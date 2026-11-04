import type { Inventory } from '../character/inventory';
import { BAG, BAG_SLOTS } from '../character/inventory';
import { query } from '../common/db/index';
import { cleanLog, offerable, type QuestBook, type QuestDef, type QuestLog } from './quests';

/** o que o fluxo de quests precisa do servidor do jogo (o realtime.ts entrega) */
export interface QuestHost<C extends QuestConn> {
  inventory: Inventory;
  book: QuestBook;
  send(c: C, msg: unknown): void;
  say(c: C, text: string): void;
  addExp(c: C, amount: number): void;
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
}
export interface QuestConn { player: { id: number; level: number } | null; quests?: QuestLog; cb: unknown }

/** estado de uma quest para o jogador, de olho no que ele tem na bolsa */
export type QuestStatus = 'offer' | 'active' | 'ready';
interface Goal { label: string; have: number; need: number }

export class QuestFlow<C extends QuestConn> {
  constructor(private h: QuestHost<C>) {}

  load(c: C, raw: unknown) { c.quests = cleanLog(raw); }

  private log(c: C): QuestLog { return (c.quests ??= {}); }
  private save(c: C) { if (c.player) void query('UPDATE characters SET quests = $2 WHERE id = $1', [c.player.id, JSON.stringify(this.log(c))]).catch((e) => console.error('quests: salvar', e)); }

  /** itens que a quest pede, com quanto o jogador tem, e os abates */
  private async goals(c: C, q: QuestDef): Promise<Goal[]> {
    const st = this.log(c)[q.id], out: Goal[] = [];
    for (const g of q.need) out.push({ label: this.h.book.itemName(g.item), have: Math.min(g.count, await this.h.inventory.count(c.player!.id, g.item)), need: g.count });
    for (const k of q.kill) out.push({ label: `Derrotar ${k.sym === '*' ? 'monstros' : this.h.book.mobName(k.mobs![0])}`, have: Math.min(k.count, st?.k?.[k.sym] ?? 0), need: k.count });
    return out;
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

  async statusOf(c: C, q: QuestDef): Promise<QuestStatus | null> {
    const st = this.log(c)[q.id];
    if (st?.s === 1) return (await this.goals(c, q)).every((g) => g.have >= g.need) ? 'ready' : 'active';
    return offerable(q, this.log(c), c.player!.level) ? 'offer' : null;
  }

  /** quests deste NPC que o jogador pode ver agora (para o menu do NPC) */
  async menuFor(c: C, key: string) {
    const out: { id: string; name: string; st: QuestStatus }[] = [];
    for (const q of this.h.book.forNpc(key)) { const st = await this.statusOf(c, q); if (st) out.push({ id: q.id, name: q.name, st }); }
    return out;
  }

  private rewardText(q: QuestDef): string[] {
    const r = q.reward, out: string[] = [];
    if (r.exp) out.push(`${r.exp.toLocaleString('pt-BR')} de EXP`);
    if (r.penya) out.push(`${r.penya.toLocaleString('pt-BR')} penya`);
    for (const i of r.items) out.push(`${i.count > 1 ? `${i.count}× ` : ''}${this.h.book.itemName(i.item)}`);
    if (r.teleport) out.push(`Teleporte para ${r.teleport.world}`);
    return out;
  }

  /** janela de diálogo da quest (resposta de { t: 'quest', op: 'open' } e depois de aceitar) */
  async dialog(c: C, id: string, key: string) {
    const q = this.h.book.get(id);
    if (!q || q.npc.toLowerCase() !== key.toLowerCase() || !c.player || !this.h.near(c, q.npc)) return;
    const st = await this.statusOf(c, q);
    if (!st) return;
    const text = st === 'offer' ? q.text.offer : st === 'active' ? q.text.progress : q.text.done;
    this.h.send(c, { t: 'questDlg', id: q.id, key, name: q.name, st, text, goals: await this.goals(c, q), reward: this.rewardText(q), req: this.partyReq(q), blocked: st === 'active' ? null : this.blockedBy(c, q) });
  }

  async accept(c: C, id: string, key: string) {
    const q = this.h.book.get(id);
    if (!q || !c.player || q.npc.toLowerCase() !== key.toLowerCase() || !this.h.near(c, q.npc)) return;
    if (!offerable(q, this.log(c), c.player.level)) { this.h.say(c, 'Você não pode aceitar esta quest agora.'); return; }
    const block = this.blockedBy(c, q);
    if (block) { this.h.say(c, block); await this.dialog(c, id, key); return; }
    const old = this.log(c)[q.id];
    this.log(c)[q.id] = { s: 1, ...(old?.n ? { n: old.n } : {}) };
    this.save(c);
    this.h.say(c, `Quest aceita: ${q.name}.`);
    await this.dialog(c, id, key);
    await this.push(c);
  }

  /**
   * Entrega: confere e tira os itens numa operação só (inventory.edit), e confere se cabem os itens da recompensa, antes de
   * pagar. Os abates já estão no andamento.
   */
  async turnIn(c: C, id: string, key: string) {
    const q = this.h.book.get(id), p = c.player;
    if (!q || !p || q.npc.toLowerCase() !== key.toLowerCase() || !this.h.near(c, q.npc)) return;
    const st = this.log(c)[q.id];
    if (st?.s !== 1) return;
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
      if (BAG_SLOTS - used.size < rewardStacks) return 'A bolsa está cheia: abra espaço para a recompensa.';
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
    this.h.say(c, `Quest concluída: ${q.name}!${this.rewardText(q).length ? ` Recompensa: ${this.rewardText(q).join(', ')}.` : ''}`);
    this.h.send(c, { t: 'questDlg', id: q.id, key, name: q.name, st: 'done', text: q.text.done, goals: [], reward: this.rewardText(q), req: [], blocked: null });
    await this.push(c);
    if (q.reward.event) this.h.runEvent(q.reward.event, c);
    if (q.reward.teleport) {
      const why = await this.h.teleport(c, q.reward.teleport.world, q.reward.teleport.point);
      if (why) this.h.say(c, why);
    }
  }

  /** abandona a quest (o andamento se perde) */
  async abandon(c: C, id: string) {
    const st = this.log(c)[id];
    if (st?.s !== 1) return;
    if (st.n) this.log(c)[id] = { s: 2, n: st.n }; else delete this.log(c)[id];
    this.save(c);
    await this.push(c);
  }

  /** o jogador derrotou o monstro `modelId` em (x, z): conta o abate e rola os itens de quest */
  async onKill(c: C, modelId: number, x: number, z: number) {
    const p = c.player;
    if (!p) return;
    const log = this.log(c);
    const world = this.h.worldOf(c);
    let changed = false;
    for (const q of this.h.book.all()) {
      const st = log[q.id];
      if (st?.s !== 1) continue;
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

  /** diário de quests (tecla Q): as em andamento, com o progresso */
  async push(c: C) {
    if (!c.player) return;
    const list: { id: string; name: string; npc: string; goals: Goal[]; ready: boolean }[] = [];
    for (const q of this.h.book.all()) {
      if (this.log(c)[q.id]?.s !== 1) continue;
      const goals = await this.goals(c, q);
      list.push({ id: q.id, name: q.name, npc: q.npc, goals, ready: goals.every((g) => g.have >= g.need) });
    }
    this.h.send(c, { t: 'quests', list });
  }

  /** GM: `//quest reset [id]` apaga o andamento (de uma ou de todas) */
  async reset(c: C, id?: string): Promise<string> {
    const log = this.log(c);
    if (id) { if (!log[id]) return `Você não tem a quest "${id}".`; delete log[id]; } else for (const k of Object.keys(log)) delete log[k];
    this.save(c);
    await this.push(c);
    return id ? `Quest "${id}" zerada.` : 'Todas as quests zeradas.';
  }

  /** GM: `//quest` lista as quests do servidor e o estado de cada uma para o personagem */
  list(c: C): string {
    const qs = this.h.book.all();
    if (!qs.length) return 'Nenhuma quest em data/quests.json.';
    return qs.map((q) => { const st = this.log(c)[q.id]; return `${q.id} (${q.npc}) — ${st?.s === 1 ? 'em andamento' : st?.s === 2 ? `concluída${st.n && st.n > 1 ? ` ${st.n}×` : ''}` : 'não aceita'}`; }).join(' · ');
  }
}
