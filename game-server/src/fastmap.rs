//! HashMap/HashSet com um hasher barato para chaves inteiras (ids de entidade, células): o SipHash padrão do Rust é
//! feito para resistir a ataques e pesa nas contas por jogador a cada envio de rede. Aqui as chaves são nossas.
use std::collections::{HashMap, HashSet};
use std::hash::{BuildHasherDefault, Hasher};

#[derive(Default, Clone, Copy)]
pub struct IdHasher(u64);

impl Hasher for IdHasher {
    fn write(&mut self, bytes: &[u8]) {
        for &b in bytes { self.0 = (self.0.rotate_left(5) ^ b as u64).wrapping_mul(0x517c_c1b7_2722_0a95); }
    }
    fn write_u32(&mut self, i: u32) { self.0 = (self.0.rotate_left(5) ^ i as u64).wrapping_mul(0x9e37_79b9_7f4a_7c15); }
    fn write_i32(&mut self, i: i32) { self.write_u32(i as u32); }
    fn finish(&self) -> u64 { self.0 ^ (self.0 >> 29) }
}

pub type IdMap<V> = HashMap<u32, V, BuildHasherDefault<IdHasher>>;
pub type IdSet = HashSet<u32, BuildHasherDefault<IdHasher>>;
pub type CellMap<V> = HashMap<(i32, i32), V, BuildHasherDefault<IdHasher>>;
