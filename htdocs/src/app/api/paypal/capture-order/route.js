export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import {
  capturePayPalOrder,
  extractCompletedCaptureFromOrder
} from '@/lib/paypal'
import {
  creditCashShopOrder,
  failLocalOrder,
  getLocalOrderByPayPalId,
  getPool,
  validateCaptureMatchesOrder
} from '@/lib/cashshop-payments'

export async function POST(request) {
  let body = {}
  let paypalOrderId = ''

  try {
    body = await request.json()
    paypalOrderId = String(body?.paypalOrderId || body?.orderId || body?.token || '').trim()

    if (!paypalOrderId) {
      return NextResponse.json(
        { success: false, error: 'Pedido PayPal ausente.' },
        { status: 400 }
      )
    }

    const pool = await getPool()
    const localOrder = await getLocalOrderByPayPalId(pool, paypalOrderId)

    if (!localOrder) {
      return NextResponse.json(
        { success: false, error: 'Pedido local não encontrado.' },
        { status: 404 }
      )
    }

    if (localOrder.credited) {
      return NextResponse.json({
        success: true,
        alreadyCredited: true,
        message: 'Este pedido já tinha sido creditado.',
        characterName: localOrder.character_name,
        points: localOrder.points,
        pointsType: localOrder.points_type
      })
    }

    const captureData = await capturePayPalOrder(paypalOrderId)
    const capture = extractCompletedCaptureFromOrder(captureData)

    validateCaptureMatchesOrder(localOrder, capture)

    const credited = await creditCashShopOrder(pool, {
      paypalOrderId,
      capture
    })

    return NextResponse.json({
      success: true,
      alreadyCredited: Boolean(credited?.already_credited),
      message: credited?.already_credited
        ? 'Pagamento já creditado.'
        : 'Pagamento confirmado. Pontos creditados no jogo.',
      characterName: credited?.character_name,
      points: credited?.points,
      pointsType: credited?.points_type
    })
  } catch (error) {
    console.error('[PAYPAL CAPTURE ERROR]', error)

    try {
      if (paypalOrderId) {
        const pool = await getPool()
        await failLocalOrder(pool, {
          paypalOrderId,
          reason: error.message || 'Erro na captura PayPal'
        })
      }
    } catch (failError) {
      console.error('[PAYPAL CAPTURE FAIL ORDER ERROR]', failError)
    }

    return NextResponse.json(
      { success: false, error: error.message || 'Não foi possível confirmar o pagamento PayPal.' },
      { status: 500 }
    )
  }
}
