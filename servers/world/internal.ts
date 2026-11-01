import type { IncomingMessage, ServerResponse } from 'node:http';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { SESSION_MS, revokeAccount, sessionFrom, sessions } from '../auth/sessions';
import { newToken } from '../auth/password';
import type { attachRealtime } from './realtime';
import { dbCounters, query } from '../common/db/index';
import { ANNOUNCE_MAX } from '../common/config';

/** contas dos bots do teste de carga (painel admin → Teste de carga): só elas recebem sessão sem senha */
export const LOADTEST_USER = /^lt_bot\d{4}$/;

/**
 * Desempenho do processo no último segundo: atraso do event loop (o quanto os timers — o tick de 100 ms, os pongs… — saem
 * atrasados porque o processo estava ocupado) e CPU. Medido aqui, uma janela por segundo, para quem lê não zerar a janela do outro.
 */
function perfSampler() {
  const h = monitorEventLoopDelay({ resolution: 10 });
  h.enable();
  let cpu = process.cpuUsage(), at = performance.now();
  let last = { lagP50: 0, lagP99: 0, lagMax: 0, cpu: 0 };
  setInterval(() => {
    const now = performance.now(), c = process.cpuUsage(cpu);
    const ms = (ns: number) => Math.max(0, Math.round((ns / 1e6 - 10) * 10) / 10); // tira a resolução de 10 ms do monitor
    last = { lagP50: ms(h.percentile(50)), lagP99: ms(h.percentile(99)), lagMax: ms(h.max), cpu: Math.round(((c.user + c.system) / 1000 / (now - at)) * 100) };
    h.reset(); cpu = process.cpuUsage(); at = now;
  }, 1000).unref();
  return () => last;
}

/**
 * Endpoints internos do servidor do jogo, usados só pelo painel admin (server/admin) que o iniciou:
 *   GET  /internal/stats                 → uptime, memória, jogadores online, conexões e mensagens do WebSocket
 *   GET  /internal/session?token=…       → a sessão de login (um World Server separado confere o token aqui)
 *   POST /internal/shutdown              → grava todos os personagens (posição, combate, inventário) e encerra o processo
 *   POST /internal/kick { accountId, reason } → derruba as conexões e as sessões da conta
 *   POST /internal/announce { text, loops }  → letreiro no meio da tela de todos os jogadores online (`loops` passagens, 1–5)
 *   POST /internal/loadtest/sessions { accountIds } → { tokens }  sessões para as contas de bot (LOADTEST_USER), sem senha
 *   POST /internal/loadtest/revoke { accountIds }                 encerra as sessões e conexões dessas contas
 * Só aceita pedidos da própria máquina (loopback) com o cabeçalho `x-admin-token` igual a ADMIN_TOKEN (gerado pelo painel a
 * cada início). Sem ADMIN_TOKEN no ambiente, as rotas não existem.
 */
export function internalMiddleware(realtime: ReturnType<typeof attachRealtime> | null) {
  const token = process.env.ADMIN_TOKEN;
  const started = Date.now();
  const perf = token ? perfSampler() : () => null;
  const send = (res: ServerResponse, status: number, body: unknown) => {
    res.statusCode = status;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.setHeader('cache-control', 'no-store');
    res.end(JSON.stringify(body));
  };
  /** ids das contas de bot pedidas, conferidos no banco (conta que não é bot é ignorada) */
  const botAccounts = async (req: IncomingMessage) => {
    let raw = '';
    for await (const c of req) { raw += c; if (raw.length > 64_000) throw new Error('grande demais'); }
    const ids = (JSON.parse(raw || '{}') as { accountIds?: unknown }).accountIds;
    if (!Array.isArray(ids) || !ids.every(Number.isInteger)) throw new Error('accountIds inválido');
    const r = await query<{ id: string; username: string }>('SELECT id, username FROM accounts WHERE id = ANY($1::bigint[])', [ids]);
    return r.rows.filter((a) => LOADTEST_USER.test(a.username)).map((a) => ({ id: Number(a.id), username: a.username }));
  };
  return (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const path = (req.url ?? '').split('?')[0];
    if (!path.startsWith('/internal/')) return next();
    const loopback = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress ?? '');
    if (!token || !loopback || req.headers['x-admin-token'] !== token) { res.statusCode = 404; res.end(); return; }
    if (path === '/internal/stats' && req.method === 'GET') {
      const m = process.memoryUsage();
      return send(res, 200, { uptimeMs: Date.now() - started, rssMb: Math.round(m.rss / 1048576), sessions: sessions.size, dbQueries: dbCounters.queries, dbTransactions: dbCounters.transactions, perf: perf(), ...(realtime?.stats() ?? {}) });
    }
    if ((path === '/internal/loadtest/sessions' || path === '/internal/loadtest/revoke') && req.method === 'POST') {
      botAccounts(req).then((bots) => {
        if (path.endsWith('/revoke')) {
          let kicked = 0;
          for (const b of bots) { kicked += realtime?.kickAccount(b.id, 'Fim do teste de carga.') ?? 0; revokeAccount(b.id); }
          return send(res, 200, { kicked });
        }
        const tokens: Record<number, string> = {};
        for (const b of bots) {
          const t = newToken();
          sessions.set(t, { token: t, accountId: b.id, username: b.username, authority: 'F', expires: Date.now() + SESSION_MS });
          tokens[b.id] = t;
        }
        send(res, 200, { tokens });
      }, (e) => send(res, 400, { error: (e as Error).message }));
      return;
    }
    if (path === '/internal/session' && req.method === 'GET') {
      // para um World Server em outro processo conferir o token de login (as sessões ficam na memória do Auth)
      const s = sessionFrom(new URL(req.url ?? '', 'http://x').searchParams.get('token'));
      return s ? send(res, 200, s) : send(res, 404, { error: 'sessão inválida' });
    }
    if (!realtime) return send(res, 404, { error: 'sem World neste processo' });
    if (path === '/internal/shutdown' && req.method === 'POST') {
      // grava todos os personagens e encerra; a resposta só sai depois de gravar
      realtime.shutdown().catch((e) => console.error('desligar:', e)).finally(() => { send(res, 200, { ok: true }); setTimeout(() => process.exit(0), 200); });
      return;
    }
    if (path === '/internal/kick' && req.method === 'POST') {
      let raw = '';
      req.on('data', (c) => { raw += c; if (raw.length > 2048) req.destroy(); });
      req.on('end', () => {
        try {
          const { accountId, reason } = JSON.parse(raw || '{}') as { accountId?: number; reason?: string };
          if (!Number.isInteger(accountId)) return send(res, 400, { error: 'accountId inválido' });
          const kicked = realtime.kickAccount(accountId!, reason || 'Você foi desconectado pelo administrador.');
          const revoked = revokeAccount(accountId!);
          send(res, 200, { kicked, revoked });
        } catch { send(res, 400, { error: 'JSON inválido' }); }
      });
      return;
    }
    if (path === '/internal/announce' && req.method === 'POST') {
      let raw = '';
      req.on('data', (c) => { raw += c; if (raw.length > 4096) req.destroy(); });
      req.on('end', () => {
        try {
          const { text, loops } = JSON.parse(raw || '{}') as { text?: string; loops?: number };
          const t = String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, ANNOUNCE_MAX);
          if (!t) return send(res, 400, { error: 'mensagem vazia' });
          send(res, 200, { sent: realtime.announce(t, Math.min(5, Math.max(1, Math.round(Number(loops) || 1)))) });
        } catch { send(res, 400, { error: 'JSON inválido' }); }
      });
      return;
    }
    send(res, 404, { error: 'rota desconhecida' });
  };
}
