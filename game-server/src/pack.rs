//! Pacote do mapa exportado pelo Node (`tools/export-mappack.ts`): spawns do .rgn + propMover e atributos do terreno.
use crate::combat::MobProp;
use crate::mobs::{Rect, Spawn, Terrain};
use serde::Deserialize;
use std::path::Path;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RectIn { pub x_min: f64, pub z_min: f64, pub x_max: f64, pub z_max: f64 }

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpawnIn {
    pub model_id: u32,
    pub rect: Option<RectIn>,
    pub pos: [f64; 3],
    pub count: u32,
    pub attack_count: u32,
    pub time_s: u32,
    pub speed: f64,
    pub flying: bool,
    pub boss: bool,
    pub prop: Option<MobProp>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Pack {
    pub world: String,
    pub tiles_x: usize,
    pub tiles_z: usize,
    pub tile_size: f64,
    pub mpu: f64,
    pub spawns: Vec<SpawnIn>,
}

impl SpawnIn {
    pub fn to_spawn(&self) -> Spawn {
        Spawn {
            model_id: self.model_id,
            rect: self.rect.as_ref().map(|r| Rect { x_min: r.x_min, z_min: r.z_min, x_max: r.x_max, z_max: r.z_max }),
            pos: (self.pos[0], self.pos[1], self.pos[2]),
            count: self.count, attack_count: self.attack_count, time_s: self.time_s, speed: self.speed, flying: self.flying, boss: self.boss, prop: self.prop.clone(),
        }
    }
}

impl Pack {
    pub fn spawns(&self) -> Vec<Spawn> {
        self.spawns.iter().map(|s| Spawn {
            model_id: s.model_id,
            rect: s.rect.as_ref().map(|r| Rect { x_min: r.x_min, z_min: r.z_min, x_max: r.x_max, z_max: r.z_max }),
            pos: (s.pos[0], s.pos[1], s.pos[2]),
            count: s.count, attack_count: s.attack_count, time_s: s.time_s, speed: s.speed, flying: s.flying, boss: s.boss, prop: s.prop.clone(),
        }).collect()
    }
}

/// terreno: atributo por ponto (0 normal, 1 NoWalk, 2 NoFly, 3 NoMove, 4 Die), mesma regra do `ServerWorld.attrAt`
pub struct AttrTerrain { data: Vec<u8>, tiles_x: usize, tiles_z: usize, tile_size: f64, mpu: f64 }

const S: usize = 129;

impl AttrTerrain {
    pub fn open(dir: &Path, pack: &Pack) -> std::io::Result<Self> {
        let data = std::fs::read(dir.join("attrs.bin"))?;
        if data.len() != pack.tiles_x * pack.tiles_z * S * S {
            return Err(std::io::Error::new(std::io::ErrorKind::InvalidData, "attrs.bin com tamanho inesperado"));
        }
        Ok(AttrTerrain { data, tiles_x: pack.tiles_x, tiles_z: pack.tiles_z, tile_size: pack.tile_size, mpu: pack.mpu })
    }

    pub fn attr_at(&self, x: f64, z: f64) -> u8 {
        let (tx, tz) = ((x / self.tile_size).floor(), (z / self.tile_size).floor());
        if tx < 0.0 || tz < 0.0 || tx >= self.tiles_x as f64 || tz >= self.tiles_z as f64 { return 0; }
        let (tx, tz) = (tx as usize, tz as usize);
        let ix = ((x - tx as f64 * self.tile_size) / self.mpu).round().clamp(0.0, (S - 1) as f64) as usize;
        let iz = ((z - tz as f64 * self.tile_size) / self.mpu).round().clamp(0.0, (S - 1) as f64) as usize;
        self.data[(tz * self.tiles_x + tx) * S * S + iz * S + ix]
    }
}

impl Terrain for AttrTerrain {
    fn walkable(&self, x: f64, z: f64) -> bool { !matches!(self.attr_at(x, z), 1 | 3 | 4) }
}

/// terreno aberto (testes e mapas sem pacote)
pub struct Open;
impl Terrain for Open {
    fn walkable(&self, _: f64, _: f64) -> bool { true }
}
