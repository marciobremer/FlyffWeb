//! Benchmark do tick dos mobs: 7368 mobs (como Madrigal) e N jogadores espalhados; mede ms por tick de simulação e o
//! custo de montar a lista "perto" de cada jogador (80 mobs, raio 150) a cada 200 ms.
//!   cargo run --release --example bench_mobs -- [jogadores]
use game_server::mobs::*;
use game_server::rng::{Rng, Xorshift32};
use std::time::Instant;

struct Flat;
impl Terrain for Flat { fn walkable(&self, _: f64, _: f64) -> bool { true } }

struct Players(Vec<(u32, f64, f64)>);
impl MobHooks for Players {
    fn player(&self, id: u32) -> Option<(f64, f64)> { self.0.iter().find(|p| p.0 == id).map(|p| (p.1, p.2)) }
    fn players_near(&self, x: f64, z: f64, r: f64, out: &mut Vec<(u32, f64, f64)>) {
        out.extend(self.0.iter().copied().filter(|p| (p.1 - x).hypot(p.2 - z) <= r));
    }
    fn attack(&mut self, _: &Mob, _: u32) {}
}

fn main() {
    let players: usize = std::env::args().nth(1).and_then(|s| s.parse().ok()).unwrap_or(100);
    let mut r = Xorshift32::new(7);
    let prop = game_server::combat::MobProp { level: 10, hp: 500, atk_speed: 1000, ..Default::default() };
    // 1022 respawns de ~7 mobs em 15360×15360
    let spawns: Vec<Spawn> = (0..1022).map(|_| {
        let (x, z) = (200.0 + r.next_f64() * 14900.0, 200.0 + r.next_f64() * 14900.0);
        Spawn { model_id: 1, rect: Some(Rect { x_min: x, z_min: z, x_max: x + 40.0, z_max: z + 40.0 }), pos: (x + 20.0, 100.0, z + 20.0), count: 7, attack_count: 2, time_s: 30, speed: 0.075, flying: false, boss: false, prop: Some(prop.clone()) }
    }).collect();
    let mut w = MobWorld::new(&spawns, Xorshift32::new(12345), Flat);
    let mut hooks = Players((0..players as u32).map(|i| (i + 1, 200.0 + r.next_f64() * 14900.0, 200.0 + r.next_f64() * 14900.0)).collect());
    println!("{} mobs, {} jogadores", w.len(), players);

    let ticks = 2000u64;
    let mut worst = 0f64;
    let t0 = Instant::now();
    for t in 0..ticks {
        let s = Instant::now();
        w.tick(0.05, t * 50, &mut hooks);
        worst = worst.max(s.elapsed().as_secs_f64() * 1000.0);
    }
    let total = t0.elapsed().as_secs_f64() * 1000.0;
    println!("tick de simulação (20 Hz): média {:.3} ms, pior {:.3} ms (orçamento 50 ms)", total / ticks as f64, worst);

    let s = Instant::now();
    let mut n = 0;
    for _ in 0..20 {
        for p in &hooks.0 { n += w.near(p.1, p.2, 150.0, 80, 0).len(); }
    }
    println!("near() para {} jogadores: {:.3} ms por rodada ({} mobs enviados/rodada)", players, s.elapsed().as_secs_f64() * 1000.0 / 20.0, n / 20);
}
