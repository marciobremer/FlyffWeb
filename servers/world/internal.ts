import type { IncomingMessage, ServerResponse } from 'node:http';
import { revokeAccount, sessionFrom, sessions } from '../auth/sessions';
import type { attachRealtime } from './realtime';
import { dbCounters } from '../common/db/index';
import { ANNOUNCE_MAX } from '../common/config';

/**
 * Endpoints internos do servidor do jogo, usados só pelo painel admin (server/admin) que o iniciou:
 *   GET  /internal/stats                 → uptime, memória, jogadores online, conexões e mensagens do WebSocket
 *   GET  /internal/session?token=…       → a sessão de login (um World Server separado confere o token aqui)
 *   POST /internal/shutdown              → grava todos os personagens (posição, combate, inventário) e encerra o processo
 *   POST /internal/kick { accountId, reason } → derruba as conexões e as sessões da conta
 *   POST /internal/announce { text, loops }  → letreiro no meio da tela de todos os jogadores online (`loops` passagens, 1–5)
 * Só aceita pedidos da própria máquina (loopback) com o cabeçalho `x-admin-token` igual a ADMIN_TOKEN (gerado pelo painel a
 * cada início). Sem ADMIN_TOKEN no ambiente, as rotas não existem.
 */
export function internalMiddleware(realtime: ReturnType<typeof attachRealtime> | null) {
  const token = process.env.ADMIN_TOKEN;
  const started = Date.now();
  const send = (res: ServerResponse, status: number, body: unknown) => {
    res.statusCode = status;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.setHeader('cache-control', 'no-store');
    res.end(JSON.stringify(body));
  };
  return (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const path = (req.url ?? '').split('?')[0];
    if (!path.startsWith('/internal/')) return next();
    const loopback = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress ?? '');
    if (!token || !loopback || req.headers['x-admin-token'] !== token) { res.statusCode = 404; res.end(); return; }
    if (path === '/internal/stats' && req.method === 'GET') {
      const m = process.memoryUsage();
      return send(res, 200, { uptimeMs: Date.now() - started, rssMb: Math.round(m.rss / 1048576), sessions: sessions.size, dbQueries: dbCounters.queries, dbTransactions: dbCounters.transactions, ...(realtime?.stats() ?? {}) });
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
