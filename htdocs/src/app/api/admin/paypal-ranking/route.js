export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import {
  getPayPalRanking,
  normalizePositiveInt,
  normalizeRankingPeriod,
  requireSuperAdmin
} from '@/lib/paypal-ranking'

export async function GET(request) {
  try {
    const admin = await requireSuperAdmin()
    if (!admin.ok) {
      return NextResponse.json({ success: false, error: admin.error }, { status: admin.status })
    }

    const { searchParams } = new URL(request.url)
    const periodInfo = normalizeRankingPeriod(searchParams)
    const limit = normalizePositiveInt(searchParams.get('limit'), 20)

    const ranking = await getPayPalRanking(admin.pool, {
      periodInfo,
      limit,
      includeRewards: true
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
      ranking
    })
  } catch (error) {
    console.error('[PAYPAL RANKING ADMIN ERROR]', error)
    return NextResponse.json(
      { success: false, error: error.message || 'Impossible de charger le classement PayPal admin' },
      { status: 500 }
    )
  }
}
