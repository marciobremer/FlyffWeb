import { query, transaction } from '../common/db/index';
import type { Inventory } from '../character/inventory';

/**
 * Loja de itens (website.shop_items), a mesma do site: vitrine e compra de dentro do jogo, e a entrega das compras
 * (website.shop_purchases). Só o servidor do jogo escreve no inventário: o site deixa o pedido e este módulo entrega a quem
 * está online. O que não cabe na bolsa continua pendente e é tentado de novo.
 */
export interface Delivery { characterId: number; name: string; delivered: number; left: number }
export interface ShopItem { id: number; itemId: number; name: string; description: string; icon: string; quantity: number; price: number; discount: number; final: number; currency: 'cash' | 'vote'; category: string }
export interface ShopView { items: ShopItem[]; cash: number; votepoint: number }

/** preço cobrado: o desconto em %, nunca abaixo de 1 ponto (a mesma conta em htdocs/src/lib/itemShop.js) */
const FINAL = 'GREATEST(1, round(price * (100 - discount) / 100.0))::int';

export async function shopView(accountId: number): Promise<ShopView> {
  const items = await query<{ id: number; item_id: number; name: string; description: string; icon: string; quantity: number; price: number; discount: number; final: number; currency: 'cash' | 'vote'; category: string }>(
    `SELECT id, item_id, name, description, icon, quantity, price, discount, ${FINAL} AS final, currency, category FROM website.shop_items WHERE is_active = 1 AND price > 0 ORDER BY category, name`);
  const a = (await query<{ cash: number; votepoint: number }>('SELECT cash, votepoint FROM accounts WHERE id = $1', [accountId])).rows[0];
  return { items: items.rows.map(({ item_id, ...x }) => ({ ...x, itemId: item_id })), cash: a?.cash ?? 0, votepoint: a?.votepoint ?? 0 };
}

/**
 * Compra `times` vezes o item `shopId` para o personagem: desconta os pontos e cria o pedido, tudo ou nada.
 * `unit` é o preço que o jogador viu: se mudou, não cobra. Devolve a mensagem de erro ou null.
 */
export async function shopBuy(accountId: number, characterId: number, shopId: number, unit: number, times: number): Promise<string | null> {
  if (!Number.isInteger(times) || times < 1 || times > 99) return 'A quantidade vai de 1 a 99.';
  return transaction(async (db) => {
    const item = (await db.query<{ item_id: number; name: string; quantity: number; final: number; currency: string }>(
      `SELECT item_id, name, quantity, ${FINAL} AS final, currency FROM website.shop_items WHERE id = $1 AND is_active = 1 AND price > 0`, [shopId])).rows[0];
    if (!item) return 'Este item não está mais à venda.';
    if (item.final !== unit) return 'O preço mudou: confira e compre de novo.';
    const total = item.final * times;
    const column = item.currency === 'vote' ? 'votepoint' : 'cash';
    const paid = await db.query(`UPDATE accounts SET ${column} = ${column} - $2 WHERE id = $1 AND ${column} >= $2`, [accountId, total]);
    if (!paid.rowCount) return 'Você não tem pontos suficientes.';
    await db.query(
      'INSERT INTO website.shop_purchases (account_id, character_id, item_id, name, quantity, pending, price, currency) VALUES ($1, $2, $3, $4, $5, $5, $6, $7)',
      [accountId, characterId, item.item_id, item.name, item.quantity * times, total, item.currency]);
    return null;
  });
}

async function deliver(inventory: Inventory, online: number[]): Promise<Delivery[]> {
  const r = await query<{ id: number; character_id: string; item_id: number; name: string; pending: number }>(
    'SELECT id, character_id, item_id, name, pending FROM website.shop_purchases WHERE pending > 0 AND character_id = ANY($1::bigint[]) ORDER BY id', [online]);
  const out: Delivery[] = [];
  for (const row of r.rows) {
    const characterId = Number(row.character_id);
    try {
      const left = await inventory.add(characterId, row.item_id, row.pending);
      const delivered = row.pending - left;
      if (delivered > 0) {
        await inventory.flush(characterId); // o item no banco antes de dar a compra como entregue
        await query('UPDATE website.shop_purchases SET pending = $2, delivered_at = CASE WHEN $2::int = 0 THEN now() END WHERE id = $1', [row.id, left]);
      }
      out.push({ characterId, name: row.name, delivered, left });
    } catch (e) { console.error(`loja: compra ${row.id} não entregue:`, (e as Error).message); }
  }
  return out;
}

/** uma entrega de cada vez: o relógio e a compra dentro do jogo não podem entregar o mesmo pedido duas vezes */
let queue: Promise<unknown> = Promise.resolve();
export function deliverPurchases(inventory: Inventory, online: number[]): Promise<Delivery[]> {
  if (!online.length) return Promise.resolve([]);
  const run = queue.then(() => deliver(inventory, online));
  queue = run.catch(() => {});
  return run;
}
