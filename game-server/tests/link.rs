//! Integração do link TCP + tick: um "Gateway" de teste fala o protocolo real com o servidor.
use game_server::combat::MobProp;
use game_server::mobs::{MobWorld, Rect, Spawn};
use game_server::pack::Open;
use game_server::protocol::*;
use game_server::rng::Xorshift32;
use game_server::server::{start, Config};
use serde_json::{json, Value};
use std::net::TcpStream;
use std::time::{Duration, Instant};

struct Gw(TcpStream);
impl Gw {
    fn connect(addr: std::net::SocketAddr) -> Gw {
        let s = TcpStream::connect(addr).unwrap();
        s.set_read_timeout(Some(Duration::from_millis(200))).unwrap();
        Gw(s)
    }
    fn send(&mut self, v: Value) { write_frame(&mut self.0, &serde_json::to_vec(&v).unwrap()).unwrap(); }
    /// próximo quadro, se chegar a tempo
    fn recv(&mut self) -> Option<Value> {
        match read_frame(&mut self.0) {
            // quadro cru (byte 1): [1][conn u32][JSON do cliente] → vira {"k":"s2c","conn":…,"msg":…} para os asserts
            Ok(b) if b.first() == Some(&1) => {
                let conn = u32::from_be_bytes([b[1], b[2], b[3], b[4]]);
                Some(json!({ "k": "s2c", "conn": conn, "msg": serde_json::from_slice::<Value>(&b[5..]).unwrap() }))
            }
            Ok(b) => Some(serde_json::from_slice(&b).unwrap()),
            Err(e) if matches!(e.kind(), std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut) => None,
            Err(_) => None,
        }
    }
    /// lê até achar uma mensagem de cliente `t` para `conn` (ou estourar 3 s)
    fn wait_s2c(&mut self, conn: u32, t: &str) -> Option<Value> {
        let end = Instant::now() + Duration::from_secs(3);
        while Instant::now() < end {
            if let Some(f) = self.recv() {
                if f["k"] == "s2c" && f["conn"] == conn && f["msg"]["t"] == t { return Some(f["msg"].clone()); }
            }
        }
        None
    }
    fn stats(&mut self) -> Stats {
        self.send(json!({ "k": "stats" }));
        let end = Instant::now() + Duration::from_secs(3);
        while Instant::now() < end {
            if let Some(f) = self.recv() { if f["k"] == "stats" { return serde_json::from_value(f).unwrap(); } }
        }
        panic!("sem stats");
    }
}

fn prop(hp: i64) -> MobProp { MobProp { level: 5, sta: 10, dex: 10, hr: 20, er: 1, hp, atk_speed: 1000, atk_min: 5, atk_max: 9, exp: 50, ..Default::default() } }
fn spawn(x: f64, count: u32, hp: i64) -> Spawn {
    Spawn { model_id: 7, rect: Some(Rect { x_min: x, z_min: 1000.0, x_max: x + 10.0, z_max: 1010.0 }), pos: (x + 5.0, 100.0, 1005.0), count, attack_count: 0, time_s: 30, speed: 0.0, flying: false, boss: false, prop: Some(prop(hp)) }
}

fn boot() -> (game_server::server::Handle, Gw) {
    // ids 1–3: perto do jogador (x≈1000); id 4: longe (x≈6000), existe mas não deve ser visível; id 5: perto, fraco (250 HP)
    let mobs = MobWorld::new(&[spawn(1000.0, 3, 100_000), spawn(6000.0, 1, 100_000), spawn(1020.0, 1, 250)], Xorshift32::new(1), Open);
    let h = start("127.0.0.1:0", Config { secret: "s3".into(), tick_ms: 20, rust_combat: true, ws_listen: None }, mobs).unwrap();
    let mut gw = Gw::connect(h.addr);
    gw.send(json!({ "k": "hello", "secret": "s3", "version": VERSION }));
    assert_eq!(gw.recv().unwrap()["k"], "hello_ok");
    (h, gw)
}

fn attach(gw: &mut Gw, conn: u32, id: u32, x: f64, z: f64) {
    gw.send(json!({ "k": "attach", "conn": conn, "ch": {
        "id": id, "name": "Teste", "level": 20, "x": x, "z": z, "hp": 1000, "maxHp": 1000, "reach": 50.0, "intervalMs": 50,
        "attacker": { "level": 20, "dex": 5000, "atkMin": 100, "atkMax": 100, "crit": 0 }, "defender": { "level": 20, "dodge": 0, "def": 0 } } }));
}

#[test]
fn wrong_secret_is_rejected() {
    let mobs = MobWorld::new(&[spawn(1000.0, 1, 100)], Xorshift32::new(1), Open);
    let h = start("127.0.0.1:0", Config { secret: "certo".into(), tick_ms: 20, rust_combat: true, ws_listen: None }, mobs).unwrap();
    let mut gw = Gw::connect(h.addr);
    gw.send(json!({ "k": "hello", "secret": "errado", "version": VERSION }));
    assert_eq!(gw.recv().unwrap()["k"], "error");
    let _ = h.stop.send(());
}

#[test]
fn player_sees_only_nearby_mobs_and_attacks_only_visible_ones() {
    let (h, mut gw) = boot();
    attach(&mut gw, 1, 42, 1005.0, 1005.0);

    // 1) recebe os 3 mobs de perto e NÃO o mob longe (id 4)
    let m = gw.wait_s2c(1, "mobs").expect("mensagem mobs");
    let ids: Vec<u64> = m["a"].as_array().unwrap().iter().map(|e| e[0].as_u64().unwrap()).collect();
    assert_eq!({ let mut v = ids.clone(); v.sort(); v }, vec![1, 2, 3, 5], "só os mobs dos tiles vizinhos");

    // 2) atacar o mob longe (existe no servidor, mas fora da visão) → recusado e contado
    gw.send(json!({ "k": "c2s", "conn": 1, "msg": { "t": "atk", "id": 4 } }));
    gw.send(json!({ "k": "c2s", "conn": 1, "msg": { "t": "atk", "id": 999_999 } }));
    let s = gw.stats();
    assert_eq!(s.rejects_not_visible, 2);
    assert_eq!(s.hits, 0);

    // 3) atacar mob visível → golpe (hit) com HP caindo
    gw.send(json!({ "k": "c2s", "conn": 1, "msg": { "t": "atk", "id": 1 } }));
    let hit = gw.wait_s2c(1, "hit").expect("hit");
    assert_eq!(hit["d"], 1);
    assert_eq!(hit["a"], 42);
    assert_eq!(hit["f"], 0, "dex enorme: acerta");
    assert!(hit["hp"].as_i64().unwrap() < 1000);

    // 4) recebe atualização do mob ferido (HP em milésimos) e o servidor mede o tick
    let s = gw.stats();
    assert_eq!(s.hits, 1);
    assert!(s.ticks > 0 && s.tick_max_ms < 50.0, "tick estourou: {s:?}");
    let _ = h.stop.send(());
}

#[test]
fn killing_a_mob_sends_mdie_with_exp_and_far_player_never_hears_about_it() {
    let (h, mut gw) = boot();
    attach(&mut gw, 1, 42, 1005.0, 1005.0); // perto
    attach(&mut gw, 2, 43, 6005.0, 1005.0); // longe (vê só o mob 4)
    // os dois `mobs` chegam no mesmo envio, em ordem qualquer
    let (mut near, mut far) = (None, None);
    let end = Instant::now() + Duration::from_secs(3);
    while (near.is_none() || far.is_none()) && Instant::now() < end {
        if let Some(f) = gw.recv() {
            if f["k"] == "s2c" && f["msg"]["t"] == "mobs" { if f["conn"] == 1 { near = Some(f["msg"].clone()); } else if f["conn"] == 2 { far = Some(f["msg"].clone()); } }
        }
    }
    near.expect("mobs de 1");
    let far = far.expect("mobs de 2");
    assert_eq!(far["a"].as_array().unwrap().len(), 1);

    // o jogador longe tenta atacar o mob 1 (perto do outro jogador): recusado
    gw.send(json!({ "k": "c2s", "conn": 2, "msg": { "t": "atk", "id": 1 } }));
    assert_eq!(gw.stats().rejects_not_visible, 1);

    // o jogador perto mata o mob 5 (250 HP, ~100 de dano por golpe)
    let mut killed = None;
    for _ in 0..40 {
        gw.send(json!({ "k": "c2s", "conn": 1, "msg": { "t": "atk", "id": 5 } }));
        std::thread::sleep(Duration::from_millis(55));
        while let Some(f) = gw.recv() {
            if f["k"] == "s2c" && f["conn"] == 1 && f["msg"]["t"] == "mdie" { killed = Some(f["msg"].clone()); }
            assert!(!(f["k"] == "s2c" && f["conn"] == 2 && (f["msg"]["t"] == "hit" || f["msg"]["t"] == "mdie")), "jogador longe recebeu evento de combate: {f}");
        }
        if killed.is_some() { break; }
    }
    let k = killed.expect("mdie");
    assert_eq!(k["id"], 5);
    assert_eq!(k["k"], 42);
    assert!(k["exp"].as_i64().unwrap() > 0);
    let _ = h.stop.send(());
}

impl Gw {
    /// primeiro quadro que satisfaz `f` (ou None em 3 s)
    fn wait_frame(&mut self, f: impl Fn(&Value) -> bool) -> Option<Value> {
        let end = Instant::now() + Duration::from_secs(3);
        while Instant::now() < end {
            if let Some(v) = self.recv() { if f(&v) { return Some(v); } }
        }
        None
    }
}

#[test]
fn players_see_each_other_only_nearby_and_invisible_hides_from_non_staff() {
    let (h, mut gw) = boot();
    attach(&mut gw, 1, 10, 1005.0, 1005.0); // A
    attach(&mut gw, 2, 11, 1030.0, 1005.0); // B perto de A
    attach(&mut gw, 3, 12, 9000.0, 9000.0); // C longe

    // A passa a ver B (e só B); C não vê ninguém
    let see = gw.wait_frame(|f| f["k"] == "see" && f["char"] == 10 && f["enter"].as_array().is_some_and(|a| !a.is_empty())).expect("see de A");
    assert_eq!(see["enter"], json!([11]));
    assert!(gw.wait_frame(|f| f["k"] == "see" && f["char"] == 12).is_none(), "C longe não deve ver ninguém");

    // B anda: A recebe `states` com B e nenhum jogador longe aparece
    gw.send(json!({ "k": "pos", "list": [{ "id": 11, "x": 1040.0, "y": 100.0, "z": 1005.0, "h": 90.0, "s": "run" }] }));
    let st = gw.wait_s2c(1, "states").expect("states para A");
    assert_eq!(st["list"][0][0], 11);
    assert_eq!(st["list"][0][5], "run");

    // B fica invisível: A (não staff) recebe leave; com A staff, volta a ver
    gw.send(json!({ "k": "flags", "char": 11, "untargetable": true, "invis": true, "staff": false }));
    let leave = gw.wait_frame(|f| f["k"] == "see" && f["char"] == 10 && f["leave"].as_array().is_some_and(|a| !a.is_empty())).expect("leave");
    assert_eq!(leave["leave"], json!([11]));
    gw.send(json!({ "k": "flags", "char": 10, "untargetable": false, "invis": false, "staff": true }));
    let back = gw.wait_frame(|f| f["k"] == "see" && f["char"] == 10 && f["enter"].as_array().is_some_and(|a| !a.is_empty())).expect("staff volta a ver");
    assert_eq!(back["enter"], json!([11]));
    let s = gw.stats();
    assert!(s.see_enter >= 3 && s.see_leave >= 1);
    let _ = h.stop.send(());
}
