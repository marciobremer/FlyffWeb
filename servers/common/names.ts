import fs from 'node:fs';
import path from 'node:path';
import { EXTRA_DIR } from './config';

/**
 * Nomes de outra versão por cima dos textos do Resource, pelo símbolo (gerados por tools/export-names.ts): o servidor
 * novo vem só em francês, então itens, sets, monstros, skills e NPCs que já existiam no antigo usam o nome em inglês;
 * o que só existe no novo fica com o texto dele. FLYFF_NAMES troca o arquivo (`off` desliga).
 */
export interface NameTable {
  items: Record<string, string>; sets: Record<string, string>; movers: Record<string, string>;
  skills: Record<string, [string, string]>; npcs: Record<string, string>;
}

let cached: NameTable | null | undefined;

export function nameTable(): NameTable | null {
  if (cached !== undefined) return cached;
  const env = process.env.FLYFF_NAMES;
  const file = env === 'off' ? '' : path.resolve(env ?? path.join(EXTRA_DIR, 'names-en.json'));
  try { cached = file ? JSON.parse(fs.readFileSync(file, 'utf8')) as NameTable : null; } catch { cached = null; }
  return cached;
}
