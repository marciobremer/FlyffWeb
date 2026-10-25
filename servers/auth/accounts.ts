import { query } from '../common/db/index';
import { hashPassword } from './password';
import { AdminError } from '../common/errors';

export { AdminError };

/** Contas do jogo web (banco `flyffweb`) para o painel admin: listar/buscar, criar, banir/desbanir, trocar senha. */
export interface AccountRow {
  id: number; username: string; authority: string; createdAt: string; lastLoginAt: string | null; blockedUntil: string | null;
  hasPassword: boolean; characters: { id: number; name: string; level: number }[];
}

/** escapa % e _ para ILIKE */
const like = (s: string) => `%${s.replace(/[\\%_]/g, (c) => '\\' + c)}%`;

export async function listAccounts(opts: { user?: string; nick?: string; page?: number; size?: number }) {
  const size = Math.min(100, Math.max(5, opts.size ?? 25));
  const page = Math.max(1, opts.page ?? 1);
  const user = (opts.user ?? '').trim(), nick = (opts.nick ?? '').trim();
  const r = await query<{ id: string; username: string; authority: string; created_at: Date; last_login_at: Date | null; blocked_until: Date | null; has_password: boolean; chars: { id: string; name: string; level: number }[]; total: string }>(`
    SELECT a.id, a.username, a.authority, a.created_at, a.last_login_at, a.blocked_until, a.password_hash IS NOT NULL AS has_password,
           COALESCE(json_agg(json_build_object('id', c.id, 'name', c.name, 'level', c.level) ORDER BY c.slot) FILTER (WHERE c.id IS NOT NULL), '[]') AS chars,
           count(*) OVER () AS total
    FROM accounts a
    LEFT JOIN characters c ON c.account_id = a.id AND NOT c.deleted
    WHERE ($1 = '' OR a.username ILIKE $2)
      AND ($3 = '' OR EXISTS (SELECT 1 FROM characters x WHERE x.account_id = a.id AND NOT x.deleted AND x.name ILIKE $4))
    GROUP BY a.id
    ORDER BY lower(a.username)
    LIMIT $5 OFFSET $6`, [user, like(user), nick, like(nick), size, (page - 1) * size]);
  const rows: AccountRow[] = r.rows.map((a) => ({
    id: Number(a.id), username: a.username, authority: a.authority, createdAt: a.created_at.toISOString(),
    lastLoginAt: a.last_login_at?.toISOString() ?? null, blockedUntil: a.blocked_until?.toISOString() ?? null, hasPassword: a.has_password,
    characters: a.chars.map((c) => ({ id: Number(c.id), name: c.name, level: c.level })),
  }));
  return { rows, total: Number(r.rows[0]?.total ?? 0), page, size };
}

export async function createAccount(input: { username?: string; password?: string; nickname?: string; authority?: string }) {
  const username = (input.username ?? '').trim();
  if (!/^[A-Za-z0-9_]{3,32}$/.test(username)) throw new AdminError('Usuário: 3 a 32 letras, números ou _.');
  const password = input.password ?? '';
  if (password && password.length < 4) throw new AdminError('Senha: pelo menos 4 caracteres (ou deixe vazia e defina depois).');
  const authority = input.authority === 'Z' || input.authority === 'G' ? input.authority : 'F';
  const nickname = (input.nickname ?? '').trim();
  if (nickname && !/^[A-Za-z0-9]{2,16}$/.test(nickname)) throw new AdminError('Personagem: 2 a 16 letras ou números.');
  try {
    const r = await query<{ id: string }>('INSERT INTO accounts (username, password_hash, authority) VALUES ($1, $2, $3) RETURNING id', [username, password ? hashPassword(password) : null, authority]);
    if (nickname) await query('INSERT INTO characters (account_id, slot, name) VALUES ($1, 0, $2)', [r.rows[0].id, nickname]);
    return Number(r.rows[0].id);
  } catch (e) {
    const pg = e as { code?: string; constraint?: string };
    if (pg.code === '23505') throw new AdminError(pg.constraint === 'characters_name_lower' ? 'Esse nome de personagem já existe.' : 'Esse usuário já existe.');
    throw e;
  }
}

/** dias = 0 → permanente */
export async function banAccount(id: number, days: number) {
  const until = days > 0 ? new Date(Date.now() + days * 86400000) : new Date('2100-01-01T00:00:00Z');
  const r = await query('UPDATE accounts SET blocked_until = $2 WHERE id = $1', [id, until]);
  if (!r.rowCount) throw new AdminError('Conta não encontrada.');
  return until;
}

export async function unbanAccount(id: number) {
  const r = await query('UPDATE accounts SET blocked_until = NULL WHERE id = $1', [id]);
  if (!r.rowCount) throw new AdminError('Conta não encontrada.');
}

/** desbanir pelo nome da conta ou do personagem (como o painel da Unreal) */
export async function unbanByName(name: string) {
  const n = name.trim();
  if (!n) throw new AdminError('Informe o usuário ou o nome do personagem.');
  const r = await query<{ username: string }>(`
    UPDATE accounts SET blocked_until = NULL
    WHERE lower(username) = lower($1) OR id IN (SELECT account_id FROM characters WHERE lower(name) = lower($1) AND NOT deleted)
    RETURNING username`, [n]);
  if (!r.rowCount) throw new AdminError(`Nenhuma conta ou personagem chamado "${n}".`);
  return r.rows.map((x) => x.username);
}

export async function setPassword(id: number, password: string) {
  if (password.length < 4) throw new AdminError('Senha: pelo menos 4 caracteres.');
  const r = await query('UPDATE accounts SET password_hash = $2 WHERE id = $1', [id, hashPassword(password)]);
  await query('DELETE FROM remember_tokens WHERE account_id = $1', [id]); // senha nova: as "contas salvas" antigas param de valer
  if (!r.rowCount) throw new AdminError('Conta não encontrada.');
}

export async function dbStatus() {
  const t0 = performance.now();
  try {
    const r = await query<{ size: string; accounts: string; characters: string }>(`
      SELECT pg_database_size(current_database()) AS size, (SELECT count(*) FROM accounts) AS accounts, (SELECT count(*) FROM characters WHERE NOT deleted) AS characters`);
    return { ok: true, latencyMs: Math.round(performance.now() - t0), sizeMb: +(Number(r.rows[0].size) / 1048576).toFixed(1), accounts: Number(r.rows[0].accounts), characters: Number(r.rows[0].characters) };
  } catch (e) {
    return { ok: false, latencyMs: null, error: (e as Error).message };
  }
}
