import { OT, type WorldObject } from './types';

/** Bloco extra de CMover::Read: name[64] + 32 + characterKey[32] + belligerence + 4. */
const MOVER_EXTRA = 64 + 32 + 32 + 4 + 4;
const CTRL_ELEM = 432; // CtrlElem com MAX_JOB = 32

/**
 * Lê um objeto a partir de `o` (começando no `u32 type`). Réplica de `CObject::CreateObject(file)` + `CObject::Read`.
 * `pos.x/z` no arquivo estão em "células" e são multiplicados por `mpu`.
 */
export function readObject(dv: DataView, o: number, mpu = 4): { obj: WorldObject; next: number } {
  const type = dv.getUint32(o, true);
  const f = (k: number) => dv.getFloat32(o + k, true);
  const obj: WorldObject = {
    type,
    rot: [f(8), f(4), f(16)],
    pos: [f(20) * mpu, f(24), f(28) * mpu],
    scale: [f(32), f(36), f(40)],
    modelId: dv.getUint32(o + 48, true),
    motion: dv.getUint32(o + 52, true),
    ai: dv.getUint32(o + 56, true),
    ai2: dv.getUint32(o + 60, true),
  };
  let next = o + 64;
  if (type === OT.MOVER) {
    const bytes = new Uint8Array(dv.buffer, dv.byteOffset, dv.byteLength);
    const str = (s: number, n: number) => {
      let e = s;
      while (e < s + n && bytes[e] !== 0) e++;
      return new TextDecoder('latin1').decode(bytes.subarray(s, e));
    };
    obj.name = str(next, 64);
    obj.characterKey = str(next + 64 + 32, 32);
    next += MOVER_EXTRA;
  } else if (type === OT.CTRL) {
    const version = dv.getUint32(next, true);
    if (version === 0x80000000) next += 4 + CTRL_ELEM;
    else if (version === 0x90000000) next += 4 + (CTRL_ELEM - 152 + 88);
    else next += CTRL_ELEM;
  }
  return { obj, next };
}
