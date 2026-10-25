import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './config';
import { cleanEdits, emptyEdits, type WorldEdits } from '../../shared/worldedits';

/** `data/world-edits/<Mundo>.json` (ver shared/worldedits.ts) */
const DIR = path.join(ROOT, 'data', 'world-edits');
const safe = (world: string) => (/^[A-Za-z0-9_]{1,40}$/.test(world) ? world : null);
const file = (world: string) => path.join(DIR, `${world}.json`);

export function editsMtime(world: string): number {
  const w = safe(world);
  try { return w ? fs.statSync(file(w)).mtimeMs : 0; } catch { return 0; }
}

export function loadEdits(world: string): WorldEdits {
  const w = safe(world);
  if (!w) return emptyEdits(world);
  try { return cleanEdits(JSON.parse(fs.readFileSync(file(w), 'utf8')), w); } catch { return emptyEdits(w); }
}

export function saveEdits(world: string, v: unknown): WorldEdits | null {
  const w = safe(world);
  if (!w) return null;
  const e = cleanEdits(v, w);
  fs.mkdirSync(DIR, { recursive: true });
  const tmp = file(w) + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(e, null, 1));
  fs.renameSync(tmp, file(w));
  return e;
}
