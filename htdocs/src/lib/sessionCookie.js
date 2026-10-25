// Cookie de sessão do site: `email|timestamp|papel|assinatura`.
// Antes o cookie era só "email|timestamp|papel" sem assinatura — qualquer um podia forjar um cookie de administrador.
// Agora a assinatura é um HMAC-SHA256 com SESSION_SECRET; o middleware (src/middleware.js) descarta cookies sem assinatura válida.
import crypto from 'node:crypto'

export const SESSION_COOKIE = 'flyff_session'
export const SESSION_MAX_AGE = 60 * 60 * 24

const secret = () => process.env.SESSION_SECRET || process.env.NEXTAUTH_SECRET || ''

export function signSession(email, role) {
  const body = `${email}|${Date.now()}|${role}`
  const sig = crypto.createHmac('sha256', secret()).update(body).digest('hex')
  return `${body}|${sig}`
}

/** opções do Set-Cookie: seguro só em HTTPS (COOKIE_SECURE=true); COOKIE_DOMAIN opcional */
export function cookieOptions(extra = {}) {
  const o = { httpOnly: true, secure: process.env.COOKIE_SECURE === 'true', sameSite: 'strict', path: '/', ...extra }
  if (process.env.COOKIE_DOMAIN) o.domain = process.env.COOKIE_DOMAIN
  return o
}
