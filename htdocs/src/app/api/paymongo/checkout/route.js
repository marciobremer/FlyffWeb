export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'

export async function POST() {
  return NextResponse.json(
    {
      success: false,
      error: 'Rota antiga do PayPal.me desativada. Use /api/paypal/create-order com itemId e characterName.'
    },
    { status: 410 }
  )
}
