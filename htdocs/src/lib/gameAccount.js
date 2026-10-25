// Conta do site = conta do jogo (tabela `public.accounts` do PostgreSQL, a mesma do login do jogo).
// Senha no mesmo formato de servers/auth/password.ts (scrypt); contas importadas do FlyFF ainda podem ter só o MD5 antigo.
// "super" no site = conta com autoridade de GM (authority 'Z').
import crypto from 'node:crypto'
import { connectToDatabase } from '@/lib/db'

const N = 1 << 15, R = 8, P = 1, KEYLEN = 32
const LEGACY_SALT = process.env.FLYFF_MD5_SALT ?? 'kikugalanet'

/** usuário: 3 a 16 letras, números ou _ (16 é o limite das contas do FlyFF) */
export const USERNAME_RE = /^[A-Za-z0-9_]{3,16}$/
export const MIN_PASSWORD = 4

export function hashPassword(password) {
  const salt = crypto.randomBytes(16)
  const key = crypto.scryptSync(String(password).normalize('NFC'), salt, KEYLEN, { N, r: R, p: P, maxmem: 64 * 1024 * 1024 })
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${key.toString('base64')}`
}

function verifyScrypt(password, stored) {
  const [alg, n, r, p, salt, hash] = String(stored).split('$')
  if (alg !== 'scrypt' || !salt || !hash) return false
  const want = Buffer.from(hash, 'base64')
  const key = crypto.scryptSync(String(password).normalize('NFC'), Buffer.from(salt, 'base64'), want.length, { N: Number(n), r: Number(r), p: Number(p), maxmem: 64 * 1024 * 1024 })
  return crypto.timingSafeEqual(key, want)
}

function verifyLegacy(password, legacyHex) {
  const got = crypto.createHash('md5').update(LEGACY_SALT + password, 'latin1').digest()
  const want = Buffer.from(String(legacyHex).trim(), 'hex')
  return want.length === got.length && crypto.timingSafeEqual(got, want)
}

export const roleOf = (authority) => (String(authority || '').trim().toUpperCase() === 'Z' ? 'super' : 'user')

/** conta pelo nome (sem diferenciar maiúsculas); null se não existe */
export async function findAccount(username) {
  const name = String(username || '').trim()
  if (!name) return null
  const pool = await connectToDatabase()
  const result = await pool.request()
    .input('username', name)
    .query(`
      SELECT id, username, password_hash, legacy_password, authority, blocked_until, created_at, cash, votepoint
      FROM public.accounts
      WHERE lower(username) = lower(@username)
    `)
  const acc = result.recordset[0]
  return acc ? { ...acc, role: roleOf(acc.authority) } : null
}

/** confere a senha; conta importada (só MD5) ganha o hash novo no primeiro acerto, como no login do jogo */
export async function checkPassword(acc, password) {
  if (!acc) {
    verifyScrypt(password, hashPassword('x')) // mesmo custo para conta inexistente
    return false
  }
  if (acc.password_hash) return verifyScrypt(password, acc.password_hash)
  if (acc.legacy_password && verifyLegacy(password, acc.legacy_password)) {
    await setPassword(acc.id, password)
    return true
  }
  return false
}

export async function setPassword(accountId, password) {
  const pool = await connectToDatabase()
  await pool.request()
    .input('id', accountId)
    .input('hash', hashPassword(password))
    .query(`UPDATE public.accounts SET password_hash = @hash WHERE id = @id`)
}

/** cria a conta do jogo; lança erro com `code = 'EXISTS'` se o nome já está em uso */
export async function createAccount(username, password) {
  const pool = await connectToDatabase()
  try {
    const result = await pool.request()
      .input('username', username)
      .input('hash', hashPassword(password))
      .query(`INSERT INTO public.accounts (username, password_hash, authority) VALUES (@username, @hash, 'F') RETURNING id`)
    return result.recordset[0].id
  } catch (e) {
    if (e?.code === '23505') {
      const err = new Error('Este nome de conta já existe.')
      err.code = 'EXISTS'
      throw err
    }
    throw e
  }
}

/** nome da conta gravado no cookie de sessão (`conta|timestamp|papel|assinatura`, validado no middleware) */
export function sessionAccount(cookieValue) {
  const parts = String(cookieValue || '').split('|')
  return parts.length >= 2 ? parts[0] : ''
}
