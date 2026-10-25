import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { CLIENT_DIR, RES_DIR, SOUND_DIR } from './config';

/**
 * Sons do jogo (.wav do cliente original, ~1700 arquivos / 220 MB). O servidor NÃO toca nada: só entrega o arquivo que o navegador pedir
 * (`/snd/<arquivo>`), uma vez por cliente (cache de 1 ano, ETag) e compactado em gzip quando o navegador aceita (o .wav encolhe bastante;
 * a versão compactada fica em memória, até 96 MB). `GET /gapi/sounds` devolve { id: arquivo } (defineSound.h + sound.inc).
 */
const decode = (b: Buffer) => new TextDecoder('euc-kr').decode(b);

let ids: Record<number, string> | null = null;
const files = new Map<string, string>(); // minúsculas → nome real

function load() {
  if (ids) return ids;
  ids = {};
  try { for (const f of fs.readdirSync(SOUND_DIR)) files.set(f.toLowerCase(), f); } catch { /* sem a pasta de sons */ }
  const num = new Map<string, number>();
  try {
    for (const line of decode(fs.readFileSync(path.join(RES_DIR, 'defineSound.h'))).split(/\r?\n/)) {
      const m = /^#define\s+(SND_\w+)\s+(\d+)/.exec(line.trim());
      if (m) num.set(m[1], Number(m[2]));
    }
    for (const line of decode(fs.readFileSync([path.join(RES_DIR, 'Client', 'sound.inc'), path.join(CLIENT_DIR, 'Client', 'sound.inc')].find((f) => fs.existsSync(f)) ?? '')).split(/\r?\n/)) {
      const m = /^(SND_\w+)\s+"([^"]+)"/.exec(line.trim());
      const id = m ? num.get(m[1]) : undefined;
      const real = m ? files.get(m[2].toLowerCase()) : undefined;
      if (m && id !== undefined && real) ids[id] = real;
    }
  } catch { /* sem os arquivos de definição */ }
  return ids;
}

export const soundIds = () => load();

const gz = new Map<string, Buffer>();
let gzBytes = 0;
const GZ_LIMIT = 96 * 1024 * 1024;

export function soundMiddleware() {
  return (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const url = new URL(req.url ?? '/', 'http://x');
    if (!url.pathname.startsWith('/snd/')) return next();
    load();
    const real = files.get(decodeURIComponent(url.pathname.slice(5)).toLowerCase());
    if (!real) { res.statusCode = 404; res.end('not found'); return; }
    const p = path.join(SOUND_DIR, real);
    const st = fs.statSync(p);
    const etag = `"${st.size}-${Math.round(st.mtimeMs)}"`;
    res.setHeader('cache-control', 'public, max-age=31536000, immutable');
    res.setHeader('etag', etag);
    res.setHeader('content-type', 'audio/wav');
    res.setHeader('vary', 'accept-encoding');
    if (req.headers['if-none-match'] === etag) { res.statusCode = 304; res.end(); return; }
    if (/\bgzip\b/.test(String(req.headers['accept-encoding'] ?? '')) && st.size > 4096) {
      let buf = gz.get(real);
      if (!buf) {
        buf = zlib.gzipSync(fs.readFileSync(p), { level: 6 });
        if (gzBytes + buf.length <= GZ_LIMIT) { gz.set(real, buf); gzBytes += buf.length; }
      }
      res.setHeader('content-encoding', 'gzip');
      res.setHeader('content-length', buf.length);
      res.end(buf);
      return;
    }
    res.setHeader('content-length', st.size);
    fs.createReadStream(p).pipe(res);
  };
}
