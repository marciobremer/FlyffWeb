export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import {
  createPayPalOrder,
  getPayPalCurrency
} from '@/lib/paypal'
import {
  attachPayPalOrder,
  createLocalOrder,
  failLocalOrder,
  getPool,
  getRequestBaseUrl,
  getTopupItem,
  normalizeCharacterName,
  resolveCharacter
} from '@/lib/cashshop-payments'

export async function POST(request) {
  let localOrderId = null
  let pool = null

  try {
    const body = await request.json()
    const itemId = body?.itemId
    const characterName = normalizeCharacterName(body?.characterName)

    if (!characterName) {
      return NextResponse.json(
        { success: false, error: 'O nome do personagem é obrigatório.' },
        { status: 400 }
      )
    }

    pool = await getPool()

    const item = await getTopupItem(pool, itemId)
    const character = await resolveCharacter(pool, characterName)
    const currency = getPayPalCurrency()
    const amount = item.price

    localOrderId = await createLocalOrder(pool, {
      item,
      character,
      amount,
      currency
    })

    const baseUrl = getRequestBaseUrl(request)
    const returnUrl = `${baseUrl}/shops?paypal=success&localOrder=${localOrderId}`
    const cancelUrl = `${baseUrl}/shops?paypal=cancel&localOrder=${localOrderId}`

    const paypal = await createPayPalOrder({
      localOrderId,
      itemName: item.name,
      characterName: character.name,
      amount,
      currency,
      returnUrl,
      cancelUrl
    })

    await attachPayPalOrder(pool, {
      localOrderId,
      paypalOrderId: paypal.paypalOrderId,
      paypalRaw: paypal.raw
    })

    return NextResponse.json({
      success: true,
      approvalUrl: paypal.approvalUrl,
      paypalOrderId: paypal.paypalOrderId,
      localOrderId,
      item: {
        id: item.id,
        name: item.name,
        points: item.points,
        pointsType: item.pointsType,
        price: item.price,
        currency
      },
      character: {
        name: character.name
      }
    })
  } catch (error) {
    console.error('[PAYPAL CREATE ORDER ERROR]', error)

    if (pool && localOrderId) {
      await failLocalOrder(pool, {
        localOrderId,
        reason: error.message || 'Erro ao criar o pedido PayPal'
      }).catch((failError) => console.error('[PAYPAL FAIL LOCAL ORDER ERROR]', failError))
    }

    return NextResponse.json(
      { success: false, error: error.message || 'Não foi possível criar o pedido PayPal.' },
      { status: 500 }
    )
  }
}
