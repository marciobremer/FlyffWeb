export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { connectToDatabase } from '@/lib/db'
import {
  getPayPalRanking,
  normalizePositiveInt,
  normalizeRankingPeriod
} from '@/lib/paypal-ranking'

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url)
    const periodInfo = normalizeRankingPeriod(searchParams)
    const limit = normalizePositiveInt(searchParams.get('limit'), 20)
    const pool = await connectToDatabase()

    const ranking = await getPayPalRanking(pool, {
      periodInfo,
      limit,
      includeRewards: false
    })

    return NextResponse.json({
      success: true,
      period: {
        type: periodInfo.period,
        key: periodInfo.periodKey,
        label: periodInfo.label,
        start: periodInfo.startDateText,
        end: periodInfo.endDateText
      },
	  ranking: ranking.map((row) => ({
	  rank_position: row.rank_position,
	  character_name: row.character_name,
      total_amount: 'XXX',
      total_points: 'XXX',
      total_orders: 'XXX',
      first_payment_at: row.first_payment_at,
      last_payment_at: row.last_payment_at
}))
    })
  } catch (error) {
    console.error('[PAYPAL RANKING PUBLIC ERROR]', error)
    return NextResponse.json(
      { success: false, error: error.message || 'Não foi possível carregar o ranking PayPal' },
      { status: 500 }
    )
  }
}
