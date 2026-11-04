import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './config';

/**
 * Teleportes extras da janela Teleporter (tecla V), criados no painel admin (World → Teleportes) por cima dos do jogo
 * (AegonTeleporter.inc). Ficam em `data/teleports-custom.json`; o servidor relê quando o arquivo muda, sem reiniciar.
 * `world` = nome da pasta do mapa (WdL2Giran, DuClockwork…), `pos` = x, y, z FlyFF do lugar onde o jogador aparece.
 */
export type CustomTeleportType = 'city' | 'collect' | 'dungeon';
export interface CustomTeleport { name: string; world: string; type: CustomTeleportType; pos: [number, number, number]; desc: string }

export const CUSTOM_TELEPORTS_FILE = path.join(ROOT, 'data', 'teleports-custom.json');
const TYPES = new Set<string>(['city', 'collect', 'dungeon']);

export function cleanCustomTeleports(v: unknown): CustomTeleport[] {
  const out: CustomTeleport[] = [];
  for (const j of Array.isArray(v) ? v : []) {
    const t = j as Partial<CustomTeleport>;
    const name = typeof t?.name === 'string' ? t.name.replace(/\s+/g, ' ').trim().slice(0, 40) : '';
    if (!name || typeof t.world !== 'string' || !/^[A-Za-z0-9_]{1,40}$/.test(t.world)) continue;
    const pos = Array.isArray(t.pos) ? t.pos.map(Number) : [];
    if (pos.length !== 3 || !pos.every(Number.isFinite) || pos[0] <= 0 || pos[2] <= 0) continue;
    if (out.some((o) => o.name.toLowerCase() === name.toLowerCase())) continue;
    out.push({ name, world: t.world, type: TYPES.has(String(t.type)) ? (t.type as CustomTeleportType) : 'city', pos: [pos[0], pos[1], pos[2]], desc: typeof t.desc === 'string' ? t.desc.slice(0, 300) : '' });
  }
  return out.slice(0, 100);
}

let cached: CustomTeleport[] = [], cachedMtime = -1, checkedAt = 0;

/** teleportes extras (relê o arquivo no máximo a cada 1 s, e só se ele mudou) */
export function customTeleports(): CustomTeleport[] {
  const now = Date.now();
  if (now - checkedAt < 1000) return cached;
  checkedAt = now;
  let m = 0;
  try { m = fs.statSync(CUSTOM_TELEPORTS_FILE).mtimeMs; } catch { /* sem arquivo */ }
  if (m !== cachedMtime) {
    cachedMtime = m;
    try { cached = m ? cleanCustomTeleports(JSON.parse(fs.readFileSync(CUSTOM_TELEPORTS_FILE, 'utf8'))) : []; } catch (e) { console.warn('teleportes extras: arquivo inválido:', (e as Error).message); cached = []; }
  }
  return cached;
}

export function saveCustomTeleports(list: unknown): CustomTeleport[] {
  const clean = cleanCustomTeleports(list);
  fs.mkdirSync(path.dirname(CUSTOM_TELEPORTS_FILE), { recursive: true });
  const tmp = CUSTOM_TELEPORTS_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(clean, null, 2) + '\n');
  fs.renameSync(tmp, CUSTOM_TELEPORTS_FILE);
  checkedAt = 0;
  return clean;
}
