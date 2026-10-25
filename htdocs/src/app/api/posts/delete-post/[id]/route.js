import { connectToDatabase } from '@/lib/db'
import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'

export async function DELETE(req, { params }) {
  const { id } = params
  try {
    const db = await connectToDatabase()

    // Get image path first
    const record = await db.query`SELECT image_url FROM WEBSITE_DBF.dbo.NewsPosts WHERE id = ${id}`
    const post = record.recordset[0]

    if (post?.image_url) {
      const imagePath = path.join(process.cwd(), 'public', post.image_url.replace(/^\/+/, ''))
      if (fs.existsSync(imagePath)) fs.unlinkSync(imagePath)
    }

    // Delete record from DB
    await db.query`DELETE FROM WEBSITE_DBF.dbo.NewsPosts WHERE id = ${id}`
    return NextResponse.json({ success: true })
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
