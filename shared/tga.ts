import { DataTexture } from 'three';
import { fetchBuf } from './data';
import { parseDds } from './dds';
import { decodeDxt } from './dxt';

/** Decodifica TGA tipo 2 (sem compressão) ou 10 (RLE), 24/32 bits — formato das imagens de interface em Data/Theme. */
export function decodeTga(buf: ArrayBuffer): ImageData {
  const b = new Uint8Array(buf);
  const idLen = b[0], cmapType = b[1], type = b[2];
  const cmapLen = b[5] | (b[6] << 8), cmapBits = b[7];
  const w = b[12] | (b[13] << 8), h = b[14] | (b[15] << 8), bpp = b[16], desc = b[17];
  if (type !== 2 && type !== 10) throw new Error('TGA tipo ' + type + ' não suportado');
  if (bpp !== 24 && bpp !== 32) throw new Error('TGA de ' + bpp + ' bits não suportado');
  const px = bpp / 8;
  let o = 18 + idLen + (cmapType ? cmapLen * Math.ceil(cmapBits / 8) : 0);
  const raw = new Uint8Array(w * h * px);
  if (type === 2) raw.set(b.subarray(o, o + raw.length));
  else {
    for (let i = 0; i < raw.length;) {
      const c = b[o++], n = (c & 0x7f) + 1;
      if (c & 0x80) { for (let k = 0; k < n; k++, i += px) raw.set(b.subarray(o, o + px), i); o += px; }
      else { raw.set(b.subarray(o, o + n * px), i); o += n * px; i += n * px; }
    }
  }
  const out = new ImageData(w, h);
  const top = (desc & 0x20) !== 0;
  for (let y = 0; y < h; y++) {
    const sy = top ? y : h - 1 - y;
    for (let x = 0; x < w; x++) {
      const s = (sy * w + x) * px, d = (y * w + x) * 4;
      out.data[d] = raw[s + 2]; out.data[d + 1] = raw[s + 1]; out.data[d + 2] = raw[s];
      out.data[d + 3] = px === 4 ? raw[s + 3] : 255;
    }
  }
  return out;
}

const urls = new Map<string, Promise<string | null>>();
/** URL (data: PNG) de uma imagem de `Data/Theme/Default`, com cache. */
export function themeImage(file: string): Promise<string | null> {
  let p = urls.get(file);
  if (!p) {
    p = fetchBuf('/res/Data/Theme/Default/' + file).then((buf) => {
      if (!buf) return null;
      try {
        const img = decodeTga(buf);
        const c = document.createElement('canvas');
        c.width = img.width; c.height = img.height;
        c.getContext('2d')!.putImageData(img, 0, 0);
        return c.toDataURL();
      } catch { return null; }
    });
    urls.set(file, p);
  }
  return p;
}

/**
 * Junta peças do tema numa imagem só (grade `cols`×`rows`, mesma ordem dos arquivos), para usar como `border-image` no CSS —
 * ex.: moldura de janela `WndTile00–11` (3×4) ou caixa de texto `WndEditTile00–08` (3×3). Todas as peças têm o tamanho da primeira.
 */
export function themeTiles(files: string[], cols: number, rows: number): Promise<{ url: string; w: number; h: number } | null> {
  return Promise.all(files.map((f) => fetchBuf('/res/Data/Theme/Default/' + f).then((b) => { try { return b ? decodeTga(b) : null; } catch { return null; } })))
    .then((imgs) => {
      if (imgs.some((i) => !i)) return null;
      const tw = imgs[0]!.width, th = imgs[0]!.height;
      const c = document.createElement('canvas');
      c.width = tw * cols; c.height = th * rows;
      const g = c.getContext('2d')!;
      imgs.forEach((im, k) => g.putImageData(im!, (k % cols) * tw, Math.floor(k / cols) * th));
      return { url: c.toDataURL(), w: tw, h: th };
    });
}

const icons = new Map<string, Promise<string | null>>();
/**
 * URL de um ícone de `Data/Icon` (ex.: `icon_MenuStatus.dds`). PNG vai direto; DDS sem compressão (os ícones de menu são
 * A8R8G8B8 32×32) é decodificado para canvas. DDS comprimido (DXT) não é suportado aqui → null.
 */
export function iconImage(file: string): Promise<string | null> {
  let p = icons.get(file);
  if (!p) {
    p = /\.png$/i.test(file) ? Promise.resolve('/res/Data/Icon/' + file) : fetchBuf('/res/Data/Icon/' + file).then((buf) => {
      const t = buf ? parseDds(buf) : null;
      if (!(t instanceof DataTexture)) return null;
      const { width, height, data } = t.image as { width: number; height: number; data: Uint8Array };
      const c = document.createElement('canvas');
      c.width = width; c.height = height;
      c.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(data.buffer, data.byteOffset, width * height * 4), width, height), 0, 0);
      t.dispose();
      return c.toDataURL();
    });
    icons.set(file, p);
  }
  return p;
}

const keyed = new Map<string, Promise<string | null>>();
/**
 * Imagem .bmp do tema com a cor-chave do cliente (magenta 255,0,255) transformada em transparência — o D3D do cliente
 * não desenha esses pixels; no navegador eles apareceriam como bordas cor-de-rosa.
 */
export function keyedImage(file: string): Promise<string | null> {
  let p = keyed.get(file);
  if (!p) {
    p = new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const c = document.createElement('canvas');
        c.width = img.naturalWidth; c.height = img.naturalHeight;
        const g = c.getContext('2d')!;
        g.drawImage(img, 0, 0);
        const d = g.getImageData(0, 0, c.width, c.height);
        for (let i = 0; i < d.data.length; i += 4) {
          if (d.data[i] > 245 && d.data[i + 1] < 10 && d.data[i + 2] > 245) d.data[i + 3] = 0;
        }
        g.putImageData(d, 0, 0);
        resolve(c.toDataURL());
      };
      img.onerror = () => resolve(null);
      img.src = '/res/Data/Theme/Default/' + file;
    });
    keyed.set(file, p);
  }
  return p;
}

const items = new Map<string, Promise<string | null>>();
/**
 * Ícone de item (`szIcon` do Spec_Item.txt, em `Data/Item`). Os .dds vêm em vários formatos (R5G6B5, A8R8G8B8, DXT1/3/5…):
 * sem compressão via parseDds, DXT decodificado no processador. PNG vai direto. null se não achar/decodificar.
 */
export function itemIcon(file: string): Promise<string | null> { return iconFrom('Item', file); }

/** imagem .dds do tema (`Data/Theme/Default`, ex.: texChatEmoticon.dds) — mesmos formatos dos ícones de item */
export function themeDds(file: string): Promise<string | null> { return iconFrom('Theme/Default', file); }

/** ícone de skill (`szIcon` do propSkill.txt, em `Data/Icon`) — mesmos formatos dos ícones de item */
export function skillIcon(file: string): Promise<string | null> { return iconFrom('Icon', file); }

function iconFrom(dir: string, file: string): Promise<string | null> { return resImage(`Data/${dir}/${file}`); }

/**
 * Qualquer imagem .dds/.png de `/res` (caminho relativo, ex.: `World/WdMadrigal/WdMadrigal01-04.dds`, o mini mapa de um
 * pedaço de terreno) como data URL, com cache; null se não achar/decodificar.
 */
export function resImage(path: string): Promise<string | null> {
  const key = path;
  let p = items.get(key);
  if (!p) {
    const url = '/res/' + path, file = path;
    p = /\.png$/i.test(file) ? Promise.resolve(url) : fetchBuf(url).then((buf) => {
      if (!buf) return null;
      let img: ImageData | null = null;
      try { img = decodeDxt(buf); } catch { img = null; }
      if (!img) {
        const t = (() => { try { return parseDds(buf); } catch { return null; } })();
        if (t instanceof DataTexture) {
          const { width, height, data } = t.image as { width: number; height: number; data: Uint8Array };
          img = new ImageData(new Uint8ClampedArray(data.buffer, data.byteOffset, width * height * 4).slice(), width, height);
        }
        t?.dispose();
      }
      if (!img) return null;
      // cor-chave do cliente (magenta 255,0,255): o D3D não desenha esses pixels nos ícones sem canal alfa
      const px = img.data;
      for (let i = 0; i < px.length; i += 4) if (px[i] > 240 && px[i + 1] < 16 && px[i + 2] > 240) px[i + 3] = 0;
      const c = document.createElement('canvas');
      c.width = img.width; c.height = img.height;
      c.getContext('2d')!.putImageData(img, 0, 0);
      return c.toDataURL();
    });
    items.set(key, p);
  }
  return p;
}
