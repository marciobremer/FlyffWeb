import fs from 'node:fs';
import path from 'node:path';
import type { ItemCatalog, ItemDef } from '../common/items';
import type { MoverProp } from './world';
import { rates } from '../common/rates';

/**
 * Drops dos mobs, portado do servidor original:
 * - tabela: `propMoverEx.inc` (CProject::LoadPropMoverEx) — `Maxitem = N`, `DropGold(min, max)`,
 *   `DropItem(II_…, probabilidade, enchant, quantidade)` (probabilidade em 3.000.000.000) e `DropKind(IK3_…, a, b)`;
 * - sorteio: `CMover::DropItem` (Source/_Common/mover.cpp) — redução pela diferença de nível (jogador − mob: até 1 → 100 %,
 *   2 → 80 %, até 4 → 60 %/penya 80 %, até 7 → 30 %/65 %, mais → 10 %/50 %) decide se cai algo; os DropItem são
 *   embaralhados e cada um cai se `rand(3e9) < probabilidade`, até `Maxitem`; o penya cai em `min + rand(max − min)` × taxa;
 *   cada DropKind sorteia um item daquele tipo com dwItemRare entre (nível do mob − 5) e (nível − 2) e um enchant +0…+10,
 *   que cai se `rand(3e9) < expDropLuck[nível do item][enchant] × dwCorrectionValue/100` (tenta enchants menores até cair).
 * Versões novas (pasta `DropItem/`, FLMonsterDropItem / FLLevelDropItem / FLDropPenalty_ByLevelDist do WORLDSERVER), usadas
 * quando existem no lugar do propMoverEx:
 * - `propDropMonsterName.csv`: por monstro, chance do penya (em 10.000) e faixa; depois grupos (ETC, WEAPON, ARMOR, QUEST…)
 *   com a chance do grupo e os itens dele — o grupo sorteado dá UM item, pela soma das chances (`NONE` = nada);
 * - `propDropMonsterLevel.csv`: grupos extras para mobs numa faixa de nível, dentro das datas (eventos);
 * - `propDropLevelPenalty.csv`: a chance do grupo cai conforme o jogador passa do nível do mob (grupos QUEST não);
 *   grupos com quest só caem com a quest em andamento — ainda não há quests, então ficam de fora.
 * Itens no chão têm dono por 30 s (quem matou) e somem em 2 min, como `m_idOwn`/`m_dwDropTime` do CItem.
 */
export interface DropTable {
  max: number; gold: [number, number] | null;
  items: { id: number; prob: number; level: number; num: number }[];
  kinds: number[];
}

export interface Drop { itemId: number; count: number; upgrade: number; gold: number }

/** grupo de drop das versões novas: chance (em 10.000), tipo e itens (id null = NONE) */
interface DropSet { kind: string; prob: number; items: { id: number | null; prob: number; min: number; max: number; quest: boolean }[] }
interface MonsterDrops { goldProb: number; gold: [number, number]; sets: DropSet[] }
const P10K = 10_000;

export const OWNER_MS = 30_000, GROUND_MS = 120_000;
const R3E9 = 3_000_000_000;
const rand = (n: number) => Math.floor(Math.random() * n);

export class DropRules {
  readonly tables = new Map<number, DropTable>();
  /** expDropLuck: chance (em 3e9) por nível do item (linha nível−1) e enchant (coluna 0–10) */
  private luck: number[][] = [];
  /** itens por IK3 (para DropKind) e as sementes de penya (modelo no chão por quantia) */
  private byKind3 = new Map<number, ItemDef[]>();
  private seeds: ItemDef[] = [];
  /** versões novas: drops por monstro (id MI_*), por faixa de nível, e a penalidade por diferença de nível */
  readonly monsterDrops = new Map<number, MonsterDrops>();
  private levelDrops: { min: number; max: number; start: number; end: number; sets: DropSet[] }[] = [];
  private penalty: { dist: number; item: number; gold: number }[] = [];

  constructor(resDir: string, private items: ItemCatalog) {
    const read = (f: string) => { try { return new TextDecoder('euc-kr').decode(fs.readFileSync(path.join(resDir, f))); } catch { return ''; } };
    this.parseTables(read('propMoverEx.inc'));
    const exp = read('expTable.inc');
    const i = exp.indexOf('expDropLuck');
    if (i >= 0) {
      const block = exp.slice(exp.indexOf('{', i) + 1, exp.indexOf('}', exp.indexOf('{', i)));
      const clean = block.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      for (const line of clean.split(/\r?\n/)) { const v = line.trim().split(/\s+/).map(Number); if (v.length >= 11 && v.every(Number.isFinite)) this.luck.push(v.slice(0, 11)); }
    }
    for (const d of items.byId.values()) {
      if (d.kind3 && d.rare > 0) { let a = this.byKind3.get(d.kind3); if (!a) this.byKind3.set(d.kind3, (a = [])); a.push(d); }
    }
    this.loadNew(resDir);
    this.seeds = ['II_GOLD_SEED1', 'II_GOLD_SEED2', 'II_GOLD_SEED3', 'II_GOLD_SEED4'].map((s) => items.bySymbol.get(s)).filter((d): d is ItemDef => !!d);
  }

  /** Lê os blocos `MI_X { … }` do propMoverEx.inc (só o nível de fora; o bloco AI { } dentro é ignorado). */
  private parseTables(text: string) {
    const src = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    const tokens = src.match(/[A-Za-z_][A-Za-z0-9_]*|-?\d+|[{}(),;=]/g) ?? [];
    const num = (t: string | undefined) => (t === undefined ? NaN : /^-?\d+$/.test(t) ? Number(t) : this.items.defines.get(t) ?? NaN);
    let depth = 0, cur: DropTable | null = null;
    for (let k = 0; k < tokens.length; k++) {
      const t = tokens[k];
      if (t === '{') { depth++; continue; }
      if (t === '}') { depth--; if (depth === 0) cur = null; continue; }
      if (depth === 0) {
        const id = this.items.defines.get(t);
        if (id !== undefined && tokens[k + 1] === '{') { cur = { max: 1, gold: null, items: [], kinds: [] }; this.tables.set(id, cur); }
        continue;
      }
      if (depth !== 1 || !cur) continue;
      // argumentos entre parênteses de uma chamada
      const args = () => { const out: string[] = []; let j = k + 2; while (j < tokens.length && tokens[j] !== ')') { if (tokens[j] !== ',') out.push(tokens[j]); j++; } k = j; return out; };
      if (t === 'Maxitem' && tokens[k + 1] === '=') { cur.max = Math.max(1, num(tokens[k + 2]) || 1); k += 2; }
      else if (t === 'DropGold' && tokens[k + 1] === '(') { const [a, b] = args().map(num); if (b >= a && b > 0) cur.gold = [a, b]; }
      else if (t === 'DropItem' && tokens[k + 1] === '(') {
        const [sym, p, lv, n] = args();
        const id = num(sym), prob = Number(p);
        if (Number.isFinite(id) && prob > 0 && prob <= R3E9) cur.items.push({ id, prob, level: Math.max(0, Number(lv) || 0), num: Number(n) || 1 });
      } else if (t === 'DropKind' && tokens[k + 1] === '(') { const ik3 = num(args()[0]); if (Number.isFinite(ik3)) cur.kinds.push(ik3); }
    }
  }

  /** DropItem/*.csv das versões novas (se existirem) */
  private loadNew(resDir: string) {
    const csv = (f: string) => {
      try { return new TextDecoder('windows-1252').decode(fs.readFileSync(path.join(resDir, 'DropItem', f))).split(/\r?\n/).filter((l) => l && !l.startsWith('//')).map((l) => l.split(',').map((x) => x.trim())); } catch { return []; }
    };
    const num = (s: string | undefined) => (s && /^-?\d+$/.test(s) ? Number(s) : 0);
    const id = (s: string | undefined) => (s && s !== '-' ? (/^\d+$/.test(s) ? Number(s) : this.items.defines.get(s)) : undefined);
    /** linhas de grupo e de item (depois da linha do dono), na coluna `c` (szMainProbName) */
    const addRow = (sets: DropSet[], r: string[], c: number) => {
      if (r[c] && r[c] !== '-') { sets.push({ kind: r[c], prob: num(r[c + 1]), items: [] }); return; }
      const sym = r[c + 2], cur = sets[sets.length - 1];
      if (!cur || !sym || sym === '-') return;
      const item = sym === 'NONE' ? null : id(sym);
      if (item === undefined) return;
      cur.items.push({ id: item, prob: num(r[c + 3]), min: num(r[c + 4]), max: num(r[c + 5]), quest: !!r[c + 6] && r[c + 6] !== '-' && r[c + 6] !== '0' });
    };
    let cur: MonsterDrops | null = null;
    for (const r of csv('propDropMonsterName.csv')) {
      const mob = id(r[0]);
      if (mob !== undefined) { cur = { goldProb: num(r[1]), gold: [num(r[2]), Math.max(num(r[2]), num(r[3]))], sets: [] }; this.monsterDrops.set(mob, cur); continue; }
      if (cur) addRow(cur.sets, r, 4);
    }
    const date = (s: string | undefined) => { const t = Date.parse((s ?? '').replace(' ', 'T')); return Number.isFinite(t) ? t : 0; };
    let lv: (typeof this.levelDrops)[number] | null = null;
    for (const r of csv('propDropMonsterLevel.csv')) {
      if (r[0] && r[0] !== '-') { lv = { min: num(r[1]), max: num(r[2]), start: date(r[3]), end: date(r[4]) || Infinity, sets: [] }; this.levelDrops.push(lv); continue; }
      if (lv) addRow(lv.sets, r, 5);
    }
    for (const r of csv('propDropLevelPenalty.csv')) {
      const dist = r[0] === 'MAX' ? Infinity : Number(r[0]);
      if (Number.isFinite(Number(r[1])) && (dist === Infinity || Number.isFinite(dist))) this.penalty.push({ dist, item: Number(r[1]), gold: Number(r[2]) });
    }
  }

  /** FLDropSet::DropItem: o grupo cai com a chance dele (× penalidade de nível); sorteia um item pela soma das chances */
  private rollSet(set: DropSet, factor: number, out: Drop[]) {
    if (rand(P10K) >= set.prob * (set.kind === 'QUEST' ? 1 : factor * rates().drop)) return;
    const r = rand(P10K);
    let acc = 0;
    for (const it of set.items) {
      acc += it.prob;
      if (r >= acc) continue;
      if (it.id === null || it.quest || it.max <= 0 || !this.items.byId.has(it.id)) return;
      out.push({ itemId: it.id, count: Math.max(1, it.min + rand(Math.max(1, it.max - it.min + 1))), upgrade: 0, gold: 0 });
      return;
    }
  }

  /** versões novas: drops do monstro + por nível, com a penalidade (GetDeclineProb_Item) */
  private rollNew(modelId: number, m: MoverProp, killerLevel: number): Drop[] {
    const out: Drop[] = [];
    const dist = killerLevel - m.level;
    const factor = this.penalty.find((p) => dist <= p.dist)?.item ?? 1;
    const t = this.monsterDrops.get(modelId);
    if (t) {
      for (const s of t.sets) this.rollSet(s, factor, out);
      if (t.goldProb > 0 && rand(P10K) < t.goldProb) {
        const g = Math.floor((t.gold[0] + rand(Math.max(1, t.gold[1] - t.gold[0] + 1))) * rates().penya);
        if (g > 0) out.push({ itemId: this.seedFor(g), count: 1, upgrade: 0, gold: g });
      }
    }
    const now = Date.now();
    for (const l of this.levelDrops) if (m.level >= l.min && m.level <= l.max && now >= l.start && now <= l.end) for (const s of l.sets) this.rollSet(s, factor, out);
    return out;
  }

  /** semente de penya (modelo no chão) pela quantia, como II_GOLD_SEED1…4 por dwAbilityMax */
  seedFor(gold: number) { return this.seeds.find((s) => gold <= s.abilityMax)?.id ?? this.seeds[this.seeds.length - 1]?.id ?? 0; }

  /** o que cai quando `killerLevel` mata o mob */
  roll(modelId: number, m: MoverProp, killerLevel: number): Drop[] {
    if (this.monsterDrops.size) return this.rollNew(modelId, m, killerLevel);
    const t = this.tables.get(modelId);
    if (!t) return [];
    const { drop, penya } = rates();
    const d = killerLevel - m.level;
    const [prob, penyaRate] = d <= 1 ? [100, 100] : d <= 2 ? [80, 100] : d <= 4 ? [60, 80] : d <= 7 ? [30, 65] : [10, 50];
    if (rand(100) >= prob) return [];
    const out: Drop[] = [];
    const order = t.items.map((_, i) => i).sort(() => Math.random() - 0.5);
    let n = 0;
    for (const i of order) {
      const it = t.items[i];
      if (rand(R3E9) >= it.prob * drop || !this.items.byId.has(it.id)) continue;
      const num = it.num === -1 ? 1 : Math.max(1, it.num);
      out.push({ itemId: it.id, count: rand(num) + 1, upgrade: Math.min(10, it.level), gold: 0 });
      if (it.num !== -1) n++;
      if (n >= t.max) break;
    }
    if (t.gold) {
      const [a, b] = t.gold;
      const g = Math.floor(((a + rand(Math.max(1, b - a))) * penyaRate * penya) / 100);
      if (g > 0) out.push({ itemId: this.seedFor(g), count: 1, upgrade: 0, gold: g });
    }
    const minRare = Math.max(1, m.level - 5), maxRare = Math.max(1, m.level - 2);
    for (const ik3 of t.kinds) {
      const pool = (this.byKind3.get(ik3) ?? []).filter((x) => x.rare >= minRare && x.rare <= maxRare);
      if (!pool.length) continue;
      const item = pool[rand(pool.length)];
      const row = this.luck[Math.min(119, Math.max(0, item.level - 1))];
      if (!row) continue;
      for (let k = rand(11); k >= 0; k--) {
        if (rand(R3E9) < row[k] * (m.correction / 100) * drop) { out.push({ itemId: item.id, count: 1, upgrade: k, gold: 0 }); break; }
      }
    }
    return out;
  }
}
