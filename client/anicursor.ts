/**
 * Cursor animado do Windows (.ani: RIFF "ACON" com `anih`, `rate`, `seq ` e LIST "fram" de quadros .cur/.ico), como os de
 * Data/Cursors — o navegador não toca .ani em `cursor:`, então os quadros viram imagens (PNG) que a interface anima.
 * Lê só quadros de 24/32 bits (os do cliente), com a máscara AND como transparência.
 */
export interface AniCursor {
  /** imagens dos quadros na ordem de exibição (já com o `seq `), e quanto cada uma fica na tela (ms) */
  frames: string[];
  ms: number[];
  /** ponto de clique dentro da imagem (o hotspot do .cur) */
  hotspot: [number, number];
  size: [number, number];
}

const tag = (v: DataView, o: number) => String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3));

/** um quadro .cur/.ico (1ª imagem do diretório) → PNG em data URL, hotspot e tamanho; null se o formato não é suportado */
function decodeCur(buf: ArrayBuffer): { url: string; hotspot: [number, number]; size: [number, number] } | null {
  const v = new DataView(buf);
  if (v.byteLength < 22 || v.getUint16(0, true) !== 0) return null;
  const type = v.getUint16(2, true);
  const hot: [number, number] = type === 2 ? [v.getUint16(10, true), v.getUint16(12, true)] : [0, 0];
  const p = v.getUint32(18, true);
  if (p + 40 > v.byteLength) return null;
  const w = v.getInt32(p + 4, true), h = v.getInt32(p + 8, true) / 2, bpp = v.getUint16(p + 14, true);
  if ((bpp !== 24 && bpp !== 32) || w <= 0 || h <= 0 || w > 256 || h > 256) return null;
  const xor = p + v.getUint32(p, true), row = Math.floor((w * bpp + 31) / 32) * 4, mrow = Math.floor((w + 31) / 32) * 4, and = xor + row * h;
  if (and + mrow * h > v.byteLength) return null;
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const img = ctx.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    const r = xor + (h - 1 - y) * row, m = and + (h - 1 - y) * mrow; // DIB de baixo para cima
    for (let x = 0; x < w; x++) {
      const s = r + x * (bpp / 8), d = (y * w + x) * 4;
      const masked = (v.getUint8(m + (x >> 3)) >> (7 - (x & 7))) & 1;
      const a = bpp === 32 ? v.getUint8(s + 3) : 255;
      img.data[d] = v.getUint8(s + 2); img.data[d + 1] = v.getUint8(s + 1); img.data[d + 2] = v.getUint8(s);
      // 24 bits: a máscara diz o que é transparente; 32 bits: o alfa
      img.data[d + 3] = bpp === 24 ? (masked ? 0 : 255) : a;
    }
  }
  ctx.putImageData(img, 0, 0);
  return { url: canvas.toDataURL('image/png'), hotspot: hot, size: [w, h] };
}

/** baixa e lê um .ani; null se não achar ou não entender */
export async function loadAniCursor(url: string): Promise<AniCursor | null> {
  let buf: ArrayBuffer;
  try { const r = await fetch(url); if (!r.ok) return null; buf = await r.arrayBuffer(); } catch { return null; }
  const v = new DataView(buf);
  if (v.byteLength < 12 || tag(v, 0) !== 'RIFF' || tag(v, 8) !== 'ACON') return null;
  let rate = 10, rates: number[] = [], seq: number[] = [];
  const icons: ArrayBuffer[] = [];
  const walk = (o: number, end: number) => {
    while (o + 8 <= end) {
      const id = tag(v, o), size = v.getUint32(o + 4, true), body = o + 8;
      if (body + size > v.byteLength) break;
      if (id === 'LIST') walk(body + 4, body + size);
      else if (id === 'anih' && size >= 36) rate = v.getUint32(body + 28, true) || rate;
      else if (id === 'rate') rates = Array.from({ length: size >> 2 }, (_, i) => v.getUint32(body + i * 4, true));
      else if (id === 'seq ') seq = Array.from({ length: size >> 2 }, (_, i) => v.getUint32(body + i * 4, true));
      else if (id === 'icon') icons.push(buf.slice(body, body + size));
      o = body + size + (size & 1);
    }
  };
  walk(12, v.byteLength);
  const decoded = icons.map(decodeCur);
  if (!decoded.length || decoded.some((d) => !d)) return null;
  const order = seq.length ? seq : decoded.map((_, i) => i);
  const first = decoded[0]!;
  return {
    frames: order.map((i) => decoded[i]?.url ?? first.url),
    // taxa em "jiffies" (1/60 s), por passo (`rate`) ou a mesma para todos (`anih`)
    ms: order.map((_, i) => ((rates[i] ?? rate) * 1000) / 60),
    hotspot: first.hotspot, size: first.size,
  };
}
