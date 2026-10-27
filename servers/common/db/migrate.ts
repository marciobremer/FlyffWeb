import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool, transaction } from './index';

/**
 * Aplica, em ordem, os arquivos `migrations/NNN_*.sql` ainda não aplicados (registrados em `schema_migrations`).
 * Cada arquivo roda numa transação. Uso: `npm run db:migrate`.
 */
const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');

/** aplica as migrações pendentes; devolve quantas (o painel admin usa depois de zerar/restaurar o banco) */
export async function runMigrations(log: (t: string) => void = console.log): Promise<number> {
  await pool.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
  const done = new Set((await pool.query<{ name: string }>('SELECT name FROM schema_migrations')).rows.map((r) => r.name));
  const files = fs.readdirSync(dir).filter((f) => /^\d+_.*\.sql$/.test(f)).sort();
  let n = 0;
  for (const f of files) {
    if (done.has(f)) continue;
    const sql = fs.readFileSync(path.join(dir, f), 'utf8');
    await transaction(async (c) => {
      await c.query(sql);
      await c.query('INSERT INTO schema_migrations (name) VALUES ($1)', [f]);
    });
    log('aplicada: ' + f);
    n++;
  }
  log(n ? `${n} migração(ões) aplicada(s).` : 'Banco já está atualizado.');
  return n;
}

// `npm run db:migrate` (rodando este arquivo direto)
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runMigrations().catch((e) => { console.error('Falha na migração:', e.message); process.exitCode = 1; }).finally(() => pool.end());
}
