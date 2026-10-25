import { NextResponse } from 'next/server'
import { MIN_PASSWORD, USERNAME_RE, createAccount } from '@/lib/gameAccount'

// Cadastro: só usuário e senha. Cria a conta do jogo direto (a mesma usada para entrar no site e no jogo).
export async function POST(req) {
  try {
    const { username, password, confirmPassword } = await req.json()

    if (!username || !password || !confirmPassword) {
      return NextResponse.json({ success: false, error: 'Todos os campos são obrigatórios.' }, { status: 400 })
    }

    const account = String(username).trim()
    if (!USERNAME_RE.test(account)) {
      return NextResponse.json(
        { success: false, error: 'Usuário: de 3 a 16 caracteres, só letras, números ou _.' },
        { status: 400 }
      )
    }

    if (String(password).length < MIN_PASSWORD) {
      return NextResponse.json(
        { success: false, error: `A senha deve ter pelo menos ${MIN_PASSWORD} caracteres.` },
        { status: 400 }
      )
    }

    if (password !== confirmPassword) {
      return NextResponse.json({ success: false, error: 'As senhas não conferem.' }, { status: 400 })
    }

    try {
      await createAccount(account, String(password))
    } catch (e) {
      if (e.code === 'EXISTS') {
        return NextResponse.json({ success: false, error: e.message }, { status: 409 })
      }
      throw e
    }

    return NextResponse.json({ success: true, message: 'Conta criada! Use o mesmo usuário e senha para entrar no site e no jogo.' })
  } catch (err) {
    console.error('Registration error:', err)
    return NextResponse.json(
      { success: false, error: 'Erro no servidor durante o cadastro. Tente novamente.' },
      { status: 500 }
    )
  }
}
