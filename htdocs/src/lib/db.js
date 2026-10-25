// Conexão do site com o banco: PostgreSQL (banco `flyffweb` do jogo) pelo adaptador `mssql-pg.js`, que imita a API do `mssql`.
// O resto do site continua usando `connectToDatabase()` e `sql` como antes.
import sql, { ConnectionPool } from './mssql-pg'

let pool = null

export const connectToDatabase = async () => {
  if (!pool) pool = new ConnectionPool()
  try {
    await pool.connect()
    return pool
  } catch (error) {
    console.error('❌ Database connection failed:', error.message || error)
    throw new Error('Database connection failed')
  }
}

export const closePool = async () => {
  if (pool) await pool.close()
  pool = null
}

export { sql }
