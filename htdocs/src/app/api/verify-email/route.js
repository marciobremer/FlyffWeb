import { NextResponse } from 'next/server'
import { connectToDatabase } from '@/lib/db'

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url)
    const token = searchParams.get('token')?.trim()

    console.log('Received verification request for token:', token)

    if (!token) {
      return NextResponse.json(
        {
          success: false,
          error: 'O token de verificação está ausente.'
        },
        { status: 400 }
      )
    }

    const db = await connectToDatabase()

    const checkResult = await db.query`
      SELECT 
        email,
        email_verified,
        verification_token,
        token_expires_at
      FROM WEBSITE_DBF.dbo.REGISTERED_USERS
      WHERE verification_token = ${token}
    `

    const user = checkResult.recordset[0]

    if (!user) {
      console.log('No user found with token:', token)
      return NextResponse.json(
        {
          success: false,
          error: 'Token de verificação inválido. Peça um novo e-mail de verificação.'
        },
        { status: 400 }
      )
    }

    if (user.email_verified === 1 || user.email_verified === true) {
      console.log('Email already verified for user:', user.email)
      return NextResponse.json(
        {
          success: true,
          message: 'E-mail já verificado. Agora você já pode entrar.'
        },
        { status: 200 }
      )
    }

    if (!user.token_expires_at) {
      console.log('Token expiration date missing for user:', user.email)
      return NextResponse.json(
        {
          success: false,
          error: 'O token de verificação é inválido. Peça um novo.'
        },
        { status: 400 }
      )
    }

    const now = new Date()
    const expiryDate = new Date(user.token_expires_at)

    if (isNaN(expiryDate.getTime()) || expiryDate < now) {
      console.log('Token expired or invalid:', {
        token,
        email: user.email,
        expiryDate: user.token_expires_at,
        now: now.toISOString()
      })

      return NextResponse.json(
        {
          success: false,
          error: 'O token de verificação expirou. Peça um novo.'
        },
        { status: 400 }
      )
    }

    try {
      await db.query`
        UPDATE WEBSITE_DBF.dbo.REGISTERED_USERS
        SET
          email_verified = 1,
          verification_token = NULL,
          token_expires_at = NULL
        WHERE verification_token = ${token}
      `

      const verifyResult = await db.query`
        SELECT email, email_verified
        FROM WEBSITE_DBF.dbo.REGISTERED_USERS
        WHERE email = ${user.email}
      `

      const verifiedUser = verifyResult.recordset[0]
      const isVerified =
        verifiedUser?.email_verified === 1 ||
        verifiedUser?.email_verified === true

      console.log('Update result:', {
        email: verifiedUser?.email,
        isVerified
      })

      if (!verifiedUser || !isVerified) {
        throw new Error('Verification update failed')
      }

      console.log('Successfully verified email for:', user.email)

      return NextResponse.json(
        {
          success: true,
          message: 'E-mail verificado com sucesso! Agora você já pode entrar.'
        },
        { status: 200 }
      )
    } catch (updateError) {
      console.error('Failed to update verification status:', updateError)

      return NextResponse.json(
        {
          success: false,
          error: 'Não foi possível verificar o e-mail. Tente novamente.'
        },
        { status: 500 }
      )
    }
  } catch (error) {
    console.error('Email verification error:', error)

    return NextResponse.json(
      {
        success: false,
        error: 'Ocorreu um erro durante a verificação. Tente novamente.'
      },
      { status: 500 }
    )
  }
}