//! Mobs controlados pelo servidor — porte de servers/world/mobs.ts: patrulha ociosa, aggro, perseguição, leash, morte e
//! respawn. O relógio (`now`, em ms) e o RNG são injetados: mesma semente + mesma entrada = mesmo estado.
use crate::combat::MobProp;
use crate::grid::{EntityId, Grid, CELL};
use crate::rng::Rng;
use crate::fastmap::IdMap;

pub const MOB_ATTACK_RANGE: f64 = 2.6;
const AGGRO_RADIUS: f64 = 9.0;
const LEASH: f64 = 30.0;
/// quanto tempo o corpo fica visível depois de morrer (ms)
pub const CORPSE_MS: u64 = 3000;
/// u/s por unidade de fSpeed (TICKS_PER_SEC do Neuz, 62,5/s)
pub const TICKS_PER_SEC: f64 = 62.5;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MobState { Stand, Walk, Run, Dead }

#[derive(Clone, Copy, Debug)]
pub struct Rect { pub x_min: f64, pub z_min: f64, pub x_max: f64, pub z_max: f64 }

/// terreno: onde o mob pode andar
pub trait Terrain { fn walkable(&self, x: f64, z: f64) -> bool; }

/// o que o mundo dos mobs precisa saber dos jogadores
pub trait MobHooks {
    /// posição (x, z) de um jogador vivo
    fn player(&self, id: u32) -> Option<(f64, f64)>;
    /// jogadores vivos a até `r` de (x, z), em `out`
    fn players_near(&self, x: f64, z: f64, r: f64, out: &mut Vec<(u32, f64, f64)>);
    /// o mob golpeou o jogador (quem chama calcula o dano com `combat::mob_hits_player`)
    fn attack(&mut self, mob: &Mob, player: u32);
}

#[derive(Clone, Debug)]
pub struct Mob {
    pub id: EntityId,
    pub model_id: u32,
    pub x: f64,
    pub z: f64,
    pub y: f64,
    pub h: f64,
    pub s: MobState,
    pub area: Option<Rect>,
    pub origin: (f64, f64),
    pub target: Option<(f64, f64)>,
    pub wait: f64,
    pub speed: f64,
    pub flying: bool,
    pub prop: Option<MobProp>,
    pub hp: i64,
    pub max_hp: i64,
    pub aggressive: bool,
    pub foe: u32,
    pub next_atk: u64,
    pub next_scan: u64,
    /// debuff de skill (Sneaker): até este instante (ms) o mob não anda — ainda golpeia quem está ao alcance
    pub frozen_until: u64,
    /// atordoado (Stonehand): até este instante (ms) não anda nem golpeia
    pub stun_until: u64,
    pub dmg_by: IdMap<i64>,
    pub died_at: u64,
    pub respawn_at: u64,
    /// < 0 = invocado (não renasce)
    pub respawn_ms: i64,
    pub dirty: bool,
}

/// um respawn do .rgn (tipo mover) já resolvido pelo carregador
#[derive(Clone, Debug)]
pub struct Spawn {
    pub model_id: u32,
    pub rect: Option<Rect>,
    pub pos: (f64, f64, f64),
    pub count: u32,
    pub attack_count: u32,
    pub time_s: u32,
    pub speed: f64,
    pub flying: bool,
    pub boss: bool,
    pub prop: Option<MobProp>,
}

pub struct MobWorld<R: Rng, T: Terrain> {
    mobs: Vec<Mob>,
    index: IdMap<usize>,
    grid: Grid,
    rng: R,
    terrain: T,
    seq: u32,
    scratch: Vec<(u32, f64, f64)>,
}

impl<R: Rng, T: Terrain> MobWorld<R, T> {
    /// mesma ordem de sorteios do construtor do mobs.ts: x, z (se há área), rumo, espera
    pub fn new(spawns: &[Spawn], mut rng: R, terrain: T) -> Self {
        let mut mobs: Vec<Mob> = Vec::new();
        for r in spawns {
            for k in 0..r.count.max(1) {
                let (x, z) = match r.rect {
                    Some(a) => {
                        let x = a.x_min + rng.next_f64() * (a.x_max - a.x_min);
                        let z = a.z_min + rng.next_f64() * (a.z_max - a.z_min);
                        (x, z)
                    }
                    None => (r.pos.0, r.pos.2),
                };
                let h = rng.next_f64() * 360.0;
                let wait = 1.0 + rng.next_f64() * 7.0;
                let hp = r.prop.as_ref().map_or(1, |p| p.hp);
                mobs.push(Mob {
                    id: mobs.len() as u32 + 1, model_id: r.model_id, x, z, y: r.pos.1, h, s: MobState::Stand, area: r.rect, origin: (r.pos.0, r.pos.2),
                    target: None, wait, speed: r.speed, flying: r.flying, prop: r.prop.clone(), hp, max_hp: hp,
                    aggressive: k < r.attack_count || r.boss, foe: 0, next_atk: 0, next_scan: 0, frozen_until: 0, stun_until: 0, dmg_by: IdMap::default(),
                    died_at: 0, respawn_at: 0, respawn_ms: r.time_s.max(5) as i64 * 1000, dirty: false,
                });
            }
        }
        let mut w = MobWorld { index: IdMap::default(), grid: Grid::new(), rng, terrain, seq: mobs.len() as u32, scratch: Vec::new(), mobs };
        for (i, m) in w.mobs.iter().enumerate() {
            w.index.insert(m.id, i);
            w.grid.set(m.id, m.x as f32, m.z as f32);
        }
        w
    }

    /// a grade (mobs e jogadores dividem a mesma, para o AOI)
    pub fn grid(&self) -> &Grid { &self.grid }
    pub fn grid_mut(&mut self) -> &mut Grid { &mut self.grid }
    pub fn len(&self) -> usize { self.mobs.len() }
    pub fn is_empty(&self) -> bool { self.mobs.is_empty() }
    pub fn mobs(&self) -> &[Mob] { &self.mobs }
    pub fn get(&self, id: EntityId) -> Option<&Mob> { self.index.get(&id).map(|i| &self.mobs[*i]) }
    pub fn clear_dirty(&mut self) { for m in &mut self.mobs { m.dirty = false; } }

    fn place(grid: &mut Grid, m: &mut Mob, x: f64, z: f64) {
        m.x = x;
        m.z = z;
        grid.set(m.id, x as f32, z as f32);
    }

    fn random_point(rng: &mut R, terrain: &T, m: &Mob) -> Option<(f64, f64)> {
        for _ in 0..6 {
            let (x, z) = match m.area {
                Some(a) => (a.x_min + rng.next_f64() * (a.x_max - a.x_min), a.z_min + rng.next_f64() * (a.z_max - a.z_min)),
                None => (m.origin.0 + (rng.next_f64() * 2.0 - 1.0) * 10.0, m.origin.1 + (rng.next_f64() * 2.0 - 1.0) * 10.0),
            };
            if m.flying || terrain.walkable(x, z) { return Some((x, z)); }
        }
        None
    }

    fn out_of_leash(m: &Mob) -> bool {
        match m.area {
            None => (m.x - m.origin.0).hypot(m.z - m.origin.1) > LEASH,
            Some(a) => m.x < a.x_min - LEASH || m.x > a.x_max + LEASH || m.z < a.z_min - LEASH || m.z > a.z_max + LEASH,
        }
    }

    /// anda até (tx, tz) a `speed` u/s; true ao chegar
    fn step_to(grid: &mut Grid, m: &mut Mob, tx: f64, tz: f64, speed: f64, dt: f64, stop_at: f64) -> bool {
        let (dx, dz) = (tx - m.x, tz - m.z);
        let dist = dx.hypot(dz);
        if dist > 1e-3 { m.h = dx.atan2(-dz) * 180.0 / std::f64::consts::PI; }
        let step = speed * dt;
        if dist - stop_at <= step {
            if dist > stop_at { Self::place(grid, m, m.x + dx / dist * (dist - stop_at), m.z + dz / dist * (dist - stop_at)); }
            m.dirty = true;
            return true;
        }
        Self::place(grid, m, m.x + dx / dist * step, m.z + dz / dist * step);
        m.dirty = true;
        false
    }

    fn set_state(m: &mut Mob, s: MobState) {
        if m.s != s {
            m.s = s;
            m.dirty = true;
        }
    }

    /// desiste do alvo: volta para a área e recupera o HP
    fn reset(rng: &mut R, terrain: &T, m: &mut Mob) {
        m.foe = 0;
        m.dmg_by.clear();
        if m.hp != m.max_hp {
            m.hp = m.max_hp;
            m.dirty = true;
        }
        m.target = Some(Self::random_point(rng, terrain, m).unwrap_or(m.origin));
        Self::set_state(m, MobState::Walk);
    }

    /// o jogador saiu/morreu: os mobs que o atacavam desistem
    pub fn forget(&mut self, player: u32) {
        let Self { mobs, rng, terrain, .. } = self;
        for m in mobs.iter_mut() {
            if m.foe == player { Self::reset(rng, terrain, m); }
        }
    }

    fn respawn(rng: &mut R, terrain: &T, grid: &mut Grid, m: &mut Mob) {
        let t = Self::random_point(rng, terrain, m).unwrap_or(m.origin);
        Self::place(grid, m, t.0, t.1);
        m.hp = m.max_hp;
        m.dmg_by.clear();
        m.foe = 0;
        m.target = None;
        m.wait = 2.0 + rng.next_f64() * 4.0;
        m.s = MobState::Stand;
        m.dirty = true;
    }

    /// avança patrulha, perseguição, ataques e renascimentos (`dt` em s, `now` em ms)
    pub fn tick(&mut self, dt: f64, now: u64, hooks: &mut impl MobHooks) {
        let mut gone: Vec<EntityId> = Vec::new();
        let Self { mobs, grid, rng, terrain, scratch, .. } = self;
        for m in mobs.iter_mut() {
            if m.s == MobState::Dead {
                if m.respawn_ms < 0 {
                    if now.saturating_sub(m.died_at) > CORPSE_MS + 500 { gone.push(m.id); }
                    continue;
                }
                if now >= m.respawn_at { Self::respawn(rng, terrain, grid, m); }
                continue;
            }
            let walk = ((if m.speed != 0.0 { m.speed } else { 0.05 }) * TICKS_PER_SEC * 0.5).max(0.6);
            let run = walk * 2.0;

            // agressivo sem alvo: procura alguém por perto (2× por segundo)
            if m.aggressive && m.foe == 0 && now >= m.next_scan {
                m.next_scan = now + 500;
                scratch.clear();
                hooks.players_near(m.x, m.z, AGGRO_RADIUS, scratch);
                let (mx, mz) = (m.x, m.z);
                if let Some(best) = scratch.iter().min_by(|a, b| (a.1 - mx).hypot(a.2 - mz).total_cmp(&(b.1 - mx).hypot(b.2 - mz))) {
                    m.foe = best.0;
                }
            }

            if m.stun_until > now {
                Self::set_state(m, MobState::Stand);
                continue;
            }
            if m.foe != 0 {
                let Some(p) = hooks.player(m.foe) else {
                    Self::reset(rng, terrain, m);
                    continue;
                };
                if Self::out_of_leash(m) {
                    Self::reset(rng, terrain, m);
                    continue;
                }
                let dist = (p.0 - m.x).hypot(p.1 - m.z);
                if dist > MOB_ATTACK_RANGE && m.frozen_until > now {
                    Self::set_state(m, MobState::Stand);
                    continue;
                }
                if dist > MOB_ATTACK_RANGE {
                    Self::set_state(m, MobState::Run);
                    Self::step_to(grid, m, p.0, p.1, run, dt, MOB_ATTACK_RANGE * 0.8);
                    continue;
                }
                // perto: vira para o alvo e golpeia no ritmo do mob
                let h = (p.0 - m.x).atan2(-(p.1 - m.z)) * 180.0 / std::f64::consts::PI;
                if (h - m.h).abs() > 1.0 {
                    m.h = h;
                    m.dirty = true;
                }
                Self::set_state(m, MobState::Stand);
                if now >= m.next_atk {
                    let spd = m.prop.as_ref().map_or(1000.0, |p| p.atk_speed as f64);
                    m.next_atk = now + (spd * 2.0).clamp(1500.0, 4000.0) as u64;
                    hooks.attack(m, m.foe);
                }
                continue;
            }

            // patrulha
            if m.frozen_until > now {
                Self::set_state(m, MobState::Stand);
                continue;
            }
            if m.target.is_none() {
                m.wait -= dt;
                if m.wait > 0.0 { continue; }
                match Self::random_point(rng, terrain, m) {
                    Some(t) if (t.0 - m.x).hypot(t.1 - m.z) >= 1.0 => {
                        m.target = Some(t);
                        Self::set_state(m, MobState::Walk);
                    }
                    _ => {
                        m.wait = 2.0;
                        continue;
                    }
                }
            }
            if let Some((tx, tz)) = m.target {
                if Self::step_to(grid, m, tx, tz, walk, dt, 0.0) {
                    m.target = None;
                    m.wait = 2.0 + rng.next_f64() * 6.0;
                    Self::set_state(m, MobState::Stand);
                }
            }
        }
        for id in gone { self.remove(id); }
    }

    fn remove(&mut self, id: EntityId) {
        let Some(i) = self.index.remove(&id) else { return };
        self.mobs.swap_remove(i);
        if let Some(moved) = self.mobs.get(i) { self.index.insert(moved.id, i); }
        self.grid.remove(id);
    }

    /// debuff que para o mob de andar até `until` (ms)
    pub fn freeze(&mut self, id: EntityId, until: u64) {
        if let Some(&i) = self.index.get(&id) { self.mobs[i].frozen_until = until; }
    }

    /// atordoamento (Stonehand): o mob não anda nem golpeia até `until` (ms)
    pub fn stun(&mut self, id: EntityId, until: u64) {
        if let Some(&i) = self.index.get(&id) { self.mobs[i].frozen_until = self.mobs[i].frozen_until.max(until); self.mobs[i].stun_until = until; }
    }

    /// jogador golpeou o mob: tira HP, guarda o dano (exp) e o mob passa a atacá-lo (se não for pacífico). true se morreu agora.
    pub fn damage(&mut self, id: EntityId, player: u32, dmg: i64, peaceful: bool, now: u64) -> bool {
        let Some(&i) = self.index.get(&id) else { return false };
        let m = &mut self.mobs[i];
        if m.s == MobState::Dead { return false; }
        m.hp = (m.hp - dmg).max(0);
        *m.dmg_by.entry(player).or_insert(0) += dmg;
        m.dirty = true;
        if m.foe == 0 && !peaceful {
            m.foe = player;
            m.next_atk = m.next_atk.max(now + 600);
        }
        if m.hp > 0 { return false; }
        m.s = MobState::Dead;
        m.foe = 0;
        m.target = None;
        m.died_at = now;
        m.respawn_at = now + (m.respawn_ms.max(0) as u64).max(CORPSE_MS + 2000);
        true
    }

    /// invoca `n` mobs do modelo em volta de (x, z) (painel de GM); morrem de vez
    pub fn summon(&mut self, spawn: &Spawn, x: f64, z: f64, y: f64, n: u32) -> u32 {
        for _ in 0..n {
            let a = self.rng.next_f64() * std::f64::consts::PI * 2.0;
            let d = if n > 1 { 1.5 + self.rng.next_f64() * 3.0 } else { 0.0 };
            let (mx, mz) = (x + a.cos() * d, z + a.sin() * d);
            self.seq += 1;
            let hp = spawn.prop.as_ref().map_or(1, |p| p.hp);
            let h = self.rng.next_f64() * 360.0;
            let m = Mob {
                id: self.seq, model_id: spawn.model_id, x: mx, z: mz, y, h, s: MobState::Stand,
                area: Some(Rect { x_min: x - 8.0, z_min: z - 8.0, x_max: x + 8.0, z_max: z + 8.0 }), origin: (x, z), target: None, wait: 2.0,
                speed: spawn.speed, flying: spawn.flying, prop: spawn.prop.clone(), hp, max_hp: hp, aggressive: spawn.boss, foe: 0, next_atk: 0,
                next_scan: 0, frozen_until: 0, stun_until: 0, dmg_by: IdMap::default(), died_at: 0, respawn_at: 0, respawn_ms: -1, dirty: true,
            };
            self.grid.set(m.id, mx as f32, mz as f32);
            self.index.insert(m.id, self.mobs.len());
            self.mobs.push(m);
        }
        n
    }

    /// mobs a até `r` de (x, z), os mais perto primeiro, no máximo `max`; corpos somem depois de CORPSE_MS
    pub fn near(&self, x: f64, z: f64, r: f64, max: usize, now: u64) -> Vec<EntityId> {
        let rc = (r / CELL as f64).ceil() as i32;
        let mut ids = Vec::new();
        self.grid.window(crate::grid::cell_of(x as f32, z as f32), rc, &mut ids);
        let mut out: Vec<(f64, EntityId)> = ids
            .into_iter()
            .filter_map(|id| {
                let m = self.get(id)?;
                if m.s == MobState::Dead && now.saturating_sub(m.died_at) > CORPSE_MS { return None; }
                let d = (m.x - x).hypot(m.z - z);
                (d <= r).then_some((d, id))
            })
            .collect();
        out.sort_by(|a, b| a.0.total_cmp(&b.0));
        out.truncate(max);
        out.into_iter().map(|o| o.1).collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::rng::Xorshift32;

    struct Flat;
    impl Terrain for Flat { fn walkable(&self, _: f64, _: f64) -> bool { true } }

    #[derive(Default)]
    struct Hooks { players: Vec<(u32, f64, f64)>, hits: Vec<(u32, u32)> }
    impl MobHooks for Hooks {
        fn player(&self, id: u32) -> Option<(f64, f64)> { self.players.iter().find(|p| p.0 == id).map(|p| (p.1, p.2)) }
        fn players_near(&self, x: f64, z: f64, r: f64, out: &mut Vec<(u32, f64, f64)>) {
            out.extend(self.players.iter().copied().filter(|p| (p.1 - x).hypot(p.2 - z) <= r));
        }
        fn attack(&mut self, mob: &Mob, player: u32) { self.hits.push((mob.id, player)); }
    }

    fn prop() -> MobProp { MobProp { level: 5, hp: 100, atk_speed: 1000, ..Default::default() } }
    fn spawn(count: u32, attack_count: u32) -> Spawn {
        Spawn {
            model_id: 1, rect: Some(Rect { x_min: 1000.0, z_min: 1000.0, x_max: 1040.0, z_max: 1040.0 }), pos: (1020.0, 100.0, 1020.0),
            count, attack_count, time_s: 30, speed: 0.075, flying: false, boss: false, prop: Some(prop()),
        }
    }
    fn world(s: &[Spawn]) -> MobWorld<Xorshift32, Flat> { MobWorld::new(s, Xorshift32::new(12345), Flat) }

    #[test]
    fn spawn_positions_are_deterministic_and_match_node_rng() {
        let w = world(&[spawn(3, 0)]);
        assert_eq!(w.len(), 3);
        // rng(12345): x = 1000 + 0.7769387…·40, z = 1000 + 0.3951727…·40 (mesma ordem do construtor do mobs.ts)
        let m = &w.mobs()[0];
        assert!((m.x - (1000.0 + 0.776938705239445 * 40.0)).abs() < 1e-9);
        assert!((m.z - (1000.0 + 0.3951726963277906 * 40.0)).abs() < 1e-9);
        let w2 = world(&[spawn(3, 0)]);
        assert_eq!(w.mobs()[2].x, w2.mobs()[2].x);
    }

    #[test]
    fn patrol_moves_within_area() {
        let mut w = world(&[spawn(5, 0)]);
        let mut h = Hooks::default();
        for t in 0..1200u64 { w.tick(0.05, t * 50, &mut h); }
        assert!(w.mobs().iter().any(|m| m.s == MobState::Walk || m.s == MobState::Stand));
        for m in w.mobs() { assert!(m.x >= 999.0 && m.x <= 1041.0 && m.z >= 999.0 && m.z <= 1041.0, "saiu da área: {} {}", m.x, m.z); }
    }

    #[test]
    fn aggressive_mob_chases_and_attacks_then_leashes() {
        let mut w = world(&[spawn(1, 1)]);
        let (mx, mz) = (w.mobs()[0].x, w.mobs()[0].z);
        let mut h = Hooks { players: vec![(7, mx + 6.0, mz)], hits: vec![] };
        for t in 0..200u64 { w.tick(0.05, t * 50, &mut h); }
        assert!(!h.hits.is_empty(), "mob agressivo deveria atacar o jogador a 6 u");
        assert_eq!(w.mobs()[0].foe, 7);
        // jogador some → desiste
        h.players.clear();
        w.tick(0.05, 20_000, &mut h);
        assert_eq!(w.mobs()[0].foe, 0);
    }

    #[test]
    fn frozen_mob_does_not_move_until_the_debuff_ends() {
        let mut w = world(&[spawn(1, 1)]);
        let (mx, mz) = (w.mobs()[0].x, w.mobs()[0].z);
        let mut h = Hooks { players: vec![(7, mx + 12.0, mz)], hits: vec![] };
        let id = w.mobs()[0].id;
        w.freeze(id, 3000);
        for t in 0..40u64 { w.tick(0.05, t * 50, &mut h); } // 2 s, ainda parado
        let m = w.get(id).unwrap();
        assert_eq!((m.x, m.z), (mx, mz), "mob parado não pode andar");
        for t in 80..200u64 { w.tick(0.05, t * 50, &mut h); } // depois dos 3 s volta a perseguir
        assert!(w.get(id).unwrap().x != mx || w.get(id).unwrap().z != mz, "passou o debuff: deveria andar");
    }

    #[test]
    fn damage_kills_and_respawns() {
        let mut w = world(&[spawn(1, 0)]);
        let id = w.mobs()[0].id;
        assert!(!w.damage(id, 1, 40, false, 1000));
        assert!(w.damage(id, 1, 80, false, 2000));
        assert_eq!(w.get(id).unwrap().s, MobState::Dead);
        // corpo some da lista de "perto" depois de CORPSE_MS
        let (x, z) = (w.get(id).unwrap().x, w.get(id).unwrap().z);
        assert_eq!(w.near(x, z, 50.0, 10, 2500), vec![id]);
        assert!(w.near(x, z, 50.0, 10, 2000 + CORPSE_MS + 1).is_empty());
        let mut h = Hooks::default();
        w.tick(0.05, 2000 + 30_000, &mut h);
        let m = w.get(id).unwrap();
        assert_eq!(m.s, MobState::Stand);
        assert_eq!(m.hp, m.max_hp);
    }

    #[test]
    fn summoned_mobs_do_not_respawn() {
        let mut w = world(&[]);
        let sp = spawn(1, 0);
        w.summon(&sp, 500.0, 500.0, 100.0, 2);
        assert_eq!(w.len(), 2);
        let id = w.mobs()[0].id;
        w.damage(id, 1, 1000, false, 0);
        let mut h = Hooks::default();
        w.tick(0.05, CORPSE_MS + 600, &mut h);
        assert_eq!(w.len(), 1);
        assert!(w.get(id).is_none());
        assert!(w.get(w.mobs()[0].id).is_some()); // índice consistente após swap_remove
    }

    #[test]
    fn near_respects_cap_and_order() {
        let mut w = world(&[]);
        w.summon(&spawn(1, 0), 500.0, 500.0, 100.0, 1);
        w.summon(&spawn(1, 0), 520.0, 500.0, 100.0, 1);
        let ids = w.near(500.0, 500.0, 100.0, 1, 0);
        assert_eq!(ids.len(), 1);
        assert_eq!(w.get(ids[0]).unwrap().x, 500.0);
    }
}
