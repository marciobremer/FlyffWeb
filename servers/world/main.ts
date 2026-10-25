import http from 'node:http';
import { internalMiddleware } from './internal';
import { saveOnSignals, startWorld } from './start';
import { WORLD } from '../common/config';

/**
 * Processo de UM mapa (World Server separado). Só atende o WebSocket `/ws` e `/internal/*`; o portão (`servers/main.ts`
 * com WORLD_NODE=host:porta) repassa o `/ws` para cá. Como o login (Auth) mora no portão, o token da sessão é conferido
 * perguntando a ele (`GATEWAY_URL`, padrão http://127.0.0.1:8080, com o mesmo ADMIN_TOKEN).
 *
 *   WORLD=WdMadrigal WORLD_PORT=9101 ADMIN_TOKEN=… npm run world
 */
const PORT = Number(process.env.WORLD_PORT ?? 9101);
const GATEWAY = process.env.GATEWAY_URL ?? 'http://127.0.0.1:8080';
const token = process.env.ADMIN_TOKEN ?? '';

let internal: ReturnType<typeof internalMiddleware> | null = null;
const server = http.createServer((req, res) => {
  if (internal) internal(req, res, () => { res.statusCode = 404; res.end(); }); else { res.statusCode = 503; res.end(); }
});
const realtime = startWorld(server, WORLD, {
  resolveSession: async (t) => {
    try {
      const r = await fetch(`${GATEWAY}/internal/session?token=${encodeURIComponent(t)}`, { headers: { 'x-admin-token': token }, signal: AbortSignal.timeout(3000) });
      return r.ok ? await r.json() : null;
    } catch { return null; }
  },
});
internal = internalMiddleware(realtime);
saveOnSignals(realtime);
server.listen(PORT, '127.0.0.1', () => console.log(`World Server "${WORLD}" em 127.0.0.1:${PORT}`));
