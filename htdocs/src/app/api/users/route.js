import { connectToDatabase } from '@/lib/db' // adjust the path as needed

export async function GET() {
  try {
    const pool = await connectToDatabase()
    const result = await pool.request().query(`
      SELECT 
        a.[account], 
        b.m_Szname AS character_name, 
        a.password,
        b.CreateTime 
      FROM [ACCOUNT_DBF].[dbo].[ACCOUNT_TBL] a
      LEFT OUTER JOIN CHARACTER_01_DBF.dbo.CHARACTER_TBL b 
        ON b.account = a.account
    `)

    return Response.json(result.recordset)
  } catch (err) {
    console.error('Failed to fetch user records:', err)
    return Response.json({ error: 'Failed to load users' }, { status: 500 })
  }
}
