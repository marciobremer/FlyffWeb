import { connectToDatabase } from '@/lib/db'

export async function GET() {
  try {
    const pool = await connectToDatabase()
    const result = await pool.request().query('SELECT * FROM WEBSITE_DBF.dbo.DownloadLinks ORDER BY id DESC')
    return Response.json(result.recordset)
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}

export async function POST(req) {
  try {
    const { name, url, size, icon_type } = await req.json()
    const pool = await connectToDatabase()
    await pool
      .request()
      .input('name', name)
      .input('url', url)
      .input('size', size)
      .input('icon_type', icon_type || 'default')
      .query(`INSERT INTO WEBSITE_DBF.dbo.DownloadLinks (name, url, size, icon_type) VALUES (@name, @url, @size, @icon_type)`)

    return Response.json({ message: 'Link added successfully' }, { status: 201 })
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}
