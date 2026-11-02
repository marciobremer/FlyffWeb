//! Fator do elemento no golpe (`UpgradeRules.elementFactor` do Node, GetDamagePropertyFactor): n/10000 a somar ao dano.
//! A tabela de níveis (dano, defesa, ataque extra por nível) vem do Node (`elements` no link), lida do Lua do servidor.
use crate::combat::MobProp;

const ELEMENT_TABLE: [[u8; 6]; 6] = [[0, 0, 0, 0, 0, 0], [0, 1, 2, 0, 3, 0], [0, 3, 1, 2, 0, 0], [0, 0, 3, 1, 0, 2], [0, 2, 0, 0, 1, 3], [0, 0, 0, 3, 2, 1]];

#[derive(Default, Clone)]
pub struct Elements {
    /// por nível: [dano, defesa, ataque extra]
    pub table: Vec<[i64; 3]>,
}

impl Elements {
    fn at(&self, n: i64) -> [i64; 3] {
        if n < 0 || self.table.is_empty() { return [0; 3]; }
        self.table[(n as usize).min(self.table.len() - 1)]
    }
    fn dmg(&self, n: i64) -> i64 { self.at(n)[0] }
    fn def(&self, n: i64) -> i64 { if n > 0 { self.at(n)[1] } else { 0 } }
    fn add_atk(&self, n: i64) -> i64 { self.at(n)[2] }

    pub fn factor(&self, atk_type: i64, atk_level: i64, def_type: i64, def_level: i64) -> i64 {
        if atk_type == 0 && def_type == 0 { return 0; }
        let kind = ELEMENT_TABLE.get(atk_type as usize).and_then(|r| r.get(def_type as usize)).copied().unwrap_or(0);
        let (mut factor, mut level) = (0i64, 0i64);
        match kind {
            0 | 1 => {
                if atk_level > 0 && def_level == 0 { factor += self.dmg(atk_level); }
                else if atk_level == 0 && def_level > 0 { factor -= self.def(def_level - 3); }
                else if atk_level > 0 && def_level > 0 { level = atk_level - def_level; }
            }
            2 => level = atk_level - 5 - def_level,
            3 => {
                level = atk_level - if def_level > 5 { def_level - 5 } else { 0 };
                if level > 0 { factor += self.add_atk(level); }
            }
            _ => {}
        }
        if level != 0 { factor += if level > 0 { self.dmg(level) } else { -self.def(-level) }; }
        factor
    }

    /// golpe do jogador (arma `w`) no mob
    pub fn player_vs_mob(&self, w: (i64, i64), m: &MobProp) -> i64 { self.factor(w.0, w.1, m.element, m.element_level) }
    /// golpe do mob na suit `s` do jogador
    pub fn mob_vs_player(&self, m: &MobProp, s: (i64, i64)) -> i64 { self.factor(m.element, m.element_level, s.0, s.1) }
}
