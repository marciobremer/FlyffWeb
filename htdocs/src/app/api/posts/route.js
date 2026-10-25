import { NextResponse } from 'next/server'
import { connectToDatabase } from '@/lib/db'
import { writeFile } from 'fs/promises'
import path from 'path'
import { v4 as uuidv4 } from 'uuid'

export async function GET() {
  const pool = await connectToDatabase()
  const result = await pool.request().query('SELECT * FROM WEBSITE_DBF.dbo.NewsPosts ORDER BY created_at DESC')
  return NextResponse.json(result.recordset)
}

export async function POST(req) {
  const formData = await req.formData()
  const title = formData.get('title')
  const content = formData.get('content')
  const image = formData.get('image')

  if (!title || !content || !image) {
    return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
  }

  const buffer = Buffer.from(await image.arrayBuffer())
  const fileName = `${uuidv4()}-${image.name}`
  const filePath = path.join(process.cwd(), 'public/uploads', fileName)
  await writeFile(filePath, buffer)

  const imageUrl = `/uploads/${fileName}`

  const pool = await connectToDatabase()
  await pool.request()
    .input('title', title)
    .input('content', content)
    .input('image_url', imageUrl)
    .query(`
      INSERT INTO WEBSITE_DBF.dbo.NewsPosts (title, content, image_url)
      VALUES (@title, @content, @image_url)
    `)

  return NextResponse.json({ success: true })
}
