//! Fórmulas de golpe jogador ↔ mob, portadas de servers/world/combat.ts (`playerHitsMob`, `mobHitsPlayer`, `mobDef`, `expFor`).
//! Os atributos do jogador já chegam agregados (equipamentos, buffs e DST somados): o Node continua montando o `Fighter`
//! até o inventário migrar. A ORDEM dos sorteios é a mesma do Node — os vetores de equivalência dependem disso.
use crate::rng::Rng;
use serde::Deserialize;

const MIN_HR: f64 = 20.0;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct HitResult { pub hit: bool, pub dmg: i64, pub crit: bool }

/// atributos de luta do jogador, já somados
#[derive(Clone, Debug, Default)]
pub struct Attacker {
    pub level: i64,
    pub dex: i64,
    /// `hitBonus`: adjHit + DST_ADJ_HITRATE
    pub hit_bonus: i64,
    /// `playerAtk` (GetHitMinMax)
    pub atk_min: i64,
    pub atk_max: i64,
    /// `critChance` (%)
    pub crit_chance: i64,
    /// DST_CRITICAL_BONUS, DST_ATKPOWER_RATE, DST_MONSTER_DMG, DST_ATKPOWER
    pub crit_bonus: i64,
    pub atkpower_rate: i64,
    pub monster_dmg: i64,
    pub atkpower: i64,
    /// fAttackRate da raridade da arma (1.0 = comum)
    pub w_rare: f32,
}

/// o que o jogador oferece como alvo
#[derive(Clone, Debug, Default)]
pub struct Defender {
    pub level: i64,
    /// `dodge` = floor(dex·0.5 + parry + DST_PARRY)
    pub dodge: i64,
    /// defesa em pedaços (`CombatRules.defenseParts`): base + item/4 sorteado entre min e máx, × (1 + rate/100)
    pub def_base: i64,
    pub def_min: i64,
    pub def_max: i64,
    pub def_rate: i64,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct MobProp {
    pub level: i64,
    pub sta: i64,
    pub dex: i64,
    pub hr: i64,
    pub er: i64,
    pub hp: i64,
    pub natural_armor: i64,
    pub atk_speed: i64,
    /// eElementType (1 fogo, 2 água, 3 elétrico, 4 vento, 5 terra; 0 nenhum) e nível do elemento
    pub element: i64,
    pub element_level: i64,
    /// dwAtkMin/Max já somados ao dwAbility da arma do mob (II_WEA_MOB_*)
    pub atk_min: i64,
    pub atk_max: i64,
    pub exp: i64,
    pub peaceful: bool,
}

/// `float` do C++: int × float vira float (32 bits) antes do (int)
fn f32mul(a: i64, b: f32) -> i64 { ((a as f64 * b as f64) as f32).trunc() as i64 }

fn chance(rng: &mut impl Rng, p: f64) -> bool { rng.next_f64() * 100.0 < MIN_HR.max(96f64.min(p)) }

pub fn mob_def(m: &MobProp) -> i64 {
    let v = (((m.level * 2) as f64 + m.sta as f64 / 2.0) / 2.8 - 4.0 + (m.sta - 14) as f64).floor() as i64 + (m.natural_armor as f64 / 4.0).floor() as i64;
    v.max(0)
}

/// chance de acerto (%) do jogador no mob, antes do limite 20–96
pub fn player_hit_rate(a: &Attacker, m: &MobProp) -> i64 {
    let hr = a.dex as f64;
    let (lv, mlv) = (a.level as f64, m.level as f64);
    (((hr * 1.6) / (hr + m.er as f64)) * 1.5 * ((lv * 1.2) / (lv + mlv)) * 100.0).floor() as i64 + a.hit_bonus
}

/// `elem` = elementFactor(arma, mob) (n/10000)
pub fn player_hits_mob(rng: &mut impl Rng, a: &Attacker, m: &MobProp, elem: i64) -> HitResult {
    if !chance(rng, player_hit_rate(a, m) as f64) { return HitResult::default(); }
    let (mut min, mut max) = (a.atk_min, a.atk_max);
    let crit = rng.next_f64() * 100.0 < a.crit_chance as f64;
    if crit {
        let (ka, kb) = if a.level > m.level { (1.2, 2.0) } else { (1.1, 1.4) };
        let bonus = 1f64.max(1.0 + a.crit_bonus as f64 / 100.0);
        min = (min as f64 * ka * bonus).floor() as i64;
        max = (max as f64 * kb * bonus).floor() as i64;
    }
    let e = 1.0 + elem as f64 / 10000.0;
    let r = rng.range(min, max) as f64;
    let atk = (r * e * (1.0 + a.atkpower_rate as f64 / 100.0) * (1.0 + a.monster_dmg as f64 / 100.0)).floor() as i64 + a.atkpower;
    let atk = if a.w_rare != 1.0 { f32mul(atk, a.w_rare) } else { atk };
    HitResult { hit: true, dmg: (atk - mob_def(m)).max(1), crit }
}

/// `elem` = elementFactor(mob, suit) (n/10000)
pub fn mob_hits_player(rng: &mut impl Rng, m: &MobProp, d: &Defender, elem: i64) -> HitResult {
    let (hr, lv, plv) = (m.hr as f64, m.level as f64, d.level as f64);
    let rate = ((hr * 1.5) / (hr + d.dodge as f64)) * 2.0 * ((lv * 0.5) / (lv + plv * 0.3)) * 100.0;
    if !chance(rng, rate) { return HitResult::default(); }
    let mut atk = rng.range(m.atk_min, m.atk_max) as f64;
    if m.level > d.level { atk = (atk * (1.0 + 0.05 * (m.level - d.level) as f64)).floor(); }
    let crit = rng.next_f64() * 100.0 < (m.dex as f64 / 10.0).floor();
    if crit {
        let k = if d.level > m.level { 1.4 + rng.next_f64() * 0.4 } else { 1.1 + rng.next_f64() * 0.3 };
        atk = (atk * k).floor();
    }
    let atk = ((atk * (1.0 + elem as f64 / 10000.0)).floor() as i64).max(0);
    // a defesa sorteia o item DEPOIS do crítico e do elemento (como `playerDef(f)` no fim de mobHitsPlayer)
    let item = rng.range(d.def_min, d.def_max) as f64;
    let def = (((d.def_base as f64 + (item / 4.0).floor()) * (1.0 + d.def_rate as f64 / 100.0)).floor() as i64).max(0);
    HitResult { hit: true, dmg: 1.max(atk - def).max((atk as f64 * 0.1).floor() as i64), crit }
}

/// dano de uma skill de ataque (`SkillCatalog.meleePower` − `mobSkillDefense`): sorteio na faixa [min, max] do poder e a defesa
/// natural do mob / 7 + 1 (um sorteio só, como o `Math.random()` do Node)
pub fn skill_damage(rng: &mut impl Rng, min: i64, max: i64, m: &MobProp) -> i64 {
    let span = 1.max(max - min + 1);
    let power = 1.max(min + (rng.next_f64() * span as f64).floor() as i64);
    1.max(power - ((m.natural_armor as f64 / 7.0 + 1.0).floor() as i64))
}

/// exp por matar o mob (penalidade por diferença de nível)
pub fn exp_for(m: &MobProp, player_level: i64) -> i64 {
    let diff = player_level - m.level;
    let k = if diff >= 5 { 0.1f64.max(1.0 - (diff - 4) as f64 * 0.2) } else { 1.0 };
    (if diff >= 5 { 0 } else { 1 }).max((m.exp as f64 * k).floor() as i64)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::rng::SeqRng;

    fn mob() -> MobProp { MobProp { level: 10, sta: 20, dex: 30, hr: 40, er: 12, hp: 500, natural_armor: 8, atk_speed: 1000, element: 0, element_level: 0, atk_min: 20, atk_max: 30, exp: 100, peaceful: false } }

    #[test]
    fn def_and_exp() {
        assert_eq!(mob_def(&mob()), ((20.0 + 10.0) / 2.8 - 4.0 + 6.0f64).floor() as i64 + 2);
        assert_eq!(exp_for(&mob(), 10), 100);
        assert_eq!(exp_for(&mob(), 15), 80); // diff 5: 1 - 0.2
        assert_eq!(exp_for(&mob(), 40), 10); // piso de 10 %
    }

    #[test]
    fn miss_when_roll_is_high() {
        let a = Attacker { level: 10, dex: 20, atk_min: 10, atk_max: 20, w_rare: 1.0, ..Default::default() };
        let r = player_hits_mob(&mut SeqRng::new(vec![0.99]), &a, &mob(), 0);
        assert!(!r.hit);
    }

    #[test]
    fn hit_uses_rolls_in_node_order() {
        let a = Attacker { level: 10, dex: 20, atk_min: 10, atk_max: 20, crit_chance: 50, w_rare: 1.0, ..Default::default() };
        // 0.0 acerta, 0.9 não critica (90 >= 50), 0.0 → rand = min
        let r = player_hits_mob(&mut SeqRng::new(vec![0.0, 0.9, 0.0]), &a, &mob(), 0);
        assert_eq!(r, HitResult { hit: true, dmg: (10 - mob_def(&mob())).max(1), crit: false });
    }
}
