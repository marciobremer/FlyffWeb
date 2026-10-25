export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import {
  extractCaptureFromWebhook,
  verifyPayPalWebhook
} from '@/lib/paypal'
import {
  creditCashShopOrder,
  failLocalOrder,
  getLocalOrderByPayPalId,
  getPool,
  validateCaptureMatchesOrder
} from '@/lib/cashshop-payments'

export async function POST(request) {
  let event = null

  try {
    event = await request.json()

    const verified = await verifyPayPalWebhook({
      headers: request.headers,
      event
    })

    if (!verified) {
      console.warn('[PAYPAL WEBHOOK] Signature refusee')
      return NextResponse.json({ success: false, error: 'Assinatura PayPal inválida' }, { status: 400 })
    }

    if (event?.event_type !== 'PAYMENT.CAPTURE.COMPLETED') {
      return NextResponse.json({ success: true, ignored: true })
    }

    const capture = extractCaptureFromWebhook(event)

    if (!capture.paypalOrderId || !capture.captureId) {
      console.error('[PAYPAL WEBHOOK] Donnees capture incompletes', event)
      return NextResponse.json({ success: false, error: 'Captura PayPal incompleta' }, { status: 400 })
    }

    const pool = await getPool()
    const localOrder = await getLocalOrderByPayPalId(pool, capture.paypalOrderId)

    if (!localOrder) {
      console.error('[PAYPAL WEBHOOK] Pedido local não encontrado', capture.paypalOrderId)
      return NextResponse.json({ success: true, missingLocalOrder: true })
    }

    if (localOrder.credited) {
      return NextResponse.json({ success: true, alreadyCredited: true })
    }

    validateCaptureMatchesOrder(localOrder, capture)

    const credited = await creditCashShopOrder(pool, {
      paypalOrderId: capture.paypalOrderId,
      capture
    })

    return NextResponse.json({
      success: true,
      credited: !credited?.already_credited,
      alreadyCredited: Boolean(credited?.already_credited)
    })
  } catch (error) {
    console.error('[PAYPAL WEBHOOK ERROR]', error)

    try {
      const capture = extractCaptureFromWebhook(event)

      if (capture?.paypalOrderId) {
        const pool = await getPool()
        await failLocalOrder(pool, {
          paypalOrderId: capture.paypalOrderId,
          reason: error.message || 'Erro no webhook PayPal'
        })
      }
    } catch (failError) {
      console.error('[PAYPAL WEBHOOK FAIL ORDER ERROR]', failError)
    }

    return NextResponse.json(
      { success: false, error: error.message || 'Erro no webhook PayPal' },
      { status: 500 }
    )
  }
}
