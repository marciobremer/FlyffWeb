import { query, transaction } from '../common/db/index';
import { BAG, type InvItem, type Inventory } from '../character/inventory';

/**
 * Correio entre personagens (CDPSrvr::OnQueryPostMail…): texto, uma pilha de item e penya, com taxa de envio. O item e o
 * penya saem do remetente e entram na carta numa única transação (e o contrário ao receber): nada duplica nem some no meio.
 * Diferença do original: a carta não vence — fica até o destinatário receber e apagar.
 */
export const POSTAGE = 500;          // nPostGold fora da Coreia
export const MAX_MAIL = 50;          // post.h
export const MAX_TITLE = 32, MAX_BODY = 256;

type Stored = Omit<InvItem, 'c' | 's'>;
interface MailRow { id: string; sender_name: string; title: string; body: string; item: Stored | null; gold: string; read: boolean; at: number }

/** tira caracteres de controle (o corpo mantém as quebras de linha) e corta no limite */
const clean = (v: unknown, max: number, lines = false) =>
  String(v ?? '').replace(lines ? /[\u0000-\u0009\u000b-\u001f\u007f]/g : /[\u0000-\u001f\u007f]/g, '').trim().slice(0, max);

export async function unreadCount(characterId: number): Promise<number> {
  const r = await query<{ n: string }>('SELECT count(*) AS n FROM character_mail WHERE recipient_id = $1 AND (NOT read OR item IS NOT NULL OR gold > 0)', [characterId]);
  return Number(r.rows[0]?.n ?? 0);
}

/** a caixa de entrada: cartas (mais novas primeiro) e a definição dos itens anexados */
export async function mailView(inv: Inventory, characterId: number) {
  const r = await query<MailRow>(
    'SELECT id, sender_name, title, body, item, gold, read, (extract(epoch from created_at) * 1000)::float8 AS at FROM character_mail WHERE recipient_id = $1 ORDER BY id DESC LIMIT $2', [characterId, MAX_MAIL]);
  const items = r.rows.map((m) => (m.item ? { ...m.item, c: BAG, s: 0 } : null));
  const { defs } = inv.rowsView(items.filter((i): i is InvItem => !!i));
  return {
    t: 'mail', postage: POSTAGE, defs,
    list: r.rows.map((m, k) => ({ id: Number(m.id), from: m.sender_name, title: m.title, body: m.body, gold: Number(m.gold), read: m.read, at: m.at, item: items[k] ? inv.row(items[k]!) : null })),
  };
}

export interface Draft { to: unknown; title: unknown; body: unknown; /** espaço da bolsa (-1 = sem item) */ s: unknown; n: unknown; gold: unknown }

/** envia; devolve o destinatário ou o motivo de não enviar */
export async function sendMail(inv: Inventory, sender: { id: number; name: string }, d: Draft, inUse?: number): Promise<{ to: { id: number; name: string } } | { error: string }> {
  const title = clean(d.title, MAX_TITLE), body = clean(d.body, MAX_BODY, true), name = clean(d.to, 24);
  const gold = Number(d.gold ?? 0), slot = Number(d.s ?? -1), n = Number(d.n ?? 0);
  if (!name) return { error: 'Escreva o nome de quem vai receber.' };
  if (!title) return { error: 'Escreva o título da carta.' };
  if (!Number.isInteger(gold) || gold < 0 || !Number.isInteger(slot) || !Number.isInteger(n)) return { error: 'Carta inválida.' };
  const who = (await query<{ id: string; name: string }>('SELECT id, name FROM characters WHERE lower(name) = lower($1) AND NOT deleted LIMIT 1', [name])).rows[0];
  if (!who) return { error: `Não existe personagem chamado ${name}.` };
  const to = { id: Number(who.id), name: who.name };
  if (to.id === sender.id) return { error: 'Você não pode enviar carta para si mesmo.' };
  const full = `A caixa de ${to.name} está cheia.`;
  const countOf = async (q: (text: string, p: unknown[]) => Promise<{ rows: { n?: string }[] }>) => Number((await q('SELECT count(*) AS n FROM character_mail WHERE recipient_id = $1', [to.id])).rows[0]?.n ?? 0);
  if (await countOf((t, p) => query(t, p)) >= MAX_MAIL) return { error: full };

  const r = await inv.transfer<Stored | null>(sender.id,
    (x) => {
      const cost = POSTAGE + gold;
      if (x.state.gold < cost) return { error: `Penya insuficiente: o envio custa ${POSTAGE} mais o penya anexado.` };
      let sent: Stored | null = null;
      if (slot >= 0) {
        const it = x.state.items.find((i) => i.c === BAG && i.s === slot), def = it && inv.catalog.byId.get(it.id);
        if (!it || !def || !(n >= 1)) return { error: 'O item anexado não está mais na bolsa.' };
        if (inv.cannotStore(def)) return { error: `${def.name} não pode ser enviado pelo correio.` };
        if (it.id === inUse) return { error: `Recolha ${def.name} antes de enviar.` };
        const k = Math.min(n, it.n);
        const { c: _c, s: _s, ...rest } = it;
        sent = { ...rest, n: k };
        if (k < it.n) it.n -= k; else x.state.items.splice(x.state.items.indexOf(it), 1);
        x.touch(BAG, slot);
      }
      x.gold(-cost);
      return {
        value: sent,
        undo: (u) => { u.gold(cost); if (sent) inv.restore(u, sent, slot); },
      };
    },
    async (db, item) => {
      // trava os dois personagens na ordem do id: cartas simultâneas não passam do limite nem travam uma à outra (deadlock)
      await db.query('SELECT 1 FROM characters WHERE id = ANY($1::bigint[]) ORDER BY id FOR UPDATE', [[sender.id, to.id]]);
      if (await countOf((t, p) => db.query(t, p)) >= MAX_MAIL) throw new MailRefused(full);
      await db.query('INSERT INTO character_mail (recipient_id, sender_id, sender_name, title, body, item, gold) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)',
        [to.id, sender.id, sender.name, title, body, item ? JSON.stringify(item) : null, gold]);
    });
  return 'error' in r ? r : { to };
}

/** recusa decidida dentro da transação (a mensagem vai para o jogador) */
export class MailRefused extends Error {}

/** recebe o item ou o penya de uma carta */
export async function takeMail(inv: Inventory, characterId: number, mailId: number, what: 'item' | 'gold'): Promise<{ ok: true } | { error: string }> {
  const m = (await query<{ item: Stored | null; gold: string }>('SELECT item, gold FROM character_mail WHERE id = $1 AND recipient_id = $2', [mailId, characterId])).rows[0];
  const gold = Number(m?.gold ?? 0);
  if (!m || (what === 'item' ? !m.item : !gold)) return { error: 'Não há mais nada para receber nessa carta.' };
  const r = await inv.transfer<null>(characterId,
    (x) => {
      if (what === 'gold') {
        if (!inv.goldFits(x.state.gold, gold)) return { error: 'Passaria do limite de penya.' };
        x.gold(gold);
        return { value: null, undo: (u) => u.gold(-gold) };
      }
      const slot = inv.freeBagSlot(x.state);
      if (slot < 0) return { error: 'A bolsa está cheia.' };
      x.state.items.push({ ...m.item!, c: BAG, s: slot });
      x.touch(BAG, slot);
      return { value: null, undo: (u) => { const k = u.state.items.findIndex((i) => i.c === BAG && i.s === slot && i.id === m.item!.id); if (k >= 0) { u.state.items.splice(k, 1); u.touch(BAG, slot); } } };
    },
    async (db) => {
      // só vale se ainda está na carta: um segundo pedido não recebe de novo
      const done = what === 'item'
        ? await db.query('UPDATE character_mail SET item = NULL, read = true WHERE id = $1 AND recipient_id = $2 AND item IS NOT NULL', [mailId, characterId])
        : await db.query('UPDATE character_mail SET gold = 0, read = true WHERE id = $1 AND recipient_id = $2 AND gold = $3', [mailId, characterId, gold]);
      if (!done.rowCount) throw new MailRefused('Não há mais nada para receber nessa carta.');
    });
  return 'error' in r ? r : { ok: true };
}

export const readMail = (characterId: number, mailId: number) => query('UPDATE character_mail SET read = true WHERE id = $1 AND recipient_id = $2', [mailId, characterId]);

/** apaga a carta; só sem item e sem penya (nada se perde por engano) */
export async function deleteMail(characterId: number, mailId: number): Promise<string | null> {
  return transaction(async (db) => {
    const r = await db.query('DELETE FROM character_mail WHERE id = $1 AND recipient_id = $2 AND item IS NULL AND gold = 0', [mailId, characterId]);
    return r.rowCount ? null : 'Receba o item e o penya antes de apagar a carta.';
  });
}
