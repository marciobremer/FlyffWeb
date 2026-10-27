import fs from 'node:fs';
import zlib from 'node:zlib';
import { DataTexture } from 'three';
import { decodeDxt } from '../../shared/dxt';
import { parseDds } from '../../shared/dds';
import { resolveRes, type ResRoot } from './resources';

/**
 * Ícones de item (`Data/Item/*.dds`) como PNG, para o painel admin (JavaScript puro, sem o decodificador do jogo). Usa os
 * mesmos decodificadores do cliente (DXT1/3/5 e os formatos sem compressão) e tira a cor-chave magenta (255,0,255), como o
 * cliente faz. Guarda em memória (cada ícone tem poucos KB).
 */

// o decodificador DXT escreve num ImageData (do navegador): no Node basta um objeto com o mesmo formato
const g = globalThis as unknown as { ImageData?: unknown };
if (!g.ImageData) g.ImageData = class { data: Uint8ClampedArray; constructor(public width: number, public height: number) { this.data = new Uint8ClampedArray(width * height * 4); } };

const cache = new Map<string, Buffer | null>();

const CRC = (() => { const t = new Int32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; } return t; })();
const crc32 = (b: Buffer) => { let c = -1; for (const x of b) c = CRC[(c ^ x) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
function chunk(type: string, data: Buffer) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
/** RGBA → PNG (sem filtro; os ícones são pequenos) */
export function encodePng(w: number, h: number, rgba: Uint8Array | Uint8ClampedArray): Buffer {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; Buffer.from(rgba.buffer, rgba.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1); }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

/** PNG do ícone `file` (nome do szIcon, em Data/Item), ou null se não existe/não decodifica */
export function itemIconPng(roots: ResRoot[], file: string): Buffer | null {
  const key = file.toLowerCase();
  if (cache.has(key)) return cache.get(key)!;
  let out: Buffer | null = null;
  try {
    if (/^[\w .()+-]+\.(dds|png)$/i.test(file)) {
      const p = resolveRes(roots, `Data/Item/${file}`);
      if (p && /\.png$/i.test(p)) out = fs.readFileSync(p);
      else if (p) {
        const b = fs.readFileSync(p);
        const buf = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
        let img: { width: number; height: number; data: Uint8Array | Uint8ClampedArray } | null = null;
        try { img = decodeDxt(buf) as never; } catch { img = null; }
        if (!img) {
          const t = (() => { try { return parseDds(buf); } catch { return null; } })();
          if (t instanceof DataTexture) { const i = t.image as { width: number; height: number; data: Uint8Array }; img = { width: i.width, height: i.height, data: new Uint8Array(i.data) }; }
          t?.dispose();
        }
        if (img) {
          const px = img.data;
          for (let i = 0; i < px.length; i += 4) if (px[i] > 240 && px[i + 1] < 16 && px[i + 2] > 240) px[i + 3] = 0;
          out = encodePng(img.width, img.height, px);
        }
      }
    }
  } catch { out = null; }
  cache.set(key, out);
  return out;
}
