export const dynamic = 'force-dynamic'
import { cookies } from 'next/headers'
import { findAccount, sessionAccount } from '@/lib/gameAccount'

// A conta logada (site e jogo são a mesma conta), no formato de lista que o perfil já usa.
export async function GET() {
  const cookieStore = await cookies()
  const account = sessionAccount(cookieStore.get('flyff_session')?.value)
  if (!account) {
    return Response.json({ error: 'Não autorizado' }, { status: 401 })
  }

  try {
    const acc = await findAccount(account)
    const accounts = acc
      ? [{ email: acc.username, name: acc.username, regdate: acc.created_at, cash: acc.cash ?? 0, votepoint: acc.votepoint ?? 0 }]
      : []
    return Response.json({ success: true, accounts })
  } catch (err) {
    console.error('Error fetching accounts:', err)
    return Response.json({ error: 'Erro no servidor' }, { status: 500 })
  }
}
