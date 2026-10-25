// /src/app/api/logout/route.js
import { NextResponse } from 'next/server'
import { serialize } from 'cookie'
import { SESSION_COOKIE, cookieOptions } from '@/lib/sessionCookie'

export async function GET() {
  const cookie = serialize(SESSION_COOKIE, '', cookieOptions({ expires: new Date(0) }))

  const res = NextResponse.json({ success: true })
  res.headers.set('Set-Cookie', cookie)
  return res
}