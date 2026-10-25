import fs from 'node:fs';
import path from 'node:path';
import { RES_DIR, ROOT, WORLD } from './config';

/**
 * Manifesto da tela de carregamento: quantos arquivos (e bytes) o cliente baixa até Flaris ficar pronta, para a barra
 * mostrar o total desde o início ("120 / 964 arquivos"). Não dá para saber de antemão (o cliente descobre o que baixar à
 * medida que carrega), então o navegador do PRÓPRIO computador do servidor grava a lista depois de carregar, por qualidade
 * (alta/baixa carregam raios diferentes). A `version` muda junto com os dados do mundo (tabelas de modelos, .dyo, edições
 * do editor): manifesto velho não é entregue e o próximo carregamento local grava outro.
 */
export interface BootEntry { files: number; bytes: number; urls: string[] }
interface BootManifest { version: string; byQuality: Record<string, BootEntry> }

const FILE = path.join(ROOT, 'data', 'boot-manifest.json');

/** "versão" dos dados: data de modificação dos arquivos que decidem o que o cliente baixa em Flaris */
function dataVersion() {
  const files = ['mdlObj.inc', 'mdlDyna.inc', 'Terrain.inc', path.join('World', WORLD, `${WORLD}.dyo`), path.join('World', WORLD, `${WORLD}.wld`)].map((f) => path.join(RES_DIR, f));
  files.push(path.join(ROOT, 'data', 'world-edits', `${WORLD}.json`));
  return files.map((f) => { try { return Math.floor(fs.statSync(f).mtimeMs).toString(36); } catch { return '0'; } }).join('.') + '@' + RES_DIR;
}

function load(): BootManifest | null {
  try { const m = JSON.parse(fs.readFileSync(FILE, 'utf8')) as BootManifest; return m.version === dataVersion() ? m : null; } catch { return null; }
}

/** total para a qualidade pedida (null = ainda não gravado ou dados mudaram) */
export function bootTotal(quality: string): { files: number; bytes: number } | null {
  const e = load()?.byQuality[quality];
  return e ? { files: e.files, bytes: e.bytes } : null;
}

/** grava o que um carregamento completo baixou (só chamado para pedidos do próprio computador) */
/** `count`: quantos pedidos o carregamento fez (alguns arquivos são pedidos mais de uma vez — é com esse número que a barra conta) */
export function saveBootManifest(quality: string, urls: unknown, bytes: unknown, count?: unknown): boolean {
  if (!/^[a-z]{1,10}$/.test(quality) || !Array.isArray(urls) || urls.length > 20000 || typeof bytes !== 'number' || !(bytes >= 0)) return false;
  const list = [...new Set(urls.filter((u): u is string => typeof u === 'string' && u.length < 300))];
  const m = load() ?? { version: dataVersion(), byQuality: {} };
  m.byQuality[quality] = { files: typeof count === 'number' && count >= list.length && count < 40000 ? Math.round(count) : list.length, bytes: Math.round(bytes), urls: list };
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(m));
  return true;
}
