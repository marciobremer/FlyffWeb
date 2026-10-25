import { connectToDatabase } from '@/lib/db'
import sql from '@/lib/mssql-pg'

export async function POST(req) {
  try {
    const { account, new_email } = await req.json()

    if (!account || !new_email) {
      return new Response(JSON.stringify({ error: 'Faltam campos' }), { status: 400 })
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(new_email)) {
      return new Response(JSON.stringify({ error: 'Formato de e-mail inválido' }), { status: 400 })
    }

    const pool = await connectToDatabase()

    const existing = await pool.request()
      .input('email', sql.VarChar, new_email)
      .query(`
        SELECT COUNT(*) as count
        FROM WEBSITE_DBF.dbo.REGISTERED_USERS
        WHERE email = @email
      `)

    if (existing.recordset[0].count === 0) {
      return new Response(JSON.stringify({ error: 'E-mail não encontrado no sistema.' }), { status: 404 })
    }

    const transaction = new sql.Transaction(pool)
    await transaction.begin()

    try {
      const request = new sql.Request(transaction)

      await request
        .input('account', sql.VarChar, account)
        .input('email', sql.VarChar, new_email)
        .query(`
          UPDATE ACCOUNT_DBF.dbo.ACCOUNT_TBL_DETAIL
          SET email = @email
          WHERE account = @account
        `)

      await transaction.commit()
      return new Response(JSON.stringify({ success: 'E-mail atualizado com sucesso!' }), { status: 200 })

    } catch (txErr) {
      await transaction.rollback()
      console.error('[TRANSACTION ERROR]', txErr)
      return new Response(JSON.stringify({ error: 'Não foi possível atualizar o e-mail.' }), { status: 500 })
    }

  } catch (err) {
    console.error('[EMAIL UPDATE ERROR]', err)
    return new Response(JSON.stringify({ error: 'Erro no servidor' }), { status: 500 })
  }
}