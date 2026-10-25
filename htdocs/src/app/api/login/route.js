import { NextResponse } from 'next/server'
import { serialize } from 'cookie'
import { SESSION_COOKIE, SESSION_MAX_AGE, cookieOptions, signSession } from '@/lib/sessionCookie'
import { checkPassword, findAccount } from '@/lib/gameAccount'

// Login do site com a conta do jogo (usuário + senha).
export async function POST(request) {
  try {
    const { username, password } = await request.json()
    if (!username || !password) {
      return NextResponse.json({ success: false, error: 'Informe usuário e senha.' }, { status: 400 })
    }

    const acc = await findAccount(username)
    if (!(await checkPassword(acc, String(password)))) {
      return NextResponse.json({ success: false, error: 'Usuário ou senha incorretos.' }, { status: 401 })
    }

    if (acc.blocked_until && new Date(acc.blocked_until).getTime() > Date.now()) {
      return NextResponse.json({
        success: false,
        error: `Conta bloqueada até ${new Date(acc.blocked_until).toLocaleDateString('pt-BR')}.`
      }, { status: 403 })
    }

    const res = NextResponse.json({
      success: true,
      user: { email: acc.username, username: acc.username, role: acc.role },
    })
    res.headers.set(
      'Set-Cookie',
      serialize(SESSION_COOKIE, signSession(acc.username, acc.role), cookieOptions({ maxAge: SESSION_MAX_AGE }))
    )
    return res
  } catch (err) {
    console.error('[LOGIN ERROR]', err)
    return NextResponse.json({
      success: false,
      error: 'Ocorreu um erro ao entrar. Tente novamente.'
    }, { status: 500 })
  }
}
