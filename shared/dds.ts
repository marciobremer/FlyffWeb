import { CompressedTexture, DataTexture, LinearFilter, LinearMipmapLinearFilter, RGBAFormat, UnsignedByteType, type Texture } from 'three';
import { trackedBuffer, trackedFetch } from './netstats';
import { DDSLoader } from 'three/examples/jsm/loaders/DDSLoader.js';

/**
 * Carrega .dds do cliente FlyFF. O DDSLoader do Three só entende DXT1/3/5; os arquivos do jogo também trazem
 * formatos sem compressão (R5G6B5/A4R4G4B4/A1R5G5B5, R8G8B8, A8R8G8B8/X8R8G8B8) que decodificamos aqui para RGBA8.
 * Retorna null em qualquer arquivo inválido (nunca uma textura sem imagem, que derrubaria o render).
 */
const parser = new DDSLoader();

const DDPF_ALPHAPIXELS = 0x1, DDPF_FOURCC = 0x4, DDPF_RGB = 0x40;

function ctz(m: number) { let s = 0; while (m && !(m & 1)) { m >>>= 1; s++; } return s; }
function bitsOf(m: number) { let n = 0; while (m) { n += m & 1; m >>>= 1; } return n; }

export async function loadDds(url: string): Promise<Texture | null> {
  let buf: ArrayBuffer;
  try {
    const r = await trackedFetch(url);
    if (!r.ok) return null;
    buf = await trackedBuffer(r);
  } catch { return null; }
  try { return parseDds(buf); } catch { return null; }
}

export function parseDds(buf: ArrayBuffer): Texture | null {
  if (buf.byteLength < 128) return null;
  const dv = new DataView(buf);
  if (dv.getUint32(0, true) !== 0x20534444) return null; // 'DDS '
  const height = dv.getUint32(12, true), width = dv.getUint32(16, true), mips = Math.max(1, dv.getUint32(28, true));
  const pfFlags = dv.getUint32(80, true);

  if (pfFlags & DDPF_FOURCC) {
    const dds = parser.parse(buf, true);
    if (!dds.mipmaps?.length || !dds.format) return null;
    const t = new CompressedTexture(dds.mipmaps as never, dds.width, dds.height, dds.format as never);
    t.minFilter = dds.mipmaps.length === 1 ? LinearFilter : LinearMipmapLinearFilter;
    t.magFilter = LinearFilter;
    t.needsUpdate = true;
    return t;
  }

  if (!(pfFlags & DDPF_RGB)) return null;
  const bits = dv.getUint32(88, true);
  const rm = dv.getUint32(92, true), gm = dv.getUint32(96, true), bm = dv.getUint32(100, true), am = pfFlags & DDPF_ALPHAPIXELS ? dv.getUint32(104, true) : 0;
  const bytes = bits / 8;
  if (![2, 3, 4].includes(bytes)) return null;
  const ch = [rm, gm, bm, am].map((m) => ({ m, s: ctz(m), n: bitsOf(m) }));
  const out = new Uint8Array(width * height * 4);
  let o = 128;
  for (let i = 0; i < width * height; i++, o += bytes) {
    let px = 0;
    for (let b = 0; b < bytes; b++) px |= dv.getUint8(o + b) << (8 * b);
    px >>>= 0;
    for (let c = 0; c < 4; c++) {
      const { m, s, n } = ch[c];
      out[i * 4 + c] = n ? Math.round((((px & m) >>> s) * 255) / ((1 << n) - 1)) : c === 3 ? 255 : 0;
    }
  }
  void mips;
  const t = new DataTexture(out, width, height, RGBAFormat, UnsignedByteType);
  t.minFilter = LinearMipmapLinearFilter; t.magFilter = LinearFilter; t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}
