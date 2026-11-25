/**
 * Quests originais de ponta a ponta, com os arquivos da Resource e um inventário em memória: para cada quest carregada,
 * monta um personagem que atende os requisitos, aceita no NPC inicial, cumpre os objetivos e entrega no NPC final.
 * `npx tsx tests/quests.test.ts`
 */
import assert from 'node:assert/strict';
import { RES_DIR } from '../servers/common/config';
import { ItemCatalog } from '../servers/common/items';
import { BAG } from '../servers/character/inventory';
import { QuestBook, type QuestDef, type QuestLog } from '../servers/world/quests';
import { QuestFlow, type QuestConn, type QuestHost } from '../servers/world/questflow';
import { applying, hasNaN, origId, type Hero } from '../servers/world/origquests';
import { loadNpcScripts } from '../servers/world/npctalk';

const items = new ItemCatalog(RES_DIR).load();
const t0 = Date.now();
const book = new QuestBook(items);
const all = book.all();
const originals = all.filter((q) => q.orig);
console.log(`${originals.length} quests originais lidas em ${Date.now() - t0} ms; ${all.length - originals.length} do quests.json`);
assert.ok(originals.length > 200);
for (const q of originals) assert.ok(!hasNaN(q.orig), `${q.id}: símbolo desconhecido`);
assert.ok(all.some((q) => q.id === 'a_arena_do_clockworks'), 'a quest do quests.json continua');

// ---------- inventário falso (bolsa, penya) ----------
interface It { c: number; s: number; id: number; n: number }
let state = { bag: 168, gold: 0, items: [] as It[] };
const count = (id: number) => state.items.reduce((s, i) => (i.id === id ? s + i.n : s), 0);
const add = (id: number, n: number) => {
  const max = items.byId.get(id)?.packMax ?? 1;
  const used = new Set(state.items.map((i) => i.s));
  for (const i of state.items) { if (i.id === id && i.n < max) { const k = Math.min(n, max - i.n); i.n += k; n -= k; } }
  for (let s = 0; s < state.bag && n > 0; s++) if (!used.has(s)) { const k = Math.min(n, max); state.items.push({ c: BAG, s, id, n: k }); n -= k; }
  return n;
};
const inventory = {
  catalog: items,
  state: async () => state,
  count: async (_: number, id: number) => count(id),
  add: async (_: number, id: number, n: number) => add(id, n),
  edit: async (_: number, fn: (x: unknown) => unknown) => fn({ state, touch() {}, gold: (d: number) => { state.gold += d; }, chips() {} }),
};

interface C extends QuestConn { quests: QuestLog }
let exp = 0, sp = 0;
const sent: Record<string, unknown>[] = [];
let party: { size: number; leader: number } | null = null;
const calls: string[] = [];
const host = {
  inventory, book, send: (_: C, m: Record<string, unknown>) => sent.push(m), say: () => {}, addExp: (_: C, n: number) => { exp += n; },
  party: () => party, near: () => true, worldOf: () => 'WdMadrigal', pointPos: () => null, teleport: async (_: C, w: string) => { calls.push(`teleport ${w}`); return null; }, runEvent: (id: string) => { calls.push(`evento ${id}`); },
  npcInfo: (_: C, k: string) => ({ name: k }), expToNext: () => 1000, partyNear: () => [], addSkillPoints: (_: C, n: number) => { sp += n; },
} as unknown as QuestHost<C>;
const flow = new QuestFlow<C>(host);

/** personagem que atende os requisitos de `q` */
function hero(q: QuestDef): C {
  const o = q.orig!;
  state = { bag: 168, gold: Math.max(10_000_000, o.end.gold, o.remove.gold), items: [] };
  const job = o.begin.jobs[0] ?? 0;
  const sex = o.begin.sex >= 0 ? o.begin.sex : 0;
  const level = Math.max(1, o.begin.levelMin, o.end.levelMin);
  const c: C = { cb: null, player: { id: -1, level, job, sex }, quests: {} };
  for (const p of o.begin.prev) c.quests[origId(p)] = o.begin.prevType === 1 ? { s: 2, n: 1 } : { s: 1 };
  party = o.begin.party.type === 2 ? { size: Math.max(2, o.begin.party.num), leader: -1 } : null;
  for (const r of o.begin.items) if (r.sex === -1 || r.sex === sex) { if (r.type === 1 && r.who > 0) add(r.who, 1); if (r.who === -1 || r.type === 1 || r.who === job) add(r.item, r.n); }
  return c;
}
const asHero = (c: C): Hero => ({ ...c.player!, gold: state.gold, party: null, count });

const failed: Record<string, string[]> = {};
const fail = (why: string, q: QuestDef) => (failed[why] ??= []).push(`${q.id} ${q.name}`);
let done = 0;
for (const q of originals) {
  const o = q.orig!, c = hero(q), p = c.player!;
  exp = 0; sp = 0;
  if ((await flow.statusOf(c, q, q.npc)) !== 'offer') { fail('não é oferecida', q); continue; }
  assert.ok((await flow.menuFor(c, q.npc)).some((m) => m.id === q.id), `${q.id} no menu do NPC`);
  await flow.accept(c, q.id, q.npc);
  if (c.quests[q.id]?.s !== 1) { fail('não aceitou', q); continue; }
  // cumpre: itens pedidos (primeiro pelos monstros que os largam), abates e nível
  for (const k of o.end.kills) for (let n = 0; n < k.n; n++) await flow.onKill(c, k.mob, 0, 0);
  for (const r of applying(o.end.items, asHero(c))) if (count(r.item) < r.n) add(r.item, r.n - count(r.item));
  p.level = Math.max(p.level, o.end.levelMin);
  if ((await flow.statusOf(c, q, q.ender)) !== 'ready') { fail('não fica pronta', q); continue; }
  const reward = applying(o.reward.items, asHero(c));
  const before = new Map(reward.map((r) => [r.item, count(r.item)]));
  await flow.turnIn(c, q.id, q.ender);
  if (c.quests[q.id]?.s !== 2) { fail('não entregou', q); continue; }
  assert.ok(exp >= o.reward.expMin && exp <= o.reward.expMax, `${q.id}: exp ${exp}`);
  assert.equal(sp, o.reward.skillPoints, `${q.id}: pontos de skill`);
  for (const r of reward) if (!o.remove.items.some((x) => x.item === r.item)) assert.ok(count(r.item) >= before.get(r.item)! + r.n, `${q.id}: recompensa ${r.item}`);
  for (const r of o.remove.items) if (r.n < 0 && !reward.some((x) => x.item === r.item)) assert.equal(count(r.item), 0, `${q.id}: item de quest removido`);
  if (!o.repeat) assert.notEqual(await flow.statusOf(c, q, q.npc), 'offer', `${q.id}: não repete sem SetRepeat`);
  done++;
}
console.log(`${done}/${originals.length} concluídas de ponta a ponta`);
for (const [why, list] of Object.entries(failed)) console.log(`  ${why}: ${list.length} — ${list.slice(0, 6).join(' | ')}`);

// itens de quest caem dos monstros certos
const withDrop = originals.find((q) => q.orig!.drops.length && !q.orig!.begin.prev.length)!;
const c = hero(withDrop);
await flow.accept(c, withDrop.id, withDrop.npc);
const d = withDrop.orig!.drops[0];
const had = count(d.item);
for (let n = 0; n < 200 && count(d.item) === had; n++) await flow.onKill(c, d.mob, 0, 0);
assert.ok(count(d.item) > had, `drop de ${withDrop.id}`);
console.log(`drop ok: ${withDrop.name} — ${book.itemName(d.item)} de ${book.mobName(d.mob)}`);

// diálogo, diário e GM
sent.length = 0;
await flow.dialog(c, withDrop.id, withDrop.ender);
await flow.push(c);
assert.ok(sent.some((m) => m.t === 'questDlg') && sent.some((m) => m.t === 'quests'));
console.log(await flow.info(c, withDrop.id));
console.log(flow.list(c));

assert.equal(Object.keys(failed).length, 0, 'há quests que não completam');

// janela de conversa e abas do diário
{
  const scripts = loadNpcScripts(RES_DIR);
  if (scripts.size) { assert.ok(scripts.get('mafl_boboko')?.intro?.includes('Boboco')); assert.ok(scripts.get('mafl_boboko')?.bye); }
  console.log(`falas ok: ${scripts.size} roteiros de NPC`);
  const tabs: Record<string, number> = {};
  for (const q of originals) tabs[q.orig!.tab] = (tabs[q.orig!.tab] ?? 0) + 1;
  console.log(`abas ok: ${JSON.stringify(tabs)}`);
  const q = originals.find((x) => x.orig!.say[0] && x.orig!.say[1] && !x.orig!.begin.prev.length)!;
  const me3 = hero(q);
  sent.length = 0;
  await flow.talk(me3, q.npc);
  await flow.dialog(me3, q.id, q.npc);
  await flow.accept(me3, q.id, q.npc);
  const talk = sent.find((m) => m.t === 'npcTalk')!, dlgs = sent.filter((m) => m.t === 'questDlg');
  assert.ok((talk.quests as { id: string }[]).some((x) => x.id === q.id));
  assert.ok((dlgs[0].pages as string[]).length >= 2, 'falas em páginas');
  assert.equal(dlgs[1].accepted, true);
  const book2 = sent.find((m) => m.t === 'quests') as { list: { id: string; tab: string; reward: string[] }[] };
  assert.ok(book2.list.some((x) => x.id === q.id && x.tab === q.orig!.tab));
  console.log(`conversa ok: ${q.name}`);
}

// marcadores: "!" antes de aceitar, "?" cinza em andamento, "?" amarelo pronta, "!" cinza até 5 níveis antes
{
  const q = originals.find((x) => x.orig!.end.items.length && !x.orig!.begin.prev.length && x.orig!.begin.levelMin > 10 && !x.orig!.repeat)!;
  const me2 = hero(q), key = q.npc.toLowerCase(), end = q.ender.toLowerCase();
  me2.player!.level = q.orig!.begin.levelMin;
  assert.equal((await flow.marks(me2))[key], 1, '! disponível');
  me2.player!.level -= 3;
  const early = (await flow.marks(me2))[key];
  assert.ok(early === 4 || early === 1, '! cinza (ou outra quest do NPC já disponível)');
  me2.player!.level += 3;
  await flow.accept(me2, q.id, q.npc);
  const doing = (await flow.marks(me2))[end];
  assert.ok(doing === 2 || doing === 1, '? em andamento');
  for (const r of applying(q.orig!.end.items, asHero(me2))) add(r.item, r.n);
  for (const k of q.orig!.end.kills) for (let n = 0; n < k.n; n++) await flow.onKill(me2, k.mob, 0, 0);
  me2.player!.level = Math.max(me2.player!.level, q.orig!.end.levelMin);
  assert.equal((await flow.marks(me2))[end], 3, '? pronta');
  console.log(`marcadores ok: ${q.name}`);
}

// a quest do quests.json continua igual: party, drop, entrega, evento e teleporte
const old = book.get('a_arena_do_clockworks')!;
state = { bag: 168, gold: 0, items: [] };
party = { size: 2, leader: -1 };
const me: C = { cb: null, player: { id: -1, level: 20, job: 0, sex: 0 }, quests: {} };
assert.ok((await flow.menuFor(me, old.npc)).some((m) => m.id === old.id && m.st === 'offer'));
await flow.accept(me, old.id, old.npc);
assert.equal(me.quests[old.id]?.s, 1);
const scale = old.need[0];
for (let n = 0; n < 2000 && count(scale.item) < scale.count; n++) await flow.onKill(me, items.defines.get('MI_AIBATT1')!, 0, 0);
assert.equal(count(scale.item), scale.count, 'drop do quests.json para no pedido');
assert.equal(await flow.statusOf(me, old, old.npc), 'ready');
calls.length = 0;
await flow.turnIn(me, old.id, old.npc);
assert.equal(me.quests[old.id]?.s, 2);
assert.equal(count(scale.item), 0);
assert.deepEqual(calls, ['evento cw_chefe', 'teleport DuClockwork']);
console.log('quests.json ok: A Arena do Clockworks de ponta a ponta');
console.log('OK');
process.exit(0);
