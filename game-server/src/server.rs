//! Servidor do link com o Gateway + loop de tick do mapa.
//!
//! Threads: uma que aceita conexões; por link uma de leitura e uma de escrita; e UMA thread de mapa, dona de todo o estado
//! (mobs, jogadores, AOI) — sem locks. A thread de mapa só recebe pela fila e envia por filas: nunca espera I/O de rede.
//! Tick de simulação a `tick_ms` (50 = 20 Hz); a rede (mobs/diffs de visão) sai a cada 2 ticks (10 Hz).
use crate::aoi::Aoi;
use crate::combat::{self, Attacker, Defender};
use crate::grid::EntityId;
use crate::mobs::{Mob, MobHooks, MobState, MobWorld, Terrain, CORPSE_MS};
use crate::protocol::*;
use crate::rng::{Rng, Xorshift32};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::{BufReader, BufWriter, Write};
use std::net::{SocketAddr, TcpListener};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

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
}

enum Inbound {
    Open { link: u64, out: Sender<Vec<u8>> },
    Closed { link: u64 },
    Msg { link: u64, msg: LinkIn },
}

pub struct Handle {
    pub addr: SocketAddr,
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
                    if w.write_all(&body).is_err() { break; }
                    // junta o que já está na fila antes de esvaziar o buffer
                    while let Ok(more) = out_rx.try_recv() {
                        if w.write_all(&more).is_err() { return; }
                    }
                    if w.flush().is_err() { break; }
                }
            });
            let t = acceptor_tx.clone();
            let _ = t.send(Inbound::Open { link, out: out_tx });
            thread::spawn(move || {
                let mut r = BufReader::new(stream);
                while let Ok(frame) = read_frame(&mut r) {
                    match serde_json::from_slice::<LinkIn>(&frame) {
                        Ok(msg) => { if t.send(Inbound::Msg { link, msg }).is_err() { return; } }
                        Err(_) => break,
                    }
                }
                let _ = t.send(Inbound::Closed { link });
            });
        }
    })?;

    let map_thread = thread::Builder::new().name("map".into()).spawn(move || run_map(rx, stop_rx, cfg, mobs))?;
    Ok(Handle { addr: local, stop: stop_tx, map_thread })
}

struct Player {
    link: u64,
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
    attacker: Attacker,
    defender: Defender,
    reach: f64,
    interval_ms: u64,
    next_atk: u64,
}

struct Link { out: Sender<Vec<u8>>, authed: bool }

/// os mobs perguntam aos jogadores; o golpe do mob é só anotado e resolvido depois do tick
struct Hooks<'a> { players: &'a HashMap<EntityId, Player>, attacks: Vec<(EntityId, EntityId)> }
impl MobHooks for Hooks<'_> {
    fn player(&self, id: u32) -> Option<(f64, f64)> { self.players.get(&id).filter(|p| !p.dead).map(|p| (p.x, p.z)) }
    fn players_near(&self, x: f64, z: f64, r: f64, out: &mut Vec<(u32, f64, f64)>) {
        out.extend(self.players.values().filter(|p| !p.dead && (p.x - x).hypot(p.z - z) <= r).map(|p| (p.ent, p.x, p.z)));
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
    players: HashMap<EntityId, Player>,
    by_conn: HashMap<(u64, u32), EntityId>,
    rng: Xorshift32,
    stats: Stats,
    tick_sum_ms: f64,
    /// contador dos envios de rede (escalona a revisão da visão)
    net_n: u64,
}

impl<T: Terrain> MapState<T> {
    fn send(&self, link: u64, v: &LinkOut) {
        if let Some(l) = self.links.get(&link) { let _ = l.out.send(encode(v)); }
    }
    fn to_player(&self, ent: EntityId, msg: Value) {
        if let Some(p) = self.players.get(&ent) { self.send(p.link, &LinkOut::S2c { conn: p.conn, msg }); }
    }
    /// para todo jogador que CONHECE o mob (interest management: ninguém recebe golpe de mob que não vê)
    fn to_watchers_of(&self, mob: EntityId, also: Option<EntityId>, msg: &Value) {
        for p in self.players.values() {
            if self.aoi.knows(p.ent, mob) || Some(p.ent) == also {
                self.send(p.link, &LinkOut::S2c { conn: p.conn, msg: msg.clone() });
            }
        }
    }

    fn handle(&mut self, now: u64, ev: Inbound) {
        match ev {
            Inbound::Open { link, out } => { self.links.insert(link, Link { out, authed: false }); }
            Inbound::Closed { link } => {
                self.links.remove(&link);
                let gone: Vec<EntityId> = self.players.values().filter(|p| p.link == link).map(|p| p.ent).collect();
                for e in gone { self.drop_player(e); }
            }
            Inbound::Msg { link, msg } => self.handle_msg(now, link, msg),
        }
    }

    fn drop_player(&mut self, ent: EntityId) {
        if let Some(p) = self.players.remove(&ent) {
            self.by_conn.remove(&(p.link, p.conn));
            self.aoi.remove_observer(ent);
            self.aoi_p.remove_observer(ent);
            self.mobs.grid_mut().remove(ent);
            self.mobs.forget(ent);
        }
    }

    fn handle_msg(&mut self, now: u64, link: u64, msg: LinkIn) {
        let authed = self.links.get(&link).is_some_and(|l| l.authed);
        match msg {
            LinkIn::Hello { secret, version } => {
                if secret != self.cfg.secret || version != VERSION {
                    self.send(link, &LinkOut::Error { error: "hello recusado (segredo ou versão)".into() });
                    self.links.remove(&link); // fecha a fila de escrita → o socket cai
                } else {
                    if let Some(l) = self.links.get_mut(&link) { l.authed = true; }
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
                let mut attacker: Attacker = (&ch.attacker).into();
                if attacker.level == 0 { attacker.level = ch.level; }
                let mut defender: Defender = (&ch.defender).into();
                if defender.level == 0 { defender.level = ch.level; }
                self.mobs.grid_mut().set(ent, ch.x as f32, ch.z as f32);
                self.aoi.add_observer(ent);
                self.aoi_p.add_observer(ent);
                self.by_conn.insert((link, conn), ent);
                self.players.insert(ent, Player {
                    link, conn, ent, name: ch.name, level: ch.level, x: ch.x, z: ch.z, y: 0.0, h: 0.0, st: "stand".into(), invis: false, staff: false, moved: false, hp: ch.hp, max_hp: ch.max_hp.max(1), dead: ch.hp <= 0,
                    attacker, defender, reach: ch.reach, interval_ms: ch.interval_ms, next_atk: 0,
                });
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
                    p.dead = untargetable;
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
            LinkIn::Summon { spawn, x, z, y, n } => { self.mobs.summon(&spawn.to_spawn(), x, z, y, n); }
            LinkIn::Stats => {
                let mut s = self.stats.clone();
                s.players = self.players.len();
                s.mobs = self.mobs.len();
                s.tick_avg_ms = if s.ticks > 0 { self.tick_sum_ms / s.ticks as f64 } else { 0.0 };
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
        if pl.dead { self.stats.rejects_dead += 1; return; }
        if mob_id >= PLAYER_BASE || !self.aoi.knows(ent, mob_id) { self.stats.rejects_not_visible += 1; return; }
        let Some(m) = self.mobs.get(mob_id) else { self.stats.rejects_not_visible += 1; return };
        let Some(prop) = m.prop.clone() else { return };
        if m.s == MobState::Dead { self.stats.rejects_dead += 1; return; }
        if (m.x - pl.x).hypot(m.z - pl.z) > pl.reach { self.stats.rejects_range += 1; return; }
        if now + 120 < pl.next_atk { self.stats.rejects_cooldown += 1; return; }
        let (attacker, interval, pid, plevel) = (pl.attacker.clone(), pl.interval_ms, pl.ent, pl.level);
        let r = combat::player_hits_mob(&mut self.rng, &attacker, &prop, 0);
        if let Some(p) = self.players.get_mut(&ent) { p.next_atk = now + interval; }
        self.stats.hits += 1;
        let died = r.hit && self.mobs.damage(mob_id, pid, r.dmg, prop.peaceful, now);
        let hp = self.mobs.get(mob_id).map_or(0, mob_hp);
        let char_id = pid - PLAYER_BASE;
        let hit = json!({ "t": "hit", "k": "p", "a": char_id, "d": mob_id, "dmg": r.dmg, "f": (!r.hit as i64) | ((r.crit as i64) << 1), "hp": hp });
        self.to_watchers_of(mob_id, Some(ent), &hit);
        if died {
            self.stats.kills += 1;
            // exp e drop: o Node (dono do inventário/personagem) aplica; a mensagem já leva o valor
            let die = json!({ "t": "mdie", "id": mob_id, "k": char_id, "exp": combat::exp_for(&prop, plevel) });
            self.to_watchers_of(mob_id, Some(ent), &die);
        }
    }

    /// golpes dos mobs anotados no tick
    fn resolve_mob_attacks(&mut self, attacks: Vec<(EntityId, EntityId)>) {
        for (mob_id, ent) in attacks {
            let Some(m) = self.mobs.get(mob_id) else { continue };
            let Some(prop) = m.prop.clone() else { continue };
            let Some(p) = self.players.get(&ent) else { continue };
            if p.dead { continue; }
            let def = p.defender.clone();
            let r = combat::mob_hits_player(&mut self.rng, &prop, &def, 0);
            self.stats.mob_hits += 1;
            let p = self.players.get_mut(&ent).unwrap();
            if r.hit { p.hp = (p.hp - r.dmg).max(0); }
            let died = p.hp == 0;
            if died { p.dead = true; }
            let (hp, char_id) = (p.hp, ent - PLAYER_BASE);
            let hit = json!({ "t": "hit", "k": "m", "a": mob_id, "d": char_id, "dmg": r.dmg, "f": (!r.hit as i64) | ((r.crit as i64) << 1), "hp": hp });
            self.to_watchers_of(mob_id, Some(ent), &hit);
            if died {
                self.to_player(ent, json!({ "t": "pdie", "id": char_id }));
                self.mobs.forget(ent);
            }
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
        let mut mob_u: HashMap<EntityId, String> = HashMap::new();
        for m in self.mobs.mobs() {
            if m.dirty { mob_u.insert(m.id, format!("[{},{:.1},{:.1},{},\"{}\",{}]", m.id, m.x, m.z, m.h.round() as i64, state_str(m.s), mob_hp(m))); }
        }
        let moved: HashMap<EntityId, String> = self.players.values().filter(|p| p.moved)
            .map(|p| (p.ent, format!("[{},{:.2},{:.2},{:.2},{},\"{}\"]", p.ent - PLAYER_BASE, p.x, p.y, p.z, p.h.round() as i64, p.st)))
            .collect();
        let ents: Vec<EntityId> = self.players.keys().copied().collect();
        let mut mirror: HashMap<EntityId, ()> = HashMap::new();
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
                    a.push(format!("[{},{},{:.1},{:.1},{},\"{}\",{},{}]", m.id, m.model_id, m.x, m.z, m.h.round() as i64, state_str(m.s), y, mob_hp(m)));
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
                self.send_raw(link, conn, msg.as_bytes());
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
                        self.send_raw(link, conn, msg.as_bytes());
                    }
                }
            }
        }
        // espelho para o Node (só mobs que alguém vê): posição, estado e HP completos, uma vez por envio
        if !mirror.is_empty() {
            let list: Vec<Value> = mirror.keys().filter_map(|id| self.mobs.get(*id)).map(|m| json!([m.id, m.model_id, r1(m.x), r1(m.z), m.h.round(), state_str(m.s), if m.flying { json!(r1(m.y)) } else { Value::Null }, mob_hp(m)])).collect();
            let link = self.links.iter().find(|(_, l)| l.authed).map(|(k, _)| *k);
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
        cfg, mobs, aoi: Aoi::new(), aoi_p: Aoi::new(), links: HashMap::new(), players: HashMap::new(), by_conn: HashMap::new(),
        rng: Xorshift32::new(0x9e3779b1), stats: Stats::default(), tick_sum_ms: 0.0, net_n: 0,
    };
    let _ = st.rng.next_f64();
    let start = Instant::now();
    let mut next = start + tick;
    let mut n = 0u64;
    loop {
        // entrada: tudo o que chegou até a hora do próximo tick
        loop {
            let wait = next.saturating_duration_since(Instant::now());
            match rx.recv_timeout(wait) {
                Ok(ev) => { let now = start.elapsed().as_millis() as u64; st.handle(now, ev); }
                Err(RecvTimeoutError::Timeout) => break,
                Err(RecvTimeoutError::Disconnected) => return,
            }
        }
        if stop.try_recv().is_ok() { return; }
        let t0 = Instant::now();
        let now = start.elapsed().as_millis() as u64;
        n += 1;
        let attacks = {
            let mut hooks = Hooks { players: &st.players, attacks: Vec::new() };
            st.mobs.tick(dt, now, &mut hooks);
            hooks.attacks
        };
        st.stats.mob_attacks += attacks.len() as u64;
        if st.cfg.rust_combat {
            st.resolve_mob_attacks(attacks);
        } else {
            // o Node calcula o dano: avisa o dono do personagem que o mob golpeou
            for (mob, ent) in attacks {
                if let Some(p) = st.players.get(&ent) { st.send(p.link, &LinkOut::MobAttack { char: ent - PLAYER_BASE, mob }); }
            }
        }
        if n % 2 == 0 { st.send_views(now); }
        let ms = t0.elapsed().as_secs_f64() * 1000.0;
        st.stats.ticks += 1;
        st.tick_sum_ms += ms;
        st.stats.tick_max_ms = st.stats.tick_max_ms.max(ms);
        next += tick;
        if next < Instant::now() { next = Instant::now(); } // atrasou: não acumula tiques de "recuperação"
    }
}
