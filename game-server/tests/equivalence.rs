//! Equivalência Node ↔ Rust: refaz os casos de `tools/combat-vectors.ts` (gerados pelo `CombatRules` de verdade) com a
//! mesma sequência de sorteios. Regenerar: `npx tsx tools/combat-vectors.ts`.
use game_server::combat::*;
use game_server::rng::SeqRng;
use serde_json::Value;

fn i(v: &Value, k: &str) -> i64 { v[k].as_f64().unwrap_or_else(|| panic!("campo {k}")) as i64 }

fn mob(v: &Value) -> MobProp {
    MobProp {
        level: i(v, "level"), sta: i(v, "sta"), dex: i(v, "dex"), hr: i(v, "hr"), er: i(v, "er"), hp: i(v, "hp"),
        natural_armor: i(v, "naturalArmor"), atk_speed: 1000, atk_min: i(v, "atkMin"), atk_max: i(v, "atkMax"), exp: 0, peaceful: false,
    }
}
fn seq(v: &Value) -> SeqRng { SeqRng::new(v["seq"].as_array().unwrap().iter().map(|x| x.as_f64().unwrap()).collect()) }
fn expected(v: &Value) -> HitResult {
    let e = &v["expected"];
    HitResult { hit: e["hit"].as_bool().unwrap(), dmg: i(e, "dmg"), crit: e["crit"].as_bool().unwrap() }
}

fn load() -> Value {
    let p = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/vectors.json");
    serde_json::from_str(&std::fs::read_to_string(p).expect("rode: npx tsx tools/combat-vectors.ts")).unwrap()
}

#[test]
fn player_hits_mob_matches_node() {
    let all = load();
    let cases = all["playerHitsMob"].as_array().unwrap();
    let mut hits = 0;
    for (n, c) in cases.iter().enumerate() {
        let a = &c["a"];
        let att = Attacker {
            level: i(a, "level"), dex: i(a, "dex"), hit_bonus: i(a, "hitBonus"), atk_min: i(a, "atkMin"), atk_max: i(a, "atkMax"),
            crit_chance: i(a, "crit"), crit_bonus: i(a, "critBonus"), atkpower_rate: i(a, "atkRate"), monster_dmg: i(a, "monsterDmg"),
            atkpower: i(a, "atkPower"), w_rare: a["wRare"].as_f64().unwrap() as f32,
        };
        let got = player_hits_mob(&mut seq(c), &att, &mob(&c["m"]), i(c, "elem"));
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
        let d = &c["d"];
        let def = Defender { level: i(d, "level"), dodge: i(d, "dodge"), def: i(d, "def") };
        let got = mob_hits_player(&mut seq(c), &mob(&c["m"]), &def, i(c, "elem"));
        assert_eq!(got, expected(c), "caso {n}: {c}");
        hits += got.hit as usize;
    }
    assert!(hits > 50, "poucos acertos para o teste ser útil: {hits}");
}
