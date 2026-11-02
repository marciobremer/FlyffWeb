import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './config';

/**
 * Modo de skills do servidor em `data/skill-mode.json`, escolhido no painel admin (aba Skills). O jogo relê o arquivo quando
 * ele muda (como `rates.ts`) — não precisa reiniciar.
 *   manual → o jogador ganha pontos de skill a cada nível e distribui na janela de Habilidades (padrão do FlyFF);
 *   auto   → sem pontos: ao chegar no nível pedido (`reqLevel`) cada skill da classe do jogador abre sozinha no nível máximo.
 */
export type SkillMode = 'auto' | 'manual';

export const SKILL_MODE_FILE = path.join(ROOT, 'data', 'skill-mode.json');
export const DEFAULT_SKILL_MODE: SkillMode = 'manual';
const CHECK_MS = 2000;

let cached: SkillMode = DEFAULT_SKILL_MODE;
let cachedMtime = -1, checkedAt = 0;

/** modo atual (relê o arquivo no máximo a cada 2 s, e só se ele mudou) */
export function skillMode(): SkillMode {
  const now = Date.now();
  if (now - checkedAt < CHECK_MS) return cached;
  checkedAt = now;
  let mtime = 0;
  try { mtime = fs.statSync(SKILL_MODE_FILE).mtimeMs; } catch { /* sem arquivo: padrão */ }
  if (mtime !== cachedMtime) {
    cachedMtime = mtime;
    try { cached = mtime ? (JSON.parse(fs.readFileSync(SKILL_MODE_FILE, 'utf8')).mode === 'auto' ? 'auto' : 'manual') : DEFAULT_SKILL_MODE; } catch (e) {
      console.error('skill-mode: não consegui ler', SKILL_MODE_FILE, (e as Error).message);
    }
  }
  return cached;
}

/** grava o modo (lança erro se não for `auto` ou `manual`) */
export function saveSkillMode(v: unknown): SkillMode {
  if (v !== 'auto' && v !== 'manual') throw new Error('Modo inválido: use "auto" ou "manual".');
  fs.mkdirSync(path.dirname(SKILL_MODE_FILE), { recursive: true });
  const tmp = SKILL_MODE_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify({ mode: v }, null, 2) + '\n');
  fs.renameSync(tmp, SKILL_MODE_FILE);
  cached = v; cachedMtime = -1; checkedAt = 0;
  return v;
}
