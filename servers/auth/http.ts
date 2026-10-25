import { createHash } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { query } from '../common/db/index';
import { bearer, readJson, send } from '../common/http';
import { hashPassword, newToken, verifyLegacyPassword, verifyPassword } from './password';
import { SESSION_MS, sessionFrom, sessions, type Session } from './sessions';
import { charactersOf } from '../character/http';

/**
 * Auth Server — HTTP: login, sessão e logout.
 *   POST /gapi/login   { username, password } → { token, account, characters }
 *   GET  /gapi/session (Authorization: Bearer <token>) → { account, characters }
 *   POST /gapi/logout  (Authorization: Bearer <token>)
 *   POST /gapi/remember (Bearer) → { remember }            token de lembrar ("Contas salvas"), 30 dias
 *   POST /gapi/login   { username, remember }              entra com ele (duplo clique na conta salva), sem a senha
 *   POST /gapi/forget  { remember }                        apaga (botão Apagar)
 * O navegador guarda só o token de lembrar, nunca a senha; no banco fica só o hash dele (remember_tokens).
 * Depois do login a resposta já traz a lista de personagens (do Character Server) para o cliente não pedir de novo.
 */

// limite simples contra força bruta: 8 falhas por IP a cada 5 minutos
const failures = new Map<string, { n: number; until: number }>();
const FAIL_MAX = 8, FAIL_WINDOW = 5 * 60 * 1000;
let dummyHash: string | undefined;

async function login(req: IncomingMessage, res: ServerResponse) {
  const ip = req.socket.remoteAddress ?? '?';
  const f = failures.get(ip);
  if (f && f.until > Date.now() && f.n >= FAIL_MAX) return send(res, 429, { error: 'Muitas tentativas. Aguarde alguns minutos.' });
  let body: Record<string, unknown>;
  try { body = await readJson(req); } catch { return send(res, 400, { error: 'Requisição inválida.' }); }
  const username = typeof body.username === 'string' ? body.username.trim() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  const remember = typeof body.remember === 'string' ? body.remember : '';
  if (remember && username && username.length <= 32 && remember.length <= 128) return loginRemembered(req, res, ip, username, remember);
  if (!username || !password || username.length > 32 || password.length > 128) return send(res, 400, { error: 'Informe usuário e senha.' });

  const r = await query<{ id: string; username: string; password_hash: string | null; legacy_password: string | null; authority: string; blocked_until: Date | null }>(
    'SELECT id, username, password_hash, legacy_password, authority, blocked_until FROM accounts WHERE lower(username) = lower($1)', [username]);
  const acc = r.rows[0];
  let ok = false;
  if (acc?.password_hash) ok = verifyPassword(password, acc.password_hash);
  else if (acc?.legacy_password) ok = verifyLegacyPassword(password, acc.legacy_password);
  else verifyPassword(password, (dummyHash ??= hashPassword('x'))); // mesmo custo para conta inexistente (não revela quem existe)
  if (!acc || !ok) {
    const cur = failures.get(ip);
    failures.set(ip, cur && cur.until > Date.now() ? { n: cur.n + 1, until: cur.until } : { n: 1, until: Date.now() + FAIL_WINDOW });
    return send(res, 401, { error: 'Usuário ou senha incorretos.' });
  }
  failures.delete(ip);
  if (acc.blocked_until && acc.blocked_until.getTime() > Date.now()) {
    return send(res, 403, { error: `Conta bloqueada até ${acc.blocked_until.toLocaleDateString('pt-BR')}.` });
  }
  // primeiro login de conta importada: troca o MD5 do FlyFF pelo hash do jogo web
  if (!acc.password_hash) await query('UPDATE accounts SET password_hash = $2 WHERE id = $1', [acc.id, hashPassword(password)]);
  await query('UPDATE accounts SET last_login_at = now() WHERE id = $1', [acc.id]);

  await startSession(res, Number(acc.id), acc.username, acc.authority);
}

async function startSession(res: ServerResponse, accountId: number, username: string, authority: string) {
  const token = newToken();
  const s: Session = { token, accountId, username, authority, expires: Date.now() + SESSION_MS };
  sessions.set(token, s);
  send(res, 200, { token, account: { username: s.username, authority: s.authority }, characters: await charactersOf(s.accountId) });
}

const REMEMBER_MS = 30 * 24 * 60 * 60 * 1000;
const hashToken = (t: string) => createHash('sha256').update(t).digest('hex');

/** login pelo token de lembrar: precisa bater conta + token e estar na validade (falhas contam no mesmo limite da senha) */
async function loginRemembered(req: IncomingMessage, res: ServerResponse, ip: string, username: string, remember: string) {
  const r = await query<{ id: string; username: string; authority: string; blocked_until: Date | null; rid: string }>(
    `SELECT a.id, a.username, a.authority, a.blocked_until, t.id AS rid FROM remember_tokens t JOIN accounts a ON a.id = t.account_id
     WHERE t.token_hash = $1 AND lower(a.username) = lower($2) AND t.expires_at > now()`, [hashToken(remember), username]);
  const acc = r.rows[0];
  if (!acc) {
    const cur = failures.get(ip);
    failures.set(ip, cur && cur.until > Date.now() ? { n: cur.n + 1, until: cur.until } : { n: 1, until: Date.now() + FAIL_WINDOW });
    return send(res, 401, { error: 'Conta salva expirada. Digite a senha e salve de novo.', expired: true });
  }
  failures.delete(ip);
  if (acc.blocked_until && acc.blocked_until.getTime() > Date.now()) {
    return send(res, 403, { error: `Conta bloqueada até ${acc.blocked_until.toLocaleDateString('pt-BR')}.` });
  }
  // cada uso renova a validade (quem joga sempre não precisa redigitar a senha)
  await query('UPDATE remember_tokens SET last_used_at = now(), expires_at = now() + $2::interval WHERE id = $1', [acc.rid, `${REMEMBER_MS / 1000} seconds`]);
  await query('UPDATE accounts SET last_login_at = now() WHERE id = $1', [acc.id]);
  await startSession(res, Number(acc.id), acc.username, acc.authority);
}

/** rotas do Auth Server; devolve false se a rota não é dele */
export async function authRoute(req: IncomingMessage, res: ServerResponse, path: string): Promise<boolean> {
  if (path === '/gapi/login' && req.method === 'POST') { await login(req, res); return true; }
  if (path === '/gapi/session' && req.method === 'GET') {
    const s = sessionFrom(bearer(req));
    if (!s) { send(res, 401, { error: 'Sessão expirada.' }); return true; }
    send(res, 200, { account: { username: s.username, authority: s.authority }, characters: await charactersOf(s.accountId) });
    return true;
  }
  if (path === '/gapi/remember' && req.method === 'POST') {
    const s = sessionFrom(bearer(req));
    if (!s) { send(res, 401, { error: 'Sessão expirada.' }); return true; }
    const remember = newToken();
    await query('INSERT INTO remember_tokens (account_id, token_hash, expires_at) VALUES ($1, $2, now() + $3::interval)', [s.accountId, hashToken(remember), `${REMEMBER_MS / 1000} seconds`]);
    send(res, 200, { remember });
    return true;
  }
  if (path === '/gapi/forget' && req.method === 'POST') {
    let body: Record<string, unknown> = {};
    try { body = await readJson(req); } catch { /* corpo inválido: nada a apagar */ }
    if (typeof body.remember === 'string' && body.remember.length <= 128) await query('DELETE FROM remember_tokens WHERE token_hash = $1', [hashToken(body.remember)]);
    send(res, 200, { ok: true });
    return true;
  }
  if (path === '/gapi/logout' && req.method === 'POST') {
    const t = bearer(req);
    if (t) sessions.delete(t);
    send(res, 200, { ok: true });
    return true;
  }
  return false;
}
