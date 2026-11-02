//! Interest management: cada observador tem um conjunto de entidades que "conhece". O servidor só envia
//! o que está no conjunto e só aceita ações sobre ids que estão nele (`knows`).
use crate::grid::{EntityId, Grid};
use crate::fastmap::{IdMap, IdSet};

/// Raio (em células) para entrar no conjunto (5×5 = 320 u, cobre os 150 u de visão do Node) e para sair (7×7): histerese de 1 célula.
pub const ENTER_R: i32 = 2;
pub const LEAVE_R: i32 = 3;

#[derive(Debug, Default, PartialEq, Eq)]
pub struct Diff {
    pub enter: Vec<EntityId>,
    pub leave: Vec<EntityId>,
}

#[derive(Default)]
pub struct Aoi {
    sets: IdMap<IdSet>,
    scratch: Vec<EntityId>,
}

impl Aoi {
    pub fn new() -> Self { Self::default() }

    pub fn add_observer(&mut self, id: EntityId) { self.sets.entry(id).or_default(); }
    pub fn remove_observer(&mut self, id: EntityId) { self.sets.remove(&id); }

    /// O observador `obs` conhece `target`? Toda ação com alvo deve passar por aqui.
    pub fn knows(&self, obs: EntityId, target: EntityId) -> bool {
        self.sets.get(&obs).is_some_and(|s| s.contains(&target))
    }

    pub fn set_of(&self, obs: EntityId) -> Option<&IdSet> { self.sets.get(&obs) }

    /// Revê o conjunto de `obs` contra a grade; `visible(target)` filtra (ex.: invisíveis). `max` limita o tamanho
    /// do conjunto (entram os mais próximos primeiro).
    pub fn refresh(&mut self, obs: EntityId, grid: &Grid, max: usize, visible: impl Fn(EntityId) -> bool) -> Diff {
        let mut diff = Diff::default();
        let (Some(cell), Some((ox, oz))) = (grid.cell(obs), grid.pos(obs)) else { return diff };
        let set = self.sets.entry(obs).or_default();
        // sai: fora da janela de saída, removido da grade ou ficou invisível
        set.retain(|t| {
            let keep = grid.cell(*t).is_some_and(|(cx, cz)| (cx - cell.0).abs() <= LEAVE_R && (cz - cell.1).abs() <= LEAVE_R) && visible(*t);
            if !keep { diff.leave.push(*t); }
            keep
        });
        // entra: janela de entrada, mais próximos primeiro, respeitando o limite
        self.scratch.clear();
        grid.window(cell, ENTER_R, &mut self.scratch);
        let mut fresh: Vec<(f32, EntityId)> = self.scratch.iter().copied()
            .filter(|t| *t != obs && !set.contains(t) && visible(*t))
            .filter_map(|t| grid.pos(t).map(|(x, z)| ((x - ox).hypot(z - oz), t)))
            .collect();
        fresh.sort_by(|a, b| a.0.total_cmp(&b.0));
        let free = max.saturating_sub(set.len());
        for (_, t) in fresh.into_iter().take(free) {
            set.insert(t);
            diff.enter.push(t);
        }
        diff
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn world() -> (Grid, Aoi) {
        let mut g = Grid::new();
        let mut a = Aoi::new();
        g.set(1, 100.0, 100.0);
        a.add_observer(1); // jogador em "Saint Morning"
        g.set(2, 5000.0, 5000.0);
        a.add_observer(2); // amigo longe ("Flaris")
        g.set(10, 120.0, 100.0); // mob perto
        g.set(11, 4000.0, 100.0); // mob longe
        (g, a)
    }

    #[test]
    fn far_entities_never_enter_and_actions_are_rejected() {
        let (g, mut a) = world();
        let d = a.refresh(1, &g, 80, |_| true);
        assert_eq!(d.enter, vec![10]);
        assert!(a.knows(1, 10));
        assert!(!a.knows(1, 2), "amigo distante não pode ser conhecido (nick não vaza)");
        assert!(!a.knows(1, 11), "mob fora da visão não pode ser alvo");
    }

    #[test]
    fn hysteresis_on_border() {
        let (mut g, mut a) = world();
        g.set(20, 100.0 + ENTER_R as f32 * 64.0, 100.0);
        assert!(a.refresh(1, &g, 80, |_| true).enter.contains(&20));
        g.set(20, 100.0 + LEAVE_R as f32 * 64.0, 100.0);
        let d = a.refresh(1, &g, 80, |_| true);
        assert!(d.leave.is_empty() && d.enter.is_empty());
        g.set(20, 100.0 + (LEAVE_R + 2) as f32 * 64.0, 100.0);
        assert_eq!(a.refresh(1, &g, 80, |_| true).leave, vec![20]);
    }

    #[test]
    fn invisible_leaves_set() {
        let (g, mut a) = world();
        a.refresh(1, &g, 80, |_| true);
        let d = a.refresh(1, &g, 80, |t| t != 10);
        assert_eq!(d.leave, vec![10]);
        assert!(!a.knows(1, 10));
    }

    #[test]
    fn cap_keeps_closest() {
        let mut g = Grid::new();
        let mut a = Aoi::new();
        g.set(1, 100.0, 100.0);
        a.add_observer(1);
        for i in 0..10u32 {
            g.set(100 + i, 100.0 + 5.0 * (i as f32 + 1.0), 100.0);
        }
        let d = a.refresh(1, &g, 3, |_| true);
        let mut e = d.enter.clone();
        e.sort();
        assert_eq!(e, vec![100, 101, 102]);
    }
}
