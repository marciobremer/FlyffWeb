import type { IncomingMessage, ServerResponse } from 'node:http';
import { send } from './common/http';
import { authRoute } from './auth/http';
import { characterRoute } from './character/http';
import { loadEdits, saveEdits } from './common/worldedits';
import { soundIds } from './common/sounds';
import { readJson } from './common/http';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { DIST } from './common/config';
import { bootTotal, saveBootManifest } from './common/bootmanifest';

/** `/assets/game-<hash>.js` do build atual (relido só quando o index.html muda) */
let entryCache = { mtime: 0, src: '' };
function gameEntry(): string {
  const f = path.join(DIST, 'client', 'index.html');
  try {
    const mtime = fs.statSync(f).mtimeMs;
    if (mtime !== entryCache.mtime) entryCache = { mtime, src: /<script[^>]+type="module"[^>]+src="([^"]+)"/.exec(fs.readFileSync(f, 'utf8'))?.[1] ?? '' };
  } catch { return ''; }
  return entryCache.src;
}

/** o pedido vem deste computador? (loopback ou o próprio IP da rede local, como http://192.168.x.x:8080) */
function fromThisMachine(req: IncomingMessage) {
  const a = (req.socket.remoteAddress ?? '').replace(/^::ffff:/, '');
  if (a === '127.0.0.1' || a === '::1') return true;
  return Object.values(os.networkInterfaces()).flat().some((i) => i && i.address === a);
}

/**
 * Porta de entrada HTTP dos serviços (JSON), montada no servidor do jogo e no Vite em desenvolvimento. Hoje tudo roda no
 * mesmo processo; cada rota já pertence a um serviço — na fase 2 cada um vira um processo e este arquivo vira um proxy:
 *   Auth       POST /gapi/login · GET /gapi/session · POST /gapi/logout       (servers/auth/http.ts)
 *   Editor     GET/PUT /gapi/world-edits?world=…  (NPCs e Ambiente salvos pelo editor; PUT só do próprio computador)
 *   Character  POST /gapi/characters                                         (servers/character/http.ts)
 * O prefixo é /gapi (e não /api) porque o site (htdocs) tem as rotas /api/login, /api/logout… dele.
 */
export function apiMiddleware() {
  return (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const path = (req.url ?? '').split('?')[0];
    if (!path.startsWith('/gapi/')) return next();
    const run = async () => {
      if (await authRoute(req, res, path)) return;
      if (await characterRoute(req, res, path)) return;
      if (path === '/gapi/boot-manifest') {
        // total da tela de carregamento: qualquer um lê; só o navegador do próprio computador do servidor grava
        const q = new URL(req.url ?? '', 'http://x').searchParams.get('q') ?? 'high';
        if (req.method === 'GET') { res.setHeader('cache-control', 'no-cache'); return send(res, 200, bootTotal(q) ?? {}); }
        if (req.method === 'POST') {
          if (!fromThisMachine(req) || req.headers['x-forwarded-for']) return send(res, 403, { error: 'Só pelo próprio computador do servidor.' });
          const body = await readJson(req, 2_000_000) as { urls?: unknown; bytes?: unknown; count?: unknown };
          return send(res, saveBootManifest(q, body.urls, body.bytes, body.count) ? 200 : 400, {});
        }
      }
      if (path === '/gapi/version') {
        // versão do jogo compilado: o script de entrada do dist/client/index.html (o nome muda a cada build — Vite põe o hash);
        // o cliente compara com o script que está rodando e se atualiza (client/version.ts)
        res.setHeader('cache-control', 'no-store');
        return send(res, 200, { game: gameEntry() });
      }
      if (path === '/gapi/sounds') { res.setHeader('cache-control', 'no-cache'); return send(res, 200, soundIds()); } // muda com a pasta de dados
      if (path === '/gapi/world-edits') {
        // edições do editor de mapa (NPCs e Ambiente): qualquer um lê; só quem está NESTA máquina grava
        const world = new URL(req.url ?? '', 'http://x').searchParams.get('world') ?? '';
        if (req.method === 'GET') return send(res, 200, loadEdits(world));
        if (req.method === 'PUT') {
          if (!fromThisMachine(req) || req.headers['x-forwarded-for']) return send(res, 403, { error: 'Só é possível salvar pelo próprio computador do servidor.' });
          const saved = saveEdits(world, await readJson(req, 1_000_000));
          return saved ? send(res, 200, saved) : send(res, 400, { error: 'Nome de mundo inválido.' });
        }
      }
      send(res, 404, { error: 'Rota desconhecida.' });
    };
    run().catch((e) => {
      console.error('API', path, e);
      send(res, 503, { error: 'Servidor indisponível (banco de dados).' });
    });
  };
}
