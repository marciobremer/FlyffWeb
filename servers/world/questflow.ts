import type { Inventory } from '../character/inventory';
import { BAG } from '../character/inventory';
import { query } from '../common/db/index';
import type { NpcScript } from './npctalk';
import { applying, canBegin, canEnd, nextLevel, origId, type Hero, type OrigQuest, type QuestTab } from './origquests';
import { cleanLog, offerable, type QuestBook, type QuestDef, type QuestLog, type QuestState } from './quests';

/** o que o fluxo de quests precisa do servidor do jogo (o realtime.ts entrega) */
export interface QuestHost<C extends QuestConn> {
  inventory: Inventory;
  book: QuestBook;
  send(c: C, msg: unknown): void;
  say(c: C, text: string): void;
  /** `raw`: sem a taxa de EXP do servidor nem bônus (recompensa de quest original) */
  addExp(c: C, amount: number, raw?: boolean): void;
  /** a party do jogador: quantos membros e quem lidera (null = sem party) */
  party(c: C): { size: number; leader: number } | null;
  /** perto do NPC `key` (alcance de conversa)? */
  near(c: C, key: string): boolean;
  /** mapa-base onde o jogador está (WdMadrigal…) e posição de um ponto marcado no editor (null se não existe) */
  worldOf(c: C): string;
  pointPos(world: string, name: string): [number, number, number] | null;
  /** leva o jogador a um mapa (ponto = nome de ponto do editor; sem ele, a chegada do mapa); devolve o motivo se não der */
  teleport(c: C, world: string, point?: string): Promise<string | null>;
  /** dispara um evento de data/events.json (recompensa de quest) */
  runEvent(id: string, by: C): void;
  /** os outros membros da party perto de (x, z), que também ganham os itens de quest original */
  partyNear(c: C, x: number, z: number): C[];
  /** pontos de skill ganhos numa quest original */
  addSkillPoints(c: C, n: number): void;
  /** nome, retrato (Data/Char) e falas do NPC na janela de conversa */
  npcInfo(c: C, key: string): NpcScript & { name: string; portrait?: string };
  /** exp que falta no nível `level` para o próximo (para mostrar a recompensa em %) */
  expToNext(level: number): number;
}
export interface QuestConn { player: { id: number; level: number; job: number; sex: number } | null; quests?: QuestLog; /** último pacote de marcadores mandado */ questMarks?: string; cb: unknown }

/** estado de uma quest para o jogador, de olho no que ele tem na bolsa */
export type QuestStatus = 'offer' | 'active' | 'ready';
interface Goal { label: string; have: number; need: number }
/** marcador sobre o NPC (m_nQuestEmoticonIndex): 1 "!" disponível, 2 "?" em andamento, 3 "?" pronta, 4 "!" em até 5 níveis */
export type QuestMark = 1 | 2 | 3 | 4;
/** qual prevalece quando o NPC tem várias */
const MARK_RANK: Record<QuestMark, number> = { 3: 4, 1: 3, 2: 2, 4: 1 };
/** uma quest no diário */
interface BookEntry { id: string; name: string; tab: QuestTab; category: string; desc: string }
interface ActiveEntry extends BookEntry { npc: string; goals: Goal[]; ready: boolean; reward: string[]; canAbandon: boolean }
/** MAX_QUEST do original: quests em andamento ao mesmo tempo */
const MAX_ACTIVE = 100;
const between = (a: number, b: number) => a + Math.floor(Math.random() * (b - a + 1));
const range = (a: number, b: number) => (a === b ? a.toLocaleString('pt-BR') : `${a.toLocaleString('pt-BR')}–${b.toLocaleString('pt-BR')}`);
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

export class QuestFlow<C extends QuestConn> {
  constructor(private h: QuestHost<C>) {}

  load(c: C, raw: unknown) { c.quests = cleanLog(raw); c.questMarks = undefined; }

  private log(c: C): QuestLog { return (c.quests ??= {}); }
  private save(c: C) { if (c.player) void query('UPDATE characters SET quests = $2 WHERE id = $1', [c.player.id, JSON.stringify(this.log(c))]).catch((e) => console.error('quests: salvar', e)); }

  /** o personagem visto pelas regras das quests originais */
  private async hero(c: C): Promise<Hero> {
    const p = c.player!, st = await this.h.inventory.state(p.id), pt = this.h.party(c);
    return {
      level: p.level, job: p.job, sex: p.sex, gold: st.gold, party: pt ? { size: pt.size, leader: pt.leader === p.id } : null,
      count: (item) => st.items.reduce((s, i) => (i.c === BAG && i.id === item ? s + i.n : s), 0),
    };
  }

  /** concluída = como na lista do original, em que as repetíveis não entram */
  private done(c: C) {
    return (num: number) => { const id = origId(num), st = this.log(c)[id]; return { active: st?.s === 1, complete: st?.s === 2 && !this.h.book.get(id)?.repeatable }; };
  }

  /** itens que a quest pede, com quanto o jogador tem, e os abates */
  private async goals(c: C, q: QuestDef): Promise<Goal[]> {
    const st = this.log(c)[q.id], out: Goal[] = [];
    if (q.orig) {
      const h = await this.hero(c), e = q.orig.end;
      for (const r of applying(e.items, h)) out.push({ label: this.h.book.itemName(r.item), have: Math.min(r.n, h.count(r.item)), need: r.n });
      for (const k of e.kills) out.push({ label: `Derrotar ${this.h.book.mobName(k.mob)}`, have: Math.min(k.n, st?.k?.[k.mob] ?? 0), need: k.n });
      if (e.gold) out.push({ label: 'Penya', have: Math.min(e.gold, h.gold), need: e.gold });
      if (e.levelMin > h.level) out.push({ label: 'Nível', have: h.level, need: e.levelMin });
      return out;
    }
    for (const g of q.need) out.push({ label: this.h.book.itemName(g.item), have: Math.min(g.count, await this.h.inventory.count(c.player!.id, g.item)), need: g.count });
    for (const k of q.kill) out.push({ label: `Derrotar ${k.sym === '*' ? 'monstros' : this.h.book.mobName(k.mobs![0])}`, have: Math.min(k.count, st?.k?.[k.sym] ?? 0), need: k.count });
    return out;
  }

  /** todos os objetivos cumpridos? */
  private async complete(c: C, q: QuestDef): Promise<boolean> {
    if (q.orig) return canEnd(q.orig, await this.hero(c), this.log(c)[q.id]?.k ?? {});
    return (await this.goals(c, q)).every((g) => g.have >= g.need);
  }

  /** o que a quest exige de party (texto para a janela) */
  private partyReq(q: QuestDef): string[] {
    return q.party ? [`Party com pelo menos ${q.party.min} jogadores${q.party.leaderOnly ? '; só o líder da party fala com o NPC e entrega os itens' : ''}`] : [];
  }

  /** por que este jogador não pode aceitar/entregar agora (party), ou null */
  private blockedBy(c: C, q: QuestDef): string | null {
    if (!q.party) return null;
    const pt = this.h.party(c);
    if (!pt || pt.size < q.party.min) return `Esta quest só pode ser feita em party com pelo menos ${q.party.min} jogadores.`;
    if (q.party.leaderOnly && pt.leader !== c.player!.id) return 'Só o líder da party pode falar com o NPC desta quest.';
    return null;
  }

  private async canAccept(c: C, q: QuestDef): Promise<boolean> {
    if (q.orig) return canBegin(q.orig, await this.hero(c), this.done(c));
    return offerable(q, this.log(c), c.player!.level);
  }

  /** estado da quest para o jogador; com `key`, só o que aquele NPC faz (oferecer ou receber) */
  async statusOf(c: C, q: QuestDef, key?: string): Promise<QuestStatus | null> {
    const st = this.log(c)[q.id];
    if (st?.s === 1) {
      if (key && !same(q.ender, key)) return same(q.npc, key) ? 'active' : null;
      return (await this.complete(c, q)) ? 'ready' : 'active';
    }
    if (key && !same(q.npc, key)) return null;
    return (await this.canAccept(c, q)) ? 'offer' : null;
  }

  /** quests deste NPC que o jogador pode ver agora (para o menu do NPC): prontas, depois novas, depois em andamento */
  async menuFor(c: C, key: string) {
    const out: { id: string; name: string; st: QuestStatus }[] = [];
    for (const q of this.h.book.forNpc(key)) { const st = await this.statusOf(c, q, key); if (st) out.push({ id: q.id, name: q.name, st }); }
    const order: Record<QuestStatus, number> = { ready: 0, offer: 1, active: 2 };
    return out.sort((a, b) => order[a.st] - order[b.st]);
  }

  /** o marcador de cada NPC para este jogador (characterKey em minúsculas) */
  async marks(c: C): Promise<Record<string, QuestMark>> {
    const out: Record<string, QuestMark> = {};
    const put = (key: string, mark: QuestMark) => { const k = key.toLowerCase(), old = out[k]; if (!old || MARK_RANK[mark] > MARK_RANK[old]) out[k] = mark; };
    const log = this.log(c), h = await this.hero(c), done = this.done(c);
    for (const q of this.h.book.all()) {
      const st = log[q.id];
      if (st?.s === 1) {
        const ready = q.orig ? canEnd(q.orig, h, st.k ?? {}) : await this.complete(c, q);
        put(q.ender, ready ? 3 : 2);
        if (!same(q.npc, q.ender)) put(q.npc, 2);
      } else if (q.orig) {
        if (canBegin(q.orig, h, done)) put(q.npc, 1);
        else if (nextLevel(q.orig, h, done)) put(q.npc, 4);
      } else if (offerable(q, log, h.level)) put(q.npc, 1);
      else if (h.level < q.minLevel && h.level + 5 >= q.minLevel && offerable(q, log, q.minLevel)) put(q.npc, 4);
    }
    return out;
  }

  /** manda os marcadores se mudaram (nível, bolsa, party e abates mexem neles: o realtime também chama de tempos em tempos) */
  async pushMarks(c: C) {
    if (!c.player) return;
    const marks = await this.marks(c), packed = JSON.stringify(marks);
    if (packed === c.questMarks || !c.player) return;
    c.questMarks = packed;
    this.h.send(c, { t: 'questMarks', marks });
  }

  private async rewardText(c: C, q: QuestDef): Promise<string[]> {
    const out: string[] = [];
    const item = (id: number, n: number) => out.push(`${n > 1 ? `${n}× ` : ''}${this.h.book.itemName(id)}`);
    if (q.orig) {
      const r = q.orig.reward;
      if (q.orig.hideReward) return ['??'];
      if (r.expMax) out.push(`${range(r.expMin, r.expMax)} de EXP`);
      if (r.goldMax) out.push(`${range(r.goldMin, r.goldMax)} penya`);
      if (r.skillPoints) out.push(`${r.skillPoints} ponto(s) de skill`);
      for (const i of applying(r.items, await this.hero(c))) item(i.item, i.n);
      return out;
    }
    const r = q.reward;
    if (r.exp) out.push(`${r.exp.toLocaleString('pt-BR')} de EXP`);
    if (r.penya) out.push(`${r.penya.toLocaleString('pt-BR')} penya`);
    for (const i of r.items) item(i.item, i.count);
    if (r.teleport) out.push(`Teleporte para ${r.teleport.world}`);
    return out;
  }

  /** janela de conversa (op 'talk'): retrato, saudação do roteiro, apresentação, despedida e as quests do NPC */
  async talk(c: C, key: string) {
    if (!c.player || !this.h.near(c, key)) return;
    const info = this.h.npcInfo(c, key), quests = await this.menuFor(c, key);
    const text = (quests.some((q) => q.st === 'offer') ? info.yes : info.no) || info.greet || '';
    this.h.send(c, { t: 'npcTalk', key, name: info.name, portrait: info.portrait ?? null, text, intro: info.intro ?? null, bye: info.bye ?? null, quests });
  }

  /**
   * Uma quest na janela de conversa (resposta de { t: 'quest', op: 'open' } e depois de aceitar). As falas vêm em páginas
   * ("Próximo"); `said` = o que o NPC responde ao aceitar (sem botões).
   */
  async dialog(c: C, id: string, key: string, said?: string) {
    const q = this.h.book.get(id);
    if (!q || !c.player || (!same(q.npc, key) && !same(q.ender, key)) || !this.h.near(c, key)) return;
    const st = said !== undefined ? 'active' : await this.statusOf(c, q, key);
    if (!st) return;
    const o = q.orig;
    const say = (...n: number[]) => n.map((i) => o?.say[i]).filter((t): t is string => !!t);
    // em andamento: quem recebe cobra o que falta; quem só ofereceu repete o que disse ao aceitar
    const own = said ? [said] : st === 'offer' ? say(0, 1, 2, 3, 4) : st === 'ready' ? say(7, 8, 9) : o && !same(q.ender, key) ? say(5) : say(10, 11, 12);
    const fallback = st === 'offer' ? q.text.offer : st === 'ready' ? q.text.done : q.text.progress;
    const info = this.h.npcInfo(c, key);
    this.h.send(c, {
      t: 'questDlg', id: q.id, key, name: q.name, npc: info.name, portrait: info.portrait ?? null, intro: info.intro ?? null, bye: info.bye ?? null,
      st, accepted: said !== undefined, pages: own.length ? own : [fallback], no: say(6)[0] ?? null, quests: await this.menuFor(c, key),
      req: this.partyReq(q), blocked: st === 'active' ? null : this.blockedBy(c, q),
    });
  }

  async accept(c: C, id: string, key: string) {
    const q = this.h.book.get(id), p = c.player;
    if (!q || !p || !same(q.npc, key) || !this.h.near(c, key)) return;
    if (!(await this.canAccept(c, q))) { this.h.say(c, 'Você não pode aceitar esta quest agora.'); return; }
    const block = this.blockedBy(c, q);
    if (block) { this.h.say(c, block); await this.dialog(c, id, key); return; }
    if (Object.values(this.log(c)).filter((s) => s.s === 1).length >= MAX_ACTIVE) { this.h.say(c, 'Você já tem quests demais em andamento.'); return; }
    const start = q.orig?.start;
    if (start && (start.items.length || start.gold)) {
      const res = await this.h.inventory.edit(p.id, (x) => {
        if (x.state.bag - x.state.items.filter((i) => i.c === BAG).length < start.items.length) return 'A bolsa está cheia: abra espaço para o item da quest.';
        if (start.gold < 0 && x.state.gold < -start.gold) return 'Penya insuficiente para começar esta quest.';
        if (start.gold) x.gold(start.gold);
        return null;
      });
      if (res) { this.h.say(c, res); return; }
    }
    const old = this.log(c)[q.id];
    this.log(c)[q.id] = { s: 1, ...(old?.n ? { n: old.n } : {}) };
    this.save(c);
    for (const i of start?.items ?? []) await this.h.inventory.add(p.id, i.item, i.n).catch((e) => console.error('quests: item inicial', e));
    this.h.say(c, `Quest aceita: ${q.name}.`);
    await this.dialog(c, id, key, q.orig?.say[5] ?? q.text.progress);
    await this.push(c);
  }

  /**
   * Entrega: confere e tira os itens numa operação só (inventory.edit), e confere se cabem os itens da recompensa, antes de
   * pagar. Os abates já estão no andamento.
   */
  async turnIn(c: C, id: string, key: string) {
    const q = this.h.book.get(id), p = c.player;
    if (!q || !p || !same(q.ender, key) || !this.h.near(c, key)) return;
    const st = this.log(c)[q.id];
    if (st?.s !== 1) return;
    if (q.orig) { await this.turnInOriginal(c, q, q.orig, st, key); return; }
    const block = this.blockedBy(c, q);
    if (block) { this.h.say(c, block); await this.dialog(c, id, key); return; }
    if (q.kill.some((k) => (st.k?.[k.sym] ?? 0) < k.count)) { this.h.say(c, 'Você ainda não terminou: falta derrotar monstros.'); await this.dialog(c, id, key); return; }
    const rewardStacks = q.reward.items.length;
    const res = await this.h.inventory.edit(p.id, (x) => {
      const bag = x.state.items.filter((i) => i.c === BAG);
      for (const g of q.need) if (bag.filter((i) => i.id === g.item).reduce((s, i) => s + i.n, 0) < g.count) return 'Faltam itens para entregar.';
      // espaços livres depois de tirar o que será entregue
      const used = new Set(bag.map((i) => i.s));
      for (const g of q.need) {
        let left = g.count;
        for (const it of bag.filter((i) => i.id === g.item).sort((a, b) => a.n - b.n)) { const k = Math.min(left, it.n); left -= k; if (k === it.n) used.delete(it.s); if (!left) break; }
      }
      if (x.state.bag - used.size < rewardStacks) return 'A bolsa está cheia: abra espaço para a recompensa.';
      for (const g of q.need) {
        let left = g.count;
        for (const it of x.state.items.filter((i) => i.c === BAG && i.id === g.item).sort((a, b) => a.n - b.n)) {
          const k = Math.min(left, it.n);
          if (k < it.n) it.n -= k; else x.state.items.splice(x.state.items.indexOf(it), 1);
          x.touch(BAG, it.s);
          left -= k;
          if (!left) break;
        }
      }
      if (q.reward.penya) x.gold(q.reward.penya);
      return null;
    });
    if (res) { this.h.say(c, res); await this.dialog(c, id, key); return; }
    for (const r of q.reward.items) await this.h.inventory.add(p.id, r.item, r.count).catch((e) => console.error('quests: recompensa', e));
    this.log(c)[q.id] = { s: 2, n: (st.n ?? 0) + 1 };
    this.save(c);
    if (q.reward.exp) this.h.addExp(c, q.reward.exp);
    await this.announce(c, q, key, await this.rewardText(c, q));
    if (q.reward.event) this.h.runEvent(q.reward.event, c);
    if (q.reward.teleport) {
      const why = await this.h.teleport(c, q.reward.teleport.world, q.reward.teleport.point);
      if (why) this.h.say(c, why);
    }
  }

  private async announce(c: C, q: QuestDef, key: string, reward: string[]) {
    this.h.say(c, `Quest concluída: ${q.name}!${reward.length ? ` Recompensa: ${reward.join(', ')}.` : ''}`);
    const info = this.h.npcInfo(c, key);
    this.h.send(c, {
      t: 'questDlg', id: q.id, key, name: q.name, npc: info.name, portrait: info.portrait ?? null, intro: info.intro ?? null, bye: info.bye ?? null,
      st: 'done', accepted: false, pages: [`Quest concluída!${reward.length ? `\n\n${reward.join('\n')}` : ''}`], no: null, quests: await this.menuFor(c, key), req: [], blocked: null,
    });
    await this.push(c);
  }

  /** entrega de quest original (__EndQuest): só sai da bolsa o que está em SetEndRemoveItem / SetEndRemoveGold */
  private async turnInOriginal(c: C, q: QuestDef, o: OrigQuest, st: QuestState, key: string) {
    const p = c.player!;
    if (!(await this.complete(c, q))) { await this.dialog(c, q.id, key); return; }
    const h = await this.hero(c);
    const need = applying(o.end.items, h), give = applying(o.reward.items, h);
    const gold = between(o.reward.goldMin, o.reward.goldMax), exp = between(o.reward.expMin, o.reward.expMax);
    const stacks = give.reduce((s, r) => s + Math.ceil(r.n / (this.h.inventory.catalog.byId.get(r.item)?.packMax ?? 1)), 0);
    const res = await this.h.inventory.edit(p.id, (x) => {
      const bag = x.state.items.filter((i) => i.c === BAG);
      const have = (item: number) => bag.reduce((s, i) => (i.id === item ? s + i.n : s), 0);
      if (need.some((r) => have(r.item) < r.n) || x.state.gold < Math.max(o.end.gold, o.remove.gold)) return 'Faltam itens ou penya para entregar.';
      // quanto cada pilha perde (-1 = todos), calculado antes para conferir o espaço da recompensa
      const take = new Map<(typeof bag)[number], number>();
      for (const r of o.remove.items) {
        let left = r.n < 0 ? Infinity : r.n;
        for (const it of bag.filter((i) => i.id === r.item).sort((a, b) => a.n - b.n)) {
          const k = Math.min(left, it.n - (take.get(it) ?? 0));
          if (k <= 0) continue;
          take.set(it, (take.get(it) ?? 0) + k);
          left -= k;
        }
      }
      const emptied = [...take].filter(([it, k]) => k >= it.n).length;
      if (x.state.bag - bag.length + emptied < stacks) return 'A bolsa está cheia: abra espaço para a recompensa.';
      for (const [it, k] of take) {
        if (k < it.n) it.n -= k; else x.state.items.splice(x.state.items.indexOf(it), 1);
        x.touch(BAG, it.s);
      }
      if (gold - o.remove.gold) x.gold(gold - o.remove.gold);
      return null;
    });
    if (res) { this.h.say(c, res); await this.dialog(c, q.id, key); return; }
    const log = this.log(c);
    log[q.id] = { s: 2, n: (st.n ?? 0) + 1 };
    for (const n of o.remove.quests) delete log[origId(n)];
    this.save(c);
    for (const r of give) await this.h.inventory.add(p.id, r.item, r.n).catch((e) => console.error('quests: recompensa', e));
    if (exp) this.h.addExp(c, exp, true); // como o original: AddExperience com bMultiply = FALSE
    if (o.reward.skillPoints) this.h.addSkillPoints(c, o.reward.skillPoints);
    await this.announce(c, q, key, [
      ...(exp ? [`${exp.toLocaleString('pt-BR')} de EXP`] : []), ...(gold ? [`${gold.toLocaleString('pt-BR')} penya`] : []),
      ...(o.reward.skillPoints ? [`${o.reward.skillPoints} ponto(s) de skill`] : []), ...give.map((r) => `${r.n > 1 ? `${r.n}× ` : ''}${this.h.book.itemName(r.item)}`),
    ]);
  }

  /** pontos de skill que as quests concluídas já deram (os pontos são recalculados pelo nível ao entrar) */
  skillBonus(log: QuestLog): number {
    let sum = 0;
    for (const [id, st] of Object.entries(log)) sum += (this.h.book.get(id)?.orig?.reward.skillPoints ?? 0) * (st.n ?? (st.s === 2 ? 1 : 0));
    return sum;
  }

  /** abandona a quest (o andamento se perde) */
  async abandon(c: C, id: string) {
    const st = this.log(c)[id];
    if (st?.s !== 1) return;
    if (this.h.book.get(id)?.orig?.canAbandon === false) { this.h.say(c, 'Esta quest não pode ser abandonada.'); return; }
    if (st.n) this.log(c)[id] = { s: 2, n: st.n }; else delete this.log(c)[id];
    this.save(c);
    await this.push(c);
  }

  /** o jogador derrotou o monstro `modelId` em (x, z): conta o abate e rola os itens de quest */
  async onKill(c: C, modelId: number, x: number, z: number) {
    if (!c.player) return;
    await this.killFor(c, modelId, x, z, false);
    // quests originais: a party perto também recebe os itens de quest (e o abate, nas quests de party)
    for (const other of this.h.partyNear(c, x, z)) await this.killFor(other, modelId, x, z, true);
  }

  private async killFor(c: C, modelId: number, x: number, z: number, shared: boolean) {
    const p = c.player;
    if (!p) return;
    const world = this.h.worldOf(c);
    let changed = false;
    for (const [id, st] of Object.entries(this.log(c))) {
      if (st.s !== 1) continue;
      const q = this.h.book.get(id);
      if (!q) continue;
      if (q.orig) { if (await this.killOriginal(c, q, q.orig, st, modelId, shared)) changed = true; continue; }
      if (shared) continue;
      for (const k of q.kill) {
        if (k.mobs && !k.mobs.includes(modelId)) continue;
        const have = st.k?.[k.sym] ?? 0;
        if (have >= k.count) continue;
        (st.k ??= {})[k.sym] = have + 1;
        changed = true;
        this.h.say(c, `${q.name}: ${k.sym === '*' ? 'monstros' : this.h.book.mobName(k.mobs![0])} ${have + 1}/${k.count}`);
      }
      for (const d of q.drops) {
        if (d.mobs && !d.mobs.includes(modelId)) continue;
        if (d.world && d.world.toLowerCase() !== world.toLowerCase()) continue;
        if (d.near) { const pt = this.h.pointPos(world, d.near.point); if (!pt || Math.hypot(pt[0] - x, pt[2] - z) > d.near.radius) continue; }
        if (Math.random() * 100 >= d.chance) continue;
        const need = q.need.find((g) => g.item === d.item);
        if (need && (await this.h.inventory.count(p.id, d.item)) >= need.count) continue; // já tem o que precisa
        const left = await this.h.inventory.add(p.id, d.item, 1);
        if (left) { this.h.say(c, 'A bolsa está cheia.'); continue; }
        const have = need ? await this.h.inventory.count(p.id, d.item) : 0;
        this.h.say(c, `${this.h.book.itemName(d.item)}${need ? ` ${have}/${need.count}` : ''}`);
        if (need && have >= need.count) this.h.say(c, `Quest "${q.name}": você já tem tudo. Volte ao NPC.`);
        changed = true;
      }
    }
    if (changed) { this.save(c); await this.push(c); }
  }

  /** abates (SetEndCondKillNPC) e itens (QuestItem: chance em 3.000.000.000, 1 a `max` por vez, sem teto) de uma quest original */
  private async killOriginal(c: C, q: QuestDef, o: OrigQuest, st: QuestState, modelId: number, shared: boolean): Promise<boolean> {
    let changed = false;
    if (!shared || o.begin.party.type === 2) {
      for (const k of o.end.kills) {
        const have = st.k?.[k.mob] ?? 0;
        if (k.mob !== modelId || have >= k.n) continue;
        (st.k ??= {})[k.mob] = have + 1;
        changed = true;
        this.h.say(c, `${q.name}: ${this.h.book.mobName(k.mob)} ${have + 1}/${k.n}`);
      }
    }
    for (const d of o.drops) {
      if (d.mob !== modelId || Math.floor(Math.random() * 3_000_000_000) > d.prob) continue;
      const n = between(1, d.max);
      const left = await this.h.inventory.add(c.player!.id, d.item, n);
      if (left >= n) { this.h.say(c, 'A bolsa está cheia.'); continue; }
      const need = o.end.items.find((r) => r.item === d.item);
      this.h.say(c, `${this.h.book.itemName(d.item)}${need ? ` ${await this.h.inventory.count(c.player!.id, d.item)}/${need.n}` : ''}`);
      changed = true;
    }
    return changed;
  }

  private entry(q: QuestDef): BookEntry {
    return { id: q.id, name: q.name, tab: q.orig?.tab ?? 'general', category: q.orig ? q.orig.category : 'Servidor', desc: q.orig?.desc ?? q.text.progress };
  }

  /** recompensa como no diário original: penya, experiência em % do nível atual, itens */
  private async rewardLines(c: C, q: QuestDef): Promise<string[]> {
    if (q.orig?.hideReward) return ['??'];
    const r = q.orig?.reward;
    const exp: [number, number] = r ? [r.expMin, r.expMax] : [q.reward.exp, q.reward.exp];
    const gold: [number, number] = r ? [r.goldMin, r.goldMax] : [q.reward.penya, q.reward.penya];
    const next = this.h.expToNext(c.player!.level), pct = (n: number) => `${((n / next) * 100).toFixed(2)}%`;
    const out: string[] = [];
    if (gold[1]) out.push(`Penya: ${range(...gold)}`);
    if (exp[1]) out.push(`Experiência: ${next > 0 ? (exp[0] === exp[1] ? pct(exp[0]) : `${pct(exp[0])}–${pct(exp[1])}`) : range(...exp)}`);
    if (r?.skillPoints) out.push(`Pontos de skill: ${r.skillPoints}`);
    const items = r ? applying(r.items, await this.hero(c)) : q.reward.items.map((i) => ({ item: i.item, n: i.count }));
    for (const i of items) out.push(`${this.h.book.itemName(i.item)}${i.n > 1 ? ` × ${i.n}` : ''}`);
    return out;
  }

  /** diário de quests (tecla Q): as em andamento, com o progresso, e as concluídas */
  async push(c: C) {
    if (!c.player) return;
    const list: ActiveEntry[] = [], done: BookEntry[] = [];
    for (const [id, st] of Object.entries(this.log(c))) {
      const q = this.h.book.get(id);
      if (!q) continue;
      if (st.s !== 1) { done.push(this.entry(q)); continue; }
      list.push({
        ...this.entry(q), npc: this.h.npcInfo(c, q.ender).name, goals: await this.goals(c, q), ready: await this.complete(c, q),
        reward: await this.rewardLines(c, q), canAbandon: q.orig?.canAbandon ?? true,
      });
    }
    this.h.send(c, { t: 'quests', list, done });
    await this.pushMarks(c);
  }

  /** GM: `//quest reset [id]` apaga o andamento (de uma ou de todas) */
  async reset(c: C, id?: string): Promise<string> {
    const log = this.log(c);
    if (id) { if (!log[id]) return `You do not have the quest "${id}".`; delete log[id]; } else for (const k of Object.keys(log)) delete log[k];
    this.save(c);
    await this.push(c);
    return id ? `Quest "${id}" reset.` : 'All quests reset.';
  }

  /** GM: `//quest` mostra o andamento de quem digitou e quantas quests o servidor tem */
  list(c: C): string {
    const all = this.h.book.all(), orig = all.filter((q) => q.orig).length;
    const mine = Object.entries(this.log(c)).map(([id, st]) => `${id} ${this.h.book.get(id)?.name ?? '?'} — ${st.s === 1 ? 'in progress' : `completed${st.n && st.n > 1 ? ` ${st.n}×` : ''}`}`);
    return `${all.length - orig} quest(s) from data/quests.json, ${orig} original. Yours: ${mine.join(' · ') || 'none'}`;
  }

  /** GM: `//quest info <id|nome>` — NPCs, requisitos, objetivos e recompensa */
  async info(c: C, what: string): Promise<string> {
    const l = what.toLowerCase();
    const exact = this.h.book.get(what);
    const found = exact ? [exact] : this.h.book.all().filter((q) => q.name.toLowerCase().includes(l));
    if (!found.length) return `No quest "${what}".`;
    if (found.length > 1) return found.slice(0, 15).map((q) => `${q.id} ${q.name} (${q.npc})`).join(' · ') + (found.length > 15 ? ` … +${found.length - 15}` : '');
    const q = found[0], o = q.orig;
    const parts = [`${q.id} ${q.name}: ${q.npc} → ${q.ender}`, `level ${q.minLevel}-${q.maxLevel}`];
    if (o?.begin.jobs.length) parts.push(`jobs ${o.begin.jobs.join(',')}`);
    if (o?.begin.prev.length) parts.push(`after ${o.begin.prev.map(origId).join(',')}`);
    const goals = (await this.goals(c, q)).map((g) => `${g.label} ${g.need}`);
    if (goals.length) parts.push(`goals: ${goals.join(', ')}`);
    if (o?.drops.length) {
      const mobs = [...new Set(o.drops.map((d) => this.h.book.mobName(d.mob)))];
      parts.push(`drops from: ${mobs.slice(0, 8).join(', ')}${mobs.length > 8 ? ` … +${mobs.length - 8}` : ''}`);
    }
    parts.push(`reward: ${(await this.rewardText(c, q)).join(', ') || '-'}`, `can accept: ${(await this.canAccept(c, q)) ? 'yes' : 'no'}`);
    return parts.join(' · ');
  }

  /** GM: `//quest npc <characterKey>` — as quests que o NPC oferece ou recebe */
  npcQuests(key: string): string {
    const qs = this.h.book.forNpc(key);
    if (!qs.length) return `No quests for NPC "${key}".`;
    return qs.map((q) => `${q.id} ${q.name} (lv ${q.minLevel}-${q.maxLevel}${same(q.npc, key) ? '' : ', turn-in only'})`).join(' · ');
  }
}
