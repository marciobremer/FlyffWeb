//! Binário do Game Server de UM mapa.
//!   game-server --pack data/mappack/WdMadrigal [--listen 127.0.0.1:9201] [--secret SEGREDO] [--tick-ms 50] [--rust-combat] [--ws-listen 0.0.0.0:8081]
//! O segredo também pode vir de GAME_LINK_SECRET.
use game_server::mobs::MobWorld;
use game_server::pack::{AttrTerrain, Pack};
use game_server::rng::Xorshift32;
use game_server::server::{start, Config};
use std::path::PathBuf;

fn arg(name: &str) -> Option<String> {
    let a: Vec<String> = std::env::args().collect();
    a.iter().position(|x| x == name).and_then(|i| a.get(i + 1).cloned())
}

fn main() {
    let dir = PathBuf::from(arg("--pack").expect("uso: game-server --pack <pasta do pacote do mapa>"));
    let listen = arg("--listen").unwrap_or_else(|| "127.0.0.1:9201".into());
    let secret = arg("--secret").or_else(|| std::env::var("GAME_LINK_SECRET").ok()).expect("falta --secret ou GAME_LINK_SECRET");
    let tick_ms = arg("--tick-ms").and_then(|s| s.parse().ok()).unwrap_or(50);
    if !listen.starts_with("127.0.0.1") && !listen.starts_with("localhost") && !listen.starts_with("[::1]") {
        eprintln!("recusado: o link do Gateway só pode escutar em loopback (recebi {listen})");
        std::process::exit(2);
    }

    let pack: Pack = serde_json::from_slice(&std::fs::read(dir.join("pack.json")).expect("pack.json")).expect("pack.json inválido");
    let terrain = AttrTerrain::open(&dir, &pack).expect("attrs.bin");
    let mobs = MobWorld::new(&pack.spawns(), Xorshift32::new(12345), terrain);
    println!("mapa {}: {} mobs em {} respawns, tick {} ms", pack.world, mobs.len(), pack.spawns.len(), tick_ms);
    let h = start(&listen, Config { secret, tick_ms, rust_combat: std::env::args().any(|a| a == "--rust-combat"), ws_listen: arg("--ws-listen") }, mobs).expect("não consegui escutar");
    println!("link do Gateway em {}", h.addr);
    h.map_thread.join().ok();
}
