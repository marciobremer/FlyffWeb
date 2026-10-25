import { Matrix4, Vector3 } from 'three';
import type { WorldObject } from './formats/types';
import type { O3d } from './formats/o3d';
import { objectMatrix } from './math';

/**
 * Colisão com objetos estáticos usando a malha de colisão do .o3d (`CObject3D::m_collObj`, a mesma que o ATools desenha como
 * colisão). Objetos sem essa malha (flores, grama, decoração pequena) não colidem. Tudo em coordenadas FlyFF (D3D).
 * Os triângulos de cada tile ficam numa grade XZ de células de `CELL` unidades.
 */
const CELL = 8;
/** acima disso (normal.y) o triângulo é chão; abaixo é parede */
const FLOOR_NY = 0.5;

interface TileColl { tris: Float32Array; ny: Float32Array; cells: Map<number, number[]>; min: [number, number]; max: [number, number] }

const cellKey = (cx: number, cz: number) => cx * 65536 + cz;
const v0 = new Vector3(), v1 = new Vector3(), v2 = new Vector3(), e1 = new Vector3(), e2 = new Vector3(), pv = new Vector3(), tv = new Vector3(), qv = new Vector3();

export class CollisionWorld {
  private tiles = new Map<string, TileColl>();
  /** incrementado a cada troca, para descartar construções assíncronas antigas do mesmo tile */
  private version = new Map<string, number>();

  get triangleCount() { let n = 0; for (const t of this.tiles.values()) n += t.ny.length; return n; }

  clear() { this.tiles.clear(); this.version.clear(); }
  removeTile(key: string) { this.tiles.delete(key); this.version.set(key, (this.version.get(key) ?? 0) + 1); }

  /** (Re)constrói o tile a partir dos objetos e de um carregador de .o3d (o modelo de cada objeto). */
  async setTile(key: string, objects: WorldObject[], model: (o: WorldObject) => Promise<O3d | null>) {
    const ver = (this.version.get(key) ?? 0) + 1;
    this.version.set(key, ver);
    const sources = await Promise.all(objects.map(async (o) => ({ o, m: await model(o) })));
    if (this.version.get(key) !== ver) return;
    const out: number[] = [];
    const mat = new Matrix4();
    for (const { o, m } of sources) {
      const c = m?.collision;
      if (!c) continue;
      objectMatrix(o, mat);
      for (let i = 0; i + 2 < c.indices.length; i += 3) {
        for (const k of [0, 1, 2]) {
          const vi = c.indices[i + k] * 3;
          v0.set(c.positions[vi], c.positions[vi + 1], c.positions[vi + 2]).applyMatrix4(mat);
          out.push(v0.x, v0.y, v0.z);
        }
      }
    }
    this.tiles.set(key, build(new Float32Array(out)));
  }

  /** Maior altura de chão de objeto em (x, z) que não passe de `yTop`; null se não houver. */
  groundAt(x: number, z: number, yTop: number): number | null {
    let best: number | null = null;
    for (const t of this.tiles.values()) {
      if (x < t.min[0] || x > t.max[0] || z < t.min[1] || z > t.max[1]) continue;
      const list = t.cells.get(cellKey(Math.floor(x / CELL), Math.floor(z / CELL)));
      if (!list) continue;
      for (const i of list) {
        if (t.ny[i] < FLOOR_NY) continue;
        const y = heightOnTri(t.tris, i * 9, x, z);
        if (y !== null && y <= yTop && (best === null || y > best)) best = y;
      }
    }
    return best;
  }

  /**
   * O segmento horizontal (x0,z0)→(x1,z1), estendido por `radius`, bate em parede nas alturas `heights` (acima de y)?
   * Só triângulos íngremes (paredes) bloqueiam; rampas e degraus contam como chão.
   */
  blocked(x0: number, z0: number, x1: number, z1: number, y: number, radius: number, heights: number[]): boolean {
    const dx = x1 - x0, dz = z1 - z0;
    const len = Math.hypot(dx, dz);
    if (len < 1e-6) return false;
    const ux = dx / len, uz = dz / len, reach = len + radius;
    const minX = Math.min(x0, x0 + ux * reach), maxX = Math.max(x0, x0 + ux * reach);
    const minZ = Math.min(z0, z0 + uz * reach), maxZ = Math.max(z0, z0 + uz * reach);
    for (const t of this.tiles.values()) {
      if (maxX < t.min[0] || minX > t.max[0] || maxZ < t.min[1] || minZ > t.max[1]) continue;
      const seen = new Set<number>();
      for (let cx = Math.floor(minX / CELL); cx <= Math.floor(maxX / CELL); cx++) {
        for (let cz = Math.floor(minZ / CELL); cz <= Math.floor(maxZ / CELL); cz++) {
          const list = t.cells.get(cellKey(cx, cz));
          if (!list) continue;
          for (const i of list) {
            if (seen.has(i) || t.ny[i] >= FLOOR_NY) continue;
            seen.add(i);
            for (const h of heights) {
              const d = rayTri(t.tris, i * 9, x0, y + h, z0, ux, 0, uz);
              if (d !== null && d <= reach) return true;
            }
          }
        }
      }
    }
    return false;
  }

  /** Distância até o primeiro triângulo (chão ou parede) no segmento de (ox,oy,oz) com direção unitária d e comprimento `len`; null se livre. */
  segmentHit(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, len: number): number | null {
    const ex = ox + dx * len, ez = oz + dz * len;
    const minX = Math.min(ox, ex), maxX = Math.max(ox, ex), minZ = Math.min(oz, ez), maxZ = Math.max(oz, ez);
    let best: number | null = null;
    for (const t of this.tiles.values()) {
      if (maxX < t.min[0] || minX > t.max[0] || maxZ < t.min[1] || minZ > t.max[1]) continue;
      const seen = new Set<number>();
      for (let cx = Math.floor(minX / CELL); cx <= Math.floor(maxX / CELL); cx++) {
        for (let cz = Math.floor(minZ / CELL); cz <= Math.floor(maxZ / CELL); cz++) {
          const list = t.cells.get(cellKey(cx, cz));
          if (!list) continue;
          for (const i of list) {
            if (seen.has(i)) continue;
            seen.add(i);
            const d = rayTri(t.tris, i * 9, ox, oy, oz, dx, dy, dz);
            if (d !== null && d <= len && (best === null || d < best)) best = d;
          }
        }
      }
    }
    return best;
  }
}

function build(tris: Float32Array): TileColl {
  const n = tris.length / 9;
  const ny = new Float32Array(n);
  const cells = new Map<number, number[]>();
  const min: [number, number] = [Infinity, Infinity], max: [number, number] = [-Infinity, -Infinity];
  for (let i = 0; i < n; i++) {
    const o = i * 9;
    v0.fromArray(tris, o); v1.fromArray(tris, o + 3); v2.fromArray(tris, o + 6);
    e1.subVectors(v1, v0); e2.subVectors(v2, v0);
    const nrm = pv.crossVectors(e1, e2);
    const l = nrm.length();
    ny[i] = l > 1e-9 ? Math.abs(nrm.y / l) : 0;
    const x0 = Math.min(v0.x, v1.x, v2.x), x1 = Math.max(v0.x, v1.x, v2.x);
    const z0 = Math.min(v0.z, v1.z, v2.z), z1 = Math.max(v0.z, v1.z, v2.z);
    min[0] = Math.min(min[0], x0); min[1] = Math.min(min[1], z0); max[0] = Math.max(max[0], x1); max[1] = Math.max(max[1], z1);
    for (let cx = Math.floor(x0 / CELL); cx <= Math.floor(x1 / CELL); cx++) {
      for (let cz = Math.floor(z0 / CELL); cz <= Math.floor(z1 / CELL); cz++) {
        const k = cellKey(cx, cz);
        let list = cells.get(k);
        if (!list) cells.set(k, (list = []));
        list.push(i);
      }
    }
  }
  return { tris, ny, cells, min, max };
}

/** Altura do plano do triângulo no ponto (x, z), se o ponto cai dentro da projeção XZ do triângulo. */
function heightOnTri(t: Float32Array, o: number, x: number, z: number): number | null {
  const ax = t[o], ay = t[o + 1], az = t[o + 2], bx = t[o + 3], by = t[o + 4], bz = t[o + 5], cx = t[o + 6], cy = t[o + 7], cz = t[o + 8];
  const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
  if (Math.abs(d) < 1e-9) return null;
  const a = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / d;
  const b = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / d;
  const c = 1 - a - b;
  const eps = -1e-4;
  if (a < eps || b < eps || c < eps) return null;
  return a * ay + b * by + c * cy;
}

/** Möller–Trumbore (dupla face): distância ao longo do raio ou null. */
function rayTri(t: Float32Array, o: number, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number): number | null {
  v0.fromArray(t, o);
  e1.set(t[o + 3] - v0.x, t[o + 4] - v0.y, t[o + 5] - v0.z);
  e2.set(t[o + 6] - v0.x, t[o + 7] - v0.y, t[o + 8] - v0.z);
  const dir = qv.set(dx, dy, dz);
  pv.crossVectors(dir, e2);
  const det = e1.dot(pv);
  if (Math.abs(det) < 1e-9) return null;
  const inv = 1 / det;
  tv.set(ox - v0.x, oy - v0.y, oz - v0.z);
  const u = tv.dot(pv) * inv;
  if (u < 0 || u > 1) return null;
  const q = tv.cross(e1);
  const v = dir.dot(q) * inv;
  if (v < 0 || u + v > 1) return null;
  const d = e2.dot(q) * inv;
  return d >= 0 ? d : null;
}
