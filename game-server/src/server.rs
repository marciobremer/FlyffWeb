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

struct MapState<T: Terrain> {
    cfg: Config,
    mobs: MobWorld<Xorshift32, T>,
    aoi: Aoi,
    links: HashMap<u64, Link>,
    players: HashMap<EntityId, Player>,
    by_conn: HashMap<(u64, u32), EntityId>,
    rng: Xorshift32,
    stats: Stats,
    tick_sum_ms: f64,
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
                self.by_conn.insert((link, conn), ent);
                self.players.insert(ent, Player {
                    link, conn, ent, name: ch.name, level: ch.level, x: ch.x, z: ch.z, hp: ch.hp, max_hp: ch.max_hp.max(1), dead: ch.hp <= 0,
                    attacker, defender, reach: ch.reach, interval_ms: ch.interval_ms, next_atk: 0,
                });
            }
            LinkIn::Detach { conn } => { if let Some(&e) = self.by_conn.get(&(link, conn)) { self.drop_player(e); } }
            LinkIn::Pos { list } => {
                for (id, x, z) in list {
                    let ent = PLAYER_BASE + id;
                    if let Some(p) = self.players.get_mut(&ent) {
                        p.x = x;
                        p.z = z;
                        self.mobs.grid_mut().set(ent, x as f32, z as f32);
                    }
                }
            }
            LinkIn::Forget { char } => self.mobs.forget(PLAYER_BASE + char),
            LinkIn::Flags { char, untargetable } => {
                if let Some(p) = self.players.get_mut(&(PLAYER_BASE + char)) { p.dead = untargetable; }
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

    /// 10 Hz: revê o conjunto de visão de cada jogador e manda os mobs que entraram, mudaram e saíram (formato `mobs` do cliente)
    fn send_views(&mut self, now: u64) {
        let ents: Vec<EntityId> = self.players.keys().copied().collect();
        for ent in ents {
            let diff = {
                let mobs = &self.mobs;
                let visible = |t: EntityId| t >= PLAYER_BASE || mobs.get(t).is_some_and(|m| !(m.s == MobState::Dead && now.saturating_sub(m.died_at) > CORPSE_MS));
                self.aoi.refresh(ent, mobs.grid(), AOI_MAX, visible)
            };
            let (mut a, mut u, mut d) = (Vec::new(), Vec::new(), Vec::new());
            for t in &diff.enter {
                if *t >= PLAYER_BASE { continue; } // jogadores entram numa etapa seguinte (enter/leave de PlayerView)
                if let Some(m) = self.mobs.get(*t) {
                    a.push(json!([m.id, m.model_id, r1(m.x), r1(m.z), m.h.round(), state_str(m.s), if m.flying { json!(r1(m.y)) } else { Value::Null }, mob_hp(m)]));
                }
            }
            for t in &diff.leave { if *t < PLAYER_BASE { d.push(json!(t)); } }
            if let Some(set) = self.aoi.set_of(ent) {
                for t in set {
                    if *t >= PLAYER_BASE || diff.enter.contains(t) { continue; }
                    if let Some(m) = self.mobs.get(*t).filter(|m| m.dirty) {
                        u.push(json!([m.id, r1(m.x), r1(m.z), m.h.round(), state_str(m.s), mob_hp(m)]));
                    }
                }
            }
            if !a.is_empty() || !u.is_empty() || !d.is_empty() {
                self.to_player(ent, json!({ "t": "mobs", "a": a, "u": u, "d": d }));
            }
        }
        self.mobs.clear_dirty();
    }
}

fn run_map<T: Terrain>(rx: Receiver<Inbound>, stop: Receiver<()>, cfg: Config, mobs: MobWorld<Xorshift32, T>) {
    let tick = Duration::from_millis(cfg.tick_ms);
    let dt = cfg.tick_ms as f64 / 1000.0;
    let mut st = MapState {
        cfg, mobs, aoi: Aoi::new(), links: HashMap::new(), players: HashMap::new(), by_conn: HashMap::new(),
        rng: Xorshift32::new(0x9e3779b1), stats: Stats::default(), tick_sum_ms: 0.0,
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
