// Loja de itens: sessão do site → conta do jogo. O cookie sem assinatura válida já foi descartado pelo middleware.
import { getPool } from '@/lib/mssql-pg'
import { SESSION_COOKIE } from '@/lib/sessionCookie'

export const db = () => getPool()

// preço cobrado: o desconto em %, nunca abaixo de 1 ponto (a mesma conta em servers/world/shopdelivery.ts)
export const FINAL_PRICE = 'GREATEST(1, round(price * (100 - discount) / 100.0))::int'

/** conta da sessão ({ id, username, admin, cash, votepoint }) ou null */
export async function sessionAccount(request) {
  const raw = request.cookies.get(SESSION_COOKIE)?.value
  const username = raw ? raw.split('|')[0] : ''
  if (!username) return null
  const r = await db().query('SELECT id, username, authority, cash, votepoint FROM public.accounts WHERE lower(username) = lower($1)', [username])
  const a = r.rows[0]
  return a ? { id: a.id, username: a.username, admin: a.authority === 'Z', cash: a.cash, votepoint: a.votepoint } : null
}

/** dados do item no catálogo do servidor do jogo (nome, ícone, descrição), ou null */
export async function catalogItem(id) {
  const port = process.env.GAME_PORT || process.env.PORT_GAME || 8080
  const res = await fetch(`http://127.0.0.1:${port}/shop-catalog?id=${Number(id)}`, { cache: 'no-store' })
  if (!res.ok) throw new Error('Servidor do jogo não respondeu.')
  return (await res.json())[0] ?? null
}

/** campos editáveis de um item da loja, validados; devolve texto com o erro */
export function shopFields(body) {
  const price = Number(body.price), quantity = Number(body.quantity)
  const currency = body.currency === 'vote' ? 'vote' : 'cash'
  const active = body.isActive ? 1 : 0
  const discount = Number(body.discount ?? 0)
  const category = String(body.category ?? '').trim().slice(0, 30) || 'Material'
  if (!Number.isInteger(discount) || discount < 0 || discount > 90) return 'O desconto vai de 0 a 90%.'
  if (!Number.isInteger(price) || price < 0 || price > 1_000_000) return 'O preço deve ser um número inteiro de pontos.'
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 999) return 'A quantidade vai de 1 a 999.'
  if (active && price < 1) return 'Defina um preço maior que zero para colocar à venda.'
  return { price, quantity, currency, active, discount, category, description: String(body.description ?? '').slice(0, 500) }
}
