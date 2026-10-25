import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';

/**
 * Acesso ao banco do jogo web (PostgreSQL `flyffweb`). Conexão por variáveis padrão do PostgreSQL, com padrões locais:
 * PGHOST=localhost PGPORT=5432 PGDATABASE=flyffweb PGUSER=flyffweb_app. A senha NÃO fica no código: vem de PGPASSWORD ou
 * do arquivo do PostgreSQL (`%APPDATA%\postgresql\pgpass.conf` no Windows, `~/.pgpass` no Linux, ou PGPASSFILE).
 * Todo SQL do servidor passa por aqui.
 */
const cfg = {
  host: process.env.PGHOST ?? 'localhost',
  port: Number(process.env.PGPORT ?? 5432),
  database: process.env.PGDATABASE ?? 'flyffweb',
  user: process.env.PGUSER ?? 'flyffweb_app',
};

/** Linha `host:porta:banco:usuário:senha` do pgpass que casa com a conexão (`*` = qualquer; `\:` e `\\` escapados). */
function pgpassLookup(): string | undefined {
  const file = process.env.PGPASSFILE
    ?? (process.platform === 'win32' ? path.join(process.env.APPDATA ?? '', 'postgresql', 'pgpass.conf') : path.join(os.homedir(), '.pgpass'));
  if (!fs.existsSync(file)) return undefined;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (!line || line.startsWith('#')) continue;
    const f: string[] = [];
    let cur = '';
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '\\' && i + 1 < line.length) cur += line[++i];
      else if (ch === ':' && f.length < 4) { f.push(cur); cur = ''; }
      else cur += ch;
    }
    f.push(cur);
    if (f.length !== 5) continue;
    const ok = (v: string, want: string) => v === '*' || v === want;
    if (ok(f[0], cfg.host) && ok(f[1], String(cfg.port)) && ok(f[2], cfg.database) && ok(f[3], cfg.user)) return f[4];
  }
  return undefined;
}

export const pool = new pg.Pool({ ...cfg, max: 10, password: async () => process.env.PGPASSWORD ?? pgpassLookup() ?? '' });

/** contador de idas ao banco (cada consulta = uma ida), para o painel e para medir otimizações */
export const dbCounters = { queries: 0, transactions: 0 };

export const query = <R extends pg.QueryResultRow = pg.QueryResultRow>(text: string, params?: unknown[]) => { dbCounters.queries++; return pool.query<R>(text, params); };

/** Executa `fn` numa transação (BEGIN/COMMIT, ROLLBACK em erro). */
export async function transaction<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  dbCounters.transactions++;
  const original = c.query;
  const counted = original.bind(c) as (...x: unknown[]) => unknown;
  c.query = ((...a: unknown[]) => { dbCounters.queries++; return counted(...a); }) as typeof c.query;
  try {
    await c.query('BEGIN');
    const r = await fn(c);
    await c.query('COMMIT');
    return r;
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally { c.query = original; c.release(); }
}
