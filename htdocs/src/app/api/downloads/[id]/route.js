import { connectToDatabase } from '@/lib/db'

export async function PUT(req, context) {
    const { id } = await context.params // ✅ Await the params
    const body = await req.json()
  
    const pool = await connectToDatabase()
    await pool.request()
      .input('id', id)
      .input('name', body.name)
      .input('url', body.url)
      .input('size', body.size)
      .input('icon_type', body.icon_type)
      .query(`
        UPDATE WEBSITE_DBF.dbo.DownloadLinks
        SET name = @name, url = @url, size = @size, icon_type = @icon_type
        WHERE id = @id
      `)
  
    return Response.json({ success: true })
}

export async function DELETE(_, context) {
    const { id } = await context.params // ✅ Await the dynamic route params
  
    try {
      const pool = await connectToDatabase()
      await pool
        .request()
        .input('id', id)
        .query('DELETE FROM WEBSITE_DBF.dbo.DownloadLinks WHERE id = @id')
  
      return Response.json({ message: 'Link deleted' })
    } catch (err) {
      return Response.json({ error: err.message }, { status: 500 })
    }
  }
  
