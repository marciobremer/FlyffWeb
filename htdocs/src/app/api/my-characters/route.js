// /app/api/my-characters/route.js
import { NextResponse } from 'next/server'
import { connectToDatabase } from '@/lib/db'
import { parse } from 'cookie'

export async function GET(req) {
  try {
    const cookies = parse(req.headers.get('cookie') || '')
    const session = cookies.flyff_session || ''
    const account = session.split('|')[0] || ''

    if (!account) return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 })

    const db = await connectToDatabase()

    const result = await db.query`
      SELECT name, m_nJob AS job, m_nLevel AS level, DATEDIFF(MINUTE, CreateTime, GETDATE()) AS playtime
      FROM CHARACTER_01_DBF.dbo.CHARACTER_TBL
      WHERE account = ${account}
    `

    const formatted = result.recordset.map((c) => ({
      name: c.name,
      job: c.job,
      level: c.level,
      time: `${Math.floor(c.playtime / 1440)}d ${Math.floor((c.playtime % 1440) / 60)}h ${c.playtime % 60}m`
    }))

    return NextResponse.json({ success: true, characters: formatted })
  } catch (err) {
    console.error('Fetch error:', err)
    return NextResponse.json({ success: false, error: 'Server error' }, { status: 500 })
  }
}
