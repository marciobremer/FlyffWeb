/** Efeitos `.sfx` (CSfx::Load, Common/Sfx.cpp). Versões "SFX0.1/0.2/0.3" e legado sem cabeçalho. */
export type V3 = [number, number, number];
export const enum SfxPartType { Bill = 1, Particle = 2, Mesh = 3, CustomMesh = 4 }
export const enum SfxBillType { Bill = 1, Bottom = 2, Pole = 3, Normal = 4 }
export const enum SfxAlphaType { Blend = 1, Glow = 2 }

export interface SfxKey { frame: number; pos: V3; posRotate: V3; scale: V3; rotate: V3; alpha: number }

export interface SfxParticleParams {
  create: number; createNum: number; frameAppear: number; frameKeep: number; frameDisappear: number;
  startPosVar: number; startPosVarY: number; yLow: number; yHigh: number; xzLow: number; xzHigh: number;
  accel: V3; scale: V3; scaleSpeed: V3; rotation: V3; rotationLow: V3; rotationHigh: V3;
  repeatScal: boolean; repeat: boolean;
  scalSpeedXLow: number; scalSpeedXHigh: number; scalSpeedYLow: number; scalSpeedYHigh: number; scalSpeedZLow: number; scalSpeedZHigh: number;
  scaleSpeed2: V3; scaleEnd: V3;
}

export interface SfxPart {
  type: SfxPartType;
  name: string;
  textureName: string;
  texFrame: number;
  texLoop: number;
  visible: boolean;
  billType: SfxBillType;
  alphaType: SfxAlphaType;
  keys: SfxKey[];
  particle?: SfxParticleParams;
  pointCount?: number;
}
export interface Sfx { version: number; parts: SfxPart[] }

export function parseSfx(buf: ArrayBuffer): Sfx {
  const dv = new DataView(buf);
  const bytes = new Uint8Array(buf);
  let o = 0;
  const head = String.fromCharCode(...bytes.subarray(0, 8));
  let version = 0;
  if (head === 'SFX0.1  ') version = 1; else if (head === 'SFX0.2  ') version = 2; else if (head === 'SFX0.3  ') version = 3;
  if (version) o = 8;

  const i32 = () => { const v = dv.getInt32(o, true); o += 4; return v; };
  const u16 = () => { const v = dv.getUint16(o, true); o += 2; return v; };
  const f32 = () => { const v = dv.getFloat32(o, true); o += 4; return v; };
  const v3 = (): V3 => [f32(), f32(), f32()];
  const str = () => {
    const len = i32();
    const s = new TextDecoder('latin1').decode(bytes.subarray(o, o + len));
    o += len;
    return s.replace(/\0.*$/, '');
  };

  const count = i32();
  const parts: SfxPart[] = [];
  for (let p = 0; p < count; p++) {
    const type = i32() as SfxPartType;
    if (type < 1 || type > 4) throw new Error('tipo de parte inválido ' + type);
    const name = str();
    const part: SfxPart = { type, name, textureName: name, texFrame: 1, texLoop: 1, visible: true, billType: SfxBillType.Bill, alphaType: SfxAlphaType.Blend, keys: [] };
    if (version >= 2) part.textureName = str();
    if (version >= 1) {
      part.texFrame = u16(); part.texLoop = u16();
      if (version >= 2) part.visible = i32() !== 0;
    }
    part.billType = i32(); part.alphaType = i32();
    if (type === SfxPartType.Particle) {
      const pp: SfxParticleParams = {
        create: u16(), createNum: u16(), frameAppear: u16(), frameKeep: u16(), frameDisappear: u16(),
        startPosVar: f32(), startPosVarY: f32(), yLow: f32(), yHigh: f32(), xzLow: f32(), xzHigh: f32(),
        accel: v3(), scale: v3(), scaleSpeed: v3(),
        rotation: [0, 0, 0], rotationLow: [0, 0, 0], rotationHigh: [0, 0, 0], repeatScal: false, repeat: false,
        scalSpeedXLow: 0, scalSpeedXHigh: 0, scalSpeedYLow: 0, scalSpeedYHigh: 0, scalSpeedZLow: 0, scalSpeedZHigh: 0,
        scaleSpeed2: [0, 0, 0], scaleEnd: [0, 0, 0],
      };
      if (version >= 2) {
        pp.rotation = v3(); pp.rotationLow = v3(); pp.rotationHigh = v3();
        pp.repeatScal = i32() !== 0;
        if (version >= 3) pp.repeat = i32() !== 0;
        pp.scalSpeedXLow = f32(); pp.scalSpeedXHigh = f32(); pp.scalSpeedYLow = f32(); pp.scalSpeedYHigh = f32(); pp.scalSpeedZLow = f32(); pp.scalSpeedZHigh = f32();
        pp.scaleSpeed2 = v3(); pp.scaleEnd = v3();
      }
      part.particle = pp;
    }
    const keyCount = i32();
    for (let k = 0; k < keyCount; k++) part.keys.push({ frame: u16(), pos: v3(), posRotate: v3(), scale: v3(), rotate: v3(), alpha: i32() });
    if (type === SfxPartType.CustomMesh) part.pointCount = i32();
    parts.push(part);
  }
  if (o !== buf.byteLength) throw new Error(`sfx: ${buf.byteLength - o} bytes não lidos`);
  return { version, parts };
}

/** `CSfxPart::GetKey(frame, key)`: interpola entre a chave anterior e a próxima; `key.frame` = distância entre elas. */
export function sampleKey(part: SfxPart, frame: number): (SfxKey & { prevFrame: number }) | null {
  const keys = part.keys;
  let prev: SfxKey | null = null;
  for (const k of keys) { if (k.frame > frame) break; prev = k; }
  let next: SfxKey | null = null;
  for (const k of keys) { if (k.frame >= frame) { next = k; break; } }
  if (!prev || !next) return null;
  const d = next.frame - prev.frame;
  const t = d === 0 ? 0 : (frame - prev.frame) / d;
  const lerp = (a: V3, b: V3): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  return {
    prevFrame: prev.frame, frame: d,
    pos: lerp(prev.pos, next.pos), posRotate: lerp(prev.posRotate, next.posRotate), scale: lerp(prev.scale, next.scale), rotate: lerp(prev.rotate, next.rotate),
    alpha: Math.trunc(prev.alpha + ((next.alpha - prev.alpha) * (frame - prev.frame)) / (d || 1)) ,
  };
}
