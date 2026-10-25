import { getServerSession } from 'next-auth/next'
import { NextResponse } from 'next/server'

export async function GET(req) {
  try {
    const session = await getServerSession()
    if (!session) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
    }

    const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/user/characters`, {
      headers: {
        'Authorization': `Bearer ${session.user.token}`
      }
    })

    const data = await response.json()
    if (!response.ok) {
      throw new Error(data.error || 'Não foi possível carregar os personagens')
    }

    return NextResponse.json({ characters: data.characters })
  } catch (error) {
    console.error('Erro ao carregar os personagens:', error)
    return NextResponse.json(
      { error: 'Não foi possível carregar os personagens' },
      { status: 500 }
    )
  }
}