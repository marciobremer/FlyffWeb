import { NextResponse } from 'next/server'
import { verifyEmailConfig } from '@/lib/emailUtils'

export async function GET() {
  try {
    const isValid = await verifyEmailConfig()

    if (isValid) {
      return NextResponse.json({
        success: true,
        message: 'A configuração de e-mail é válida',
        config: {
          smtp_host: process.env.SMTP_HOST ? 'Configure' : 'Manquant',
          smtp_port: process.env.SMTP_PORT ? 'Configure' : 'Manquant',
          smtp_user: process.env.SMTP_USER ? 'Configure' : 'Manquant',
          smtp_pass: process.env.SMTP_PASS ? 'Configure' : 'Manquant',
          mail_from: process.env.MAIL_FROM ? 'Configure' : 'Manquant',
          app_url:
            process.env.NEXT_PUBLIC_APP_URL ||
            process.env.NEXTAUTH_URL ||
            'Manquant'
        }
      })
    }

    return NextResponse.json(
      {
        success: false,
        error: 'A configuração de e-mail é inválida',
        config: {
          smtp_host: process.env.SMTP_HOST ? 'Configure' : 'Manquant',
          smtp_port: process.env.SMTP_PORT ? 'Configure' : 'Manquant',
          smtp_user: process.env.SMTP_USER ? 'Configure' : 'Manquant',
          smtp_pass: process.env.SMTP_PASS ? 'Configure' : 'Manquant',
          mail_from: process.env.MAIL_FROM ? 'Configure' : 'Manquant',
          app_url:
            process.env.NEXT_PUBLIC_APP_URL ||
            process.env.NEXTAUTH_URL ||
            'Manquant'
        }
      },
      { status: 400 }
    )
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error.message || 'Erro no servidor'
      },
      { status: 500 }
    )
  }
}