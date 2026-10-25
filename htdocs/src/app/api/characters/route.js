// app/api/characters/route.js

export const dynamic = 'force-dynamic'

import { connectToDatabase } from '@/lib/db'

export async function GET(req) {
  const { searchParams } = new URL(req.url)
  const account = searchParams.get('account')
  if (!account) {
    return new Response(JSON.stringify({ error: 'Missing account' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  try {
    const pool = await connectToDatabase()
    const result = await pool
      .request()
      .input('account', account)
      .query(`
        SELECT TOP 1000 
          m_idPlayer, serverindex, account, m_szName, m_nJob, m_nLevel, m_nMaximumLevel, TotalPlayTime
        FROM [CHARACTER_01_DBF].[dbo].[CHARACTER_TBL]
        WHERE account = @account
      `)

    return new Response(JSON.stringify({ characters: result.recordset }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('[CHARACTER API ERROR]', err)
    return new Response(JSON.stringify({ error: 'Server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}
