/** Leitor de `.o3d` (CObject3D::Load, Common/Object3D.cpp:688). Só geometria/material do grupo LOD 0. */

export interface O3dPart {
  /** 4x4 em ordem de memória D3D (linha-vetor) — vira column-major do Three diretamente via Matrix4.fromArray */
  transform: number[];
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  indices: Uint16Array;
  skinned: boolean;
  /** só skin: 2 pesos por vértice e 2 índices (registradores de constante: 3·posição em usedBones) */
  skinWeights?: Float32Array;
  skinIndices?: Uint16Array;
  usedBones: number[];
  id: number;
  parentId: number;
  /** 0 = objeto, 1 = skin, 2 = osso (parentId indexa o esqueleto) */
  parentType: number;
  /** bit 31 do tipo: objeto de luz (CObject3D: só é desenhado à noite) */
  light: boolean;
  textures: string[];
  /** blocos de material: início no buffer de índices, nº de triângulos, materialId */
  blocks: { start: number; triangles: number; material: number; /** ossos locais deste bloco (registradores c[i*3]); vazio = usa os do objeto */ usedBones: number[] }[];
  /** animação TM do objeto (LoadTMAni): frameCount × 7 floats (quatérnio x,y,z,w e posição x,y,z, local ao pai); só GMT_NORMAL */
  frames?: Float32Array;
}
/** nó do grupo LOD 0 (inclui os sem malha, que podem ser pai de outros) — para animar a hierarquia */
export interface O3dNode { id: number; parentId: number; parentType: number; transform: number[]; frames?: Float32Array }
/** ossos embutidos no .o3d (objetos com esqueleto próprio: m_pBaseBone/m_pBaseBoneInv + CMotion::ReadTM) */
export interface O3dBones {
  /** pose padrão (mundo do modelo) e inversa, por osso — D3D linha-vetor */
  base: number[][]; inverse: number[][];
  parents: number[];
  /** por osso: frameCount × 7 floats, ou null (osso parado usa `staticTm`) */
  frames: (Float32Array | null)[]; staticTm: (number[] | null)[];
}
export interface O3d {
  name: string;
  version: number;
  frameCount: number;
  boneCount: number;
  bounds: { min: [number, number, number]; max: [number, number, number] };
  /** quadros por tique do Neuz (m_fPerSlerp) */
  perSlerp: number;
  parts: O3dPart[];
  nodes: O3dNode[];
  bones: O3dBones | null;
  /** malha de colisão (`m_collObj`, espaço do objeto) quando o arquivo tem uma */
  collision: { positions: Float32Array; indices: Uint16Array } | null;
}

class Reader {
  o = 0;
  readonly dv: DataView;
  constructor(readonly buf: ArrayBuffer) { this.dv = new DataView(buf); }
  i32() { const v = this.dv.getInt32(this.o, true); this.o += 4; return v; }
  u32() { const v = this.dv.getUint32(this.o, true); this.o += 4; return v; }
  f32() { const v = this.dv.getFloat32(this.o, true); this.o += 4; return v; }
  u8() { return this.dv.getUint8(this.o++); }
  skip(n: number) { this.o += n; }
  mat() { const m: number[] = []; for (let i = 0; i < 16; i++) m.push(this.f32()); return m; }
  floats(n: number) { const a = new Float32Array(n); for (let i = 0; i < n; i++) a[i] = this.f32(); return a; }
}

const GMT_NORMAL = 0, GMT_SKIN = 1;
const MAX_GROUP = 3;

function readGM(r: Reader, type: number, part: Partial<O3dPart>) {
  const isSkin = type === GMT_SKIN;
  r.skip(24 + 12 + 28); // bounds, opacity/bump/rigid, reservado
  const vertexListCount = r.i32(), vertexCount = r.i32(), _faceListCount = r.i32(), indexCount = r.i32();
  r.skip(12 * vertexListCount);

  const stride = type === GMT_SKIN ? 44 : 32;
  const pos = new Float32Array(vertexCount * 3), nor = new Float32Array(vertexCount * 3), uv = new Float32Array(vertexCount * 2);
  const sw = isSkin ? new Float32Array(vertexCount * 2) : undefined, si = isSkin ? new Uint16Array(vertexCount * 2) : undefined;
  for (let i = 0; i < vertexCount; i++) {
    const b = r.o + i * stride;
    pos[i * 3] = r.dv.getFloat32(b, true); pos[i * 3 + 1] = r.dv.getFloat32(b + 4, true); pos[i * 3 + 2] = r.dv.getFloat32(b + 8, true);
    // Skin: p(12) w1 w2(8) blendindices SHORT2(4) n(12) t(8) = 44 B; Normal: p n t = 32 B
    // (decl de CObject3D::InitStaticDeviceObjects: D3DDECLTYPE_SHORT2 no offset 20 → Skin.vs usa v2.x e v2.y)
    const nb = isSkin ? b + 24 : b + 12;
    if (sw && si) {
      sw[i * 2] = r.dv.getFloat32(b + 12, true); sw[i * 2 + 1] = r.dv.getFloat32(b + 16, true);
      si[i * 2] = r.dv.getInt16(b + 20, true); si[i * 2 + 1] = r.dv.getInt16(b + 22, true);
    }
    nor[i * 3] = r.dv.getFloat32(nb, true); nor[i * 3 + 1] = r.dv.getFloat32(nb + 4, true); nor[i * 3 + 2] = r.dv.getFloat32(nb + 8, true);
    uv[i * 2] = r.dv.getFloat32(nb + 12, true); uv[i * 2 + 1] = r.dv.getFloat32(nb + 16, true);
  }
  r.skip(vertexCount * stride);
  const indices = new Uint16Array(r.buf.slice(r.o, r.o + indexCount * 2));
  r.skip(indexCount * 2 + vertexCount * 2); // indices + IIB
  if (r.i32()) r.skip(4 * vertexListCount); // physique

  const textures: string[] = [];
  if (r.i32()) {
    const mc = r.i32() || 1;
    for (let i = 0; i < mc; i++) {
      r.skip(68); // D3DMATERIAL9
      const len = r.i32();
      const bytes = new Uint8Array(r.buf, r.o, len);
      let e = 0; while (e < len && bytes[e] !== 0) e++;
      textures.push(new TextDecoder('latin1').decode(bytes.subarray(0, e)));
      r.skip(len);
    }
  }
  const blocks: O3dPart['blocks'] = [];
  const mbc = r.i32();
  for (let i = 0; i < mbc; i++) {
    const start = r.i32(), triangles = r.i32(), material = r.i32();
    r.skip(8); // effect, amount
    const ubc = r.i32();
    const usedBones: number[] = [];
    for (let k = 0; k < 28; k++) { const v = r.i32(); if (k < ubc) usedBones.push(v); }
    blocks.push({ start, triangles, material, usedBones });
  }
  Object.assign(part, { positions: pos, normals: nor, uvs: uv, indices, textures, blocks, skinWeights: sw, skinIndices: si });
}

export function parseO3d(buf: ArrayBuffer): O3d {
  const r = new Reader(buf);
  const nameLen = r.u8();
  const nb = new Uint8Array(buf, 1, nameLen);
  const name = String.fromCharCode(...nb.map((b) => b ^ 0xcd));
  r.o = 1 + nameLen;
  const version = r.i32();
  if (version < 20) throw new Error('Versão de .o3d não suportada: ' + version);
  r.i32(); // ID
  r.skip(version >= 22 ? 48 : 24); // forces
  r.skip(8 + 16); // scrlU/V + reservado
  const bounds = {
    min: [r.f32(), r.f32(), r.f32()] as [number, number, number],
    max: [r.f32(), r.f32(), r.f32()] as [number, number, number],
  };
  const perSlerp = r.f32();
  const frameCount = r.i32();
  const eventCount = r.i32();
  r.skip(12 * eventCount);
  let collision: O3d['collision'] = null;
  if (r.i32()) { // objeto de colisão (m_collObj)
    const c: Partial<O3dPart> = {};
    readGM(r, GMT_NORMAL, c);
    if (c.positions?.length && c.indices?.length) collision = { positions: c.positions, indices: c.indices };
  }
  const lod = r.i32() !== 0;
  const boneCount = r.i32();
  let bones: O3dBones | null = null;
  if (boneCount > 0) {
    const base: number[][] = [], inverse: number[][] = [];
    for (let i = 0; i < boneCount; i++) base.push(r.mat());
    for (let i = 0; i < boneCount; i++) inverse.push(r.mat());
    if (frameCount > 0) {
      const parents: number[] = [];
      for (let i = 0; i < boneCount; i++) { const len = r.i32(); r.skip(len + 128); parents.push(r.i32()); }
      r.i32(); // aniCount
      const frames: (Float32Array | null)[] = [], staticTm: (number[] | null)[] = [];
      for (let i = 0; i < boneCount; i++) {
        if (r.i32() === 1) { frames.push(r.floats(7 * frameCount)); staticTm.push(null); } else { frames.push(null); staticTm.push(r.mat()); }
      }
      bones = { base, inverse, parents, frames, staticTm };
    }
    r.i32(); // sendVS
  }
  r.i32(); // poolSize
  const parts: O3dPart[] = [];
  const nodes: O3dNode[] = [];
  for (let g = 0; g < (lod ? MAX_GROUP : 1); g++) {
    const count = r.i32();
    for (let i = 0; i < count; i++) {
      const t = r.u32();
      const type = t & 0xffff;
      const ubCount = r.i32();
      const usedBones: number[] = [];
      for (let k = 0; k < ubCount; k++) usedBones.push(r.i32());
      const id = r.i32(), parentId = r.i32();
      let parentType = 0;
      if (parentId !== -1) parentType = r.i32();
      const transform: number[] = [];
      for (let k = 0; k < 16; k++) transform.push(r.f32());
      const part: Partial<O3dPart> = { id, parentId, parentType, light: (t & 0x80000000) !== 0, transform, skinned: type === GMT_SKIN, usedBones };
      readGM(r, type, part);
      if (type === GMT_NORMAL && frameCount > 0 && r.i32()) part.frames = r.floats(7 * frameCount);
      if (g === 0) nodes.push({ id, parentId, parentType, transform, frames: part.frames });
      if (g === 0 && type !== 2) parts.push(part as O3dPart); // 2 = bone (sem malha)
    }
  }
  return { name, version, frameCount, boneCount, bounds, perSlerp, parts, nodes, bones, collision };
}
