const LIVE_API_BASE = 'https://api-m.paypal.com'
const SANDBOX_API_BASE = 'https://api-m.sandbox.paypal.com'

function getPayPalBaseUrl() {
  const mode = String(process.env.PAYPAL_MODE || 'sandbox').trim().toLowerCase()
  return mode === 'live' ? LIVE_API_BASE : SANDBOX_API_BASE
}

function requirePayPalEnv() {
  const clientId = process.env.PAYPAL_CLIENT_ID
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET

  if (!clientId || !clientSecret) {
    throw new Error('Configuração do PayPal ausente: PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET')
  }

  return { clientId, clientSecret }
}

export function getPayPalCurrency() {
  return String(process.env.PAYPAL_CURRENCY || 'EUR').trim().toUpperCase()
}

export function formatPayPalAmount(value) {
  const amount = Number(value)

  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error('Valor PayPal inválido')
  }

  return amount.toFixed(2)
}

export async function getPayPalAccessToken() {
  const { clientId, clientSecret } = requirePayPalEnv()
  const baseUrl = getPayPalBaseUrl()
  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')

  const response = await fetch(`${baseUrl}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: 'grant_type=client_credentials'
  })

  const data = await response.json().catch(() => ({}))

  if (!response.ok || !data.access_token) {
    console.error('[PAYPAL TOKEN ERROR]', data)
    throw new Error('Não foi possível obter o token do PayPal')
  }

  return data.access_token
}

export async function paypalRequest(path, options = {}) {
  const token = await getPayPalAccessToken()
  const baseUrl = getPayPalBaseUrl()

  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  })

  const text = await response.text()
  let data = {}

  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      data = { raw: text }
    }
  }

  if (!response.ok) {
    console.error('[PAYPAL API ERROR]', response.status, data)
    const details = Array.isArray(data.details)
      ? data.details.map((d) => d.description || d.issue).filter(Boolean).join(' | ')
      : ''
    throw new Error(details || data.message || `Erro PayPal HTTP ${response.status}`)
  }

  return data
}

export async function createPayPalOrder({
  localOrderId,
  itemName,
  characterName,
  amount,
  currency,
  returnUrl,
  cancelUrl
}) {
  const brandName = String(process.env.PAYPAL_BRAND_NAME || 'Cash Shop').slice(0, 127)
  const finalAmount = formatPayPalAmount(amount)
  const finalCurrency = String(currency || getPayPalCurrency()).toUpperCase()
  const invoiceId = `CSHOP-${localOrderId}`.slice(0, 127)
  const customId = `cashshop:${localOrderId}`.slice(0, 127)

  const payload = {
    intent: 'CAPTURE',
    purchase_units: [
      {
        reference_id: String(localOrderId),
        invoice_id: invoiceId,
        custom_id: customId,
        description: `${itemName} para ${characterName}`.slice(0, 127),
        amount: {
          currency_code: finalCurrency,
          value: finalAmount
        }
      }
    ],
    payment_source: {
      paypal: {
        experience_context: {
          payment_method_preference: 'IMMEDIATE_PAYMENT_REQUIRED',
          brand_name: brandName,
          locale: 'pt-BR',
          landing_page: 'LOGIN',
          shipping_preference: 'NO_SHIPPING',
          user_action: 'PAY_NOW',
          return_url: returnUrl,
          cancel_url: cancelUrl
        }
      }
    }
  }

  const data = await paypalRequest('/v2/checkout/orders', {
    method: 'POST',
    headers: {
      'PayPal-Request-Id': `create-${localOrderId}`
    },
    body: JSON.stringify(payload)
  })

  const approvalUrl = data.links?.find((link) => link.rel === 'payer-action')?.href
    || data.links?.find((link) => link.rel === 'approve')?.href

  if (!data.id || !approvalUrl) {
    console.error('[PAYPAL CREATE ORDER INVALID RESPONSE]', data)
    throw new Error('O PayPal não devolveu o link de pagamento')
  }

  return {
    paypalOrderId: data.id,
    approvalUrl,
    raw: data
  }
}

export async function capturePayPalOrder(paypalOrderId) {
  if (!paypalOrderId || typeof paypalOrderId !== 'string') {
    throw new Error('Pedido PayPal inválido')
  }

  return paypalRequest(`/v2/checkout/orders/${encodeURIComponent(paypalOrderId)}/capture`, {
    method: 'POST',
    headers: {
      'PayPal-Request-Id': `capture-${paypalOrderId}`
    },
    body: '{}'
  })
}

export async function verifyPayPalWebhook({ headers, event }) {
  const webhookId = process.env.PAYPAL_WEBHOOK_ID

  if (!webhookId) {
    throw new Error('Configuração do PayPal ausente: PAYPAL_WEBHOOK_ID')
  }

  const payload = {
    auth_algo: headers.get('paypal-auth-algo'),
    cert_url: headers.get('paypal-cert-url'),
    transmission_id: headers.get('paypal-transmission-id'),
    transmission_sig: headers.get('paypal-transmission-sig'),
    transmission_time: headers.get('paypal-transmission-time'),
    webhook_id: webhookId,
    webhook_event: event
  }

  for (const [key, value] of Object.entries(payload)) {
    if (key !== 'webhook_event' && !value) {
      throw new Error(`Header de webhook PayPal ausente: ${key}`)
    }
  }

  const data = await paypalRequest('/v1/notifications/verify-webhook-signature', {
    method: 'POST',
    body: JSON.stringify(payload)
  })

  return data.verification_status === 'SUCCESS'
}

export function extractCompletedCaptureFromOrder(captureData) {
  const captures = captureData?.purchase_units
    ?.flatMap((unit) => unit?.payments?.captures || [])
    ?.filter(Boolean) || []

  const completed = captures.find((capture) => capture.status === 'COMPLETED')

  if (!completed) {
    return null
  }

  return {
    id: completed.id,
    status: completed.status,
    amount: Number(completed.amount?.value),
    currency: completed.amount?.currency_code,
    payerEmail: captureData?.payer?.email_address || null,
    raw: completed
  }
}

export function extractCaptureFromWebhook(event) {
  const resource = event?.resource || {}
  const orderId = resource?.supplementary_data?.related_ids?.order_id || null

  return {
    paypalOrderId: orderId,
    captureId: resource.id || null,
    status: resource.status || null,
    amount: Number(resource.amount?.value),
    currency: resource.amount?.currency_code || null,
    payerEmail: resource?.payer?.email_address || null,
    raw: resource
  }
}
