import fs from 'node:fs';

/**
 * Geodata do L2 (`<x>_<y>_conv.dat`, formato L2OFF — o mesmo que o Cruma lê) → malha de colisão (.glb só de posições e índices).
 *
 * O arquivo é uma região de 2048×2048 células de 16 unidades (= um tile de 32768), em setores de 8×8 células:
 *   cabeçalho 18 bytes (região x, y, assinatura, totais), depois 65536 setores na ordem `bx*256 + by`, cada um:
 *     short 0   → plano: 1 altura para as 64 células (+2 shorts, o 2º é a altura)
 *     short 64  → complexo: 64 shorts (1 camada por célula)
 *     outro     → multicamada: por célula, short n e n shorts (andares: pontes, casas…)
 *   short de célula: altura = (valor & 0xFFF0) / 2, bits 0–3 = NSWE (L2J: 1 leste +x, 2 oeste −x, 4 sul +y, 8 norte −y; bit ligado = passa)
 *   índice da célula no setor: `(x & 7) * 8 + (y & 7)`; mundo: X = (regiãoX − 20)·32768 + x·16, Y = (regiãoY − 18)·32768 + y·16
 *
 * Só entra na malha o que o terreno (grade de alturas já usada para o chão) não cobre: células com outro andar, a mais de `tol`
 * unidades do terreno, ou com passagem bloqueada. Os pisos são fundidos em retângulos; cada borda bloqueada vira uma parede de `wall`.
 */
const CELLS = 2048, SIZE = 16;
const s16 = (v: number) => (v >= 32768 ? v - 65536 : v);
const heightOf = (val: number) => s16(val & 0xfff0) / 2;

export interface GeoTerrain { heights: Buffer; gw: number; gh: number; dx: number; dy: number }
export interface GeoOptions { tol: number; wall: number; maxTris: number; /** gera as paredes das bordas bloqueadas */ walls: boolean; /** parede só onde a célula vizinha difere em altura mais que isto (rampas suaves bloqueadas pelo L2 não viram parede) */ wallDiff: number }

export interface Geo {
  region: [number, number];
  /** 1ª camada de cada célula (índice cx*2048+cy) */
  h0: Int16Array; f0: Uint8Array;
  /** camadas a mais, por célula */
  extra: Map<number, number[]>;
  layers: number;
}

export function readGeo(buf: Buffer): Geo {
  const h0 = new Int16Array(CELLS * CELLS), f0 = new Uint8Array(CELLS * CELLS), extra = new Map<number, number[]>();
  let pos = 18, layers = 0;
  for (let i = 0; i < 65536; i++) {
    const bx = Math.floor(i / 256), by = i % 256;
    const t = buf.readInt16LE(pos); pos += 2;
    for (let c = 0; c < 64; c++) {
      const cx = bx * 8 + (c >> 3), cy = by * 8 + (c & 7), ci = cx * CELLS + cy;
      let vals: number[];
      if (t === 0) { const v = buf.readInt16LE(pos); vals = [(((v << 1) & 0xfff0) | 15) & 0xffff]; }
      else if (t === 64) { vals = [buf.readUInt16LE(pos + c * 2)]; }
      else { const n = buf.readInt16LE(pos); pos += 2; vals = []; for (let k = 0; k < n; k++) { vals.push(buf.readUInt16LE(pos)); pos += 2; } }
      h0[ci] = heightOf(vals[0]); f0[ci] = vals[0] & 15; layers += vals.length;
      if (vals.length > 1) extra.set(ci, vals.slice(1));
    }
    if (t === 0) pos += 4; else if (t === 64) pos += 128;
  }
  if (pos !== buf.length) throw new Error(`geodata: tamanho inesperado (${pos} de ${buf.length} bytes)`);
  return { region: [buf[0], buf[1]], h0, f0, extra, layers };
}

/** camadas (altura, NSWE) de uma célula */
function layersOf(g: Geo, ci: number): { h: number; f: number }[] {
  const out = [{ h: g.h0[ci], f: g.f0[ci] }];
  const e = g.extra.get(ci);
  if (e) for (const v of e) out.push({ h: heightOf(v), f: v & 15 });
  return out;
}

/** altura do terreno (grade de alturas do tile) no ponto (x, y) em unidades do L2 relativas ao canto do tile */
function terrainAt(t: GeoTerrain, x: number, y: number): number {
  const fx = Math.min(t.gw - 1.001, Math.max(0, x / t.dx)), fy = Math.min(t.gh - 1.001, Math.max(0, y / t.dy));
  const c = Math.floor(fx), r = Math.floor(fy), u = fx - c, v = fy - r;
  const at = (cc: number, rr: number) => t.heights.readFloatLE((rr * t.gw + cc) * 4);
  return at(c, r) * (1 - u) * (1 - v) + at(c + 1, r) * u * (1 - v) + at(c, r + 1) * (1 - u) * v + at(c + 1, r + 1) * u * v;
}

export function geoCollisionGlb(g: Geo, terrain: GeoTerrain, opt: GeoOptions): { glb: Buffer; tris: number; floors: number; walls: number; offset: number } | null {
  // o geodata do L2 fica uns 32 acima do terreno em todo lugar (altura de "pé"): a diferença mediana é tirada de todas as alturas
  const diffs: number[] = [];
  for (let cx = 5; cx < CELLS; cx += 17) for (let cy = 5; cy < CELLS; cy += 17) diffs.push(g.h0[cx * CELLS + cy] - terrainAt(terrain, (cx + 0.5) * SIZE, (cy + 0.5) * SIZE));
  diffs.sort((a, b) => a - b);
  const offset = Math.round(diffs[diffs.length >> 1]);
  // células que importam: camada extra, altura longe do terreno ou passagem bloqueada
  const interesting = new Map<number, { h: number; f: number }[]>();
  for (let cx = 0; cx < CELLS; cx++) for (let cy = 0; cy < CELLS; cy++) {
    const ci = cx * CELLS + cy, ls = layersOf(g, ci);
    let keep: { h: number; f: number }[] | null = null;
    const th = terrainAt(terrain, (cx + 0.5) * SIZE, (cy + 0.5) * SIZE);
    for (let k = 0; k < ls.length; k++) {
      const l = ls[k];
      if (k > 0 || Math.abs(l.h - offset - th) > opt.tol) (keep ??= []).push({ h: l.h - offset, f: l.f });
    }
    if (keep) interesting.set(ci, keep);
  }

  const pos: number[] = [], idx: number[] = [];
  const quad = (a: number[], b: number[], c: number[], d: number[]) => {
    const i = pos.length / 3;
    pos.push(...a, ...b, ...c, ...d);
    idx.push(i, i + 2, i + 1, i, i + 3, i + 2);
  };
  // glb = (x, altura, y) como o <tile>.glb
  const P = (x: number, h: number, y: number) => [x, h, y];

  // pisos: retângulos de células vizinhas com a mesma altura
  const done = new Set<number>(); // (índice da célula)*64 + posição da camada
  const find = (cx: number, cy: number, h: number) => {
    if (cx < 0 || cy < 0 || cx >= CELLS || cy >= CELLS) return -1;
    const ls = interesting.get(cx * CELLS + cy);
    if (!ls) return -1;
    for (let k = 0; k < ls.length; k++) if (ls[k].h === h && !done.has((cx * CELLS + cy) * 64 + k)) return k;
    return -1;
  };
  let floors = 0;
  for (let cy = 0; cy < CELLS; cy++) for (let cx = 0; cx < CELLS; cx++) {
    const ls = interesting.get(cx * CELLS + cy);
    if (!ls) continue;
    for (let k = 0; k < ls.length; k++) {
      if (done.has((cx * CELLS + cy) * 64 + k)) continue;
      const h = ls[k].h;
      let x2 = cx + 1;
      while (find(x2, cy, h) >= 0) x2++;
      let y2 = cy + 1;
      for (; ; y2++) {
        let ok = true;
        for (let x = cx; x < x2 && ok; x++) if (find(x, y2, h) < 0) ok = false;
        if (!ok) break;
      }
      for (let y = cy; y < y2; y++) for (let x = cx; x < x2; x++) done.add((x * CELLS + y) * 64 + find(x, y, h));
      quad(P(cx * SIZE, h, cy * SIZE), P(x2 * SIZE, h, cy * SIZE), P(x2 * SIZE, h, y2 * SIZE), P(cx * SIZE, h, y2 * SIZE));
      floors++;
      // as camadas deste retângulo já estão em `done`; a posição `k` atual também
    }
  }

  // paredes: borda bloqueada cuja célula vizinha tem altura bem diferente (degrau alto, muro, objeto); cada borda uma vez
  const seen = new Set<string>();
  let walls = 0;
  const near = (cx: number, cy: number, h: number) => { // altura da camada vizinha mais próxima de h (null fora da grade)
    if (cx < 0 || cy < 0 || cx >= CELLS || cy >= CELLS) return null;
    let best: number | null = null;
    for (const l of layersOf(g, cx * CELLS + cy)) { const lh = l.h - offset; if (best === null || Math.abs(lh - h) < Math.abs(best - h)) best = lh; }
    return best;
  };
  if (opt.walls) for (let cx = 0; cx < CELLS; cx++) for (let cy = 0; cy < CELLS; cy++) {
    const ci = cx * CELLS + cy;
    if (g.f0[ci] === 15 && !g.extra.has(ci)) continue;
    for (const raw of layersOf(g, ci)) {
      if (raw.f === 15) continue;
      const h = raw.h - offset, f = raw.f;
      const edges: [string, number[], number[], number, number][] = [];
      if (!(f & 1)) edges.push([`x${cx + 1},${cy},${h}`, P((cx + 1) * SIZE, h, cy * SIZE), P((cx + 1) * SIZE, h, (cy + 1) * SIZE), cx + 1, cy]);
      if (!(f & 2)) edges.push([`x${cx},${cy},${h}`, P(cx * SIZE, h, cy * SIZE), P(cx * SIZE, h, (cy + 1) * SIZE), cx - 1, cy]);
      if (!(f & 4)) edges.push([`y${cx},${cy + 1},${h}`, P(cx * SIZE, h, (cy + 1) * SIZE), P((cx + 1) * SIZE, h, (cy + 1) * SIZE), cx, cy + 1]);
      if (!(f & 8)) edges.push([`y${cx},${cy},${h}`, P(cx * SIZE, h, cy * SIZE), P((cx + 1) * SIZE, h, cy * SIZE), cx, cy - 1]);
      for (const [key, a, b, nx, ny] of edges) {
        if (seen.has(key)) continue;
        const nh = near(nx, ny, h);
        if (nh === null || Math.abs(nh - h) <= opt.wallDiff) continue;
        seen.add(key);
        quad(a, b, [b[0], b[1] + opt.wall, b[2]], [a[0], a[1] + opt.wall, a[2]]);
        walls++;
      }
    }
  }

  const tris = idx.length / 3;
  if (tris === 0) return null;
  if (tris > opt.maxTris) throw new Error(`a malha de colisão do geodata ficou com ${tris} triângulos (limite ${opt.maxTris}); aumente --geo-tol`);
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pos.length; i++) { mn[i % 3] = Math.min(mn[i % 3], pos[i]); mx[i % 3] = Math.max(mx[i % 3], pos[i]); }
  const pb = Buffer.alloc(pos.length * 4), ib = Buffer.alloc(idx.length * 4);
  pos.forEach((v, i) => pb.writeFloatLE(v, i * 4));
  idx.forEach((v, i) => ib.writeUInt32LE(v, i * 4));
  const body = Buffer.concat([pb, ib]);
  const js = JSON.stringify({
    asset: { version: '2.0', generator: 'l2geo' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
    accessors: [{ bufferView: 0, componentType: 5126, count: pos.length / 3, type: 'VEC3', min: mn, max: mx }, { bufferView: 1, componentType: 5125, count: idx.length, type: 'SCALAR' }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: pb.length }, { buffer: 0, byteOffset: pb.length, byteLength: ib.length }], buffers: [{ byteLength: body.length }],
  });
  const jb = Buffer.from(js + ' '.repeat((4 - (js.length % 4)) % 4), 'utf8');
  const head = Buffer.alloc(20), tail = Buffer.alloc(8);
  head.writeUInt32LE(0x46546c67, 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(20 + jb.length + 8 + body.length, 8);
  head.writeUInt32LE(jb.length, 12); head.writeUInt32LE(0x4e4f534a, 16);
  tail.writeUInt32LE(body.length, 0); tail.writeUInt32LE(0x004e4942, 4);
  return { glb: Buffer.concat([head, jb, tail, body]), tris, floors, walls, offset };
}

export const geoFile = (dir: string, tile: string) => `${dir}/${tile}_conv.dat`;
export const hasGeo = (dir: string, tile: string) => fs.existsSync(geoFile(dir, tile));
