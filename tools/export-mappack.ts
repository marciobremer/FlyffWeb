import fs from 'node:fs';
import path from 'node:path';
import { RES_DIR } from '../servers/common/config';
import { ServerWorld } from '../servers/world/world';
import { isBoss } from '../servers/world/mobs';
import { OT } from '../shared/formats/types';
import { MAP_SIZE } from '../shared/formats/types';

/**
 * Exporta o "pacote do mapa" que o Game Server em Rust lê (ele não parseia .wld/.rgn/propMover):
 *   mappack/<Mundo>/pack.json   spawns de mover (um por respawn do .rgn) + tamanho do mapa
 *   mappack/<Mundo>/attrs.bin   atributos do terreno: por tile (z-maior, x-menor) 129×129 bytes (0 normal, 1 NoWalk, 2 NoFly, 3 NoMove, 4 Die)
 *
 *   npx tsx tools/export-mappack.ts [WdMadrigal] [pasta-de-saida]
 */
const name = process.argv[2] ?? 'WdMadrigal';
const out = path.resolve(process.argv[3] ?? path.join(import.meta.dirname, '..', 'data', 'mappack', name));
const w = new ServerWorld(RES_DIR, name).load();
fs.mkdirSync(out, { recursive: true });

const spawns = w.respawns.filter((r) => r.type === OT.MOVER).map((r) => {
  const p = w.moverProps.get(r.modelId) ?? null;
  const rect = r.rect.xMax > r.rect.xMin && r.rect.zMax > r.rect.zMin ? r.rect : null;
  return {
    modelId: r.modelId, rect, pos: r.pos, count: Math.max(1, r.count), attackCount: r.attackCount || 0, timeS: r.time || 30,
    speed: w.moverSpeed.get(r.modelId) ?? 0, flying: w.flyingMovers.has(r.modelId), boss: isBoss(p),
    prop: p && { level: p.level, sta: p.sta, dex: p.dex, hr: p.hr, er: p.er, hp: p.hp, naturalArmor: p.naturalArmor, atkSpeed: p.attackSpeed, atkMin: p.atkMin, atkMax: p.atkMax, exp: p.exp, peaceful: p.belligerence === 'BELLI_PEACEFUL' },
  };
});
const S = MAP_SIZE + 1, tile = w.tileSize, mpu = w.wld.mpu;
fs.writeFileSync(path.join(out, 'pack.json'), JSON.stringify({ world: name, tilesX: w.wld.width, tilesZ: w.wld.height, tileSize: tile, mpu, spawns }));

const buf = Buffer.alloc(w.wld.width * w.wld.height * S * S);
let o = 0;
for (let tz = 0; tz < w.wld.height; tz++) for (let tx = 0; tx < w.wld.width; tx++) {
  for (let iz = 0; iz < S; iz++) for (let ix = 0; ix < S; ix++) buf[o++] = w.attrAt(tx * tile + ix * mpu, tz * tile + iz * mpu);
}
fs.writeFileSync(path.join(out, 'attrs.bin'), buf);
console.log(`${name}: ${spawns.length} respawns, ${spawns.reduce((n, s) => n + s.count, 0)} mobs, terreno ${w.wld.width}×${w.wld.height} tiles (${(buf.length / 1e6).toFixed(1)} MB) em ${out}`);
