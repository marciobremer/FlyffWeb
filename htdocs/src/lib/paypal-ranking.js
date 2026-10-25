import { cookies } from 'next/headers'
import { connectToDatabase, sql } from '@/lib/db'

const VALID_PERIODS = new Set(['current_month', 'all', 'custom'])
const MAX_LIMIT = 100

function pad2(value) {
  return String(value).padStart(2, '0')
}

function parseDateOnly(value) {
  const raw = String(value || '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null

  const date = new Date(`${raw}T00:00:00.000Z`)
  if (Number.isNaN(date.getTime())) return null

  return date
}

function addDays(date, days) {
  const next = new Date(date.getTime())
  next.setUTCDate(next.getUTCDate() + days)
  return next
}

export function normalizeText(value, maxLength = 255) {
  return String(value || '').trim().slice(0, maxLength)
}

export function normalizePositiveInt(value, fallback = 0) {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0) return fallback
  return parsed
}

export function normalizeRankingPeriod(searchParamsLike = {}) {
  const getter = typeof searchParamsLike?.get === 'function'
    ? (key) => searchParamsLike.get(key)
    : (key) => searchParamsLike?.[key]

  const rawPeriod = String(getter('period') || 'current_month').trim().toLowerCase()
  const period = VALID_PERIODS.has(rawPeriod) ? rawPeriod : 'current_month'
  const now = new Date()

  if (period === 'all') {
    return {
      period: 'all',
      periodKey: 'all',
      label: 'Desde o início',
      startDate: null,
      endDateExclusive: null,
      startDateText: '',
      endDateText: ''
    }
  }

  if (period === 'custom') {
    const startDate = parseDateOnly(getter('start'))
    const endDate = parseDateOnly(getter('end'))

    if (!startDate || !endDate || startDate.getTime() > endDate.getTime()) {
      throw new Error('Período personalizado inválido')
    }

    const startText = startDate.toISOString().slice(0, 10)
    const endText = endDate.toISOString().slice(0, 10)

    return {
      period: 'custom',
      periodKey: `custom:${startText}:${endText}`,
      label: `${startText} au ${endText}`,
      startDate,
      endDateExclusive: addDays(endDate, 1),
      startDateText: startText,
      endDateText: endText
    }
  }

  const year = now.getUTCFullYear()
  const month = now.getUTCMonth()
  const startDate = new Date(Date.UTC(year, month, 1, 0, 0, 0))
  const endDateExclusive = new Date(Date.UTC(year, month + 1, 1, 0, 0, 0))
  const monthKey = `${year}-${pad2(month + 1)}`

  return {
    period: 'current_month',
    periodKey: monthKey,
    label: `Mês atual (${monthKey})`,
    startDate,
    endDateExclusive,
    startDateText: startDate.toISOString().slice(0, 10),
    endDateText: addDays(endDateExclusive, -1).toISOString().slice(0, 10)
  }
}

export async function requireSuperAdmin() {
  const cookieStore = await cookies()
  const session = cookieStore.get('flyff_session')

  if (!session?.value) {
    return { ok: false, status: 401, error: 'Não autorizado' }
  }

  const parts = session.value.split('|')
  const email = normalizeText(parts[0], 255)

  if (!email) {
    return { ok: false, status: 401, error: 'Sessão inválida' }
  }

  const pool = await connectToDatabase()
  const result = await pool.request()
    .input('email', sql.NVarChar(255), email)
    .query(`
      SELECT TOP 1 username AS email, CASE WHEN authority = 'Z' THEN 'super' ELSE 'user' END AS role
      FROM public.accounts
      WHERE lower(username) = lower(@email)
    `)

  const user = result.recordset[0]
  const role = String(user?.role || '').trim().toLowerCase()

  if (!user || role !== 'super') {
    return { ok: false, status: 403, error: 'Não autorizado' }
  }

  return { ok: true, pool, email: user.email }
}

export async function getPayPalRanking(pool, { periodInfo, limit = 50, includeRewards = false }) {
  const safeLimit = Math.min(Math.max(normalizePositiveInt(limit, 50), 1), MAX_LIMIT)
  const request = pool.request()
    .input('limit', sql.Int, safeLimit)
    .input('periodKey', sql.NVarChar(80), periodInfo.periodKey)
    .input('startDate', sql.DateTime, periodInfo.startDate)
    .input('endDateExclusive', sql.DateTime, periodInfo.endDateExclusive)

  const rewardJoin = includeRewards
    ? `
      LEFT JOIN [WEBSITE_DBF].[dbo].[paypal_ranking_rewards] rw
        ON rw.period_key = @periodKey
       AND rw.rank_position = r.rank_position
       AND LTRIM(RTRIM(rw.character_name)) = r.character_name
    `
    : ''

  const rewardSelect = includeRewards
    ? `,
        rw.id AS reward_id,
        rw.item_id AS reward_item_id,
        rw.item_count AS reward_item_count,
        rw.status AS reward_status,
        rw.credited_at AS reward_credited_at,
        rw.credited_by_email AS reward_credited_by_email`
    : ''

  const result = await request.query(`
    WITH paid AS (
      SELECT
        LTRIM(RTRIM(character_name)) AS character_name,
        MAX(character_id) AS character_id,
        SUM(CAST(amount AS DECIMAL(18, 2))) AS total_amount,
        SUM(CAST(points AS BIGINT)) AS total_points,
        COUNT_BIG(*) AS total_orders,
        MIN(COALESCE(paid_at, credited_at, updated_at, created_at)) AS first_payment_at,
        MAX(COALESCE(paid_at, credited_at, updated_at, created_at)) AS last_payment_at
      FROM [WEBSITE_DBF].[dbo].[paypal_cashshop_orders]
      WHERE status = 'completed'
        AND credited = 1
        AND character_name IS NOT NULL
        AND LTRIM(RTRIM(character_name)) <> ''
        AND (@startDate IS NULL OR COALESCE(paid_at, credited_at, updated_at, created_at) >= @startDate)
        AND (@endDateExclusive IS NULL OR COALESCE(paid_at, credited_at, updated_at, created_at) < @endDateExclusive)
      GROUP BY LTRIM(RTRIM(character_name))
    ), ranked AS (
      SELECT
        ROW_NUMBER() OVER (
          ORDER BY total_amount DESC, total_points DESC, total_orders DESC, character_name ASC
        ) AS rank_position,
        character_name,
        character_id,
        total_amount,
        total_points,
        total_orders,
        first_payment_at,
        last_payment_at
      FROM paid
    )
    SELECT TOP (@limit)
      r.rank_position,
      r.character_name,
      r.character_id,
      r.total_amount,
      r.total_points,
      r.total_orders,
      r.first_payment_at,
      r.last_payment_at
      ${rewardSelect}
    FROM ranked r
    ${rewardJoin}
    ORDER BY r.rank_position ASC
  `)

  return result.recordset.map((row) => ({
    rank_position: Number(row.rank_position),
    character_name: normalizeText(row.character_name, 32),
    character_id: row.character_id !== null && row.character_id !== undefined ? String(row.character_id).trim() : '',
    total_amount: Number(row.total_amount || 0),
    total_points: Number(row.total_points || 0),
    total_orders: Number(row.total_orders || 0),
    first_payment_at: row.first_payment_at,
    last_payment_at: row.last_payment_at,
    reward_id: row.reward_id || null,
    reward_item_id: row.reward_item_id || null,
    reward_item_count: row.reward_item_count || null,
    reward_status: row.reward_status || null,
    reward_credited_at: row.reward_credited_at || null,
    reward_credited_by_email: row.reward_credited_by_email || null
  }))
}

async function resolveCharacterForReward(transaction, characterName) {
  const result = await new sql.Request(transaction)
    .input('characterName', sql.NVarChar(32), normalizeText(characterName, 32))
    .query(`
      SELECT TOP 1
        CONVERT(NVARCHAR(32), m_idPlayer) AS m_idPlayer,
        LTRIM(RTRIM(m_szName)) AS m_szName,
        ISNULL(serverindex, 0) AS serverindex
      FROM [CHARACTER_01_DBF].[dbo].[CHARACTER_TBL] WITH (UPDLOCK, HOLDLOCK)
      WHERE LTRIM(RTRIM(m_szName)) = @characterName
      ORDER BY m_idPlayer DESC
    `)

  const character = result.recordset[0]

  if (!character) {
    throw new Error('Personagem não encontrado em CHARACTER_TBL')
  }

  return {
    idPlayer: normalizeText(character.m_idPlayer, 32),
    name: normalizeText(character.m_szName, 32),
    serverIndex: Number(character.serverindex || 0)
  }
}

async function getMailColumns(transaction) {
  const result = await new sql.Request(transaction).query(`
    SELECT
      c.name,
      c.is_nullable,
      c.is_identity,
      CASE WHEN dc.object_id IS NULL THEN 0 ELSE 1 END AS has_default
    FROM [CHARACTER_01_DBF].sys.columns c
    INNER JOIN [CHARACTER_01_DBF].sys.objects o
      ON o.object_id = c.object_id
    INNER JOIN [CHARACTER_01_DBF].sys.schemas s
      ON s.schema_id = o.schema_id
    LEFT JOIN [CHARACTER_01_DBF].sys.default_constraints dc
      ON dc.parent_object_id = c.object_id
     AND dc.parent_column_id = c.column_id
    WHERE s.name = 'dbo'
      AND o.name = 'MAIL_TBL'
    ORDER BY c.column_id ASC
  `)

  if (result.recordset.length === 0) {
    throw new Error('MAIL_TBL não encontrada em CHARACTER_01_DBF')
  }

  return result.recordset
}

async function getNextMailId(transaction) {
  const result = await new sql.Request(transaction).query(`
    SELECT ISNULL(MAX(CAST(nMail AS BIGINT)), 0) + 1 AS nextMailId
    FROM [CHARACTER_01_DBF].[dbo].[MAIL_TBL] WITH (TABLOCKX, HOLDLOCK)
  `)

  return Number(result.recordset[0]?.nextMailId || 1)
}

async function insertRewardMail(transaction, { characterId, characterName, itemId, itemCount, rankPosition, periodLabel }) {
  const columns = await getMailColumns(transaction)
  const columnNames = new Set(columns.map((column) => String(column.name)))
  const insertMap = new Map()

  const now = new Date()
  const nowSeconds = Math.floor(now.getTime() / 1000)
  const title = normalizeText(`Recompensa ranking PayPal #${rankPosition}`, 128)
  const message = normalizeText(
    `Parabens ${characterName}, voce recebeu sua recompensa do ranking PayPal (${periodLabel}).`,
    1000
  )

  const addIfExists = (columnName, paramName, type, value) => {
    if (columnNames.has(columnName)) {
      insertMap.set(columnName, { paramName, type, value })
    }
  }

  // Format valide pour ta MAIL_TBL Flyff.
  addIfExists('serverindex', 'serverindex', sql.NVarChar(2), '01')

  if (columnNames.has('nMail')) {
    addIfExists('nMail', 'nMail', sql.BigInt, await getNextMailId(transaction))
  }

  addIfExists('idReceiver', 'idReceiver', sql.NVarChar(7), characterId)
  addIfExists('idSender', 'idSender', sql.NVarChar(7), '0000001')
  addIfExists('nGold', 'nGold', sql.BigInt, 0)
  addIfExists('tmCreate', 'tmCreate', sql.Int, nowSeconds)
  addIfExists('byRead', 'byRead', sql.Int, 0)
  addIfExists('szTitle', 'szTitle', sql.NVarChar(512), title)
  addIfExists('szText', 'szText', sql.NVarChar(1024), message)
  addIfExists('dwItemId', 'dwItemId', sql.Int, itemId)
  addIfExists('nItemNum', 'nItemNum', sql.Int, itemCount)

  addIfExists('nHitPoint', 'nHitPoint', sql.Int, 0)
  addIfExists('nMaterial', 'nMaterial', sql.Int, 0)
  addIfExists('byFlag', 'byFlag', sql.Int, 0)
  addIfExists('dwSerialNumber', 'dwSerialNumber', sql.Int, 0)
  addIfExists('nOption', 'nOption', sql.Int, 0)
  addIfExists('bItemResist', 'bItemResist', sql.Int, 0)
  addIfExists('nResistAbilityOption', 'nResistAbilityOption', sql.Int, 0)
  addIfExists('nResistSMItemId', 'nResistSMItemId', sql.Int, 0)
  addIfExists('dwKeepTime', 'dwKeepTime', sql.Int, 0)
  addIfExists('nRandomOptItemId', 'nRandomOptItemId', sql.BigInt, 0)
  addIfExists('nPiercedSize', 'nPiercedSize', sql.Int, 0)

  addIfExists('dwItemId1', 'dwItemId1', sql.Int, 0)
  addIfExists('dwItemId2', 'dwItemId2', sql.Int, 0)
  addIfExists('dwItemId3', 'dwItemId3', sql.Int, 0)
  addIfExists('dwItemId4', 'dwItemId4', sql.Int, 0)
  addIfExists('dwItemId5', 'dwItemId5', sql.Int, 0)
  addIfExists('dwItemId6', 'dwItemId6', sql.Int, 0)
  addIfExists('dwItemId7', 'dwItemId7', sql.Int, 0)
  addIfExists('dwItemId8', 'dwItemId8', sql.Int, 0)
  addIfExists('dwItemId9', 'dwItemId9', sql.Int, 0)
  addIfExists('dwItemId10', 'dwItemId10', sql.Int, 0)

  addIfExists('SendDt', 'SendDt', sql.DateTime, now)
  addIfExists('ReadDt', 'ReadDt', sql.DateTime, null)
  addIfExists('GetGoldDt', 'GetGoldDt', sql.DateTime, null)
  addIfExists('DeleteDt', 'DeleteDt', sql.DateTime, null)
  addIfExists('ItemFlag', 'ItemFlag', sql.Int, 0)
  addIfExists('ItemReceiveDt', 'ItemReceiveDt', sql.DateTime, null)
  addIfExists('GoldFlag', 'GoldFlag', sql.Int, 0)

  addIfExists('bPet', 'bPet', sql.Int, 0)
  addIfExists('nKind', 'nKind', sql.Int, 0)
  addIfExists('nLevel', 'nLevel', sql.Int, 0)
  addIfExists('dwExp', 'dwExp', sql.Int, 0)
  addIfExists('wEnergy', 'wEnergy', sql.Int, 0)
  addIfExists('wLife', 'wLife', sql.Int, 0)
  addIfExists('anAvailLevel_D', 'anAvailLevel_D', sql.Int, 0)
  addIfExists('anAvailLevel_C', 'anAvailLevel_C', sql.Int, 0)
  addIfExists('anAvailLevel_B', 'anAvailLevel_B', sql.Int, 0)
  addIfExists('anAvailLevel_A', 'anAvailLevel_A', sql.Int, 0)
  addIfExists('anAvailLevel_S', 'anAvailLevel_S', sql.Int, 0)

  const requiredColumns = columns
    .filter((column) => !column.is_nullable && !column.is_identity && !column.has_default)
    .map((column) => String(column.name))
    .filter((name) => !insertMap.has(name))

  if (requiredColumns.length > 0) {
    throw new Error(`MAIL_TBL ainda tem colunas obrigatórias não tratadas: ${requiredColumns.join(', ')}`)
  }

  const requiredBase = ['serverindex', 'nMail', 'idReceiver', 'idSender', 'tmCreate', 'szTitle', 'szText', 'dwItemId', 'nItemNum', 'SendDt']
  const missingBase = requiredBase.filter((name) => !insertMap.has(name))

  if (missingBase.length > 0) {
    throw new Error(`MAIL_TBL não tem as colunas esperadas: ${missingBase.join(', ')}`)
  }

  const insertColumns = Array.from(insertMap.keys())
  const request = new sql.Request(transaction)

  for (const info of insertMap.values()) {
    request.input(info.paramName, info.type, info.value)
  }

  await request.query(`
    INSERT INTO [CHARACTER_01_DBF].[dbo].[MAIL_TBL]
      (${insertColumns.map((name) => `[${name}]`).join(', ')})
    VALUES
      (${insertColumns.map((name) => `@${insertMap.get(name).paramName}`).join(', ')})
  `)
}

export async function creditRankingReward(pool, {
  adminEmail,
  periodInfo,
  rankPosition,
  itemId,
  itemCount,
  notes
}) {
  const rank = normalizePositiveInt(rankPosition, 0)
  const safeItemId = normalizePositiveInt(itemId, 0)
  const safeItemCount = Math.min(normalizePositiveInt(itemCount, 1), 9999)

  if (rank < 1 || rank > 3) {
    throw new Error('Só as posições 1, 2 e 3 podem ser recompensadas')
  }

  if (!safeItemId) {
    throw new Error('ItemID inválido')
  }

  const ranking = await getPayPalRanking(pool, {
    periodInfo,
    limit: 3,
    includeRewards: true
  })

  const target = ranking.find((row) => row.rank_position === rank)

  if (!target) {
    throw new Error(`Nenhum jogador encontrado na posição ${rank}`)
  }

  if (target.reward_id) {
    return {
      alreadyCredited: true,
      characterName: target.character_name,
      rankPosition: target.rank_position,
      itemId: target.reward_item_id,
      itemCount: target.reward_item_count,
      status: target.reward_status
    }
  }

  const transaction = new sql.Transaction(pool)

  try {
    await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE)

    const existing = await new sql.Request(transaction)
      .input('periodKey', sql.NVarChar(80), periodInfo.periodKey)
      .input('rankPosition', sql.Int, rank)
      .query(`
        SELECT TOP 1 id, character_name, item_id, item_count, status
        FROM [WEBSITE_DBF].[dbo].[paypal_ranking_rewards] WITH (UPDLOCK, HOLDLOCK)
        WHERE period_key = @periodKey
          AND rank_position = @rankPosition
      `)

    if (existing.recordset[0]) {
      await transaction.commit()
      return {
        alreadyCredited: true,
        characterName: existing.recordset[0].character_name,
        rankPosition: rank,
        itemId: existing.recordset[0].item_id,
        itemCount: existing.recordset[0].item_count,
        status: existing.recordset[0].status
      }
    }

    const character = await resolveCharacterForReward(transaction, target.character_name)

    await insertRewardMail(transaction, {
      characterId: character.idPlayer,
      characterName: character.name,
      itemId: safeItemId,
      itemCount: safeItemCount,
      rankPosition: rank,
      periodLabel: periodInfo.label
    })

    const insertReward = await new sql.Request(transaction)
      .input('periodKey', sql.NVarChar(80), periodInfo.periodKey)
      .input('periodLabel', sql.NVarChar(100), periodInfo.label)
      .input('periodStart', sql.DateTime, periodInfo.startDate)
      .input('periodEndExclusive', sql.DateTime, periodInfo.endDateExclusive)
      .input('rankPosition', sql.Int, rank)
      .input('characterName', sql.NVarChar(32), character.name)
      .input('characterId', sql.NVarChar(32), character.idPlayer)
      .input('totalAmount', sql.Decimal(18, 2), target.total_amount)
      .input('totalPoints', sql.BigInt, target.total_points)
      .input('totalOrders', sql.BigInt, target.total_orders)
      .input('itemId', sql.Int, safeItemId)
      .input('itemCount', sql.Int, safeItemCount)
      .input('creditedByEmail', sql.NVarChar(255), normalizeText(adminEmail, 255))
      .input('notes', sql.NVarChar(500), normalizeText(notes, 500))
      .query(`
        INSERT INTO [WEBSITE_DBF].[dbo].[paypal_ranking_rewards] (
          period_key,
          period_label,
          period_start,
          period_end_exclusive,
          rank_position,
          character_name,
          character_id,
          total_amount_at_credit,
          total_points_at_credit,
          total_orders_at_credit,
          item_id,
          item_count,
          status,
          mail_inserted,
          credited_by_email,
          credited_at,
          notes
        )
        OUTPUT INSERTED.*
        VALUES (
          @periodKey,
          @periodLabel,
          @periodStart,
          @periodEndExclusive,
          @rankPosition,
          @characterName,
          @characterId,
          @totalAmount,
          @totalPoints,
          @totalOrders,
          @itemId,
          @itemCount,
          'credited',
          1,
          @creditedByEmail,
          GETDATE(),
          @notes
        )
      `)

    await transaction.commit()

    const reward = insertReward.recordset[0]

    return {
      alreadyCredited: false,
      rewardId: reward.id,
      characterName: reward.character_name,
      rankPosition: reward.rank_position,
      itemId: reward.item_id,
      itemCount: reward.item_count,
      status: reward.status
    }
  } catch (error) {
    try {
      if (transaction._aborted !== true) {
        await transaction.rollback()
      }
    } catch {
      // Ignore rollback errors.
    }

    throw error
  }
}