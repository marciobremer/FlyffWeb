import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { fileURLToPath } from 'node:url';

/**
 * Acesso ao banco do jogo web (PostgreSQL `flyffweb`). Conexão por variáveis padrão do PostgreSQL, com padrões locais:
 * PGHOST=localhost PGPORT=5432 PGDATABASE=flyffweb PGUSER=flyffweb_app. A senha NÃO fica no código: vem de PGPASSWORD ou
 * do arquivo do PostgreSQL (`%APPDATA%\postgresql\pgpass.conf` no Windows, `~/.pgpass` no Linux, ou PGPASSFILE).
 * Todo SQL do servidor passa por aqui.
 * O painel admin (Database → Conexão) grava host/porta/banco/usuário em `data/database.json`; as variáveis PG* do ambiente
 * (Docker) continuam valendo por cima dele.
 */
export const DB_CONFIG_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'data', 'database.json');
export interface DbConnection { host: string; port: number; database: string; user: string }
function fileConfig(): Partial<DbConnection> {
  try { const j = JSON.parse(fs.readFileSync(DB_CONFIG_FILE, 'utf8')) as Partial<DbConnection>; return j && typeof j === 'object' ? j : {}; } catch { return {}; }
}
const file = fileConfig();
const cfg: DbConnection = {
  host: process.env.PGHOST ?? file.host ?? 'localhost',
  port: Number(process.env.PGPORT ?? file.port ?? 5432),
  database: process.env.PGDATABASE ?? file.database ?? 'flyffweb',
  user: process.env.PGUSER ?? file.user ?? 'flyffweb_app',
};
/** quais campos vêm do ambiente (o painel não consegue trocar esses) */
export const dbEnvFixed = { host: !!process.env.PGHOST, port: !!process.env.PGPORT, database: !!process.env.PGDATABASE, user: !!process.env.PGUSER, password: !!process.env.PGPASSWORD };

/** arquivo de senhas do PostgreSQL (PGPASSFILE, `%APPDATA%\postgresql\pgpass.conf` ou `~/.pgpass`) */
export function pgpassFile() {
  return process.env.PGPASSFILE ?? (process.platform === 'win32' ? path.join(process.env.APPDATA ?? '', 'postgresql', 'pgpass.conf') : path.join(os.homedir(), '.pgpass'));
}

/** Linha `host:porta:banco:usuário:senha` do pgpass que casa com a conexão (`*` = qualquer; `\:` e `\\` escapados). */
function pgpassLookup(): string | undefined {
  const file = pgpassFile();
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

/** o servidor do jogo se identifica nas conexões (o painel mostra quem está usando o banco); os outros usam PGAPPNAME */
const appName = /servers[\\/]main\.ts$/.test(process.argv[1] ?? '') && !process.env.PGAPPNAME ? 'flyffweb-game' : undefined;
const makePool = () => new pg.Pool({ ...cfg, ...(appName ? { application_name: appName } : {}), max: 10, password: async () => process.env.PGPASSWORD ?? pgpassLookup() ?? '' });
/** pool de conexões; `reconfigureDb` troca por um novo (quem importa `pool` enxerga o novo: export vivo) */
export let pool = makePool();

/**
 * Painel admin: grava a conexão nova em data/database.json, a senha do usuário do jogo no pgpass.conf (se informada) e passa
 * a usar a conexão nova neste processo. O servidor do jogo pega a conexão nova ao ser iniciado de novo.
 */
export function reconfigureDb(next: DbConnection, password?: string) {
  fs.mkdirSync(path.dirname(DB_CONFIG_FILE), { recursive: true });
  fs.writeFileSync(DB_CONFIG_FILE, JSON.stringify({ host: next.host, port: next.port, database: next.database, user: next.user }, null, 2) + os.EOL);
  if (!dbEnvFixed.host) cfg.host = next.host;
  if (!dbEnvFixed.port) cfg.port = next.port;
  if (!dbEnvFixed.database) cfg.database = next.database;
  if (!dbEnvFixed.user) cfg.user = next.user;
  if (password) savePgpass(password);
  const old = pool;
  pool = makePool();
  void old.end().catch(() => {});
}

const pgpassEsc = (s: string) => s.replace(/\\/g, '\\\\').replace(/:/g, '\\:');
/** grava (ou troca) a linha host:porta:banco:usuário:senha da conexão atual no pgpass.conf; devolve o caminho */
export function savePgpass(password: string): string {
  const f = pgpassFile();
  const key = `${pgpassEsc(cfg.host)}:${cfg.port}:${pgpassEsc(cfg.database)}:${pgpassEsc(cfg.user)}:`;
  const lines = fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split(/\r?\n/).filter((l) => l && !l.startsWith(key)) : [];
  lines.push(key + pgpassEsc(password));
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, lines.join(os.EOL) + os.EOL, { mode: 0o600 });
  return f;
}

/** conexão (sem a senha) e a senha, para as ferramentas do PostgreSQL (pg_dump/pg_restore do backup no painel) */
export const dbConfig = cfg;
export const dbPassword = () => process.env.PGPASSWORD ?? pgpassLookup() ?? '';

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
