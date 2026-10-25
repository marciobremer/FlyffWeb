import { cookies } from 'next/headers'
import { findAccount, sessionAccount, setPassword, MIN_PASSWORD } from '@/lib/gameAccount'

// Painel admin do site: um GM (authority 'Z') define a senha de qualquer conta. Grava no formato do jogo (scrypt).
export async function POST(req) {
  try {
    const admin = await findAccount(sessionAccount((await cookies()).get('flyff_session')?.value))
    if (!admin || admin.role !== 'super') {
      return Response.json({ error: 'Não autorizado' }, { status: 403 })
    }

    const { account, password } = await req.json()
    if (!account || !password || String(password).length < MIN_PASSWORD) {
      return Response.json({ error: `Informe a conta e uma senha com pelo menos ${MIN_PASSWORD} caracteres.` }, { status: 400 })
    }

    const target = await findAccount(account)
    if (!target) {
      return Response.json({ error: 'Conta não encontrada.' }, { status: 404 })
    }

    await setPassword(target.id, String(password))
    return Response.json({ success: true })
  } catch (err) {
    console.error('Erro ao trocar a senha:', err)
    return Response.json({ error: 'Erro no servidor' }, { status: 500 })
  }
}
