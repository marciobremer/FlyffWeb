import { NextResponse } from 'next/server'

// Remove da requisição o cookie de sessão que não tem assinatura válida (forjado ou antigo) antes de chegar nas rotas.
const NAME = 'flyff_session'
const MAX_AGE_MS = 24 * 60 * 60 * 1000

async function validSession(value) {
  const secret = process.env.SESSION_SECRET || process.env.NEXTAUTH_SECRET || ''
  const i = value.lastIndexOf('|')
  if (!secret || i < 0) return false
  const body = value.slice(0, i), sig = value.slice(i + 1)
  const ts = Number(body.split('|')[1])
  if (!Number.isFinite(ts) || Date.now() - ts > MAX_AGE_MS) return false
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body))
  const hex = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('')
  if (hex.length !== sig.length) return false
  let diff = 0
  for (let k = 0; k < hex.length; k++) diff |= hex.charCodeAt(k) ^ sig.charCodeAt(k)
  return diff === 0
}

export async function middleware(request) {
  const cookie = request.cookies.get(NAME)
  if (!cookie?.value || (await validSession(decodeURIComponent(cookie.value)))) return NextResponse.next()
  const headers = new Headers(request.headers)
  const rest = (headers.get('cookie') || '').split(/;\s*/).filter((c) => c && !c.startsWith(NAME + '='))
  if (rest.length) headers.set('cookie', rest.join('; ')); else headers.delete('cookie')
  return NextResponse.next({ request: { headers } })
}

export const config = { matcher: ['/api/:path*', '/((?!_next/static|_next/image|favicon.ico).*)'] }
