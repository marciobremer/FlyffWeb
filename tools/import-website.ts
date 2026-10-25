import fs from 'node:fs';
import { pool, transaction } from '../servers/common/db/index';

/**
 * Importa os dados do banco do site (WEBSITE_DBF do SQL Server) para o esquema `website` do PostgreSQL.
 *   npm run db:import-website -- <arquivo.json>
 * O JSON vem de um export das tabelas (objeto { NomeDaTabela: [linhas…] }, datas em ISO). Faça antes `npm run db:migrate`.
 * Mantém os ids originais e acerta as sequências. Roda uma vez: se a tabela já tem linhas, ela é pulada.
 */
const TABLES: Record<string, { to: string; cols?: Record<string, string> }> = {
  REGISTERED_USERS: { to: 'registered_users' },
  DownloadLinks: { to: 'download_links' },
  News: { to: 'news', cols: { Id: 'id', Title: 'title', Content: 'content', ImageUrl: 'image_url', CreatedAt: 'created_at' } },
  NewsPosts: { to: 'news_posts' },
  topup_items: { to: 'topup_items' },
  topup_requests: { to: 'topup_requests' },
  vote_logs: { to: 'vote_logs' },
  paypal_cashshop_orders: { to: 'paypal_cashshop_orders' },
};

async function main() {
  const file = process.argv[2];
  if (!file) throw new Error('uso: npm run db:import-website -- <arquivo.json>');
  const data = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, '')) as Record<string, Record<string, unknown>[] | undefined>;
  await transaction(async (db) => {
    for (const [src, { to, cols }] of Object.entries(TABLES)) {
      const rows = data[src] ?? [];
      const have = Number((await db.query(`SELECT count(*) FROM website.${to}`)).rows[0].count);
      if (have > 0) { console.log(`${to}: já tem ${have} linhas — pulada`); continue; }
      for (const row of rows) {
        const names = Object.keys(row).map((k) => cols?.[k] ?? k.toLowerCase());
        const values = Object.values(row);
        await db.query(`INSERT INTO website.${to} (${names.join(', ')}) VALUES (${names.map((_, i) => `$${i + 1}`).join(', ')})`, values);
      }
      if (rows.length) await db.query(`SELECT setval(pg_get_serial_sequence('website.${to}', 'id'), (SELECT max(id) FROM website.${to}))`);
      console.log(`${to}: ${rows.length} linhas`);
    }
  });
}

main().catch((e) => { console.error('Erro:', (e as Error).message); process.exitCode = 1; }).finally(() => pool.end());
