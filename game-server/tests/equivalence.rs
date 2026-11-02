//! Equivalência Node ↔ Rust: refaz os casos de `tools/combat-vectors.ts` (gerados pelo `CombatRules` e pelo
//! `UpgradeRules.elementFactor` de verdade; as entradas vêm do `fightSnapshot`) com a mesma sequência de sorteios.
//! Regenerar: `npx tsx tools/combat-vectors.ts`.
use game_server::combat::*;
use game_server::elements::Elements;
use game_server::protocol::{AttackerIn, DefenderIn};
use game_server::rng::SeqRng;
use serde_json::Value;

fn i(v: &Value, k: &str) -> i64 { v[k].as_f64().unwrap_or_else(|| panic!("campo {k}")) as i64 }

fn mob(v: &Value) -> MobProp {
    MobProp {
        level: i(v, "level"), sta: i(v, "sta"), dex: i(v, "dex"), hr: i(v, "hr"), er: i(v, "er"), hp: i(v, "hp"),
        natural_armor: i(v, "naturalArmor"), atk_speed: 1000, element: i(v, "element"), element_level: i(v, "elementLevel"),
        atk_min: i(v, "atkMin"), atk_max: i(v, "atkMax"), exp: 0, peaceful: false,
    }
}
fn seq(v: &Value) -> SeqRng { SeqRng::new(v["seq"].as_array().unwrap().iter().map(|x| x.as_f64().unwrap()).collect()) }
fn expected(v: &Value) -> HitResult {
    let e = &v["expected"];
    HitResult { hit: e["hit"].as_bool().unwrap(), dmg: i(e, "dmg"), crit: e["crit"].as_bool().unwrap() }
}
fn elements(v: &Value) -> Elements {
    Elements { table: v["table"].as_array().unwrap().iter().map(|r| { let r = r.as_array().unwrap(); [r[0].as_i64().unwrap(), r[1].as_i64().unwrap(), r[2].as_i64().unwrap()] }).collect() }
}
fn pair(v: &Value) -> (i64, i64) { (v[0].as_i64().unwrap(), v[1].as_i64().unwrap()) }

fn load() -> Value {
    let p = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/vectors.json");
    serde_json::from_str(&std::fs::read_to_string(p).expect("rode: npx tsx tools/combat-vectors.ts")).unwrap()
}

#[test]
fn element_factor_matches_node() {
    let all = load();
    let cases = all["elementFactor"].as_array().unwrap();
    let mut nonzero = 0;
    for (n, c) in cases.iter().enumerate() {
        let q: Vec<i64> = c["q"].as_array().unwrap().iter().map(|x| x.as_i64().unwrap()).collect();
        let got = elements(c).factor(q[0], q[1], q[2], q[3]);
        assert_eq!(got, c["expected"].as_i64().unwrap(), "caso {n}: {c}");
        nonzero += (got != 0) as usize;
    }
    assert!(nonzero > 200, "poucos fatores não nulos para o teste ser útil: {nonzero}");
}

#[test]
fn player_hits_mob_matches_node() {
    let all = load();
    let cases = all["playerHitsMob"].as_array().unwrap();
    let mut hits = 0;
    for (n, c) in cases.iter().enumerate() {
        let a: AttackerIn = serde_json::from_value(c["attacker"].clone()).unwrap();
        let m = mob(&c["m"]);
        let elem = elements(c).player_vs_mob(pair(&c["wElem"]), &m);
        let got = player_hits_mob(&mut seq(c), &(&a).into(), &m, elem);
        assert_eq!(got, expected(c), "caso {n}: {c}");
        hits += got.hit as usize;
    }
    assert!(hits > 100, "poucos acertos para o teste ser útil: {hits}");
}

#[test]
fn mob_hits_player_matches_node() {
    let all = load();
    let cases = all["mobHitsPlayer"].as_array().unwrap();
    let mut hits = 0;
    for (n, c) in cases.iter().enumerate() {
        let d: DefenderIn = serde_json::from_value(c["defender"].clone()).unwrap();
        let m = mob(&c["m"]);
        let elem = elements(c).mob_vs_player(&m, pair(&c["sElem"]));
        let got = mob_hits_player(&mut seq(c), &m, &(&d).into(), elem);
        assert_eq!(got, expected(c), "caso {n}: {c}");
        hits += got.hit as usize;
    }
    assert!(hits > 50, "poucos acertos para o teste ser útil: {hits}");
}
