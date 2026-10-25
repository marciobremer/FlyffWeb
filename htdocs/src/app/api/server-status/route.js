import { NextResponse } from 'next/server'
import { connectToDatabase } from '@/lib/db'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function GET() {
  try {
    const db = await connectToDatabase()
    const request = db.request()
    request.timeout = 10000

    const result = await request.query(`
      SELECT
        (SELECT COUNT(*)
         FROM [CHARACTER_01_DBF].[dbo].[CHARACTER_TBL]
         WHERE [MultiServer] = 1) AS onlineCount,

        (SELECT COUNT(*)
         FROM [ACCOUNT_DBF].[dbo].[ACCOUNT_TBL]) AS totalAccounts,

        (SELECT COUNT(*)
         FROM [CHARACTER_01_DBF].[dbo].[CHARACTER_TBL]) AS totalCharacters,

        (SELECT COUNT(*)
         FROM [CHARACTER_01_DBF].[dbo].[GUILD_TBL]
         WHERE m_szGuild IS NOT NULL
           AND LTRIM(RTRIM(m_szGuild)) <> '') AS activeGuilds
    `)

    const row = result.recordset[0] || {}

    return NextResponse.json({
      success: true,
      status: 'online',
      playersOnline: Number(row.onlineCount || 0),
      totalAccounts: Number(row.totalAccounts || 0),
      totalCharacters: Number(row.totalCharacters || 0),
      activeGuilds: Number(row.activeGuilds || 0),
    })
  } catch (error) {
    console.error('Server status error:', error.message || error)

    return NextResponse.json(
      {
        success: false,
        status: 'offline',
        playersOnline: 0,
        totalAccounts: 0,
        totalCharacters: 0,
        activeGuilds: 0,
        error: 'Erro interno do servidor',
      },
      { status: 500 }
    )
  }
}
