import { HGT_NOWALK, MAP_SIZE, PATCHES, type WorldObject } from './types';
import { readObject } from './object';

export interface LandLayer {
  textureId: number;
  patchEnable: Uint8Array; // 16x16
  /** Alpha 128x128 (índice = z*128 + x) */
  alpha: Uint8Array;
  /** RGB 128x128x3 */
  rgb: Uint8Array;
}

export interface Landscape {
  version: number;
  tileX: number;
  tileY: number;
  /** 129x129, índice = z*129 + x, já sem o offset de atributo */
  heights: Float32Array;
  /** 0 = normal, 1 NoWalk, 2 NoFly, 3 NoMove, 4 Die */
  attrs: Uint8Array;
  /** 16x16 */
  waterHeight: Uint8Array;
  waterTexture: Uint8Array;
  layers: LandLayer[];
  /** posições já em coordenadas de mundo */
  objects: WorldObject[];
  sfx: WorldObject[];
}

/** `CLandscape::Load` (Common/Landscape.cpp:296). */
export function parseLnd(buf: ArrayBuffer, tileX: number, tileY: number, mpu = 4): Landscape {
  const dv = new DataView(buf);
  let o = 0;
  const version = dv.getUint32(o, true); o += 4;
  if (version >= 1) { tileX = dv.getInt32(o, true); tileY = dv.getInt32(o + 4, true); o += 8; }

  const n = (MAP_SIZE + 1) * (MAP_SIZE + 1);
  const heights = new Float32Array(n);
  const attrs = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const h = dv.getFloat32(o + i * 4, true);
    if (h >= HGT_NOWALK) {
      const k = Math.min(4, Math.floor(h / 1000));
      attrs[i] = k;
      heights[i] = h - 1000 * k;
    } else heights[i] = h;
  }
  o += n * 4;

  const wh = new Uint8Array(PATCHES * PATCHES), wt = new Uint8Array(PATCHES * PATCHES);
  for (let i = 0; i < PATCHES * PATCHES; i++) { wh[i] = dv.getUint8(o + i * 2); wt[i] = dv.getUint8(o + i * 2 + 1); }
  o += PATCHES * PATCHES * 2;
  if (version >= 2) o += PATCHES * PATCHES;

  const layerCount = dv.getUint8(o); o += 1;
  const layers: LandLayer[] = [];
  for (let l = 0; l < layerCount; l++) {
    const textureId = dv.getUint16(o, true); o += 2;
    const patchEnable = new Uint8Array(PATCHES * PATCHES);
    for (let i = 0; i < patchEnable.length; i++) patchEnable[i] = dv.getInt32(o + i * 4, true) ? 1 : 0;
    o += PATCHES * PATCHES * 4;
    const cells = MAP_SIZE * MAP_SIZE;
    const alpha = new Uint8Array(cells), rgb = new Uint8Array(cells * 3);
    const px = new Uint8Array(buf, o, cells * 4);
    for (let i = 0; i < cells; i++) {
      alpha[i] = px[i * 4 + 3];
      rgb[i * 3] = px[i * 4 + 2]; rgb[i * 3 + 1] = px[i * 4 + 1]; rgb[i * 3 + 2] = px[i * 4];
    }
    o += cells * 4;
    layers.push({ textureId, patchEnable, alpha, rgb });
  }

  const ox = tileX * MAP_SIZE * mpu, oz = tileY * MAP_SIZE * mpu;
  const readList = (): WorldObject[] => {
    const count = dv.getUint32(o, true); o += 4;
    const out: WorldObject[] = [];
    for (let i = 0; i < count; i++) {
      const r = readObject(dv, o, mpu);
      o = r.next;
      if (version >= 1) { r.obj.pos[0] += ox; r.obj.pos[2] += oz; }
      r.obj.src = i;
      out.push(r.obj);
    }
    return out;
  };
  const objects = readList();
  const sfx = readList();
  if (o !== buf.byteLength) console.warn(`lnd ${tileX}-${tileY}: ${buf.byteLength - o} bytes não lidos`);

  return { version, tileX, tileY, heights, attrs, waterHeight: wh, waterTexture: wt, layers, objects, sfx };
}
