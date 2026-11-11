import { query } from '../servers/common/db/index';
import { AdminError } from '../servers/auth/accounts';
import { cat } from './items-api';
import { catalog as skillCatalog } from './skills-api';
import { CombatRules, type Equipped } from '../servers/world/combat';
import { RES_DIR } from '../servers/common/config';

/**
 * Aba Characters do painel admin (só leitura): busca de personagens e a ficha completa de um (status, classe, penya, equipados,
 * bolsa, skills, quests, buffs, posição…), tudo direto do banco.
 *   GET /characters?q=&page=&size=     lista (busca por nome do personagem ou da conta)
 *   GET /characters/<id>               ficha completa
 *   GET /characters/by-name/<nome>     o mesmo, pelo nome (a lista de Account abre por aqui)
 */
const JOB_NAMES = ['Vagrant', 'Mercenary', 'Acrobat', 'Assist', 'Magician', 'Puppeteer', 'Knight', 'Blade', 'Jester', 'Ranger', 'Ringmaster', 'Billposter',
  'Psykeeper', 'Elementor', 'Gatekeeper', 'Doppler', 'Knight (Master)', 'Blade (Master)', 'Jester (Master)', 'Ranger (Master)', 'Ringmaster (Master)',
  'Billposter (Master)', 'Psykeeper (Master)', 'Elementor (Master)', 'Knight (Hero)', 'Blade (Hero)', 'Jester (Hero)', 'Ranger (Hero)', 'Ringmaster (Hero)',
  'Billposter (Hero)', 'Psykeeper (Hero)', 'Elementor (Hero)', 'Lord Templar', 'Storm Blade', 'Wind Lurker', 'Crack Shooter', 'Florist', 'Force Master',
  'Mentalist', 'Arch Mage'];
const ELEMENTS = ['', 'Fogo', 'Água', 'Elétrico', 'Vento', 'Terra'];
const GRADES: Record<number, string> = { 100: 'Comum', 200: 'Unique', 300: 'Ultimate', 400: 'Baruna' };
const SLOT_PT: Record<string, string> = {
  PARTS_HAT: 'Chapéu (cash)', PARTS_CLOTH: 'Roupa (cash)', PARTS_GLOVE: 'Luvas (cash)', PARTS_BOOTS: 'Botas (cash)', PARTS_HEAD: 'Cabeça',
  PARTS_UPPER_BODY: 'Roupa', PARTS_LOWER_BODY: 'Calça', PARTS_HAND: 'Luvas', PARTS_FOOT: 'Botas', PARTS_CAP: 'Capacete', PARTS_RWEAPON: 'Arma',
  PARTS_LWEAPON: 'Arma (2ª mão)', PARTS_SHIELD: 'Escudo', PARTS_CLOAK: 'Capa', PARTS_MASK: 'Máscara', PARTS_NECKLACE1: 'Colar', PARTS_RING1: 'Anel',
  PARTS_RING2: 'Anel', PARTS_EARRING1: 'Brinco', PARTS_EARRING2: 'Brinco', PARTS_BULLET: 'Munição', PARTS_RIDE: 'Montaria',
};

let rules: CombatRules | null = null;

let partName: Map<number, string> | null = null;
const slotLabel = (part: number) => {
  if (!partName) { partName = new Map(); for (const [k, v] of cat().defines) if (k.startsWith('PARTS_') && !partName.has(v)) partName.set(v, SLOT_PT[k] ?? k.slice(6)); }
  return partName.get(part) ?? `Slot ${part}`;
};

interface ItemRow {
  container: number; slot: number; item_id: number; count: number; upgrade: number; element: number; element_level: number; piercing: unknown;
  gems: unknown; rarity: number; expires_at: Date | null; upgrade_tries: number; awakening: unknown;
}
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

function itemView(r: ItemRow) {
  const d = cat().byId.get(r.item_id) ?? cat().original.get(r.item_id);
  const name = (id: number) => (id > 0 ? cat().byId.get(id)?.name ?? `#${id}` : '');
  return {
    slot: r.slot, id: r.item_id, name: d?.name ?? `Item #${r.item_id}`, icon: d?.icon ?? '', count: r.count, level: d?.level ?? 0,
    grade: GRADES[d?.grade ?? 100] ?? 'Comum', upgrade: r.upgrade, tries: r.upgrade_tries,
    element: r.element ? `${ELEMENTS[r.element] ?? r.element} +${r.element_level}` : '', rarity: r.rarity,
    piercing: list(r.piercing).map((x) => Number(x)).filter((x) => x > 0).map(name), gems: list(r.gems).length, awakening: list(r.awakening).length,
    expires: r.expires_at ? r.expires_at.toISOString() : null,
  };
}

async function sheet(where: string, param: unknown, online: (accountId: number) => string | null) {
  const { rows } = await query<Record<string, unknown>>(
    `SELECT c.*, a.username, a.authority FROM characters c JOIN accounts a ON a.id = c.account_id WHERE NOT c.deleted AND ${where} LIMIT 1`, [param]);
  const c = rows[0];
  if (!c) throw new AdminError('Personagem não encontrado.');
  const id = Number(c.id);
  const items = await query<ItemRow>('SELECT * FROM character_items WHERE character_id = $1 ORDER BY container, slot', [id]);
  const sc = skillCatalog();
  const skillsRaw = (c.skills ?? {}) as Record<string, unknown>;
  const skills = Object.entries(skillsRaw).map(([sid, v]) => {
    const lv = typeof v === 'number' ? v : Number((v as { lv?: number; level?: number })?.lv ?? (v as { level?: number })?.level ?? 0);
    const d = sc.byId.get(Number(sid));
    return { id: Number(sid), name: d?.name ?? `#${sid}`, icon: d?.icon ?? '', level: lv, max: d?.max ?? 0, job: d?.job ?? -1 };
  }).filter((s) => s.level > 0).sort((a, b) => a.job - b.job || a.name.localeCompare(b.name));
  const quests = Object.entries((c.quests ?? {}) as Record<string, unknown>).map(([qid, v]) => ({ id: qid, state: v }));
  const num = (k: string) => Number(c[k] ?? 0);
  // máximos de HP/MP/FP e EXP do nível com a mesma fórmula do jogo (atributos + o que está equipado; sem buffs temporários)
  const r = (rules ??= new CombatRules(RES_DIR, cat()));
  const now = Date.now(), eq: Equipped[] = [];
  for (const i of items.rows) {
    if (i.container !== 1 || (i.expires_at && i.expires_at.getTime() <= now)) continue;
    const d = cat().byId.get(i.item_id);
    if (d) eq.push({ d, u: i.upgrade, s: i.slot, p: list(i.piercing).map(Number), e: i.element, el: i.element_level, g: list(i.gems).map(Number), r: i.rarity, a: list(i.awakening).map(Number) });
  }
  const f = r.buildFighter({ level: num('level'), job: num('job'), str: num('str'), sta: num('sta'), dex: num('dex'), int: num('int') }, eq, []);
  const maxHp = r.maxHp(f), maxMp = r.maxMp(f), maxFp = r.maxFp(f);
  return {
    id, name: c.name, sex: num('sex') ? 'Feminino' : 'Masculino', job: num('job'), jobName: JOB_NAMES[num('job')] ?? `Classe ${num('job')}`, level: num('level'),
    exp: String(c.exp), gold: String(c.gold), redChips: String(c.red_chips ?? 0), craftingExp: num('crafting_exp'), playMinutes: num('play_minutes'),
    str: num('str'), sta: num('sta'), dex: num('dex'), int: num('int'), statPoints: num('stat_points'), skillPoints: num('skill_points'),
    hp: Math.min(num('hp') || maxHp, maxHp), mp: Math.min(num('mp') || maxMp, maxMp), fp: Math.min(num('fp') || maxFp, maxFp), maxHp, maxMp, maxFp, expMax: r.expToNext[num('level')] ?? 0, bagSlots: num('bag_slots'),
    world: num('world_id'), pos: [num('pos_x'), num('pos_y'), num('pos_z')].map((n) => Math.round(n)), angle: Math.round(num('angle')),
    account: { id: Number(c.account_id), username: c.username, authority: c.authority, online: online(Number(c.account_id)) },
    slot: num('slot'), createdAt: c.created_at, updatedAt: c.updated_at, lastOnlineAt: c.last_online_at,
    equipped: items.rows.filter((r) => r.container === 1).map((r) => ({ ...itemView(r), label: slotLabel(r.slot) })),
    bag: items.rows.filter((r) => r.container === 0).map(itemView),
    skills, quests, buffs: list(c.buffs).length,
  };
}

/** rotas /characters*; devolve false se não é uma delas */
export async function charactersApi(p: string, m: string, url: URL, send: (status: number, body: unknown) => void, online: () => Promise<Map<number, string>>): Promise<boolean> {
  if (!p.startsWith('/characters') || m !== 'GET') return false;
  if (p === '/characters') {
    const q = (url.searchParams.get('q') ?? '').trim();
    const size = Math.min(100, Math.max(10, Number(url.searchParams.get('size')) || 30)), page = Math.max(1, Number(url.searchParams.get('page')) || 1);
    const like = `%${q.replace(/[\\%_]/g, (s) => '\\' + s)}%`;
    const where = 'NOT c.deleted AND ($1 = \'%%\' OR c.name ILIKE $1 OR a.username ILIKE $1)';
    const [total, rows, on] = await Promise.all([
      query<{ n: string }>(`SELECT count(*) AS n FROM characters c JOIN accounts a ON a.id = c.account_id WHERE ${where}`, [like]),
      query<{ id: string; name: string; level: number; job: number; username: string; account_id: string }>(
        `SELECT c.id, c.name, c.level, c.job, a.username, c.account_id FROM characters c JOIN accounts a ON a.id = c.account_id WHERE ${where}
         ORDER BY c.level DESC, c.name LIMIT ${size} OFFSET ${(page - 1) * size}`, [like]),
      online(),
    ]);
    send(200, {
      total: Number(total.rows[0].n), page, size,
      rows: rows.rows.map((r) => ({ id: Number(r.id), name: r.name, level: r.level, jobName: JOB_NAMES[r.job] ?? `Classe ${r.job}`, account: r.username, online: on.get(Number(r.account_id)) === r.name })),
    });
    return true;
  }
  const on = await online();
  const own = (accountId: number) => on.get(accountId) ?? null;
  const byId = /^\/characters\/(\d+)$/.exec(p);
  if (byId) { send(200, await sheet('c.id = $1', Number(byId[1]), own)); return true; }
  const byName = /^\/characters\/by-name\/(.+)$/.exec(p);
  if (byName) { send(200, await sheet('lower(c.name) = lower($1)', decodeURIComponent(byName[1]), own)); return true; }
  return false;
}
