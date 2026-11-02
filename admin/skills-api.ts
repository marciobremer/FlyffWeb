import type http from 'node:http';
import path from 'node:path';
import { RES_DIR, RES_ROOTS, ROOT } from '../servers/common/config';
import { itemIconPng } from '../servers/common/icons';
import { SKILL_MODE_FILE, saveSkillMode, skillMode } from '../servers/common/skillmode';
import { SkillCatalog, type SkillDef } from '../servers/world/skills';
import { AdminError } from '../servers/auth/accounts';
import { cat } from './items-api';

/**
 * Aba Skills do painel admin: modo de skills do servidor e a lista de skills por classe (o que cada uma faz, para o popup).
 *   GET /skills/mode            { mode: 'auto' | 'manual' }
 *   PUT /skills/mode            { mode }  → grava data/skill-mode.json; o jogo aplica em até 2 s (servers/common/skillmode.ts)
 *   GET /skills?job=N           classes (com a contagem de skills) e as skills da classe N (padrão 0 = Vagrant)
 *   GET /admin/skill-icons/<arquivo>   ícone em PNG (Data/Icon)
 */
const JOBS: [number, string][] = [[0, 'Vagrant'], [1, 'Mercenary'], [2, 'Acrobat'], [3, 'Assist'], [4, 'Magician'], [6, 'Knight'], [7, 'Blade'],
  [8, 'Jester'], [9, 'Ranger'], [10, 'Ringmaster'], [11, 'Billposter'], [12, 'Psykeeper'], [13, 'Elementor']];
const KIND_TXT = { melee: 'Ataque corpo a corpo', magic: 'Ataque mágico', buff: 'Buff / cura', other: 'Especial' } as const;
const TYPE_TXT: Record<string, string> = { JTYPE_BASE: 'Vagrant', JTYPE_EXPERT: '1ª classe', JTYPE_PRO: '2ª classe' };

let skills: SkillCatalog | null = null;
let dstName: Map<number, string> | null = null;
const catalog = () => (skills ??= new SkillCatalog(RES_DIR, cat()));
/** DST_STR → "STR" etc., a partir dos #define do jogo */
const dstLabel = (id: number) => {
  if (!dstName) { dstName = new Map(); for (const [k, v] of cat().defines) if (k.startsWith('DST_') && !dstName.has(v)) dstName.set(v, k.slice(4)); }
  return dstName.get(id) ?? '';
};

const view = (s: SkillDef) => ({
  id: s.id, symbol: s.symbol, name: s.name, desc: s.desc, icon: s.icon, type: TYPE_TXT[s.jtype] ?? s.jtype, kind: KIND_TXT[s.kind],
  req: s.reqLevel, max: s.max, cost: catalog().cost(s),
  pre: s.pre.map(([id, lv]) => ({ name: catalog().byId.get(id)?.name ?? `#${id}`, lv })),
  levels: s.levels.slice(0, s.max).map((l) => ({
    mp: l.mp, fp: l.fp, cd: l.cooldown / 1000, min: l.min, max: l.max, time: l.time / 1000, range: l.range,
    fx: [0, 1].map((i) => ({ dst: dstLabel(l.dest[i]), val: l.adj[i] })).filter((e) => e.dst && e.val),
  })),
});

export function skillIcon(res: http.ServerResponse, file: string) {
  const png = itemIconPng(RES_ROOTS, decodeURIComponent(file), 'Icon');
  if (!png) { res.statusCode = 404; res.end(); return; }
  res.setHeader('content-type', 'image/png');
  res.setHeader('cache-control', 'max-age=86400');
  res.end(png);
}

/** rotas /skills*; devolve false se não é uma delas */
export async function skillsApi(p: string, m: string, url: URL, readJson: () => Promise<Record<string, unknown>>, send: (status: number, body: unknown) => void): Promise<boolean> {
  if (!p.startsWith('/skills')) return false;
  if (p === '/skills/mode' && m === 'GET') { send(200, { mode: skillMode(), file: path.relative(ROOT, SKILL_MODE_FILE) }); return true; }
  if (p === '/skills/mode' && m === 'PUT') {
    try { send(200, { mode: saveSkillMode((await readJson()).mode) }); } catch (e) { throw e instanceof AdminError ? e : new AdminError((e as Error).message); }
    return true;
  }
  if (p === '/skills' && m === 'GET') {
    const c = catalog();
    const job = Number(url.searchParams.get('job') ?? 0);
    if (!JOBS.some(([id]) => id === job)) throw new AdminError('Classe inválida.');
    const all = [...c.byId.values()];
    send(200, {
      mode: skillMode(), job,
      jobs: JOBS.map(([id, name]) => ({ id, name, count: all.filter((s) => s.job === id).length })),
      skills: all.filter((s) => s.job === job).sort((a, b) => a.reqLevel - b.reqLevel || a.id - b.id).map(view),
    });
    return true;
  }
  return false;
}
