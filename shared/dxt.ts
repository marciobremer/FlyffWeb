/**
 * Decodifica o 1º nível (mip 0) de um .dds DXT1/DXT3/DXT5 para RGBA8 no processador — para ícones pequenos (32×32) que viram
 * <img> na interface (o DDSLoader do Three só entrega a textura comprimida para a GPU). null se não for DXT.
 */
export function decodeDxt(buf: ArrayBuffer): ImageData | null {
  if (buf.byteLength < 128) return null;
  const dv = new DataView(buf);
  if (dv.getUint32(0, true) !== 0x20534444 || !(dv.getUint32(80, true) & 0x4)) return null;
  const h = dv.getUint32(12, true), w = dv.getUint32(16, true);
  const four = String.fromCharCode(dv.getUint8(84), dv.getUint8(85), dv.getUint8(86), dv.getUint8(87));
  const kind = four === 'DXT1' ? 1 : four === 'DXT3' ? 3 : four === 'DXT5' ? 5 : 0;
  if (!kind || !w || !h || w > 1024 || h > 1024) return null;
  const blockBytes = kind === 1 ? 8 : 16;
  const bw = Math.ceil(w / 4), bh = Math.ceil(h / 4);
  if (128 + bw * bh * blockBytes > buf.byteLength) return null;
  const out = new ImageData(w, h), px = out.data, src = new Uint8Array(buf);
  const c = new Uint8Array(16); // 4 cores RGBA
  const alpha = new Uint8Array(16);
  const rgb565 = (v: number, o: number) => { c[o] = ((v >> 11) & 31) * 255 / 31; c[o + 1] = ((v >> 5) & 63) * 255 / 63; c[o + 2] = (v & 31) * 255 / 31; c[o + 3] = 255; };
  let p = 128;
  for (let by = 0; by < bh; by++) for (let bx = 0; bx < bw; bx++, p += blockBytes) {
    // alfa (DXT3: 4 bits explícitos; DXT5: 2 referências interpoladas + índices de 3 bits)
    if (kind === 3) for (let i = 0; i < 16; i++) alpha[i] = ((src[p + (i >> 1)] >> ((i & 1) * 4)) & 15) * 17;
    else if (kind === 5) {
      const a0 = src[p], a1 = src[p + 1];
      const pal = [a0, a1];
      if (a0 > a1) for (let k = 1; k < 7; k++) pal.push(((7 - k) * a0 + k * a1) / 7);
      else { for (let k = 1; k < 5; k++) pal.push(((5 - k) * a0 + k * a1) / 5); pal.push(0, 255); }
      let bits = 0, nb = 0, q = p + 2;
      for (let i = 0; i < 16; i++) {
        if (nb < 3) { bits |= src[q++] << nb; nb += 8; }
        alpha[i] = pal[bits & 7]; bits >>= 3; nb -= 3;
      }
    }
    const cp = kind === 1 ? p : p + 8;
    const c0 = src[cp] | (src[cp + 1] << 8), c1 = src[cp + 2] | (src[cp + 3] << 8);
    rgb565(c0, 0); rgb565(c1, 4);
    if (c0 > c1 || kind !== 1) for (let k = 0; k < 3; k++) { c[8 + k] = (2 * c[k] + c[4 + k]) / 3; c[12 + k] = (c[k] + 2 * c[4 + k]) / 3; c[11] = c[15] = 255; }
    else { for (let k = 0; k < 3; k++) { c[8 + k] = (c[k] + c[4 + k]) / 2; c[12 + k] = 0; } c[11] = 255; c[15] = 0; }
    const idx = src[cp + 4] | (src[cp + 5] << 8) | (src[cp + 6] << 16) | (src[cp + 7] << 24);
    for (let i = 0; i < 16; i++) {
      const x = bx * 4 + (i & 3), y = by * 4 + (i >> 2);
      if (x >= w || y >= h) continue;
      const o = (y * w + x) * 4, ci = ((idx >>> (2 * i)) & 3) * 4;
      px[o] = c[ci]; px[o + 1] = c[ci + 1]; px[o + 2] = c[ci + 2];
      px[o + 3] = kind === 1 ? c[ci + 3] : alpha[i];
    }
  }
  return out;
}
