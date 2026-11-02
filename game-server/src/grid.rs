//! Grade uniforme de células de `CELL` unidades (x, z). Guarda ids por célula; troca de célula é O(1).
use crate::fastmap::{CellMap, IdMap};

pub const CELL: f32 = 64.0;
pub type EntityId = u32;

pub fn cell_of(x: f32, z: f32) -> (i32, i32) {
    ((x / CELL).floor() as i32, (z / CELL).floor() as i32)
}

#[derive(Default)]
pub struct Grid {
    cells: CellMap<Vec<EntityId>>,
    at: IdMap<((i32, i32), (f32, f32))>,
}

impl Grid {
    pub fn new() -> Self { Self::default() }

    /// Insere ou move; devolve true se mudou de célula.
    pub fn set(&mut self, id: EntityId, x: f32, z: f32) -> bool {
        let c = cell_of(x, z);
        match self.at.get_mut(&id) {
            Some((old, pos)) => {
                *pos = (x, z);
                if *old == c { return false; }
                if let Some(v) = self.cells.get_mut(old) {
                    if let Some(i) = v.iter().position(|e| *e == id) { v.swap_remove(i); }
                }
                *old = c;
                self.cells.entry(c).or_default().push(id);
                true
            }
            None => {
                self.at.insert(id, (c, (x, z)));
                self.cells.entry(c).or_default().push(id);
                true
            }
        }
    }

    pub fn remove(&mut self, id: EntityId) {
        if let Some((c, _)) = self.at.remove(&id) {
            if let Some(v) = self.cells.get_mut(&c) {
                if let Some(i) = v.iter().position(|e| *e == id) { v.swap_remove(i); }
            }
        }
    }

    pub fn pos(&self, id: EntityId) -> Option<(f32, f32)> { self.at.get(&id).map(|a| a.1) }
    pub fn cell(&self, id: EntityId) -> Option<(i32, i32)> { self.at.get(&id).map(|a| a.0) }

    /// Ids nas células a até `r` células de (cx, cz) (janela quadrada (2r+1)²).
    pub fn window(&self, (cx, cz): (i32, i32), r: i32, out: &mut Vec<EntityId>) {
        for x in cx - r..=cx + r {
            for z in cz - r..=cz + r {
                if let Some(v) = self.cells.get(&(x, z)) { out.extend_from_slice(v); }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn move_between_cells() {
        let mut g = Grid::new();
        assert!(g.set(1, 10.0, 10.0));
        assert!(!g.set(1, 20.0, 20.0));
        assert!(g.set(1, 100.0, 10.0));
        let mut o = vec![];
        g.window((0, 0), 0, &mut o);
        assert!(o.is_empty());
        g.window((1, 0), 0, &mut o);
        assert_eq!(o, vec![1]);
        g.remove(1);
        assert!(g.pos(1).is_none());
    }
}
