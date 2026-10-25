import { NextResponse } from 'next/server'
import { connectToDatabase } from '@/lib/db'

export async function GET() {
  try {
    const db = await connectToDatabase()

    const result = await db.query`SELECT current_database() AS name`

    return NextResponse.json({
      success: true,
      databases: result.recordset.map(db => db.name),
    })
  } catch (err) {
    console.error('Connection failed:', err)
    return NextResponse.json({ success: false, error: err.message }, { status: 500 })
  }
}
