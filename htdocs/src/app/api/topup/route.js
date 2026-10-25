export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { connectToDatabase } from '@/lib/db'
import { writeFile, mkdir } from 'fs/promises'
import { v4 as uuidv4 } from 'uuid'
import path from 'path'
import { cookies } from 'next/headers'

async function getAdminUser() {
  const cookieStore = await cookies()
  const session = cookieStore.get('flyff_session')

  if (!session?.value) {
    return { ok: false, error: 'Não autorizado', status: 401 }
  }

  const parts = session.value.split('|')
  if (parts.length < 2) {
    return { ok: false, error: 'Sessão inválida', status: 401 }
  }

  const email = parts[0]
  const pool = await connectToDatabase()

  const userResult = await pool.request()
    .input('email', email)
    .query(`
      SELECT username AS email, CASE WHEN authority = 'Z' THEN 'super' ELSE 'user' END AS role
      FROM public.accounts
      WHERE lower(username) = lower(@email)
    `)

  const user = userResult.recordset[0]

  if (!user) {
    return { ok: false, error: 'Usuário não encontrado', status: 404 }
  }

  const normalizedRole =
    typeof user.role === 'string' ? user.role.trim().toLowerCase() : 'user'

  if (normalizedRole !== 'super') {
    return { ok: false, error: 'Não autorizado', status: 403 }
  }

  return { ok: true, pool }
}

function normalizePointType(value, fallbackCategory = '') {
  const raw = String(value || '').trim().toLowerCase()
  const category = String(fallbackCategory || '').trim().toLowerCase()

  if (raw === 'vote' || category === 'vote') return 'vote'
  return 'donate'
}

export async function GET() {
  try {
    const pool = await connectToDatabase()
    const result = await pool.request().query(`
      SELECT
        id,
        ISNULL(name, '') AS name,
        ISNULL(description, '') AS description,
        CAST(ISNULL(price, 0) AS DECIMAL(18, 2)) AS price,
        ISNULL(points, 0) AS points,
        LOWER(ISNULL(points_type, CASE WHEN category = 'vote' THEN 'vote' ELSE 'donate' END)) AS points_type,
        ISNULL(category, LOWER(ISNULL(points_type, 'donate'))) AS category,
        ISNULL(is_on_sale, 0) AS is_on_sale,
        ISNULL(sale_percentage, 0) AS sale_percentage,
        ISNULL(is_active, 1) AS is_active,
        image_url,
        created_at,
        updated_at
      FROM [WEBSITE_DBF].[dbo].[topup_items]
      WHERE ISNULL(is_active, 1) = 1
      ORDER BY
        CASE WHEN LOWER(ISNULL(points_type, category)) IN ('donate', 'cash') THEN 1 ELSE 2 END,
        price ASC,
        id DESC
    `)

    return NextResponse.json(result.recordset.map((item) => ({
      ...item,
      price: Number(item.price),
      points: Number(item.points),
      points_type: normalizePointType(item.points_type, item.category),
      category: normalizePointType(item.points_type, item.category),
      is_on_sale: Boolean(item.is_on_sale),
      sale_percentage: Number(item.sale_percentage || 0),
      is_active: Boolean(item.is_active)
    })))
  } catch (error) {
    console.error('[TOPUP GET ERROR]', error)
    return NextResponse.json({ error: 'Não foi possível carregar os pacotes da loja' }, { status: 500 })
  }
}

export async function POST(request) {
  try {
    const adminCheck = await getAdminUser()
    if (!adminCheck.ok) {
      return NextResponse.json({ error: adminCheck.error }, { status: adminCheck.status })
    }

    const pool = adminCheck.pool
    const formData = await request.formData()

    const name = String(formData.get('name') || '').trim()
    const description = String(formData.get('description') || '').trim()
    const price = Number(formData.get('price'))
    const points = Number(formData.get('points'))
    const pointsType = normalizePointType(formData.get('pointsType'), formData.get('category'))
    const category = pointsType
    const isOnSale = formData.get('isOnSale') === 'true'
    const salePercentageRaw = formData.get('salePercentage')
    const salePercentage = salePercentageRaw !== null && salePercentageRaw !== '' ? Number(salePercentageRaw) : 0
    const image = formData.get('image')

    if (!name || !description) {
      return NextResponse.json({ error: 'Nome e descrição são obrigatórios.' }, { status: 400 })
    }

    if (!Number.isFinite(price) || price <= 0) {
      return NextResponse.json({ error: 'Preço inválido.' }, { status: 400 })
    }

    if (!Number.isFinite(points) || points <= 0 || !Number.isInteger(points)) {
      return NextResponse.json({ error: 'O número de pontos deve ser um inteiro positivo.' }, { status: 400 })
    }

    if (salePercentage !== null && (!Number.isFinite(salePercentage) || salePercentage < 0 || salePercentage > 100)) {
      return NextResponse.json({ error: 'Porcentagem de promoção inválida.' }, { status: 400 })
    }

    let imageUrl = null

    if (image && typeof image === 'object' && image.size > 0) {
      const uploadDir = path.join(process.cwd(), 'public', 'uploads')
      await mkdir(uploadDir, { recursive: true })

      const safeName = String(image.name || 'image').replace(/[^a-zA-Z0-9._-]/g, '_')
      const buffer = Buffer.from(await image.arrayBuffer())
      const fileName = `${uuidv4()}-${safeName}`
      const filePath = path.join(uploadDir, fileName)

      await writeFile(filePath, buffer)
      imageUrl = `/uploads/${fileName}`
    }

    const result = await pool.request()
      .input('name', name)
      .input('description', description)
      .input('price', price)
      .input('points', points)
      .input('pointsType', pointsType)
      .input('category', category)
      .input('isOnSale', isOnSale ? 1 : 0)
      .input('salePercentage', salePercentage)
      .input('imageUrl', imageUrl)
      .query(`
        INSERT INTO [WEBSITE_DBF].[dbo].[topup_items] (
          name,
          description,
          price,
          points,
          points_type,
          category,
          is_on_sale,
          sale_percentage,
          is_active,
          image_url,
          created_at,
          updated_at
        )
        OUTPUT INSERTED.*
        VALUES (
          @name,
          @description,
          @price,
          @points,
          @pointsType,
          @category,
          @isOnSale,
          @salePercentage,
          1,
          @imageUrl,
          GETDATE(),
          GETDATE()
        )
      `)

    return NextResponse.json(result.recordset[0])
  } catch (error) {
    console.error('[TOPUP POST ERROR]', error)
    return NextResponse.json({ error: 'Não foi possível criar o pacote da loja' }, { status: 500 })
  }
}
