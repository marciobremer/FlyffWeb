import { NextResponse } from 'next/server'
import { db, FINAL_PRICE, sessionAccount } from '@/lib/itemShop'

export const dynamic = 'force-dynamic'

// vitrine da loja de itens; com sessão, também o saldo, os personagens e as entregas pendentes
export async function GET(request) {
  try {
    const items = (await db().query(
      `SELECT id, name, description, icon, quantity, price, discount, ${FINAL_PRICE} AS final, currency, category FROM website.shop_items WHERE is_active = 1 AND price > 0 ORDER BY category, name`)).rows
    const acc = await sessionAccount(request)
    if (!acc) return NextResponse.json({ items, account: null })
    const characters = (await db().query('SELECT id, name, level FROM public.characters WHERE account_id = $1 AND NOT deleted ORDER BY slot', [acc.id])).rows
    const pending = (await db().query(
      'SELECT p.id, p.name, p.pending, c.name AS character FROM website.shop_purchases p JOIN public.characters c ON c.id = p.character_id WHERE p.account_id = $1 AND p.pending > 0 ORDER BY p.id', [acc.id])).rows
    return NextResponse.json({ items, account: { username: acc.username, cash: acc.cash, votepoint: acc.votepoint, characters, pending } })
  } catch (error) {
    console.error('[SHOP GET ERROR]', error)
    return NextResponse.json({ error: 'Não foi possível carregar a loja de itens' }, { status: 500 })
  }
}
