export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import {
  creditRankingReward,
  normalizeRankingPeriod,
  requireSuperAdmin
} from '@/lib/paypal-ranking'

export async function POST(request) {
  try {
    const admin = await requireSuperAdmin()
    if (!admin.ok) {
      return NextResponse.json({ success: false, error: admin.error }, { status: admin.status })
    }

    const body = await request.json().catch(() => ({}))
    const periodInfo = normalizeRankingPeriod({
      period: body.period,
      start: body.start,
      end: body.end
    })

    const result = await creditRankingReward(admin.pool, {
      adminEmail: admin.email,
      periodInfo,
      rankPosition: body.rankPosition,
      itemId: body.itemId,
      itemCount: body.itemCount || 1,
      notes: body.notes || ''
    })

    return NextResponse.json({
      success: true,
      ...result,
      message: result.alreadyCredited
        ? 'Cette recompense etait deja creditee.'
        : 'Recompense creditee par courrier en jeu.'
    })
  } catch (error) {
    console.error('[PAYPAL RANKING REWARD ERROR]', error)
    return NextResponse.json(
      { success: false, error: error.message || 'Impossible de crediter la recompense' },
      { status: 500 }
    )
  }
}
