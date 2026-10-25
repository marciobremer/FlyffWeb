import type { WorldObject } from './types';
import { readObject } from './object';

/** `CWorld::_loadDyoFile` — objetos (ctrl/item/mover) terminados em 0xFFFFFFFF. */
export function parseDyo(buf: ArrayBuffer, mpu = 4): WorldObject[] {
  const dv = new DataView(buf);
  const out: WorldObject[] = [];
  let o = 0;
  while (o + 4 <= buf.byteLength) {
    if (dv.getUint32(o, true) === 0xffffffff) break;
    const r = readObject(dv, o, mpu);
    out.push(r.obj);
    o = r.next;
  }
  return out;
}
