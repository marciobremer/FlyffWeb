//! Servidor do link com o Gateway + loop de tick do mapa.
//!
//! Threads: uma que aceita conexões; por link uma de leitura e uma de escrita; e UMA thread de mapa, dona de todo o estado
//! (mobs, jogadores, AOI) — sem locks. A thread de mapa só recebe pela fila e envia por filas: nunca espera I/O de rede.
//! Tick de simulação a `tick_ms` (50 = 20 Hz); a rede (mobs/diffs de visão) sai a cada 2 ticks (10 Hz).
use crate::aoi::Aoi;
use crate::combat::{self, Attacker, Defender};
use crate::elements::Elements;
use crate::grid::EntityId;
use crate::mobs::{Mob, MobHooks, MobState, MobWorld, Terrain, CORPSE_MS};
use crate::protocol::*;
use crate::rng::{Rng, Xorshift32};
use crate::ws::{self, Out, WsEvent};
use serde_json::{json, Value};
use crate::fastmap::IdMap;
use std::collections::HashMap;
use std::io::{BufReader, BufWriter, Write};
use std::net::{SocketAddr, TcpListener};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
use std::thread::{self, JoinHandle};
use std::sync::atomic::{AtomicU64, Ordering::Relaxed};
use std::time::{Duration, Instant};

/// medidas da escrita no link do Node (thread de escrita → thread de mapa lê no `stats`)
static LINK_WRITE_MAX_US: AtomicU64 = AtomicU64::new(0);
static LINK_BATCH_MAX: AtomicU64 = AtomicU64::new(0);
static LINK_BYTES: AtomicU64 = AtomicU64::new(0);

/// ids de jogador na grade = PLAYER_BASE + id do personagem (ids de mob são pequenos)
pub const PLAYER_BASE: EntityId = 1 << 30;
/// limite de mobs conhecidos por jogador (MOB_MAX do Node)
const AOI_MAX: usize = 80;
/// limite de jogadores conhecidos por jogador (VIEW_MAX do Node)
const PLAYER_VIEW_MAX: usize = 100;
/// maior deslocamento aceito entre duas mensagens de posição (MAX_STEP do Node)
const MAX_STEP: f64 = 60.0;

#[derive(Clone)]
pub struct Config {
    pub secret: String,
    pub tick_ms: u64,
    /// true: o Rust calcula o dano dos golpes (jogador e mob); false: o Node calcula e o Rust cuida de mobs, IA e visão
    pub rust_combat: bool,
    /// endereço do servidor WebSocket que os navegadores usam (ex.: "0.0.0.0:8081"); None = só o link (o Node tem os sockets)
    pub ws_listen: Option<String>,
}

enum Inbound {
    Open { link: u64, out: Sender<Vec<u8>> },
    Closed { link: u64 },
    Msg { link: u64, msg: LinkIn },
    /// o Node mandou um JSON pronto para o navegador `ws` (quadro cru, byte 3)
    WsOut { ws: u32, payload: Vec<u8> },
    Ws(WsEvent),
}

pub struct Handle {
    pub addr: SocketAddr,
    /// onde os navegadores conectam (WebSocket), se ligado
    pub ws_addr: Option<SocketAddr>,
    /// termina o loop do mapa (e, com isso, o servidor)
    pub stop: Sender<()>,
    pub map_thread: JoinHandle<()>,
}

/// sobe o servidor: ouve em `addr` ("127.0.0.1:0" escolhe a porta) e roda o mapa numa thread
pub fn start<T: Terrain + Send + 'static>(addr: &str, cfg: Config, mobs: MobWorld<Xorshift32, T>) -> std::io::Result<Handle> {
    let listener = TcpListener::bind(addr)?;
    let local = listener.local_addr()?;
    let (tx, rx) = mpsc::channel::<Inbound>();
    let (stop_tx, stop_rx) = mpsc::channel::<()>();

    let acceptor_tx = tx.clone();
    thread::Builder::new().name("link-accept".into()).spawn(move || {
        for (link, stream) in (1u64..).zip(listener.incoming()) {
            let Ok(stream) = stream else { continue };
            let _ = stream.set_nodelay(true);
            let (out_tx, out_rx) = mpsc::channel::<Vec<u8>>();
            let Ok(write_half) = stream.try_clone() else { continue };
            thread::spawn(move || {
                let mut w = BufWriter::new(write_half);
                while let Ok(body) = out_rx.recv() {
                    let t0 = Instant::now();
                    let (mut batch, mut bytes) = (1u64, body.len() as u64);
                    if w.write_all(&body).is_err() { break; }
                    // junta o que já está na fila antes de esvaziar o buffer
                    while let Ok(more) = out_rx.try_recv() {
                        batch += 1;
                        bytes += more.len() as u64;
                        if w.write_all(&more).is_err() { return; }
                    }
                    if w.flush().is_err() { break; }
                    LINK_WRITE_MAX_US.fetch_max(t0.elapsed().as_micros() as u64, Relaxed);
                    LINK_BATCH_MAX.fetch_max(batch, Relaxed);
                    LINK_BYTES.fetch_add(bytes, Relaxed);
                }
            });
            let t = acceptor_tx.clone();
            let _ = t.send(Inbound::Open { link, out: out_tx });
            thread::spawn(move || {
                let mut r = BufReader::new(stream);
                while let Ok(frame) = read_frame(&mut r) {
                    // quadro cru do Node para um navegador: [3][ws u32][JSON]
                    if frame.len() >= 5 && frame[0] == 3 {
                        let ws = u32::from_be_bytes([frame[1], frame[2], frame[3], frame[4]]);
                        if t.send(Inbound::WsOut { ws, payload: frame[5..].to_vec() }).is_err() { return; }
                        continue;
                    }
                    match serde_json::from_slice::<LinkIn>(&frame) {
                        Ok(msg) => { if t.send(Inbound::Msg { link, msg }).is_err() { return; } }
                        Err(_) => break,
                    }
                }
                let _ = t.send(Inbound::Closed { link });
            });
        }
    })?;

    // servidor WebSocket dos navegadores (opcional): os eventos dele entram na mesma fila da thread de mapa
    let mut ws_addr = None;
    if let Some(addr) = cfg.ws_listen.clone() {
        let (wtx, wrx) = mpsc::channel::<WsEvent>();
        ws_addr = Some(ws::spawn_server(&addr, wtx)?);
        let fwd = tx.clone();
        thread::Builder::new().name("ws-forward".into()).spawn(move || { for ev in wrx { if fwd.send(Inbound::Ws(ev)).is_err() { break; } } })?;
    }
    let map_thread = thread::Builder::new().name("map".into()).spawn(move || run_map(rx, stop_rx, cfg, mobs))?;
    Ok(Handle { addr: local, ws_addr, stop: stop_tx, map_thread })
}

/// estado de luta que o Node empurra (equipamento, buffs, nível…): o que o Rust precisa para resolver golpes
struct Fight {
    attacker: Attacker,
    defender: Defender,
    w_elem: (i64, i64),
    s_elem: (i64, i64),
    reach: f64,
    interval_ms: u64,
    snd: [i64; 2],
    god: bool,
    skills: IdMap<SkillIn>,
}

struct Player {
    link: u64,
    /// conexão WebSocket direta (None = as mensagens passam pelo Node)
    ws: Option<u32>,
    conn: u32,
    ent: EntityId,
    name: String,
    level: i64,
    x: f64,
    z: f64,
    hp: i64,
    max_hp: i64,
    dead: bool,
    y: f64,
    h: f64,
    st: String,
    /// invisível (só staff o vê) e se ESTE jogador é staff
    invis: bool,
    staff: bool,
    /// mexeu desde o último envio de rede
    moved: bool,
    /// morto/invisível: os mobs não o veem (`flags` do Node)
    untargetable: bool,
    /// None até o Node mandar o `fighter`: sem ele os golpes continuam sendo resolvidos pelo Node
    fight: Option<Fight>,
    mp: i64,
    fp: i64,
    /// quando cada skill (id) pode ser lançada de novo (ms)
    skill_ready: IdMap<u64>,
    next_atk: u64,
}

struct Link { out: Sender<Vec<u8>>, authed: bool, probe: bool }

/// os mobs perguntam aos jogadores; o golpe do mob é só anotado e resolvido depois do tick
struct Hooks<'a> { players: &'a IdMap<Player>, attacks: Vec<(EntityId, EntityId)> }
impl MobHooks for Hooks<'_> {
    fn player(&self, id: u32) -> Option<(f64, f64)> { self.players.get(&id).filter(|p| !p.dead && !p.untargetable).map(|p| (p.x, p.z)) }
    fn players_near(&self, x: f64, z: f64, r: f64, out: &mut Vec<(u32, f64, f64)>) {
        out.extend(self.players.values().filter(|p| !p.dead && !p.untargetable && (p.x - x).hypot(p.z - z) <= r).map(|p| (p.ent, p.x, p.z)));
    }
    fn attack(&mut self, mob: &Mob, player: u32) { self.attacks.push((mob.id, player)); }
}

fn mob_hp(m: &Mob) -> i64 { ((m.hp as f64 / m.max_hp.max(1) as f64) * 1000.0).round() as i64 }
fn state_str(s: MobState) -> &'static str {
    match s { MobState::Stand => "stand", MobState::Walk => "walk", MobState::Run => "run", MobState::Dead => "dead" }
}
fn r1(v: f64) -> f64 { (v * 10.0).round() / 10.0 }
fn r2(v: f64) -> f64 { (v * 100.0).round() / 100.0 }

struct MapState<T: Terrain> {
    cfg: Config,
    mobs: MobWorld<Xorshift32, T>,
    /// visão de mobs e visão de jogadores têm limites próprios (80 e 100) e não competem entre si
    aoi: Aoi,
    aoi_p: Aoi,
    links: HashMap<u64, Link>,
    players: IdMap<Player>,
    by_conn: HashMap<(u64, u32), EntityId>,
    rng: Xorshift32,
    stats: Stats,
    tick_sum_ms: f64,
    views_sum_ms: f64,
    views_n: u64,
    /// contador dos envios de rede (escalona a revisão da visão)
    net_n: u64,
    /// navegadores conectados direto ao Rust: id → fila de saída
    ws_conns: IdMap<tokio::sync::mpsc::Sender<Out>>,
    /// mensagens descartadas por fila cheia (cliente lento)
    ws_dropped: std::cell::Cell<u64>,
    /// tabela de elementos (vem do Node) e conexão WebSocket → jogador (o Rust atende o `atk` direto)
    elements: Elements,
    ws_ent: IdMap<EntityId>,
}

impl<T: Terrain> MapState<T> {
    fn send(&self, link: u64, v: &LinkOut) {
        if let Some(l) = self.links.get(&link) { let _ = l.out.send(encode(v)); }
    }
    /// o link do Node (quem recebe os eventos dos navegadores)
    fn gateway(&self) -> Option<u64> { self.links.iter().filter(|(_, l)| l.authed && !l.probe).map(|(k, _)| *k).min() }

    /// entrega um JSON pronto ao jogador: direto no WebSocket dele (se conectou no Rust) ou em quadro cru pelo Node
    fn deliver(&self, ent: EntityId, text: &str) {
        let Some(p) = self.players.get(&ent) else { return };
        if let Some(w) = p.ws {
            if let Some(tx) = self.ws_conns.get(&w) {
                if tx.try_send(Out::Text(text.to_owned())).is_err() { self.ws_dropped.set(self.ws_dropped.get() + 1); }
                return;
            }
        }
        self.send_raw(p.link, p.conn, text.as_bytes());
    }

    fn to_player(&self, ent: EntityId, msg: Value) { self.deliver(ent, &msg.to_string()); }
    /// para todo jogador que CONHECE o mob (interest management: ninguém recebe golpe de mob que não vê)
    fn to_watchers_of(&self, mob: EntityId, also: Option<EntityId>, msg: &Value) {
        let text = msg.to_string();
        for p in self.players.values() {
            if self.aoi.knows(p.ent, mob) || Some(p.ent) == also { self.deliver(p.ent, &text); }
        }
    }

    fn handle(&mut self, now: u64, ev: Inbound) {
        match ev {
            Inbound::Open { link, out } => { self.links.insert(link, Link { out, authed: false, probe: false }); }
            Inbound::Closed { link } => {
                self.links.remove(&link);
                if self.gateway().is_none() {
                    // sem o Node ninguém atende o `join`: solta os navegadores (eles reconectam quando o link voltar)
                    for (_, tx) in self.ws_conns.drain() { let _ = tx.try_send(Out::Close); }
                    for p in self.players.values_mut() { p.ws = None; }
                }
                let gone: Vec<EntityId> = self.players.values().filter(|p| p.link == link).map(|p| p.ent).collect();
                for e in gone { self.drop_player(e); }
            }
            Inbound::Msg { link, msg } => self.handle_msg(now, link, msg),
            Inbound::WsOut { ws, payload } => {
                if let (Some(tx), Ok(text)) = (self.ws_conns.get(&ws), String::from_utf8(payload)) {
                    if tx.try_send(Out::Text(text)).is_err() { self.ws_dropped.set(self.ws_dropped.get() + 1); }
                }
            }
            Inbound::Ws(WsEvent::Open { ws, tx, ip }) => match self.gateway() {
                Some(link) => {
                    self.ws_conns.insert(ws, tx);
                    self.send(link, &LinkOut::WsOpen { ws, ip });
                }
                None => { let _ = tx.try_send(Out::Close); }
            },
            Inbound::Ws(WsEvent::Msg { ws, payload }) => {
                // `atk` de quem já tem estado de luta no Rust: resolvido aqui, o Node nem vê a mensagem
                // `skill` de ataque (melee/magic) de quem tem a skill na tabela do `fighter`: também resolvido aqui
                if payload.starts_with(b"{\"t\":\"skill\"") {
                    if let Some(&ent) = self.ws_ent.get(&ws) {
                        let v = serde_json::from_slice::<Value>(&payload).ok();
                        let (sid, target) = v.as_ref().map_or((None, None), |v| (v.get("id").and_then(Value::as_u64), v.get("target").and_then(Value::as_u64)));
                        if let (Some(sid), Some(target)) = (sid, target) {
                            if self.players.get(&ent).and_then(|p| p.fight.as_ref()).is_some_and(|f| f.skills.contains_key(&(sid as u32))) {
                                self.on_skill(now, ent, sid as u32, target as u32);
                                return;
                            }
                        }
                    }
                }
                if payload.starts_with(b"{\"t\":\"atk\"") {
                    if let Some(&ent) = self.ws_ent.get(&ws) {
                        if self.players.get(&ent).is_some_and(|p| p.fight.is_some()) {
                            if let Some(id) = serde_json::from_slice::<Value>(&payload).ok().and_then(|v| v.get("id").and_then(Value::as_u64)) { self.on_attack(now, ent, id as u32); }
                            return;
                        }
                    }
                }
                // do navegador para o Node: quadro cru [2][ws][JSON]
                if let Some(link) = self.gateway() {
                    if let Some(l) = self.links.get(&link) {
                        let mut f = Vec::with_capacity(payload.len() + 9);
                        f.extend_from_slice(&((payload.len() + 5) as u32).to_be_bytes());
                        f.push(2);
                        f.extend_from_slice(&ws.to_be_bytes());
                        f.extend_from_slice(&payload);
                        let _ = l.out.send(f);
                    }
                }
            }
            Inbound::Ws(WsEvent::Closed { ws }) => {
                self.ws_conns.remove(&ws);
                self.ws_ent.remove(&ws);
                for p in self.players.values_mut() { if p.ws == Some(ws) { p.ws = None; } }
                if let Some(link) = self.gateway() { self.send(link, &LinkOut::WsClose { ws }); }
            }
        }
    }

    fn drop_player(&mut self, ent: EntityId) {
        if let Some(p) = self.players.remove(&ent) {
            self.by_conn.remove(&(p.link, p.conn));
            if let Some(w) = p.ws { self.ws_ent.remove(&w); }
            self.aoi.remove_observer(ent);
            self.aoi_p.remove_observer(ent);
            self.mobs.grid_mut().remove(ent);
            self.mobs.forget(ent);
        }
    }

    fn handle_msg(&mut self, now: u64, link: u64, msg: LinkIn) {
        let authed = self.links.get(&link).is_some_and(|l| l.authed);
        match msg {
            LinkIn::Hello { secret, version, probe } => {
                if secret != self.cfg.secret || version != VERSION {
                    self.send(link, &LinkOut::Error { error: "hello recusado (segredo ou versão)".into() });
                    self.links.remove(&link); // fecha a fila de escrita → o socket cai
                } else {
                    if let Some(l) = self.links.get_mut(&link) { l.authed = true; l.probe = probe; }
                    self.send(link, &LinkOut::HelloOk { version: VERSION });
                }
            }
            _ if !authed => { self.links.remove(&link); }
            LinkIn::Attach { conn, ch } => {
                let ent = PLAYER_BASE + ch.id;
                if let Some(old) = self.players.get(&ent).map(|p| (p.link, p.conn)) {
                    // mesmo personagem entrando de novo: derruba o antigo
                    self.by_conn.remove(&old);
                    self.drop_player(ent);
                }
                self.mobs.grid_mut().set(ent, ch.x as f32, ch.z as f32);
                self.aoi.add_observer(ent);
                self.aoi_p.add_observer(ent);
                self.by_conn.insert((link, conn), ent);
                self.players.insert(ent, Player {
                    link, ws: ch.ws, conn, ent, name: ch.name, level: ch.level, x: ch.x, z: ch.z, y: 0.0, h: 0.0, st: "stand".into(), invis: false, staff: false, moved: false, hp: ch.hp, max_hp: ch.max_hp.max(1), dead: ch.hp <= 0,
                    untargetable: false, fight: None, mp: 0, fp: 0, skill_ready: IdMap::default(), next_atk: 0,
                });
                if let Some(w) = ch.ws { self.ws_ent.insert(w, ent); }
            }
            LinkIn::Detach { conn } => { if let Some(&e) = self.by_conn.get(&(link, conn)) { self.drop_player(e); } }
            LinkIn::Pos { list } => {
                for u in list {
                    let ent = PLAYER_BASE + u.id;
                    if let Some(p) = self.players.get_mut(&ent) {
                        p.x = u.x;
                        p.y = u.y;
                        p.z = u.z;
                        p.h = u.h;
                        p.st = u.s;
                        p.moved = true;
                        self.mobs.grid_mut().set(ent, u.x as f32, u.z as f32);
                    }
                }
            }
            LinkIn::Forget { char } => self.mobs.forget(PLAYER_BASE + char),
            LinkIn::Flags { char, untargetable, invis, staff } => {
                if let Some(p) = self.players.get_mut(&(PLAYER_BASE + char)) {
                    p.untargetable = untargetable;
                    p.invis = invis;
                    p.staff = staff;
                }
                if untargetable { self.mobs.forget(PLAYER_BASE + char); }
            }
            LinkIn::Damage { char, mob, dmg, peaceful } => {
                let ent = PLAYER_BASE + char;
                if !self.players.contains_key(&ent) { return; }
                if mob >= PLAYER_BASE || !self.aoi.knows(ent, mob) { self.stats.rejects_not_visible += 1; return; }
                self.stats.hits += 1;
                if self.mobs.damage(mob, ent, dmg, peaceful, now) { self.stats.kills += 1; }
            }
            LinkIn::Freeze { mob, ms } => { self.mobs.freeze(mob, now + ms); }
            LinkIn::Summon { spawn, x, z, y, n } => { self.mobs.summon(&spawn.to_spawn(), x, z, y, n); }
            LinkIn::Elements { table } => { self.elements = Elements { table }; }
            LinkIn::Fighter { char, f } => {
                if let Some(p) = self.players.get_mut(&(PLAYER_BASE + char)) {
                    p.hp = f.hp;
                    p.max_hp = f.max_hp.max(1);
                    p.dead = f.dead;
                    p.mp = f.mp;
                    p.fp = f.fp;
                    p.fight = Some(Fight {
                        attacker: (&f.attacker).into(), defender: (&f.defender).into(), w_elem: (f.w_elem[0], f.w_elem[1]), s_elem: (f.s_elem[0], f.s_elem[1]),
                        reach: f.reach, interval_ms: f.interval_ms, snd: f.snd, god: f.god,
                        skills: f.skills.into_iter().map(|s| (s.id, s)).collect(),
                    });
                }
            }
            LinkIn::WsClose { ws } => { if let Some(tx) = self.ws_conns.remove(&ws) { let _ = tx.try_send(Out::Close); } }
            LinkIn::Stats => {
                let mut s = self.stats.clone();
                s.ws_open = self.ws_conns.len();
                s.ws_dropped = self.ws_dropped.get();
                s.players = self.players.len();
                s.mobs = self.mobs.len();
                s.tick_avg_ms = if s.ticks > 0 { self.tick_sum_ms / s.ticks as f64 } else { 0.0 };
                s.views_avg_ms = if self.views_n > 0 { self.views_sum_ms / self.views_n as f64 } else { 0.0 };
                s.link_write_max_ms = LINK_WRITE_MAX_US.swap(0, Relaxed) as f64 / 1000.0;
                s.link_batch_max = LINK_BATCH_MAX.swap(0, Relaxed);
                s.link_bytes = LINK_BYTES.load(Relaxed);
                // máximos da janela: zeram a cada leitura
                self.stats.tick_gap_max_ms = 0.0; self.stats.tick_late_max_ms = 0.0; self.stats.input_batch_max = 0;
                self.stats.input_phase_max_ms = 0.0; self.stats.handle_max_ms = 0.0; self.stats.views_max_ms = 0.0;
                self.send(link, &LinkOut::Stats(s));
            }
            LinkIn::C2s { conn, msg } => {
                let Some(&ent) = self.by_conn.get(&(link, conn)) else { return };
                match msg.get("t").and_then(Value::as_str) {
                    Some("state") => self.on_state(ent, &msg),
                    Some("atk") => { if let Some(id) = msg.get("id").and_then(Value::as_u64) { self.on_attack(now, ent, id as u32); } }
                    _ => {}
                }
            }
        }
    }

    fn on_state(&mut self, ent: EntityId, msg: &Value) {
        let Some(p) = msg.get("p").and_then(Value::as_array) else { return };
        let (Some(x), Some(z)) = (p.first().and_then(Value::as_f64), p.get(2).and_then(Value::as_f64)) else { return };
        if !(x > 0.0 && z > 0.0 && x.is_finite() && z.is_finite()) { return; }
        let Some(pl) = self.players.get_mut(&ent) else { return };
        if pl.dead || (x - pl.x).hypot(z - pl.z) > MAX_STEP { return; }
        pl.x = x;
        pl.z = z;
        self.mobs.grid_mut().set(ent, x as f32, z as f32);
    }

    /// golpe do jogador no mob: o alvo PRECISA estar no conjunto de visão dele (AOI), vivo, no alcance, e fora da espera
    fn on_attack(&mut self, now: u64, ent: EntityId, mob_id: u32) {
        let Some(pl) = self.players.get(&ent) else { return };
        let Some(fight) = pl.fight.as_ref() else { return };
        if pl.dead { self.stats.rejects_dead += 1; return; }
        if mob_id >= PLAYER_BASE || !self.aoi.knows(ent, mob_id) { self.stats.rejects_not_visible += 1; return; }
        let Some(m) = self.mobs.get(mob_id) else { self.stats.rejects_not_visible += 1; return };
        let Some(prop) = m.prop.clone() else { return };
        if m.s == MobState::Dead { self.stats.rejects_dead += 1; return; }
        if (m.x - pl.x).hypot(m.z - pl.z) > fight.reach { self.stats.rejects_range += 1; return; }
        if now + 120 < pl.next_atk { self.stats.rejects_cooldown += 1; return; }
        self.stats.direct_atk += 1;
        let (attacker, interval, snd, link, pid, plevel) = (fight.attacker.clone(), fight.interval_ms, fight.snd, pl.link, pl.ent, pl.level);
        let elem = self.elements.player_vs_mob(fight.w_elem, &prop);
        let r = combat::player_hits_mob(&mut self.rng, &attacker, &prop, elem);
        if let Some(p) = self.players.get_mut(&ent) { p.next_atk = now + interval; }
        self.stats.hits += 1;
        let died = r.hit && self.mobs.damage(mob_id, pid, r.dmg, prop.peaceful, now);
        let (hp, mx, mz) = self.mobs.get(mob_id).map_or((0, 0.0, 0.0), |m| (mob_hp(m), m.x, m.z));
        let char_id = pid - PLAYER_BASE;
        let hit = json!({ "t": "hit", "k": "p", "a": char_id, "d": mob_id, "dmg": r.dmg, "f": (!r.hit as i64) | ((r.crit as i64) << 1), "hp": hp, "sn": snd });
        self.to_watchers_of(mob_id, Some(ent), &hit);
        // o Node desfaz Dark Illusion/modo de batalha e guarda a espera do golpe (as skills respeitam a mesma espera)
        self.send(link, &LinkOut::Attacked { char: char_id, cooldown_ms: interval });
        if died { self.mob_died(ent, mob_id, &prop, plevel, mx, mz); }
    }

    /// o mob morreu: `mdie` a quem o conhece e, para quem causou mais dano (entre os jogadores que ainda estão aqui), a exp/itens no Node
    fn mob_died(&mut self, ent: EntityId, mob_id: u32, prop: &combat::MobProp, plevel: i64, mx: f64, mz: f64) {
        self.stats.kills += 1;
        let best = self.mobs.get(mob_id).and_then(|m| m.dmg_by.iter().filter(|(id, _)| self.players.contains_key(id)).max_by_key(|(_, d)| **d).map(|(id, _)| *id)).unwrap_or(ent);
        let best_char = best - PLAYER_BASE;
        let die = json!({ "t": "mdie", "id": mob_id, "k": best_char, "exp": combat::exp_for(prop, plevel) });
        self.to_watchers_of(mob_id, Some(ent), &die);
        if let Some(link) = self.players.get(&best).or_else(|| self.players.get(&ent)).map(|p| p.link) {
            self.send(link, &LinkOut::Kill { char: best_char, mob: mob_id, x: mx, z: mz });
        }
    }

    /// skill de ataque (melee/magic) do jogador no mob — as mesmas conferências do `castSkill` do Node: skill conhecida e fora da
    /// espera, alvo na visão e no alcance (magia 24 u; corpo a corpo = alcance da arma + 1), espera do golpe, MP/FP; gasta MP/FP,
    /// manda `skillUsed`, calcula o dano (`combat::skill_damage`) e aplica
    fn on_skill(&mut self, now: u64, ent: EntityId, skill_id: u32, mob_id: u32) {
        let Some(pl) = self.players.get(&ent) else { return };
        let Some(fight) = pl.fight.as_ref() else { return };
        let Some(sk) = fight.skills.get(&skill_id) else { return };
        if pl.dead { self.stats.rejects_dead += 1; return; }
        if pl.skill_ready.get(&skill_id).is_some_and(|t| *t > now) { return; }
        if now + 120 < pl.next_atk { self.stats.rejects_cooldown += 1; return; }
        if mob_id >= PLAYER_BASE || !self.aoi.knows(ent, mob_id) { self.stats.rejects_not_visible += 1; return; }
        let Some(m) = self.mobs.get(mob_id) else { self.stats.rejects_not_visible += 1; return };
        let Some(prop) = m.prop.clone() else { return };
        if m.s == MobState::Dead { self.stats.rejects_dead += 1; return; }
        let reach = if sk.magic { 24.0 } else { fight.reach + 1.0 };
        if (m.x - pl.x).hypot(m.z - pl.z) > reach { self.stats.rejects_range += 1; return; }
        let (link, char_id, plevel, link_conn) = (pl.link, ent - PLAYER_BASE, pl.level, pl.conn);
        if pl.mp < sk.mp || pl.fp < sk.fp {
            let text = if sk.mp > pl.mp { "MP insuficiente." } else { "FP insuficiente." };
            self.to_player(ent, json!({ "t": "chat", "id": 0, "name": "", "text": text }));
            return;
        }
        let (min, max, cd, magic, mp_cost, fp_cost, template) = (sk.min, sk.max, sk.cd, sk.magic, sk.mp, sk.fp, sk.hit.clone());
        let dmg = combat::skill_damage(&mut self.rng, min, max, &prop);
        let _ = link_conn;
        let pl = self.players.get_mut(&ent).unwrap();
        pl.mp -= mp_cost;
        pl.fp -= fp_cost;
        pl.skill_ready.insert(skill_id, now + cd);
        let lock = if magic { 1500 } else { 1200 }; // a animação da skill segura o próximo golpe
        pl.next_atk = now + lock;
        let (mp, fp) = (pl.mp, pl.fp);
        self.stats.skill_casts += 1;
        self.send(link, &LinkOut::Spent { char: char_id, mp, fp });
        self.send(link, &LinkOut::Attacked { char: char_id, cooldown_ms: lock });
        self.to_player(ent, json!({ "t": "skillUsed", "id": skill_id, "cd": cd }));
        let died = self.mobs.damage(mob_id, ent, dmg, prop.peaceful, now);
        let (hp, mx, mz) = self.mobs.get(mob_id).map_or((0, 0.0, 0.0), |m| (mob_hp(m), m.x, m.z));
        let mut hit = json!({ "t": "hit", "k": "p", "a": char_id, "d": mob_id, "dmg": dmg, "f": 4, "hp": hp });
        if let (Some(o), Some(t)) = (hit.as_object_mut(), template.as_object()) { for (k, v) in t { o.insert(k.clone(), v.clone()); } }
        self.to_watchers_of(mob_id, Some(ent), &hit);
        if died { self.mob_died(ent, mob_id, &prop, plevel, mx, mz); }
    }

    /// golpes dos mobs anotados no tick: quem tem estado de luta no Rust é resolvido aqui; os outros vão para o Node
    fn resolve_mob_attacks(&mut self, attacks: Vec<(EntityId, EntityId)>) {
        for (mob_id, ent) in attacks {
            let Some(m) = self.mobs.get(mob_id) else { continue };
            let Some(prop) = m.prop.clone() else { continue };
            let Some(p) = self.players.get(&ent) else { continue };
            if p.dead { continue; }
            let Some(fight) = p.fight.as_ref().filter(|_| self.cfg.rust_combat) else {
                self.send(p.link, &LinkOut::MobAttack { char: ent - PLAYER_BASE, mob: mob_id });
                continue;
            };
            let (def, elem, god) = (fight.defender.clone(), self.elements.mob_vs_player(&prop, fight.s_elem), fight.god);
            let r = combat::mob_hits_player(&mut self.rng, &prop, &def, elem);
            self.stats.mob_hits += 1;
            let p = self.players.get_mut(&ent).unwrap();
            if r.hit && !god { p.hp = (p.hp - r.dmg).max(0); }
            let died = p.hp == 0;
            if died { p.dead = true; }
            let (hp, link, char_id) = (p.hp, p.link, ent - PLAYER_BASE);
            let hit = json!({ "t": "hit", "k": "m", "a": mob_id, "d": char_id, "dmg": r.dmg, "f": (!r.hit as i64) | ((r.crit as i64) << 1), "hp": hp });
            self.to_watchers_of(mob_id, Some(ent), &hit);
            // o Node é dono do resto da vida do personagem (barra de HP, morte, buffs, troca): recebe o valor novo
            self.send(link, &LinkOut::Hurt { char: char_id, hp, dmg: if r.hit { r.dmg } else { 0 }, dead: died }); // também o golpe que erra: o Node liga o modo de batalha
            if died { self.mobs.forget(ent); }
        }
    }

    /// envia ao cliente `conn` um JSON JÁ PRONTO (quadro "cru": o Node repassa os bytes ao WebSocket sem ler)
    fn send_raw(&self, link: u64, conn: u32, payload: &[u8]) {
        if let Some(l) = self.links.get(&link) {
            let mut f = Vec::with_capacity(payload.len() + 9);
            f.extend_from_slice(&((payload.len() + 5) as u32).to_be_bytes());
            f.push(1);
            f.extend_from_slice(&conn.to_be_bytes());
            f.extend_from_slice(payload);
            let _ = l.out.send(f);
        }
    }

    /// 10 Hz: revê (escalonado) a visão de cada jogador e manda mobs e jogadores que entraram, mudaram e saíram.
    /// Cada mob/jogador que mudou vira texto UMA vez; cada observador só junta os pedaços que ele conhece.
    fn send_views(&mut self, now: u64) {
        self.net_n += 1;
        let n = self.net_n;
        // texto de cada mob que mudou (formato `u` do cliente) e de cada jogador que andou (formato do `states`)
        let mut mob_u: IdMap<String> = IdMap::default();
        for m in self.mobs.mobs() {
            if m.dirty { mob_u.insert(m.id, format!("[{},{:.1},{:.1},{},\"{}\",{}]", m.id, m.x, m.z, m.h.round() as i64, state_str(m.s), mob_hp(m))); }
        }
        let moved: IdMap<String> = self.players.values().filter(|p| p.moved)
            .map(|p| (p.ent, format!("[{},{:.2},{:.2},{:.2},{},\"{}\"]", p.ent - PLAYER_BASE, p.x, p.y, p.z, p.h.round() as i64, p.st)))
            .collect();
        let ents: Vec<EntityId> = self.players.keys().copied().collect();
        let mut mirror: IdMap<()> = IdMap::default();
        for ent in ents {
            let Some(p) = self.players.get(&ent) else { continue };
            let (link, conn, staff) = (p.link, p.conn, p.staff);

            // ---- mobs: conjunto de visão revisto a cada 2 envios (ou sempre, se está vazio) ----
            let due_m = (n + ent as u64) % 2 == 0 || self.aoi.set_of(ent).is_none_or(|s| s.is_empty());
            let diff = if due_m {
                let mobs = &self.mobs;
                let visible = |t: EntityId| t < PLAYER_BASE && mobs.get(t).is_some_and(|m| !(m.s == MobState::Dead && now.saturating_sub(m.died_at) > CORPSE_MS));
                self.aoi.refresh(ent, mobs.grid(), AOI_MAX, visible)
            } else { Default::default() };
            let (mut a, mut u, mut d) = (Vec::<String>::new(), Vec::<&str>::new(), Vec::<String>::new());
            for t in &diff.enter {
                if let Some(m) = self.mobs.get(*t) {
                    let y = if m.flying { format!("{:.1}", m.y) } else { "null".into() };
                    a.push(format!("[{},{},{:.1},{:.1},{},\"{}\",{},{},{}]", m.id, m.model_id, m.x, m.z, m.h.round() as i64, state_str(m.s), y, mob_hp(m), m.aggressive as u8));
                }
            }
            for t in &diff.leave { d.push(t.to_string()); }
            if let Some(set) = self.aoi.set_of(ent) {
                for t in set {
                    if let Some(s) = mob_u.get(t) {
                        if !diff.enter.contains(t) { u.push(s); }
                        mirror.insert(*t, ());
                    }
                }
            }
            for t in &diff.enter { mirror.insert(*t, ()); }
            if !a.is_empty() || !u.is_empty() || !d.is_empty() {
                let msg = format!("{{\"t\":\"mobs\",\"a\":[{}],\"u\":[{}],\"d\":[{}]}}", a.join(","), u.join(","), d.join(","));
                self.deliver(ent, &msg);
            }
            if !diff.enter.is_empty() || !diff.leave.is_empty() {
                // o Node mantém o conjunto `c.mobs` (as ações conferem nele)
                self.send(link, &LinkOut::Known { char: ent - PLAYER_BASE, add: diff.enter.clone(), del: diff.leave.clone() });
            }

            // ---- jogadores: revisão a cada 4 envios (ou sempre, se vazio) ----
            let due_p = (n + ent as u64) % 4 == 0 || self.aoi_p.set_of(ent).is_none_or(|s| s.is_empty());
            let pdiff = if due_p {
                let players = &self.players;
                let visible = |t: EntityId| t >= PLAYER_BASE && players.get(&t).is_some_and(|q| !(q.invis && !staff));
                self.aoi_p.refresh(ent, self.mobs.grid(), PLAYER_VIEW_MAX, visible)
            } else { Default::default() };
            if !pdiff.enter.is_empty() || !pdiff.leave.is_empty() {
                self.stats.see_enter += pdiff.enter.len() as u64;
                self.stats.see_leave += pdiff.leave.len() as u64;
                let ids = |v: &[EntityId]| -> Vec<u32> { v.iter().map(|t| t - PLAYER_BASE).collect() };
                self.send(link, &LinkOut::See { char: ent - PLAYER_BASE, enter: ids(&pdiff.enter), leave: ids(&pdiff.leave) });
            }
            // movimentos de quem ele conhece (quem acabou de entrar já chega com a posição no `enter` do Node)
            if !moved.is_empty() {
                if let Some(set) = self.aoi_p.set_of(ent) {
                    let list: Vec<&str> = set.iter().filter(|t| !pdiff.enter.contains(t)).filter_map(|t| moved.get(t)).map(|s| s.as_str()).collect();
                    if !list.is_empty() {
                        self.stats.state_updates += list.len() as u64;
                        let msg = format!("{{\"t\":\"states\",\"list\":[{}]}}", list.join(","));
                        self.deliver(ent, &msg);
                    }
                }
            }
        }
        // espelho para o Node (só mobs que alguém vê): posição, estado e HP completos, uma vez por envio
        if !mirror.is_empty() {
            let list: Vec<Value> = mirror.keys().filter_map(|id| self.mobs.get(*id)).map(|m| json!([m.id, m.model_id, r1(m.x), r1(m.z), m.h.round(), state_str(m.s), if m.flying { json!(r1(m.y)) } else { Value::Null }, mob_hp(m)])).collect();
            let link = self.gateway();
            if let Some(link) = link { self.send(link, &LinkOut::Mirror { list }); }
        }
        self.mobs.clear_dirty();
        for p in self.players.values_mut() { p.moved = false; }
    }
}

fn run_map<T: Terrain>(rx: Receiver<Inbound>, stop: Receiver<()>, cfg: Config, mobs: MobWorld<Xorshift32, T>) {
    let tick = Duration::from_millis(cfg.tick_ms);
    let dt = cfg.tick_ms as f64 / 1000.0;
    let mut st = MapState {
        cfg, mobs, aoi: Aoi::new(), aoi_p: Aoi::new(), links: HashMap::new(), players: IdMap::default(), by_conn: HashMap::new(),
        rng: Xorshift32::new(0x9e3779b1), stats: Stats::default(), tick_sum_ms: 0.0, views_sum_ms: 0.0, views_n: 0, net_n: 0, ws_conns: IdMap::default(), ws_dropped: std::cell::Cell::new(0), elements: Elements::default(), ws_ent: IdMap::default(),
    };
    let _ = st.rng.next_f64();
    let start = Instant::now();
    let mut next = start + tick;
    let mut n = 0u64;
    let mut last_tick: Option<Instant> = None;
    loop {
        // entrada: tudo o que chegou até a hora do próximo tick
        let mut batch = 0u64;
        let phase0 = Instant::now();
        loop {
            let wait = next.saturating_duration_since(Instant::now());
            match rx.recv_timeout(wait) {
                Ok(ev) => {
                    let h0 = Instant::now();
                    let now = start.elapsed().as_millis() as u64;
                    st.handle(now, ev);
                    batch += 1;
                    st.stats.handle_max_ms = st.stats.handle_max_ms.max(h0.elapsed().as_secs_f64() * 1000.0);
                    // fluxo contínuo de mensagens não pode adiar o tick: passou da hora, sai (o resto da fila fica para a próxima fase)
                    if Instant::now() >= next { break; }
                }
                Err(RecvTimeoutError::Timeout) => break,
                Err(RecvTimeoutError::Disconnected) => return,
            }
        }
        if stop.try_recv().is_ok() { return; }
        let t0 = Instant::now();
        st.stats.input_batch_max = st.stats.input_batch_max.max(batch);
        st.stats.input_phase_max_ms = st.stats.input_phase_max_ms.max(t0.duration_since(phase0).as_secs_f64() * 1000.0);
        st.stats.tick_late_max_ms = st.stats.tick_late_max_ms.max(t0.saturating_duration_since(next).as_secs_f64() * 1000.0);
        if let Some(prev) = last_tick { st.stats.tick_gap_max_ms = st.stats.tick_gap_max_ms.max(t0.duration_since(prev).as_secs_f64() * 1000.0); }
        last_tick = Some(t0);
        let now = start.elapsed().as_millis() as u64;
        n += 1;
        let attacks = {
            let mut hooks = Hooks { players: &st.players, attacks: Vec::new() };
            st.mobs.tick(dt, now, &mut hooks);
            hooks.attacks
        };
        st.stats.mob_attacks += attacks.len() as u64;
        st.resolve_mob_attacks(attacks);
        if n % 2 == 0 {
            let v0 = Instant::now();
            st.send_views(now);
            let vm = v0.elapsed().as_secs_f64() * 1000.0;
            st.views_sum_ms += vm; st.views_n += 1;
            st.stats.views_max_ms = st.stats.views_max_ms.max(vm);
        }
        let ms = t0.elapsed().as_secs_f64() * 1000.0;
        st.stats.ticks += 1;
        st.tick_sum_ms += ms;
        st.stats.tick_max_ms = st.stats.tick_max_ms.max(ms);
        next += tick;
        if next < Instant::now() { next = Instant::now(); } // atrasou: não acumula tiques de "recuperação"
    }
}
