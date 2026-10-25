export const dynamic = 'force-dynamic'
import { cookies } from 'next/headers'
import { findAccount, sessionAccount } from '@/lib/gameAccount'

// Quem está logado. `email` continua no retorno (é o nome da conta) porque as telas do site leem esse campo.
export async function GET() {
  try {
    const cookieStore = await cookies()
    const account = sessionAccount(cookieStore.get('flyff_session')?.value)
    if (!account) {
      return Response.json({ error: 'Não autorizado' }, { status: 401 })
    }

    const acc = await findAccount(account)
    if (!acc) {
      return Response.json({ error: 'Usuário não encontrado' }, { status: 404 })
    }

    return Response.json({ success: true, email: acc.username, username: acc.username, role: acc.role })
  } catch (err) {
    console.error('[API /me] Unexpected Error:', err)
    return Response.json({ error: 'Erro no servidor' }, { status: 500 })
  }
}
