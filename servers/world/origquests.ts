import fs from 'node:fs';
import path from 'node:path';
import type { ItemCatalog } from '../common/items';
import { nameTable } from '../common/names';

/**
 * Quests originais do FlyFF: lê os `propQuest*.inc` (na ordem do Masquerade.prj) e os textos `.txt.txt`, com as regras do
 * CProject::LoadPropQuest. Aqui só o que está no arquivo; quem aplica é o questflow.ts.
 *
 * Ficam de fora (por enquanto): quest sem NPC inicial (troca de classe e afins, dadas por roteiro), quest que os roteiros
 * C++ dos NPCs avançam por etapas (estados 1–13), e as que usam comandos ainda sem suporte (pet, PK, patrulha, buff…).
 * ORIGINAL_QUESTS=0 desliga.
 */
const FILES = ['propQuest', 'propQuest-RequestBox', 'propQuest-Scenario', 'propQuest-RequestBox2', 'propQuest-DungeonandPK'];

/** (sexo, tipo, classe ou item, item, quantidade): sexo -1 = ambos; tipo 0 = só para a classe (-1 = todas), tipo 1 = se tiver o item `who` */
export interface ItemRule { sex: number; type: number; who: number; item: number; n: number }

export interface OrigQuest {
  num: number;
  /** SetCharacter: quem oferece; SetEndCondCharacter: quem recebe (sem ele, o mesmo) */
  giver: string; ender: string;
  /** título da categoria (SetHeadQuest) e a descrição do diário (state 0) */
  category: string; desc: string;
  /** falas por QSAY_* */
  say: Record<number, string>;
  /** SetEndRewardHide: a recompensa aparece como "??" até concluir */ hideReward: boolean;
  /** SetRemove(FALSE) = não pode abandonar */
  canAbandon: boolean;
  repeat: boolean;
  begin: {
    levelMin: number; levelMax: number; jobs: number[]; sex: number;
    party: { type: number; comp: number; num: number; leader: number };
    prevType: number; prev: number[];
    items: ItemRule[]; notItems: ItemRule[];
  };
  /** o que a quest entrega ao ser aceita */
  start: { items: { item: number; n: number }[]; gold: number };
  end: {
    levelMin: number; levelMax: number; gold: number;
    items: ItemRule[]; kills: { mob: number; n: number }[];
  };
  drops: { mob: number; item: number; /** em 3.000.000.000 */ prob: number; max: number }[];
  reward: { items: ItemRule[]; goldMin: number; goldMax: number; expMin: number; expMax: number; skillPoints: number };
  remove: { items: { item: number; n: number }[]; gold: number; quests: number[] };
}

/** id no andamento do personagem (characters.quests), sem colidir com as do data/quests.json */
export const origId = (num: number) => `o${num}`;

const SUPPORTED = new Set(['SetTitle', 'SetNPCName', 'SetCharacter', 'SetHeadQuest', 'SetQuestType', 'SetRemove', 'SetRepeat',
  'SetBeginCondLevel', 'SetBeginCondJob', 'SetBeginCondParty', 'SetBeginCondSex', 'SetBeginCondPreviousQuest', 'SetBeginCondItem', 'SetBeginCondNotItem',
  'SetBeginSetAddItem', 'SetBeginSetAddGold', 'SetEndCondCharacter', 'SetEndCondItem', 'SetEndCondKillNPC', 'SetEndCondLevel', 'SetEndCondState', 'SetEndCondGold',
  'SetEndRewardItem', 'SetEndRewardGold', 'SetEndRewardExp', 'SetEndRewardSkillPoint', 'SetEndRewardHide', 'SetEndRemoveItem', 'SetEndRemoveGold', 'SetEndRemoveQuest',
  'SetDialog', 'SetDesc', 'SetCond', 'SetStatus', 'QuestItem',
  // o servidor original não lê estes (o CProject não tem o token)
  'SetBeginCondCharacter', 'zSetBeginCondJob']);

/** quests que os roteiros C++ dos NPCs (WorldDialog) conduzem: ficam para quando os roteiros forem portados */
const SCRIPTED = /^QUEST_VOC(ACR|MER|ASS|MAG)_(BFTRN|TRN2)$/;

interface Raw { sym: string; calls: [string, string[]][]; states: Map<number, [string, string[]][]> }

function readText(file: string): string {
  const b = fs.readFileSync(file);
  return b[0] === 0xff && b[1] === 0xfe ? new TextDecoder('utf-16le').decode(b.subarray(2)) : new TextDecoder('windows-1252').decode(b);
}

/** blocos `NOME { setting { Cmd(a, b); } state N { … } }` */
export function parseQuestBlocks(text: string): Raw[] {
  const tk = text.replace(/\/\*[\s\S]*?\*\/|\/\/[^\r\n]*|("[^"\r\n]*")/g, (_, s: string | undefined) => s ?? ' ').match(/"[^"]*"|-?[\w.]+|[{}(),;]/g) ?? [];
  const out: Raw[] = [];
  let i = 0;
  while (i < tk.length) {
    const sym = tk[i++];
    if (tk[i] !== '{') continue;
    const q: Raw = { sym, calls: [], states: new Map() };
    let depth = 0, state: number | null = null, stateDepth = 0;
    do {
      const t = tk[i++];
      if (t === '{') depth++;
      else if (t === '}') { depth--; if (state !== null && depth < stateDepth) state = null; }
      else if (t === 'state' && /^\d+$/.test(tk[i] ?? '')) { state = Number(tk[i++]); stateDepth = depth + 1; q.states.set(state, []); }
      else if (tk[i] === '(' && /^[A-Za-z_]/.test(t)) {
        const args: string[] = [];
        let j = i + 1;
        for (; j < tk.length && tk[j] !== ')'; j++) if (tk[j] !== ',') args.push(tk[j]);
        i = j + 1;
        if (state === null) q.calls.push([t, args]); else q.states.get(state)!.push([t, args]);
      }
    } while (depth > 0 && i < tk.length);
    out.push(q);
  }
  return out;
}

/** algum campo numérico saiu de um símbolo que não existe? */
export function hasNaN(v: unknown): boolean {
  if (typeof v === 'number') return Number.isNaN(v);
  return !!v && typeof v === 'object' && Object.values(v).some(hasNaN);
}

export interface OrigLoad {
  quests: Map<number, OrigQuest & { title: string }>;
  /** por que as outras ficaram de fora (motivo → quantas) */
  skipped: Record<string, number>;
}

export function loadOriginalQuests(resDir: string, items: ItemCatalog): OrigLoad {
  const quests: OrigLoad['quests'] = new Map(), skipped: Record<string, number> = {};
  const skip = (why: string) => { skipped[why] = (skipped[why] ?? 0) + 1; };
  const defs = new Map<string, number>();
  const texts = new Map<string, string>();
  const raws = new Map<number, Raw>();
  try {
    for (const m of readText(path.join(resDir, 'definequest.h')).matchAll(/^[ \t]*#define[ \t]+(\w+)[ \t]+(\d+)/gm)) defs.set(m[1], Number(m[2]));
  } catch { return { quests, skipped }; }
  for (const f of FILES) {
    try {
      for (const line of readText(path.join(resDir, `${f}.txt.txt`)).split(/\r?\n/)) {
        const t = line.indexOf('\t');
        if (t > 0) texts.set(line.slice(0, t).trim(), line.slice(t + 1).trim());
      }
    } catch { /* sem textos deste arquivo */ }
    try {
      for (const r of parseQuestBlocks(readText(path.join(resDir, `${f}.inc`)))) {
        const num = /^\d+$/.test(r.sym) ? Number(r.sym) : defs.get(r.sym);
        if (num !== undefined) raws.set(num, r); // id repetido: o último vence, como no original
      }
    } catch { /* arquivo ausente */ }
  }

  /** número, define (QUEST_*, MI_*, II_*, JOB_*…) ou TRUE/FALSE; NaN se desconhecido */
  const num = (s: string | undefined): number => {
    if (s === undefined) return 0;
    if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
    if (s === 'TRUE') return 1;
    if (s === 'FALSE') return 0;
    return items.defines.get(s) ?? defs.get(s) ?? NaN;
  };
  const str = (s: string | undefined) => (s ?? '').replace(/^"|"$/g, '');
  const text = (s: string | undefined) => {
    if (!s) return '';
    const v = s.startsWith('"') ? str(s) : texts.get(s) ?? '';
    return v.startsWith('IDS_') ? '' : v.replace(/#n[bc]?|#c[0-9a-f]{8}|#nc|#[bu]/gi, '').trim();
  };
  const first = (r: Raw, name: string) => r.calls.find((c) => c[0] === name)?.[1];

  for (const [id, r] of raws) {
    const all = (name: string) => r.calls.filter((c) => c[0] === name).map((c) => c[1]);
    if (!first(r, 'SetCharacter') && !r.states.size) continue; // bloco de categoria: só título
    const giver = str(first(r, 'SetCharacter')?.[0]).trim();
    if (!giver) { skip('sem NPC inicial'); continue; }
    if (SCRIPTED.test(r.sym)) { skip('conduzida por roteiro do NPC'); continue; }
    const mid = [...r.states.keys()].some((s) => s > 0 && s < 14);
    if (mid || num(first(r, 'SetEndCondState')?.[0])) { skip('várias etapas'); continue; }
    const calls = [...r.calls, ...[...r.states.values()].flat()];
    if (calls.some((c) => !SUPPORTED.has(c[0]))) { skip('usa recurso ainda sem suporte'); continue; }

    let bad = '';
    const item = (s: string | undefined) => { const n = num(s); if (!items.byId.has(n)) bad = 'item inexistente'; return n; };
    const rules = (name: string): ItemRule[] => all(name).filter((a) => a[3] !== undefined && a[3] !== '0').map((a) => ({ sex: num(a[0]), type: num(a[1]), who: num(a[2]), item: item(a[3]), n: a[4] === undefined ? 1 : num(a[4]) }));
    const pair = (name: string) => { const a = first(r, name); return [num(a?.[0]), num(a?.[1] ?? a?.[0])] as const; };
    const party = first(r, 'SetBeginCondParty');
    const prev = first(r, 'SetBeginCondPreviousQuest');
    const [levelMin, levelMax] = pair('SetBeginCondLevel');
    const [endMin, endMax] = pair('SetEndCondLevel');
    const [goldMin, goldMax] = pair('SetEndRewardGold');
    const [expMin, expMax] = pair('SetEndRewardExp');
    const kills = all('SetEndCondKillNPC').map((a) => ({ mob: num(a[1]), n: num(a[2]) })).filter((k) => k.mob || Number.isNaN(k.mob));
    const drops = calls.filter((c) => c[0] === 'QuestItem').map(([, a]) => ({ mob: num(a[0]), item: item(a[1]), prob: num(a[2]), max: Math.max(1, num(a[3]) || 1) }));
    if (kills.some((k) => Number.isNaN(k.mob)) || drops.some((d) => Number.isNaN(d.mob))) bad = 'monstro inexistente';
    const jobs = (first(r, 'SetBeginCondJob') ?? []).map(num);
    const q: OrigQuest & { title: string } = {
      num: id,
      title: text(first(r, 'SetTitle')?.[0]) || r.sym,
      giver,
      ender: str(first(r, 'SetEndCondCharacter')?.[0]).trim() || giver,
      category: '', desc: text(r.states.get(0)?.find((c) => c[0] === 'SetDesc')?.[1][0]),
      say: Object.fromEntries(all('SetDialog').map((a) => [num(a[0]), text(a[1])]).filter(([k, v]) => Number.isInteger(k) && v)),
      hideReward: !!num(first(r, 'SetEndRewardHide')?.[0]),
      canAbandon: !first(r, 'SetRemove') || !!num(first(r, 'SetRemove')![0]),
      repeat: !!num(first(r, 'SetRepeat')?.[0]),
      begin: {
        levelMin, levelMax, jobs: jobs.filter((j) => !Number.isNaN(j)),
        sex: first(r, 'SetBeginCondSex') ? num(first(r, 'SetBeginCondSex')![0]) : -1,
        party: { type: num(party?.[0]), comp: num(party?.[1]), num: num(party?.[2]), leader: num(party?.[3]) },
        prevType: num(prev?.[0]), prev: (prev?.slice(1) ?? []).map(num).filter((n) => n > 0),
        items: rules('SetBeginCondItem'), notItems: rules('SetBeginCondNotItem'),
      },
      start: { items: all('SetBeginSetAddItem').filter((a) => a[1] !== undefined && a[1] !== '0').map((a) => ({ item: item(a[1]), n: Math.max(1, num(a[2]) || 1) })), gold: num(first(r, 'SetBeginSetAddGold')?.[0]) },
      end: { levelMin: endMin, levelMax: endMax, gold: num(first(r, 'SetEndCondGold')?.[0]), items: rules('SetEndCondItem'), kills: kills.filter((k) => k.n > 0) },
      drops,
      reward: { items: rules('SetEndRewardItem'), goldMin, goldMax: Math.max(goldMin, goldMax), expMin, expMax: Math.max(expMin, expMax), skillPoints: num(first(r, 'SetEndRewardSkillPoint')?.[0]) },
      remove: {
        items: all('SetEndRemoveItem').filter((a) => a[1] !== undefined && a[1] !== '0').map((a) => ({ item: item(a[1]), n: num(a[2]) })),
        gold: num(first(r, 'SetEndRemoveGold')?.[0]),
        quests: (first(r, 'SetEndRemoveQuest') ?? []).map(num).filter((n) => n > 0),
      },
    };
    // classe pedida que não existe aqui: sem ela a lista ficaria vazia e a quest valeria para todos
    if (jobs.length && !q.begin.jobs.length) bad = 'classe inexistente';
    if (!bad && hasNaN(q)) bad = 'símbolo desconhecido';
    if (bad) { skip(bad); continue; }
    const head = num(first(r, 'SetHeadQuest')?.[0]);
    q.category = text(first(raws.get(head) ?? r, 'SetTitle')?.[0]);
    if (!head) q.category = '';
    quests.set(id, q);
  }
  return { quests, skipped };
}

/** nomes de monstro por id (MI_*): tabela de nomes por símbolo, senão o texto do propMover */
export function moverNames(resDir: string, items: ItemCatalog): (id: number) => string {
  const byId = new Map<number, string>();
  try {
    const texts = new Map(readText(path.join(resDir, 'propMover.txt.txt')).split(/\r?\n/).map((l) => l.split('\t')).filter((c) => c.length > 1).map((c) => [c[0].trim(), c[1].trim()]));
    const table = nameTable()?.movers ?? {};
    for (const line of readText(path.join(resDir, 'propMover.txt')).split(/\r?\n/)) {
      const c = line.split('\t');
      const sym = c[0]?.trim(), id = items.defines.get(sym);
      if (id === undefined || !sym.startsWith('MI_')) continue;
      byId.set(id, table[sym] ?? texts.get(c[1]?.trim()) ?? sym);
    }
  } catch { /* sem propMover: mostra o número */ }
  return (id) => byId.get(id) ?? `#${id}`;
}

// ---------- regras (puras): CMover __IsBeginQuestCondition / __IsEndQuestCondition ----------

/** o que as regras precisam saber do personagem */
export interface Hero { level: number; job: number; sex: number; gold: number; /** quantos do item há na bolsa */ count(item: number): number; party: { size: number; leader: boolean } | null }

/** a regra de item vale para este personagem? (filtro de sexo + classe, ou "se tiver o item") */
export function ruleApplies(r: ItemRule, h: Hero): boolean {
  if (r.sex !== -1 && r.sex !== h.sex) return false;
  if (r.who === -1) return true;
  return r.type === 1 ? h.count(r.who) > 0 : r.who === h.job;
}
export const applying = (list: ItemRule[], h: Hero) => list.filter((r) => ruleApplies(r, h));

/** quests do andamento: ativa (s 1) e concluída (as repetíveis não entram na lista de concluídas do original) */
export type Done = (num: number) => { active: boolean; complete: boolean };

export function canBegin(q: OrigQuest, h: Hero, done: Done): boolean {
  const b = q.begin, mine = done(q.num);
  if (mine.active || mine.complete) return false;
  if (b.levelMin && (h.level < b.levelMin || h.level > b.levelMax)) return false;
  if (b.jobs.length && !b.jobs.includes(h.job)) return false;
  if (b.sex !== -1 && b.sex !== h.sex) return false;
  for (const p of b.prev) {
    const d = done(p);
    if (b.prevType === 0 && !(d.active || d.complete)) return false;
    if (b.prevType === 1 && !(d.complete && !d.active)) return false;
    if (b.prevType === 2 && !(d.active && !d.complete)) return false;
  }
  const pt = b.party;
  if (pt.type === 1 && h.party) return false;
  if (pt.type === 2) {
    if (!h.party) return false;
    if (pt.leader === 1 && !h.party.leader) return false;
    if (pt.num && ((pt.comp === 0 && h.party.size !== pt.num) || (pt.comp === 1 && h.party.size < pt.num) || (pt.comp === -1 && h.party.size > pt.num))) return false;
  }
  if (applying(b.items, h).some((r) => h.count(r.item) < r.n)) return false;
  if (applying(b.notItems, h).some((r) => h.count(r.item) >= r.n)) return false;
  return true;
}

/** __IsNextLevelQuest: só falta nível, e no máximo 5 */
export function nextLevel(q: OrigQuest, h: Hero, done: Done): boolean {
  const min = q.begin.levelMin;
  return h.level < min && h.level + 5 >= min && canBegin(q, { ...h, level: min }, done);
}

export function canEnd(q: OrigQuest, h: Hero, kills: Record<string, number>): boolean {
  const e = q.end;
  if (e.levelMin && (h.level < e.levelMin || h.level > e.levelMax)) return false;
  if (e.gold && h.gold < e.gold) return false;
  if (e.kills.some((k) => (kills[k.mob] ?? 0) < k.n)) return false;
  return applying(e.items, h).every((r) => h.count(r.item) >= r.n);
}
