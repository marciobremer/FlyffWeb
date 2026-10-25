import { NextResponse } from 'next/server'
import { connectToDatabase } from '@/lib/db'
import bcrypt from 'bcrypt'
import { sendTemporaryPasswordEmail } from '@/lib/emailUtils'

const SALT_ROUNDS = 10

function generateTemporaryPassword() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  let temp = ''
  for (let i = 0; i < 12; i++) {
    temp += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return temp
}

export async function POST(request) {
  try {
    const { email, pin } = await request.json()

    if (!email || !pin) {
      return NextResponse.json({ 
        success: false, 
        error: 'O e-mail e o PIN são obrigatórios.' 
      }, { status: 400 })
    }

    if (!/^\d{4,6}$/.test(pin)) {
      return NextResponse.json({ 
        success: false, 
        error: 'O PIN deve ter entre 4 e 6 dígitos.' 
      }, { status: 400 })
    }

    const db = await connectToDatabase()

    const result = await db.query`
      SELECT email, email_verified, pin_hash
      FROM WEBSITE_DBF.dbo.REGISTERED_USERS
      WHERE email = ${email}
    `

    const user = result.recordset[0]

    if (!user) {
      return NextResponse.json({ 
        success: false, 
        error: 'Nenhuma conta encontrada com este e-mail.' 
      }, { status: 404 })
    }

    if (!user.email_verified) {
      return NextResponse.json({ 
        success: false, 
        error: 'Verifique seu e-mail primeiro.' 
      }, { status: 400 })
    }

    const pinMatch = await bcrypt.compare(pin, user.pin_hash)
    if (!pinMatch) {
      return NextResponse.json({ 
        success: false, 
        error: 'PIN inválido.' 
      }, { status: 401 })
    }

    const tempPassword = generateTemporaryPassword()
    const hashedPassword = await bcrypt.hash(tempPassword, SALT_ROUNDS)

    await db.query`
      UPDATE WEBSITE_DBF.dbo.REGISTERED_USERS
      SET password_hash = ${hashedPassword}
      WHERE email = ${email}
    `

    const emailSent = await sendTemporaryPasswordEmail(email, tempPassword)

    if (!emailSent) {
      return NextResponse.json({ 
        success: false, 
        error: 'Não foi possível enviar o e-mail com a senha temporária. Tente novamente.' 
      }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      message: 'Uma senha temporária foi enviada para o seu e-mail.'
    })

  } catch (error) {
    console.error('Forgot password error:', error)
    return NextResponse.json({ 
      success: false, 
      error: 'Ocorreu um erro. Tente novamente.' 
    }, { status: 500 })
  }
}