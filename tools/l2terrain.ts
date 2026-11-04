import fs from 'node:fs';
import path from 'node:path';

/**
 * Terreno do L2 (exportado pelo Cruma em tools/cruma: height.f32, layers.json, layer<i>.dds, alpha<i>.bin, meta.json) → terreno NATIVO do FlyFF:
 * um `.lnd` por tile do mundo (129×129 alturas, água por patch, camadas com mapa de alfa 128×128 e cor neutra, sem objetos), as texturas das camadas
 * como `World/Texture/L2_<chave>.dds` e as entradas novas em `terrain-extra.inc` (o cliente lê junto com o Terrain.inc).
 *
 * O `.lnd` (CLandscape::Load, versão 3): versão u32, tileX/tileY i32, 129×129 float32 (z·129+x; altura ≥ 1000 = atributo + 1000·k), 16×16 pares (altura, tipo) de água,
 * +256 bytes (v≥2), nº de camadas u8; por camada: id da textura u16, 16×16 patchEnable i32, 128×128 células BGRA (alfa = mistura); depois as listas de objetos e de SFX.
 * A posição de cada vértice segue a MESMA transformação dos props (tools/l2world.ts): X_L2 = minX + (x − left)/escala, Y_L2 = minY + (top − z)/escala,
 * altura = yOffset + escala·Z_L2.
 */
export const MAP_SIZE = 128, PATCHES = 16, N = MAP_SIZE + 1, MPU = 4, LND_VERSION = 3;
const NOWALK = 1000; // altura + 1000·k: k=1 NoWalk (como o parser: h ≥ HGT_NOWALK)

export interface L2Tile { t: string; dir: string; ox: number; oy: number; W: number; D: number; gw: number; gh: number; dx: number; dy: number }
export interface Layout { scale: number; left: number; top: number; minX: number; minY: number; yOffset: number; size: number }

interface LayerInfo { i: number; texture: string; key: string; alpha: string | null; alphaSize: [number, number]; uvPerUU?: [number, number, number, number] }
interface TileData { tile: L2Tile; heights: Buffer; alphaUV: [number, number, number, number]; layers: LayerInfo[]; alpha: Map<number, Buffer>; waterZ: number[] }

export function hasLayers(tiles: L2Tile[]): boolean { return tiles.every((k) => fs.existsSync(path.join(k.dir, 'layers.json')) && fs.existsSync(path.join(k.dir, 'height.f32'))); }

function load(tile: L2Tile): TileData {
  const lj = JSON.parse(fs.readFileSync(path.join(tile.dir, 'layers.json'), 'utf8')) as { alphaUV: [number, number, number, number]; layers: LayerInfo[] };
  const meta = JSON.parse(fs.readFileSync(path.join(tile.dir, 'meta.json'), 'utf8')) as { waterZ?: number[] };
  const alpha = new Map<number, Buffer>();
  for (const l of lj.layers) if (l.alpha) alpha.set(l.i, fs.readFileSync(path.join(tile.dir, l.alpha)));
  return { tile, heights: fs.readFileSync(path.join(tile.dir, 'height.f32')), alphaUV: lj.alphaUV, layers: lj.layers, alpha, waterZ: meta.waterZ ?? [] };
}

/** altura L2 (Z) por interpolação bilinear na grade do tile, em (col, row) fracionários */
function heightAt(d: TileData, col: number, row: number): number {
  const { gw, gh } = d.tile;
  const c = Math.min(gw - 1.0001, Math.max(0, col)), r = Math.min(gh - 1.0001, Math.max(0, row));
  const c0 = Math.floor(c), r0 = Math.floor(r), u = c - c0, v = r - r0;
  const h = (cc: number, rr: number) => d.heights.readFloatLE((rr * gw + cc) * 4);
  return h(c0, r0) * (1 - u) * (1 - v) + h(c0 + 1, r0) * u * (1 - v) + h(c0, r0 + 1) * (1 - u) * v + h(c0 + 1, r0 + 1) * u * v;
}

function alphaAt(d: TileData, l: LayerInfo, col: number, row: number): number {
  const a = d.alpha.get(l.i);
  if (!a) return l.i === 0 ? 255 : 0;
  const [aw, ah] = l.alphaSize;
  const { gw, gh } = d.tile, [u0, v0, u1, v1] = d.alphaUV;
  const u = u0 + (u1 - u0) * (col / (gw - 1)), v = v0 + (v1 - v0) * (row / (gh - 1));
  const fx = Math.min(aw - 1.001, Math.max(0, u * aw - 0.5)), fy = Math.min(ah - 1.001, Math.max(0, v * ah - 0.5));
  const x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
  const p = (x: number, y: number) => a[y * aw + x];
  return p(x0, y0) * (1 - tx) * (1 - ty) + p(x0 + 1, y0) * tx * (1 - ty) + p(x0, y0 + 1) * (1 - tx) * ty + p(x0 + 1, y0 + 1) * tx * ty;
}

/** id de textura (u16) estável pela chave de conteúdo; sondagem linear se dois cairem no mesmo */
function textureId(key: string, taken: Map<number, string>): number {
  let id = 40000 + (parseInt(key.slice(0, 6), 16) % 20000);
  while (taken.has(id) && taken.get(id) !== key) id++;
  taken.set(id, key);
  return id;
}

export interface NativeResult { tiles: number; textures: number; layers: number; water: boolean }

export function writeNativeTerrain(o: { name: string; worldDir: string; texDir: string; incFile: string; tiles: L2Tile[]; layout: Layout }): NativeResult {
  const { layout: L } = o;
  const data = o.tiles.map(load);
  const layerCount = Math.max(...data.map((d) => d.layers.length));

  // texturas: copia como L2_<chave>.dds e registra no terrain-extra.inc (mantém as entradas de antes)
  fs.mkdirSync(o.texDir, { recursive: true });
  const ids = new Map<number, string>();
  const old = fs.existsSync(o.incFile) ? fs.readFileSync(o.incFile, 'utf8') : '';
  for (const m of old.matchAll(/^\s*(\d+)\s+\d+\s+"L2_([0-9a-f]+)\.dds"/gm)) ids.set(Number(m[1]), m[2]);
  const idOf = new Map<string, number>();
  for (const d of data) for (const l of d.layers) {
    if (!idOf.has(l.key)) idOf.set(l.key, textureId(l.key, ids));
    fs.copyFileSync(path.join(d.tile.dir, l.texture), path.join(o.texDir, `L2_${l.key}.dds`));
  }
  // repetição da textura: o Flyff repete 3× por patch (8 células = 32 unidades); a do L2 vem em uvPerUU (repetições por unidade L2) → multiplicador por camada, gravado por mundo
  const uv: Record<string, number> = {};
  for (const d of data) for (const l of d.layers) {
    if (!l.uvPerUU) continue;
    const perPatch = ((MAP_SIZE / PATCHES) * MPU / L.scale) * ((Math.abs(l.uvPerUU[0]) + Math.abs(l.uvPerUU[3])) / 2);
    uv[String(idOf.get(l.key))] = Math.round(Math.min(32, Math.max(0.25, perPatch / 3)) * 1000) / 1000;
  }
  fs.writeFileSync(path.join(o.worldDir, `${o.name}.uv.json`), JSON.stringify(uv));
  const lines = ['// Terrain extra — gerado por tools/l2terrain.ts (texturas das camadas do L2); o cliente lê junto com o Terrain.inc', ''];
  for (const [id, key] of [...ids].sort((a, b) => a[0] - b[0])) lines.push(`${id}\t0\t"L2_${key}.dds"\t0\t""`);
  fs.writeFileSync(o.incFile, lines.join('\r\n') + '\r\n');

  // nível de água: o mediano dos níveis das caixas de água de todos os tiles
  const zs = data.flatMap((d) => d.waterZ).sort((a, b) => a - b);
  const waterH = zs.length ? Math.round(L.yOffset + L.scale * zs[zs.length >> 1]) : null;

  const find = (X: number, Y: number): { d: TileData; col: number; row: number; inside: boolean } => {
    let best: { d: TileData; col: number; row: number; inside: boolean } | null = null, bestDist = Infinity;
    for (const d of data) {
      const t = d.tile, col = (X - t.ox) / t.dx, row = (Y - t.oy) / t.dy;
      const inside = col >= 0 && col <= t.gw - 1 && row >= 0 && row <= t.gh - 1;
      const dist = Math.hypot(Math.max(0, -col, col - (t.gw - 1)), Math.max(0, -row, row - (t.gh - 1)));
      if (inside) return { d, col, row, inside };
      if (dist < bestDist) { bestDist = dist; best = { d, col, row, inside: false }; }
    }
    return best!;
  };
  const toL2 = (x: number, z: number): [number, number] => [L.minX + (x - L.left) / L.scale, L.minY + (L.top - z) / L.scale];

  let tilesWritten = 0;
  for (let tz = 0; tz < L.size; tz++) for (let tx = 0; tx < L.size; tx++) {
    const cells: Buffer[] = [];
    const heights = Buffer.alloc(N * N * 4);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const [X, Y] = toL2((tx * MAP_SIZE + i) * MPU, (tz * MAP_SIZE + j) * MPU);
      const f = find(X, Y);
      const h = L.yOffset + L.scale * heightAt(f.d, f.col, f.row);
      if (!(h >= 0 && h < NOWALK)) throw new Error(`altura ${h.toFixed(1)} fora de 0..${NOWALK} (tile ${tx},${tz}); ajuste a escala ou o nível do chão`);
      heights.writeFloatLE(f.inside ? h : h + NOWALK, (j * N + i) * 4); // fora do mapa do L2: NoWalk
    }
    // água por patch (8×8 células): onde o terreno fica abaixo do nível
    const water = Buffer.alloc(PATCHES * PATCHES * 2);
    if (waterH !== null && waterH >= 0 && waterH < 256) {
      for (let pz = 0; pz < PATCHES; pz++) for (let px = 0; px < PATCHES; px++) {
        let below = 0;
        for (const [ci, cj] of [[0, 0], [8, 0], [0, 8], [8, 8], [4, 4]]) {
          const v = heights.readFloatLE(((pz * 8 + cj) * N + (px * 8 + ci)) * 4);
          if (v < waterH - 0.3 && v < NOWALK) below++;
        }
        if (below >= 3) { water[(px + pz * PATCHES) * 2] = waterH; water[(px + pz * PATCHES) * 2 + 1] = 6; } // lista 1 (como o mar do Madrigal), tipo água
      }
    }
    // camadas
    const layerBufs: Buffer[] = [];
    for (let li = 0; li < layerCount; li++) {
      const px = Buffer.alloc(MAP_SIZE * MAP_SIZE * 4), enable = Buffer.alloc(PATCHES * PATCHES * 4);
      let key: string | null = null, any = false;
      for (let j = 0; j < MAP_SIZE; j++) for (let i = 0; i < MAP_SIZE; i++) {
        const [X, Y] = toL2((tx * MAP_SIZE + i + 0.5) * MPU, (tz * MAP_SIZE + j + 0.5) * MPU);
        const f = find(X, Y);
        const layer = f.d.layers.find((l) => l.i === li);
        let a = 0;
        if (layer) { key ??= layer.key; a = li === 0 ? 255 : f.inside ? alphaAt(f.d, layer, f.col, f.row) : 0; }
        const o2 = (j * MAP_SIZE + i) * 4;
        px[o2] = px[o2 + 1] = px[o2 + 2] = 127; // cor neutra da lightmap (127 = ×1)
        px[o2 + 3] = Math.round(a);
        if (a > 0) { enable.writeInt32LE(1, ((j >> 3) * PATCHES + (i >> 3)) * 4); any = true; }
      }
      if (!key || !any) continue;
      const head = Buffer.alloc(2);
      head.writeUInt16LE(idOf.get(key)!);
      layerBufs.push(Buffer.concat([head, enable, px]));
    }
    const hdr = Buffer.alloc(12);
    hdr.writeUInt32LE(LND_VERSION, 0); hdr.writeInt32LE(tx, 4); hdr.writeInt32LE(tz, 8);
    const out = Buffer.concat([hdr, heights, water, Buffer.alloc(PATCHES * PATCHES), Buffer.from([layerBufs.length]), ...layerBufs, Buffer.alloc(8)]);
    fs.writeFileSync(path.join(o.worldDir, `${o.name}${String(tx).padStart(2, '0')}-${String(tz).padStart(2, '0')}.lnd`), out);
    void cells;
    tilesWritten++;
  }
  return { tiles: tilesWritten, textures: idOf.size, layers: layerCount, water: waterH !== null };
}
