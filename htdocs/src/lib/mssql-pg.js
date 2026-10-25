// Adaptador "mssql → PostgreSQL" para o site.
// O site foi escrito para o SQL Server (pacote `mssql`, T-SQL). Este arquivo oferece a mesma API (pool.request().input().query(),
// tagged templates, transações, tipos `sql.Int`…) por cima do PostgreSQL do jogo (banco `flyffweb`) e converte o T-SQL que o
// site usa (colchetes, `Banco.dbo.Tabela`, TOP, ISNULL, GETDATE, DATEADD/DATEDIFF/FORMAT, OUTER APPLY, OUTPUT INSERTED…).
// Esquemas: WEBSITE_DBF → `website`; ACCOUNT_DBF / CHARACTER_01_DBF / LOGGING_01_DBF → `legacy` (views sobre as tabelas do jogo,
// ver servers/common/db/migrations/008_legacy_views.sql). As colunas voltam com a caixa que o site escreveu no SQL
// (o PostgreSQL devolve tudo em minúsculas).
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import pg from 'pg'

// ---------- conexão ----------
const cfg = {
  host: process.env.PGHOST || 'localhost',
  port: Number(process.env.PGPORT || 5432),
  database: process.env.PGDATABASE || 'flyffweb',
  user: process.env.PGUSER || 'flyffweb_app',
}

// COUNT/SUM (bigint) e numeric viram número, como no SQL Server
pg.types.setTypeParser(20, (v) => Number(v))
pg.types.setTypeParser(1700, (v) => Number(v))

/** senha: PGPASSWORD ou o pgpass do PostgreSQL (nunca no código) */
function pgpassLookup() {
  const file = process.env.PGPASSFILE || (process.platform === 'win32' ? path.join(process.env.APPDATA || '', 'postgresql', 'pgpass.conf') : path.join(os.homedir(), '.pgpass'))
  if (!fs.existsSync(file)) return undefined
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (!line || line.startsWith('#')) continue
    const f = []
    let cur = ''
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]
      if (ch === '\\' && i + 1 < line.length) cur += line[++i]
      else if (ch === ':' && f.length < 4) { f.push(cur); cur = '' }
      else cur += ch
    }
    f.push(cur)
    if (f.length !== 5) continue
    const ok = (v, want) => v === '*' || v === want
    if (ok(f[0], cfg.host) && ok(f[1], String(cfg.port)) && ok(f[2], cfg.database) && ok(f[3], cfg.user)) return f[4]
  }
  return undefined
}

let pgPool = null
function getPgPool() {
  if (!pgPool) {
    pgPool = new pg.Pool({
      ...cfg,
      max: 10,
      password: async () => process.env.PGPASSWORD || pgpassLookup() || '',
      // o site só enxerga os esquemas dele e o legado
      options: '-c search_path=website,legacy',
    })
    pgPool.on('error', (e) => console.error('PostgreSQL:', e.message))
  }
  return pgPool
}

// ---------- tradução T-SQL → PostgreSQL ----------
const DB_SCHEMA = { website_dbf: 'website', account_dbf: 'legacy', character_01_dbf: 'legacy', logging_01_dbf: 'legacy' }

/** separa `texto` em pedaços fora/dentro de aspas simples; devolve o texto com marcadores no lugar das strings */
function hideStrings(text) {
  const lits = []
  const out = text.replace(/N?'(?:[^']|'')*'/g, (m) => {
    lits.push(m.startsWith('N') ? m.slice(1) : m)
    return `\u0001${lits.length - 1}\u0001`
  })
  return { out, lits }
}
const showStrings = (text, lits) => text.replace(/\u0001(\d+)\u0001/g, (_, i) => lits[Number(i)])

/** índice do ')' que fecha o '(' em `open` */
function closeParen(text, open) {
  let d = 0
  for (let i = open; i < text.length; i++) {
    if (text[i] === '(') d++
    else if (text[i] === ')' && --d === 0) return i
  }
  return -1
}

/** divide os argumentos no nível de cima (por vírgulas fora de parênteses) */
function splitArgs(s) {
  const out = []
  let d = 0, cur = ''
  for (const ch of s) {
    if (ch === '(') d++
    else if (ch === ')') d--
    if (ch === ',' && d === 0) { out.push(cur.trim()); cur = '' } else cur += ch
  }
  if (cur.trim() || out.length) out.push(cur.trim())
  return out
}

/** troca cada chamada NAME(args) por fn(args), de dentro para fora (a última ocorrência primeiro) */
function mapCall(text, name, fn) {
  const re = new RegExp(`\\b${name}\\s*\\(`, 'gi')
  for (;;) {
    let last = null, m
    re.lastIndex = 0
    while ((m = re.exec(text))) last = m
    if (!last) return text
    const open = last.index + last[0].length - 1
    const close = closeParen(text, open)
    if (close < 0) return text
    const repl = fn(splitArgs(text.slice(open + 1, close)))
    text = text.slice(0, last.index) + repl + text.slice(close + 1)
  }
}

const UNIT_SECONDS = { second: 1, minute: 60, hour: 3600, day: 86400, week: 604800 }
const FORMAT_TOKENS = [['yyyy', 'YYYY'], ['MM', 'MM'], ['dd', 'DD'], ['HH', 'HH24'], ['mm', 'MI'], ['ss', 'SS']]

function translate(sqlText) {
  const { out: hidden, lits } = hideStrings(sqlText)
  let t = hidden

  // Banco.dbo.Tabela → esquema.tabela ; dbo.Tabela → website.tabela
  t = t.replace(/\[?(\w+)\]?\s*\.\s*\[?dbo\]?\s*\.\s*\[?(\w+)\]?/gi, (_, db, tbl) => `${DB_SCHEMA[db.toLowerCase()] || 'website'}.${tbl}`)
  t = t.replace(/(?<![\w.])\[?dbo\]?\s*\.\s*\[?(\w+)\]?/gi, (_, tbl) => `website.${tbl}`)
  t = t.replace(/\[([^\]]+)\]/g, '$1')
  t = t.replace(/\bWITH\s*\(\s*(?:TABLOCKX|HOLDLOCK|NOLOCK|UPDLOCK|ROWLOCK|READPAST)(?:\s*,\s*\w+)*\s*\)/gi, '')

  // TOP n → LIMIT n (no fim do SELECT)
  for (;;) {
    const m = /\bSELECT\s+(DISTINCT\s+)?TOP\s*\(?\s*(\d+|@\w+)\s*\)?\s*/i.exec(t)
    if (!m) break
    const start = m.index + m[0].length
    let d = 0, end = t.length
    for (let i = start; i < t.length; i++) {
      if (t[i] === '(') d++
      else if (t[i] === ')') { if (d === 0) { end = i; break } d-- }
      else if (t[i] === ';' && d === 0) { end = i; break }
    }
    t = t.slice(0, m.index) + 'SELECT ' + (m[1] || '') + t.slice(start, end).replace(/\s+$/, '') + ` LIMIT ${m[2]} ` + t.slice(end)
  }

  t = t.replace(/\bGETDATE\s*\(\s*\)|\bSYSDATETIME\s*\(\s*\)/gi, 'now()')
  t = mapCall(t, 'ISNULL', (a) => `COALESCE(${a.join(', ')})`)
  t = mapCall(t, 'COUNT_BIG', (a) => `COUNT(${a.join(', ')})`)
  t = mapCall(t, 'LEN', (a) => `length(${a[0]})`)
  t = mapCall(t, 'CHAR', (a) => `chr(${a[0]})`)
  t = mapCall(t, 'DATEADD', (a) => {
    const unit = a[0].toLowerCase().replace(/s$/, '')
    if (unit in UNIT_SECONDS) return `(${a[2]}::timestamp + (${a[1]}) * interval '${UNIT_SECONDS[unit]} seconds')`
    return `(${a[2]}::timestamp + (${a[1]}) * interval '1 ${unit}')`
  })
  t = mapCall(t, 'DATEDIFF', (a) => {
    const unit = a[0].toLowerCase().replace(/s$/, '')
    const secs = `extract(epoch from (${a[2]}::timestamp - ${a[1]}::timestamp))`
    if (unit in UNIT_SECONDS) return `floor(${secs} / ${UNIT_SECONDS[unit]})::int`
    if (unit === 'month') return `((extract(year from ${a[2]}::timestamp) - extract(year from ${a[1]}::timestamp)) * 12 + extract(month from ${a[2]}::timestamp) - extract(month from ${a[1]}::timestamp))::int`
    return `floor(${secs} / 86400)::int`
  })
  t = mapCall(t, 'CONVERT', (a) => {
    if (['20', '120', '21', '121'].includes(a[2])) return `to_char(${a[1]}, 'YYYY-MM-DD HH24:MI:SS')`
    if (a[2] === '23') return `to_char(${a[1]}, 'YYYY-MM-DD')`
    return `CAST(${a[1]} AS ${a[0].replace(/^n?varchar\s*(\(.*\))?$/i, 'varchar')})`
  })
  t = mapCall(t, 'FORMAT', (a) => {
    let f = a[1] ? showStrings(a[1], lits) : "'YYYY-MM-DD'"
    for (const [from, to] of FORMAT_TOKENS) f = f.split(from).join(to)
    return `to_char(${a[0]}, ${f})`
  })

  // OUTER APPLY (...) alias → LEFT JOIN LATERAL (...) alias ON true
  for (;;) {
    const m = /\bOUTER\s+APPLY\s*\(/i.exec(t)
    if (!m) break
    const open = m.index + m[0].length - 1
    const close = closeParen(t, open)
    const alias = /^\s*(?:AS\s+)?(\w+)/i.exec(t.slice(close + 1))
    t = t.slice(0, m.index) + 'LEFT JOIN LATERAL ' + t.slice(open, close + 1) + (alias ? ` ${alias[1]} ON true` : ' ON true') + t.slice(close + 1 + (alias ? alias[0].length : 0))
  }

  // OUTPUT INSERTED.a, INSERTED.b (ou INSERTED.*) → RETURNING a, b (no fim)
  const out = /\bOUTPUT\s+((?:INSERTED\.(?:\w+|\*)\s*,?\s*)+)/i.exec(t)
  if (out) {
    const cols = out[1].replace(/INSERTED\./gi, '').trim().replace(/,\s*$/, '')
    t = (t.slice(0, out.index) + t.slice(out.index + out[0].length)).replace(/;?\s*$/, '') + ` RETURNING ${cols}`
  }

  t = t.replace(/\bNVARCHAR\b/gi, 'varchar').replace(/\bNCHAR\b/gi, 'char').replace(/\bDATETIME2?\b/gi, 'timestamp').replace(/\bAS\s+BIT\b/gi, 'AS boolean')
  return showStrings(t, lits)
}

// tipos do .input() que viram cast explícito: sem ele, `@data IS NULL` não diz ao PostgreSQL o tipo do parâmetro
const PARAM_CASTS = { DateTime: 'timestamp', DateTime2: 'timestamp', Date: 'date' }

/** @nome → $n (fora de strings) com a lista de valores na ordem */
function bindParams(text, inputs, types = new Map()) {
  const { out, lits } = hideStrings(text)
  const names = []
  const sql = out.replace(/@(\w+)/g, (_, name) => {
    let i = names.indexOf(name)
    if (i < 0) { names.push(name); i = names.length - 1 }
    const cast = PARAM_CASTS[types.get(name)]
    return cast ? `$${i + 1}::${cast}` : `$${i + 1}`
  })
  return { text: showStrings(sql, lits), values: names.map((n) => (inputs.has(n) ? inputs.get(n) : null)) }
}

/** a caixa que o site escreveu: primeiro token do SQL original com o mesmo nome em minúsculas */
function caseMap(sqlText) {
  const map = new Map()
  for (const m of sqlText.matchAll(/[A-Za-z_][A-Za-z0-9_]*/g)) if (!map.has(m[0].toLowerCase())) map.set(m[0].toLowerCase(), m[0])
  return map
}
// colunas do jogo/site cujo nome tem maiúsculas (vale para `SELECT *` e colunas sem aparecer no texto)
const KNOWN_CASE = new Map(['m_szName', 'm_nJob', 'm_nLevel', 'm_nMaximumLevel', 'm_idPlayer', 'm_dwGold', 'm_nMoney', 'm_szGuild', 'm_idGuild', 'TotalPlayTime', 'MultiServer', 'CreateTime', 'm_chLoginAuthority'].map((k) => [k.toLowerCase(), k]))

function shapeResult(res, original, tx) {
  const cases = caseMap(original)
  const keys = res.fields ? res.fields.map((f) => [f.name, cases.get(f.name) || KNOWN_CASE.get(f.name) || f.name]) : []
  const rename = keys.some(([a, b]) => a !== b)
  const rows = rename ? res.rows.map((r) => { const o = {}; for (const [a, b] of keys) o[b] = r[a]; return o }) : res.rows
  return { recordset: rows, recordsets: [rows], rows, rowsAffected: [res.rowCount ?? 0], output: {} }
}

// ---------- API do mssql ----------
const typeFn = (name) => { const f = (...args) => ({ type: name, args }); f.type = name; return f }
export const types = {
  Int: typeFn('Int'), BigInt: typeFn('BigInt'), SmallInt: typeFn('SmallInt'), TinyInt: typeFn('TinyInt'), Bit: typeFn('Bit'),
  VarChar: typeFn('VarChar'), NVarChar: typeFn('NVarChar'), Char: typeFn('Char'), NChar: typeFn('NChar'), Text: typeFn('Text'), NText: typeFn('NText'),
  DateTime: typeFn('DateTime'), DateTime2: typeFn('DateTime2'), Date: typeFn('Date'), Decimal: typeFn('Decimal'), Numeric: typeFn('Numeric'), Float: typeFn('Float'), Real: typeFn('Real'),
  UniqueIdentifier: typeFn('UniqueIdentifier'), MAX: 'max',
}

class Request {
  constructor(source) {
    this._source = source // pool ou transaction
    this._inputs = new Map()
    this._types = new Map()
    this.timeout = 0
  }
  input(name, a, b) {
    const typed = b !== undefined || !!(a && (a.type || typeof a === 'function'))
    const value = typed ? b : a
    this._inputs.set(name, value === undefined ? null : value)
    if (typed && a?.type) this._types.set(name, a.type)
    return this
  }
  output() { return this }
  async query(text, ...values) {
    let sqlText = text
    if (Array.isArray(text)) { // tagged template
      sqlText = text.reduce((acc, part, i) => acc + part + (i < values.length ? `@p${i}` : ''), '')
      values.forEach((v, i) => this._inputs.set(`p${i}`, v === undefined ? null : v))
    }
    const { text: bound, values: params } = bindParams(translate(sqlText), this._inputs, this._types)
    const client = this._source._client ? this._source._client : getPgPool()
    const res = await client.query(bound, params)
    return shapeResult(Array.isArray(res) ? res[res.length - 1] : res, sqlText)
  }
}

class Transaction {
  constructor(pool) { this._pool = pool; this._client = null }
  async begin() { this._client = await getPgPool().connect(); await this._client.query('BEGIN'); return this }
  async commit() { const c = this._client; this._client = null; if (c) { try { await c.query('COMMIT') } finally { c.release() } } }
  async rollback() { const c = this._client; this._client = null; if (c) { try { await c.query('ROLLBACK') } finally { c.release() } } }
  request() { return new Request(this) }
}

class Pool {
  constructor() { this.connected = true }
  request() { return new Request(this) }
  transaction() { return new Transaction(this) }
  query(text, ...values) { return new Request(this).query(text, ...values) }
  async connect() { await getPgPool().query('SELECT 1'); return this }
  on() { return this }
  async close() {}
}

const sql = {
  ...types, Request, Transaction, ConnectionPool: Pool,
  ISOLATION_LEVEL: { READ_COMMITTED: 'READ COMMITTED', SERIALIZABLE: 'SERIALIZABLE', REPEATABLE_READ: 'REPEATABLE READ', READ_UNCOMMITTED: 'READ UNCOMMITTED' },
  getPool: () => new Pool(),
}

export { Request, Transaction, Pool as ConnectionPool }
export const getPool = () => getPgPool()
export const __translate = translate // para testes
export default sql
