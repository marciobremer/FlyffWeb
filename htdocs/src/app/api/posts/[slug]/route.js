import { connectToDatabase } from '@/lib/db'
import { NextResponse } from 'next/server'

export async function GET(_, { params }) {
  const { slug } = params
  const db = await connectToDatabase()
  const result = await db
    .request()
    .input('slug', slug)
    .query(`SELECT * FROM WEBSITE_DBF.dbo.NewsPosts WHERE id = @slug`)

  const post = result.recordset[0]
  if (!post) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  return NextResponse.json(post)
}
