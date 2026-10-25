import { zipSync, strToU8, type Zippable } from 'fflate';
import type { WorldData } from '../shared/data';
import { fetchBuf } from '../shared/data';
import type { Landscape } from '../shared/formats/lnd';
import { MAP_SIZE, OT, type WorldObject } from '../shared/formats/types';
import { modelFileName } from '../shared/formats/inc';

/**
 * Formato de exportação "flyff-web-world" v1 (ver README do web-world-editor):
 *   world.json            metadados + objetos por tile + movers/spawns/regiões/continentes
 *   tiles/XX-YY.bin       terreno binário por tile (little-endian):
 *       u32 magic 'FTIL' (0x4C495446) · u16 version=1 · u16 tileX · u16 tileY · u16 layerCount
 *       f32 heights[129*129]            (altura real, índice = z*129 + x)
 *       u8  attrs[129*129]              (0 normal, 1 NoWalk, 2 NoFly, 3 NoMove, 4 Die)
 *       u8  waterHeight[16*16], waterType[16*16]
 *       layerCount × { u16 textureId · u8 alpha[128*128] }
 *   models/<arquivo>.o3d  modelos que existem em Resource/Model (+ models/Texture/*.dds referenciados)
 * Espaço de coordenadas: FlyFF original (mão esquerda, Y para cima). No Three.js use `root.scale.z = -1`.
 */
const r3 = (n: number) => Math.round(n * 1000) / 1000;
const objRow = (o: WorldObject) => [o.modelId, r3(o.pos[0]), r3(o.pos[1]), r3(o.pos[2]), r3(o.rot[0]), r3(o.rot[1]), r3(o.rot[2]), r3(o.scale[0]), r3(o.scale[1]), r3(o.scale[2])];

export function encodeTile(l: Landscape): Uint8Array {
  const n = (MAP_SIZE + 1) ** 2, cells = MAP_SIZE * MAP_SIZE;
  const size = 12 + n * 4 + n + 256 * 2 + l.layers.length * (2 + cells);
  const out = new Uint8Array(size);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 0x4c495446, true); dv.setUint16(4, 1, true); dv.setUint16(6, l.tileX, true); dv.setUint16(8, l.tileY, true); dv.setUint16(10, l.layers.length, true);
  let o = 12;
  for (let i = 0; i < n; i++, o += 4) dv.setFloat32(o, l.heights[i], true);
  out.set(l.attrs, o); o += n;
  out.set(l.waterHeight, o); o += 256;
  out.set(l.waterTexture, o); o += 256;
  for (const layer of l.layers) { dv.setUint16(o, layer.textureId, true); o += 2; out.set(layer.alpha, o); o += cells; }
  return out;
}

export async function exportWorld(data: WorldData, tiles: Landscape[], onProgress: (s: string) => void = () => {}): Promise<Blob> {
  const files: Zippable = {};
  const used = new Map<number, { name: string; file: string; type: number }>();
  const tileList = [];
  for (const l of tiles) {
    files[`tiles/${String(l.tileX).padStart(2, '0')}-${String(l.tileY).padStart(2, '0')}.bin`] = [encodeTile(l), { level: 1 }];
    for (const o of l.objects) {
      const e = data.objModels.get(o.modelId);
      if (e && !used.has(o.modelId)) used.set(o.modelId, { name: e.name, file: modelFileName(e), type: e.type });
    }
    tileList.push({
      x: l.tileX, y: l.tileY, terrain: `tiles/${String(l.tileX).padStart(2, '0')}-${String(l.tileY).padStart(2, '0')}.bin`,
      objects: l.objects.map(objRow), sfx: l.sfx.map(objRow),
    });
  }

  // modelos reais disponíveis + texturas referenciadas
  const models: Record<string, { name: string; file: string; mesh: boolean }> = {};
  const texWanted = new Set<string>();
  for (const [id, m] of used) {
    const has = data.modelFiles.has(m.file.toLowerCase());
    models[id] = { name: m.name, file: m.file, mesh: has };
    if (has) {
      onProgress('Copiando modelo ' + m.file);
      const buf = await fetchBuf('/res/Data/Model/' + m.file);
      if (buf) {
        files['models/' + m.file] = [new Uint8Array(buf), { level: 0 }];
        const { parseO3d } = await import('../shared/formats/o3d');
        for (const p of parseO3d(buf).parts) for (const t of p.textures) texWanted.add(t);
      }
    }
  }
  for (const t of texWanted) {
    if (!data.textureFiles.has(t.toLowerCase())) continue;
    const b = await fetchBuf('/res/Data/Model/Texture/' + t);
    if (b) files['models/Texture/' + t] = [new Uint8Array(b), { level: 0 }];
  }

  const dynaName = (o: { type?: number; modelId: number }, t: number) => data.dynaModels.get(`${t}:${o.modelId}`)?.name ?? null;
  const world = {
    format: 'flyff-web-world', version: 1, name: data.name,
    coordinateSystem: { handedness: 'left', up: 'y', unit: 'flyff', note: 'No Three.js, espelhe Z (root.scale.z = -1)' },
    mpu: data.wld.mpu, tileSize: MAP_SIZE, grid: { width: data.wld.width, height: data.wld.height },
    environment: {
      ambient: data.wld.ambient, diffuse: data.wld.diffuse, bgColor: data.wld.bgColor, fog: data.wld.fog,
      lightDir: data.wld.lightDir, indoor: data.wld.indoor, fly: data.wld.fly, camera: data.wld.camera,
    },
    terrainTextures: Object.fromEntries([...new Set(tiles.flatMap((l) => l.layers.map((x) => x.textureId)))].map((id) => [id, data.terrainTextures.get(id) ?? null])),
    models,
    tiles: tileList,
    movers: data.movers.map((m) => ({ modelId: m.modelId, model: dynaName(m, OT.MOVER), name: m.name, characterKey: m.characterKey, pos: m.pos.map(r3), rot: m.rot.map(r3), scale: m.scale.map(r3) })),
    spawns: data.respawns.map((s) => ({ type: s.type, modelId: s.modelId, model: dynaName(s, s.type), pos: s.pos.map(r3), count: s.count, time: s.time, rect: s.rect, angle: s.angle })),
    regions: data.regions,
    continents: data.continents,
  };
  files['world.json'] = [strToU8(JSON.stringify(world)), { level: 6 }];
  onProgress('Compactando…');
  const zip = zipSync(files);
  return new Blob([zip as BlobPart], { type: 'application/zip' });
}

export function download(blob: Blob, name: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}
