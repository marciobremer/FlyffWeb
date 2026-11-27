import { NextResponse } from 'next/server'
import { catalogItem, db, sessionAccount, shopFields } from '@/lib/itemShop'

export const dynamic = 'force-dynamic'

const fail = (error, status = 400) => NextResponse.json({ error }, { status })
const isAdmin = async (request) => !!(await sessionAccount(request))?.admin
const LIST = 'SELECT id, item_id, name, description, icon, quantity, price, discount, category, currency, is_active FROM website.shop_items ORDER BY is_active DESC, name'

export async function GET(request) {
  if (!(await isAdmin(request))) return fail('Não autorizado', 403)
  return NextResponse.json((await db().query(LIST)).rows)
}

// adiciona um item do jogo à loja
export async function POST(request) {
  if (!(await isAdmin(request))) return fail('Não autorizado', 403)
  try {
    const body = await request.json()
    const f = shopFields(body)
    if (typeof f === 'string') return fail(f)
    const item = await catalogItem(body.itemId)
    if (!item) return fail('Item não encontrado no jogo.', 404)
    await db().query(
      'INSERT INTO website.shop_items (item_id, symbol, name, description, icon, quantity, price, currency, is_active, discount, category) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)',
      [item.id, item.symbol, item.name, f.description || item.description, item.icon, f.quantity, f.price, f.currency, f.active, f.discount, f.category])
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[SHOP ADMIN POST ERROR]', error)
    return fail('Não foi possível adicionar o item.', 500)
  }
}

export async function PUT(request) {
  if (!(await isAdmin(request))) return fail('Não autorizado', 403)
  const body = await request.json().catch(() => ({}))
  const f = shopFields(body)
  if (typeof f === 'string') return fail(f)
  const r = await db().query('UPDATE website.shop_items SET price = $2, quantity = $3, currency = $4, is_active = $5, description = $6, discount = $7, category = $8 WHERE id = $1',
    [Number(body.id) || 0, f.price, f.quantity, f.currency, f.active, f.description, f.discount, f.category])
  return r.rowCount ? NextResponse.json({ success: true }) : fail('Item não encontrado.', 404)
}

// tira da loja (o histórico das compras fica em shop_purchases)
export async function DELETE(request) {
  if (!(await isAdmin(request))) return fail('Não autorizado', 403)
  const id = Number(new URL(request.url).searchParams.get('id')) || 0
  const r = await db().query('DELETE FROM website.shop_items WHERE id = $1', [id])
  return r.rowCount ? NextResponse.json({ success: true }) : fail('Item não encontrado.', 404)
}
