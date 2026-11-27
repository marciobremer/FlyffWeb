import { NextResponse } from 'next/server'
import { db, FINAL_PRICE, sessionAccount } from '@/lib/itemShop'

export const dynamic = 'force-dynamic'

const fail = (error, status = 400) => NextResponse.json({ error }, { status })

// compra: desconta os pontos e deixa o pedido; o servidor do jogo entrega ao personagem quando ele estiver online
export async function POST(request) {
  const acc = await sessionAccount(request)
  if (!acc) return fail('Entre na sua conta para comprar.', 401)
  const body = await request.json().catch(() => ({}))
  const client = await db().connect()
  try {
    await client.query('BEGIN')
    const item = (await client.query(`SELECT id, item_id, name, quantity, ${FINAL_PRICE} AS price, currency FROM website.shop_items WHERE id = $1 AND is_active = 1 AND price > 0`, [Number(body.itemId) || 0])).rows[0]
    if (!item) { await client.query('ROLLBACK'); return fail('Este item não está mais à venda.', 404) }
    // o preço que o jogador viu: se mudou, não cobra outro valor sem ele saber
    if (Number(body.price) !== item.price) { await client.query('ROLLBACK'); return fail('O preço mudou. Atualize a página.', 409) }
    const ch = (await client.query('SELECT id, name FROM public.characters WHERE id = $1 AND account_id = $2 AND NOT deleted', [Number(body.characterId) || 0, acc.id])).rows[0]
    if (!ch) { await client.query('ROLLBACK'); return fail('Escolha um personagem da sua conta.') }
    const column = item.currency === 'vote' ? 'votepoint' : 'cash'
    const paid = await client.query(`UPDATE public.accounts SET ${column} = ${column} - $2 WHERE id = $1 AND ${column} >= $2 RETURNING ${column}`, [acc.id, item.price])
    if (!paid.rowCount) { await client.query('ROLLBACK'); return fail('Você não tem pontos suficientes.') }
    await client.query(
      'INSERT INTO website.shop_purchases (account_id, character_id, item_id, name, quantity, pending, price, currency) VALUES ($1, $2, $3, $4, $5, $5, $6, $7)',
      [acc.id, ch.id, item.item_id, item.name, item.quantity, item.price, item.currency])
    await client.query('COMMIT')
    return NextResponse.json({ success: true, character: ch.name, balance: paid.rows[0][column] })
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    console.error('[SHOP BUY ERROR]', error)
    return fail('Não foi possível concluir a compra.', 500)
  } finally {
    client.release()
  }
}
