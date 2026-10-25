import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { MIN_PASSWORD, checkPassword, findAccount, sessionAccount, setPassword } from '@/lib/gameAccount'

// Troca a senha da conta logada (vale para o site e para o jogo).
export async function POST(request) {
  try {
    const { currentPassword, newPassword } = await request.json()
    const account = sessionAccount((await cookies()).get('flyff_session')?.value)

    if (!account) {
      return NextResponse.json({ success: false, error: 'Não autorizado' }, { status: 401 })
    }

    if (!currentPassword || !newPassword) {
      return NextResponse.json({ success: false, error: 'Todos os campos são obrigatórios.' }, { status: 400 })
    }

    if (String(newPassword).length < MIN_PASSWORD) {
      return NextResponse.json({
        success: false,
        error: `A nova senha deve ter pelo menos ${MIN_PASSWORD} caracteres.`
      }, { status: 400 })
    }

    const acc = await findAccount(account)
    if (!acc) {
      return NextResponse.json({ success: false, error: 'Usuário não encontrado.' }, { status: 404 })
    }

    if (!(await checkPassword(acc, String(currentPassword)))) {
      return NextResponse.json({ success: false, error: 'A senha atual está incorreta.' }, { status: 401 })
    }

    await setPassword(acc.id, String(newPassword))

    return NextResponse.json({ success: true, message: 'Senha atualizada com sucesso.' })
  } catch (error) {
    console.error('Change password error:', error)
    return NextResponse.json({ success: false, error: 'Ocorreu um erro ao alterar a senha.' }, { status: 500 })
  }
}
