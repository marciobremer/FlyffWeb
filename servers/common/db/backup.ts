import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { dbConfig, dbPassword, pool } from './index';
import { runMigrations } from './migrate';
import { ROOT } from '../config';

/**
 * Backup, restauração e "zerar" do banco do jogo (painel admin → Database).
 *   backup    pg_dump -Fc → data/backups/<nome>.dump (formato custom: o pg_restore lê, compacto)
 *   restaurar apaga tudo o que é do usuário do jogo e aplica o arquivo (pg_restore), depois roda as migrações novas
 *   zerar     apaga tudo o que é do usuário do jogo e roda todas as migrações: banco vazio, só a estrutura
 * Antes de restaurar ou zerar sempre sai um backup automático ("antes-de-…"), para dar para voltar.
 * Só com o banco livre: nenhuma outra conexão (jogo, site, scripts) além do próprio painel.
 */
export const BACKUP_DIR = path.join(ROOT, 'data', 'backups');
/** nome do painel nas conexões (PGAPPNAME): as dele não contam como "outro programa usando o banco" */
export const ADMIN_APP = 'flyffweb-admin';

export class DbOpError extends Error {}

/** pg_dump / pg_restore: no PATH ou na instalação padrão do PostgreSQL no Windows (a versão mais nova) */
function tool(name: 'pg_dump' | 'pg_restore'): string | null {
  const exe = process.platform === 'win32' ? `${name}.exe` : name;
  for (const dir of (process.env.PATH ?? '').split(path.delimiter)) if (dir && fs.existsSync(path.join(dir, exe))) return path.join(dir, exe);
  if (process.platform === 'win32') {
    const base = path.join(process.env.ProgramFiles ?? 'C:\\Program Files', 'PostgreSQL');
    const vers = fs.existsSync(base) ? fs.readdirSync(base).filter((v) => /^\d+/.test(v)).sort((a, b) => parseFloat(b) - parseFloat(a)) : [];
    for (const v of vers) { const p = path.join(base, v, 'bin', exe); if (fs.existsSync(p)) return p; }
  }
  return null;
}
export const toolsReady = () => ({ pgDump: !!tool('pg_dump'), pgRestore: !!tool('pg_restore') });

/** roda a ferramenta com a conexão do jogo (senha pelo ambiente, nunca na linha de comando) */
function run(name: 'pg_dump' | 'pg_restore', args: string[]): Promise<void> {
  const exe = tool(name);
  if (!exe) return Promise.reject(new DbOpError(`${name} não encontrado (instale o PostgreSQL ou coloque a pasta bin no PATH).`));
  return new Promise((resolve, reject) => {
    const child = spawn(exe, ['-h', dbConfig.host, '-p', String(dbConfig.port), '-U', dbConfig.user, '-d', dbConfig.database, ...args],
      { windowsHide: true, env: { ...process.env, PGPASSWORD: dbPassword(), PGAPPNAME: ADMIN_APP } });
    let err = '';
    child.stderr.on('data', (d) => { err += String(d); if (err.length > 8000) err = err.slice(-8000); });
    child.on('error', (e) => reject(new DbOpError(e.message)));
    child.on('close', (code) => (code === 0 ? resolve() : reject(new DbOpError(`${name} falhou (código ${code}): ${err.trim().split(/\r?\n/).slice(-3).join(' ')}`))));
  });
}

export interface BackupInfo { name: string; size: number; date: string }

/** arquivo de backup pelo nome (só nomes simples dentro da pasta de backups) */
export function backupPath(name: string): string {
  if (!/^[\w.-]+\.dump$/.test(name)) throw new DbOpError('Nome de backup inválido.');
  const file = path.join(BACKUP_DIR, name);
  if (!fs.existsSync(file)) throw new DbOpError('Backup não encontrado.');
  return file;
}

export function listBackups(): BackupInfo[] {
  if (!fs.existsSync(BACKUP_DIR)) return [];
  return fs.readdirSync(BACKUP_DIR).filter((f) => /^[\w.-]+\.dump$/.test(f)).map((f) => {
    const st = fs.statSync(path.join(BACKUP_DIR, f));
    return { name: f, size: st.size, date: st.mtime.toISOString() };
  }).sort((a, b) => b.date.localeCompare(a.date));
}

/** data e hora locais no nome do arquivo: AAAAMMDD-HHMMSS */
const stamp = () => { const d = new Date(), z = (n: number) => String(n).padStart(2, '0'); return `${d.getFullYear()}${z(d.getMonth() + 1)}${z(d.getDate())}-${z(d.getHours())}${z(d.getMinutes())}${z(d.getSeconds())}`; };

/** backup agora: data/backups/flyffweb-AAAAMMDD-HHMMSS[-rótulo].dump */
export async function createBackup(label = ''): Promise<BackupInfo> {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const tag = label.replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  const name = `${dbConfig.database}-${stamp()}${tag ? '-' + tag : ''}.dump`;
  const file = path.join(BACKUP_DIR, name);
  try { await run('pg_dump', ['-Fc', '--no-owner', '--no-privileges', '-f', file]); } catch (e) { fs.rmSync(file, { force: true }); throw e; }
  const st = fs.statSync(file);
  return { name, size: st.size, date: st.mtime.toISOString() };
}

export function deleteBackup(name: string) { fs.rmSync(backupPath(name)); }

/** outros programas conectados ao banco (o jogo, o site, scripts) — restaurar/zerar só com o banco livre */
export async function otherConnections(): Promise<string[]> {
  const r = await pool.query<{ app: string; n: number }>(
    `SELECT coalesce(nullif(application_name, ''), 'sem nome') AS app, count(*)::int AS n FROM pg_stat_activity
      WHERE datname = current_database() AND backend_type = 'client backend' AND pid <> pg_backend_pid() AND application_name <> $1
      GROUP BY 1`, [ADMIN_APP]);
  const names: Record<string, string> = { 'flyffweb-game': 'servidor do jogo', 'flyffweb-site': 'site', 'sem nome': 'servidor do jogo ou outro programa', pg_dump: 'backup em andamento', psql: 'psql' };
  return r.rows.map((x) => `${names[x.app] ?? x.app} (${x.n} conexão${x.n > 1 ? 'ões' : ''})`);
}

/**
 * Apaga tudo o que pertence ao usuário do jogo: os esquemas dele (website, legacy…) inteiros e, no `public`, tabelas, views,
 * sequências, funções e tipos dele. Não usa DROP OWNED (que também tiraria a permissão de criar no `public`).
 */
async function dropAll() {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await dropAllIn(c);
    await c.query('COMMIT');
  } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
}
/** os DROP de `dropAll`, num client já dentro de uma transação */
export async function dropAllIn(c: { query: <R extends Record<string, unknown>>(sql: string) => Promise<{ rows: R[] }> }) {
  {
    const schemas = await c.query<{ nspname: string }>(`SELECT nspname FROM pg_namespace WHERE pg_get_userbyid(nspowner) = current_user AND nspname <> 'public' AND nspname NOT LIKE 'pg\\_%'`);
    for (const { nspname } of schemas.rows) await c.query(`DROP SCHEMA ${quoteId(nspname)} CASCADE`);
    const rels = await c.query<{ relname: string; relkind: string }>(
      `SELECT c.relname, c.relkind FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND pg_get_userbyid(c.relowner) = current_user AND c.relkind IN ('r', 'p', 'v', 'm', 'f')`);
    const kind: Record<string, string> = { r: 'TABLE', p: 'TABLE', v: 'VIEW', m: 'MATERIALIZED VIEW', f: 'FOREIGN TABLE' };
    for (const r of rels.rows) await c.query(`DROP ${kind[r.relkind]} IF EXISTS public.${quoteId(r.relname)} CASCADE`);
    const seqs = await c.query<{ relname: string }>(`SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'S' AND pg_get_userbyid(c.relowner) = current_user`);
    for (const r of seqs.rows) await c.query(`DROP SEQUENCE IF EXISTS public.${quoteId(r.relname)} CASCADE`);
    const fns = await c.query<{ sig: string }>(`SELECT p.oid::regprocedure::text AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND pg_get_userbyid(p.proowner) = current_user`);
    for (const r of fns.rows) await c.query(`DROP ROUTINE IF EXISTS ${r.sig} CASCADE`);
    const types = await c.query<{ typname: string }>(`SELECT t.typname FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = 'public' AND t.typtype IN ('e', 'c', 'd', 'r') AND t.typrelid = 0 AND pg_get_userbyid(t.typowner) = current_user`);
    for (const r of types.rows) await c.query(`DROP TYPE IF EXISTS public.${quoteId(r.typname)} CASCADE`);
  }
}
const quoteId = (s: string) => '"' + s.replace(/"/g, '""') + '"';

async function ensureFree() {
  const others = await otherConnections();
  if (others.length) throw new DbOpError(`O banco está em uso por: ${others.join(', ')}. Pare o servidor do jogo (e o site) antes.`);
}

/** zera o banco: backup automático, apaga tudo e recria a estrutura vazia pelas migrações */
export async function resetDatabase(log: (t: string) => void): Promise<{ backup: BackupInfo; migrations: number }> {
  await ensureFree();
  const backup = await createBackup('antes-de-zerar');
  log(`Backup automático: ${backup.name}`);
  await dropAll();
  log('Banco apagado; recriando a estrutura…');
  const migrations = await runMigrations(log);
  return { backup, migrations };
}

/** restaura um backup: backup automático do estado atual, apaga tudo, aplica o arquivo e roda as migrações mais novas */
export async function restoreBackup(name: string, log: (t: string) => void): Promise<{ backup: BackupInfo; migrations: number }> {
  const file = backupPath(name);
  await ensureFree();
  const backup = await createBackup('antes-de-restaurar');
  log(`Backup automático: ${backup.name}`);
  await dropAll();
  await run('pg_restore', ['--no-owner', '--no-privileges', '--exit-on-error', file]);
  log(`Restaurado: ${name}`);
  const migrations = await runMigrations(log);
  return { backup, migrations };
}
