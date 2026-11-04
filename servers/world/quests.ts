import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../common/config';
import type { ItemCatalog } from '../common/items';

/**
 * Quests, definidas em `data/quests.json` (editável à mão; o servidor relê o arquivo quando ele muda, sem reiniciar).
 *
 *   { "quests": [ {
 *       "id": "cw_entrada",                    identificador único (letras, números, _)
 *       "enabled": true,                      false = a quest fica no arquivo mas não aparece (opcional)
 *       "name": "A Arena do Clockworks",
 *       "npc": "MaFl_Algo",                    characterKey do NPC que dá e recebe a quest (o mesmo do editor de NPCs)
 *       "minLevel": 1, "maxLevel": 999,        faixa de nível (opcional)
 *       "requires": "outra_quest",             só aparece depois de concluir essa (opcional)
 *       "repeatable": false,                   pode refazer? (opcional)
 *       "party": { "min": 2, "leaderOnly": true },   só em party com pelo menos `min` jogadores; leaderOnly (padrão) = só o líder fala com o NPC e entrega (opcional)
 *       "text": { "offer": "...", "progress": "...", "done": "..." },   falas do NPC
 *       "need":  [ { "item": "II_SYS_SYS_QUE_X", "count": 10 } ],       itens que o jogador entrega (saem da bolsa)
 *       "kill":  [ { "mob": "MI_AIBATT1", "count": 5 } ],               monstros a derrotar (mob: símbolo, lista ou "*")
 *       "drops": [ { "item": "II_SYS_SYS_QUE_X", "mob": "MI_AIBATT1", "chance": 30,
 *                    "world": "WdMadrigal", "near": { "point": "farm", "radius": 80 } } ],
 *                                              com a quest em andamento, esses monstros largam o item direto na bolsa (chance em %);
 *                                              world e near (ponto marcado no editor) restringem onde; mob "*" = qualquer
 *       "reward": { "exp": 0, "penya": 0, "items": [ { "item": "II_...", "count": 1 } ],
 *                   "teleport": { "world": "DuClockwork", "point": "chegada" },   // ponto do editor; sem point usa a chegada do mapa
 *                   "event": "cw_chefe" }      // dispara um evento de data/events.json ao concluir
 *   } ] }
 * Símbolos inválidos (item/monstro inexistente) são avisados no log e a quest fica de fora.
 */
export interface QuestGoal { item: number; count: number }
export interface QuestKill { mobs: number[] | null; label: string; sym: string; count: number }
export interface QuestDrop { item: number; mobs: number[] | null; world?: string; near?: { point: string; radius: number }; chance: number }
export interface QuestDef {
  id: string; name: string; npc: string; minLevel: number; maxLevel: number; requires?: string; repeatable: boolean;
  /** exige party (mínimo de jogadores) e, com leaderOnly, que quem fala com o NPC seja o líder */ party?: { min: number; leaderOnly: boolean };
  text: { offer: string; progress: string; done: string };
  need: QuestGoal[]; kill: QuestKill[]; drops: QuestDrop[];
  reward: { exp: number; penya: number; items: { item: number; count: number }[]; teleport?: { world: string; point?: string }; event?: string };
}

/** andamento de uma quest de um personagem (coluna characters.quests) */
export interface QuestState { s: 1 | 2; /** abates por MI_* */ k?: Record<string, number>; /** vezes concluída */ n?: number }
export type QuestLog = Record<string, QuestState>;

export const QUESTS_FILE = path.join(ROOT, 'data', 'quests.json');
const CHECK_MS = 2000;

export function cleanLog(raw: unknown): QuestLog {
  const out: QuestLog = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [id, v] of Object.entries(raw as Record<string, unknown>)) {
    const q = v as { s?: unknown; k?: unknown; n?: unknown };
    if (q?.s !== 1 && q?.s !== 2) continue;
    const k: Record<string, number> = {};
    if (q.k && typeof q.k === 'object') for (const [m, n] of Object.entries(q.k as Record<string, unknown>)) if (Number.isFinite(Number(n)) && Number(n) > 0) k[m] = Math.floor(Number(n));
    out[id.slice(0, 64)] = { s: q.s, ...(Object.keys(k).length ? { k } : {}), ...(Number(q.n) > 0 ? { n: Math.floor(Number(q.n)) } : {}) };
  }
  return out;
}

export class QuestBook {
  private quests = new Map<string, QuestDef>();
  private mtime = -1;
  private checkedAt = 0;

  constructor(private items: ItemCatalog) {}

  private moverId(sym: string) { return this.items.defines.get(sym); }

  /** relê o arquivo se mudou (confere no máximo a cada 2 s) */
  private refresh() {
    const now = Date.now();
    if (now - this.checkedAt < CHECK_MS) return;
    this.checkedAt = now;
    let m = 0;
    try { m = fs.statSync(QUESTS_FILE).mtimeMs; } catch { /* sem arquivo: sem quests */ }
    if (m === this.mtime) return;
    this.mtime = m;
    this.quests.clear();
    let raw: unknown = null;
    try { raw = JSON.parse(fs.readFileSync(QUESTS_FILE, 'utf8')); } catch (e) { if (m) console.warn('Quests: data/quests.json inválido:', (e as Error).message); }
    for (const j of ((raw as { quests?: unknown[] } | null)?.quests ?? [])) {
      if ((j as { enabled?: unknown })?.enabled === false) continue;
      try { const q = this.parse(j as Record<string, unknown>); this.quests.set(q.id, q); } catch (e) { console.warn(`Quests: ${(e as Error).message}`); }
    }
    console.log(`Quests: ${this.quests.size} carregada(s).`);
  }

  private item(sym: unknown, id: string): number {
    const d = typeof sym === 'string' ? this.items.bySymbol.get(sym) : undefined;
    if (!d) throw new Error(`quest "${id}": item "${String(sym)}" não existe`);
    return d.id;
  }

  /** "MI_X", ["MI_X", …] ou "*" → ids (null = qualquer monstro) */
  private mobs(v: unknown, id: string): number[] | null {
    if (v === undefined || v === '*') return null;
    const ids: number[] = [];
    for (const sym of Array.isArray(v) ? v : [v]) {
      const n = typeof sym === 'string' ? this.moverId(sym) : undefined;
      if (n === undefined) throw new Error(`quest "${id}": monstro "${String(sym)}" não existe`);
      ids.push(n);
    }
    return ids;
  }

  private parse(j: Record<string, unknown>): QuestDef {
    const id = String(j.id ?? '');
    if (!/^[A-Za-z0-9_]{1,40}$/.test(id)) throw new Error(`id de quest inválido: "${id}"`);
    const npc = String(j.npc ?? '').trim();
    if (!npc) throw new Error(`quest "${id}": falta o npc`);
    const num = (v: unknown, d: number, lo = 0, hi = 1e9) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.floor(n))) : d; };
    const t = (j.text ?? {}) as Record<string, unknown>;
    const arr = (v: unknown) => (Array.isArray(v) ? (v as Record<string, unknown>[]) : []);
    const rw = (j.reward ?? {}) as Record<string, unknown>;
    const tp = rw.teleport as { world?: unknown; point?: unknown } | undefined;
    const q: QuestDef = {
      id, name: String(j.name ?? id).slice(0, 60), npc, minLevel: num(j.minLevel, 1, 1, 999), maxLevel: num(j.maxLevel, 999, 1, 999),
      requires: typeof j.requires === 'string' && j.requires ? j.requires : undefined, repeatable: !!j.repeatable,
      ...(j.party && typeof j.party === 'object' ? { party: { min: num((j.party as Record<string, unknown>).min, 2, 2, 8), leaderOnly: (j.party as Record<string, unknown>).leaderOnly !== false } } : {}),
      text: { offer: String(t.offer ?? ''), progress: String(t.progress ?? ''), done: String(t.done ?? '') },
      need: arr(j.need).map((g) => ({ item: this.item(g.item, id), count: num(g.count, 1, 1, 9999) })),
      kill: arr(j.kill).map((g) => { const mobs = this.mobs(g.mob, id); return { mobs, sym: mobs ? String(Array.isArray(g.mob) ? g.mob[0] : g.mob) : '*', label: mobs ? '' : 'monstros', count: num(g.count, 1, 1, 9999) }; }),
      drops: arr(j.drops).map((g) => {
        const near = g.near as { point?: unknown; radius?: unknown } | undefined;
        return { item: this.item(g.item, id), mobs: this.mobs(g.mob, id), chance: Math.min(100, Math.max(0, Number(g.chance) || 100)),
          ...(typeof g.world === 'string' && g.world ? { world: g.world } : {}),
          ...(near && typeof near.point === 'string' ? { near: { point: near.point, radius: num(near.radius, 60, 1, 5000) } } : {}) };
      }),
      reward: {
        exp: num(rw.exp, 0), penya: num(rw.penya, 0),
        items: arr(rw.items).map((g) => ({ item: this.item(g.item, id), count: num(g.count, 1, 1, 9999) })),
        ...(tp && typeof tp.world === 'string' ? { teleport: { world: tp.world, ...(typeof tp.point === 'string' ? { point: tp.point } : {}) } } : {}),
        ...(typeof rw.event === 'string' && rw.event ? { event: rw.event } : {}),
      },
    };
    if (!q.need.length && !q.kill.length) throw new Error(`quest "${id}": precisa de "need" ou "kill"`);
    return q;
  }

  all(): QuestDef[] { this.refresh(); return [...this.quests.values()]; }
  get(id: string): QuestDef | undefined { this.refresh(); return this.quests.get(id); }
  forNpc(key: string): QuestDef[] { const k = key.toLowerCase(); return this.all().filter((q) => q.npc.toLowerCase() === k); }
  itemName(id: number) { return this.items.byId.get(id)?.name ?? `#${id}`; }
  mobName(id: number) { return [...this.items.defines].find(([, v]) => v === id)?.[0] ?? `#${id}`; }
}

/** a quest pode ser oferecida a este personagem agora? */
export function offerable(q: QuestDef, log: QuestLog, level: number): boolean {
  const st = log[q.id];
  if (st?.s === 1) return false;
  if (st?.s === 2 && !q.repeatable) return false;
  if (level < q.minLevel || level > q.maxLevel) return false;
  if (q.requires && log[q.requires]?.s !== 2) return false;
  return true;
}
