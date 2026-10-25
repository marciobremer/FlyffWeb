import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './config';

/**
 * Taxas do servidor (multiplicadores de EXP, Penya e Drop) em `data/server-rates.json`, editável à mão ou pelo painel admin
 * (tela World). O servidor do jogo relê o arquivo quando ele muda — não precisa reiniciar. 1 = taxa original do FlyFF.
 */
export type Rates = { exp: number; penya: number; drop: number };

export const RATES_FILE = path.join(ROOT, 'data', 'server-rates.json');
export const DEFAULT_RATES: Rates = { exp: 1, penya: 1, drop: 1 };
export const RATE_MIN = 0.1, RATE_MAX = 1000;

const KEYS = ['exp', 'penya', 'drop'] as const;
const CHECK_MS = 2000;

/** valida e arredonda (2 casas); valor ausente ou inválido volta ao padrão quando `strict` é falso */
export function cleanRates(v: unknown, strict = false): Rates {
  const src = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const out = { ...DEFAULT_RATES };
  for (const k of KEYS) {
    const n = Number(src[k]);
    if (Number.isFinite(n) && n >= RATE_MIN && n <= RATE_MAX) out[k] = Math.round(n * 100) / 100;
    else if (strict) throw new Error(`Taxa de ${k.toUpperCase()} inválida: use um número entre ${RATE_MIN} e ${RATE_MAX}.`);
  }
  return out;
}

let cached: Rates = { ...DEFAULT_RATES };
let cachedMtime = -1, checkedAt = 0;

/** taxas atuais (relê o arquivo no máximo a cada 2 s, e só se ele mudou) */
export function rates(): Rates {
  const now = Date.now();
  if (now - checkedAt < CHECK_MS) return cached;
  checkedAt = now;
  let mtime = 0;
  try { mtime = fs.statSync(RATES_FILE).mtimeMs; } catch { /* sem arquivo: padrão */ }
  if (mtime !== cachedMtime) {
    cachedMtime = mtime;
    try { cached = mtime ? cleanRates(JSON.parse(fs.readFileSync(RATES_FILE, 'utf8'))) : { ...DEFAULT_RATES }; } catch (e) {
      console.error('rates: não consegui ler', RATES_FILE, (e as Error).message);
    }
  }
  return cached;
}

/** grava as taxas (lança erro se algum valor for inválido) */
export function saveRates(v: unknown): Rates {
  const r = cleanRates(v, true);
  fs.mkdirSync(path.dirname(RATES_FILE), { recursive: true });
  const tmp = RATES_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(r, null, 2) + '\n');
  fs.renameSync(tmp, RATES_FILE);
  return r;
}
