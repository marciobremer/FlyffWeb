/** Esqueleto `.chr` (CSkeleton::Load, Common/Motion.cpp:272) e animação `.ani` (CMotion::Load). Matrizes D3D linha-vetor (16 floats). */
export interface Bone { name: string; parentId: number; tm: number[]; inverseTm: number[]; localTm: number[] }
export interface Skeleton {
  version: number; bones: Bone[];
  /** ossos das mãos (achados pelo nome "R Hand"/"L Hand", como CSkeleton) e onde a arma fica em relação a eles */
  rHand: number; lHand: number;
  /** antebraços (m_nLArmIdx / m_nRArmIdx): o escudo fica preso no esquerdo e o knuckle no direito, não na mão */
  lArm: number; rArm: number;
  /** m_mLocalRH (arma na mão direita), m_mLocalShield (escudo, mão esquerda), m_mLocalKnuckle (knuckle), m_mLocalLH (arco/mão esquerda) */
  localRH?: number[]; localShield?: number[]; localKnuckle?: number[]; localLH?: number[];
}

class R {
  o = 0; dv: DataView;
  constructor(public buf: ArrayBuffer) { this.dv = new DataView(buf); }
  i32() { const v = this.dv.getInt32(this.o, true); this.o += 4; return v; }
  f32() { const v = this.dv.getFloat32(this.o, true); this.o += 4; return v; }
  mat() { const m: number[] = []; for (let i = 0; i < 16; i++) m.push(this.f32()); return m; }
  str(len: number) {
    const b = new Uint8Array(this.buf, this.o, len); this.o += len;
    let e = 0; while (e < len && b[e] !== 0) e++;
    return new TextDecoder('latin1').decode(b.subarray(0, e));
  }
  skip(n: number) { this.o += n; }
}

export function parseChr(buf: ArrayBuffer): Skeleton {
  const r = new R(buf);
  const version = r.i32();
  if (version < 4) throw new Error('versão de .chr não suportada ' + version);
  r.i32(); // ID
  const n = r.i32();
  const bones: Bone[] = [];
  for (let i = 0; i < n; i++) {
    const name = r.str(r.i32());
    const tm = r.mat(), inverseTm = r.mat(), localTm = r.mat();
    bones.push({ name, tm, inverseTm, localTm, parentId: r.i32() });
  }
  const sk: Skeleton = { version, bones, rHand: bones.findIndex((b) => /R Hand$/i.test(b.name)), lHand: bones.findIndex((b) => /L Hand$/i.test(b.name)), lArm: bones.findIndex((b) => /L ForeArm$/i.test(b.name)), rArm: bones.findIndex((b) => /R ForeArm$/i.test(b.name)) };
  // depois dos ossos: m_bSendVS, m_mLocalRH, m_mLocalShield, m_mLocalKnuckle, eventos (posições + ossos) e, na v7, m_mLocalLH
  const rest = buf.byteLength - r.o;
  if (rest >= 4 + 64 * 3) {
    r.i32();
    sk.localRH = r.mat(); sk.localShield = r.mat(); sk.localKnuckle = r.mat();
    if (rest >= 388) { r.skip(128); sk.localLH = r.mat(); }
  }
  return sk;
}

export interface MotionFrame { rot: [number, number, number, number]; pos: [number, number, number] }
export interface Motion {
  perSlerp: number;
  frameCount: number;
  boneCount: number;
  parents: number[];
  /** por osso: Float32Array(frameCount*7) = x,y,z,w,px,py,pz; ou null (osso estático usa `staticTm`) */
  frames: (Float32Array | null)[];
  staticTm: (number[] | null)[];
}

export function parseAni(buf: ArrayBuffer): Motion {
  const r = new R(buf);
  const ver = r.i32();
  if (ver < 10) throw new Error('versão de .ani não suportada ' + ver);
  r.i32(); // ID
  const perSlerp = r.f32();
  r.skip(32);
  const boneCount = r.i32(), frameCount = r.i32();
  if (r.i32()) r.skip(12 * frameCount); // paths
  const parents: number[] = [];
  for (let i = 0; i < boneCount; i++) { r.skip(r.i32() + 128); parents.push(r.i32()); } // nome, inverseTM, localTM, parent
  r.i32(); // aniCount
  const frames: (Float32Array | null)[] = [], staticTm: (number[] | null)[] = [];
  for (let i = 0; i < boneCount; i++) {
    if (r.i32() === 1) {
      const a = new Float32Array(frameCount * 7);
      for (let k = 0; k < a.length; k++) a[k] = r.f32();
      frames.push(a); staticTm.push(null);
    } else { frames.push(null); staticTm.push(r.mat()); }
  }
  return { perSlerp, frameCount, boneCount, parents, frames, staticTm };
}
