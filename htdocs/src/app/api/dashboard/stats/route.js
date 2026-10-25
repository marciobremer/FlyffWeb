import { NextResponse } from 'next/server'
import { connectToDatabase } from '@/lib/db'
import { jobMapping } from '@/utils/jobUtils'

export const dynamic = 'force-dynamic'
export const revalidate = 0

function createRequest(db, timeout = 20000) {
  const request = db.request()
  request.timeout = timeout
  return request
}

export async function GET() {
  try {
    console.log('Attempting to connect to database...')
    const db = await connectToDatabase()

    if (!db) {
      throw new Error('Failed to connect to database')
    }

    console.log('Database connection successful')

    // Pas de transaction ici : ce sont uniquement des SELECT.
    // Une transaction qui plante sans rollback peut garder une connexion bloquee dans le pool.
    console.log('Fetching online players...')
    const onlinePlayersResult = await createRequest(db).query(`
      SELECT
        COUNT(*) as total,
        COUNT(CASE WHEN m_nLevel >= 105 THEN 1 END) as high_level,
        COUNT(CASE WHEN m_nLevel < 60 THEN 1 END) as low_level
      FROM CHARACTER_01_DBF.dbo.CHARACTER_TBL
      WHERE MultiServer = 1
    `)

    console.log('Fetching account statistics...')
    const accountsResult = await createRequest(db).query(`
      SELECT
        (SELECT COUNT(*) FROM ACCOUNT_DBF.dbo.ACCOUNT_TBL) as total_accounts,
        (SELECT COUNT(*) FROM CHARACTER_01_DBF.dbo.CHARACTER_TBL) as total_characters,
        (SELECT COUNT(*) FROM CHARACTER_01_DBF.dbo.CHARACTER_TBL WHERE m_nLevel = 105) as max_level_chars
    `)

    console.log('Fetching today statistics...')
    const todayStats = await createRequest(db).query(`
      SELECT
        (SELECT COUNT(*) FROM ACCOUNT_DBF.dbo.[ACCOUNT_TBL_DETAIL] WHERE CAST(regdate AS DATE) = CAST(GETDATE() AS DATE)) as new_accounts,
        (SELECT COUNT(*) FROM CHARACTER_01_DBF.dbo.CHARACTER_TBL WHERE CAST(CreateTime AS DATE) = CAST(GETDATE() AS DATE)) as new_characters,
        (SELECT COUNT(*) FROM LOGGING_01_DBF.dbo.tblTradeLog WHERE CAST(TradeDt AS DATE) = CAST(GETDATE() AS DATE)) as trades_today,
        (SELECT COUNT(*) FROM CHARACTER_01_DBF.dbo.MAIL_TBL WHERE CAST(Senddt AS DATE) = CAST(GETDATE() AS DATE)) as mails_today
    `)

    console.log('Fetching top characters...')
    const topCharacters = await createRequest(db).query(`
      SELECT TOP 5
        m_szName as name,
        m_nLevel as level,
        m_dwGold as gold,
        CreateTime as created_at
      FROM CHARACTER_01_DBF.dbo.CHARACTER_TBL
      ORDER BY m_nLevel DESC, m_dwGold DESC
    `)

    console.log('Fetching recent trades...')
    const recentTrades = await createRequest(db, 25000).query(`
      SELECT TOP 5
        t.TradeID,
        FORMAT(t.TradeDt, 'yyyy-MM-dd HH:mm:ss') AS TradeDt,
        p1.m_szName AS Player1,
        p2.m_szName AS Player2
      FROM [LOGGING_01_DBF].[dbo].[tblTradeLog] t
      LEFT JOIN [LOGGING_01_DBF].[dbo].[tblTradeDetailLog] td1 ON t.TradeID = td1.TradeID
      LEFT JOIN CHARACTER_01_DBF.dbo.CHARACTER_TBL p1 ON p1.m_idPlayer = td1.idPlayer
      LEFT JOIN [LOGGING_01_DBF].[dbo].[tblTradeDetailLog] td2 ON t.TradeID = td2.TradeID AND td2.idPlayer <> td1.idPlayer
      LEFT JOIN CHARACTER_01_DBF.dbo.CHARACTER_TBL p2 ON p2.m_idPlayer = td2.idPlayer
      ORDER BY t.TradeDt DESC
    `)

    console.log('Fetching class distribution...')
    const classDistribution = await createRequest(db).query(`
      SELECT
        m_nJob as job_id,
        COUNT(*) as count
      FROM CHARACTER_01_DBF.dbo.CHARACTER_TBL
      GROUP BY m_nJob
      ORDER BY count DESC
    `)

    console.log('All queries completed successfully')

    const mappedClassDistribution = classDistribution.recordset.map(row => ({
      class_name: jobMapping[row.job_id] || 'Unknown',
      class_id: row.job_id,
      count: row.count,
    }))

    return NextResponse.json({
      online_players: {
        total: onlinePlayersResult.recordset[0]?.total || 0,
        high_level: onlinePlayersResult.recordset[0]?.high_level || 0,
        low_level: onlinePlayersResult.recordset[0]?.low_level || 0,
      },
      accounts: {
        total: accountsResult.recordset[0]?.total_accounts || 0,
        total_characters: accountsResult.recordset[0]?.total_characters || 0,
        max_level_chars: accountsResult.recordset[0]?.max_level_chars || 0,
      },
      today: {
        new_accounts: todayStats.recordset[0]?.new_accounts || 0,
        new_characters: todayStats.recordset[0]?.new_characters || 0,
        trades: todayStats.recordset[0]?.trades_today || 0,
        mails: todayStats.recordset[0]?.mails_today || 0,
      },
      top_characters: topCharacters.recordset,
      recent_trades: recentTrades.recordset,
      class_distribution: mappedClassDistribution,
    })
  } catch (error) {
    console.error('Dashboard API error:', error.message || error)

    return NextResponse.json(
      {
        error: error.message || 'Failed to fetch dashboard statistics',
        details: process.env.NODE_ENV === 'development' ? error.stack : undefined,
      },
      { status: 500 }
    )
  }
}
