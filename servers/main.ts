import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { resourceMiddleware } from './common/resources';
import { soundMiddleware } from './common/sounds';
import { DIST, GAME_PORT, RES_DIR, RES_ROOTS, ROOT, SITE_DIR, SITE_PORT, pageAlias } from './common/config';
import { apiMiddleware } from './api';
import net from 'node:net';
import { saveOnSignals, startWorld } from './world/start';
import { internalMiddleware } from './world/internal';

/**
 * Servidor do jogo: entrega a versão compilada (`npm run build` → `dist/`) — jogo em `/game/`, editor em `/editor/` — e os
 * arquivos do cliente FlyFF em `/res`. Tudo que não é do jogo vai para o site (htdocs, Next.js em 127.0.0.1:SITE_PORT): `/` é o site.
 * Sem a pasta htdocs, `/` continua sendo a página inicial com os links para jogar/editar. Escuta em todas as interfaces (rede local).
 * WebSocket `/ws` (server/realtime.ts): jogadores se vendo no mundo.
 *
 *   npm run build && npm start        (PORT=8080 e FLYFF_RESOURCE=<pasta Resource> opcionais)
 *
 * Os três serviços — Auth (servers/auth), Character (servers/character) e World (servers/world) — rodam neste processo. Para ter
 * um processo por mapa: `npm run world` (servers/world/main.ts) e este processo com WORLD_NODE=127.0.0.1:9101 vira só o portão.
 */
const PORT = GAME_PORT;

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.wasm': 'application/wasm',
};

const resources = resourceMiddleware(RES_ROOTS);
const sounds = soundMiddleware();
const api = apiMiddleware();

/** páginas e arquivos do jogo/editor (do dist/); o resto é do site */
const isGamePath = (p: string) => p === '/game' || p.startsWith('/game/') || p === '/editor' || p.startsWith('/editor/') || p.startsWith('/assets/');
const siteEnabled = fs.existsSync(path.join(SITE_DIR, 'package.json'));

/** repassa o pedido ao site (Next.js em 127.0.0.1:SITE_PORT); se ele não está no ar, mostra uma página de espera */
function proxyToSite(req: http.IncomingMessage, res: http.ServerResponse) {
  const up = http.request({ host: '127.0.0.1', port: SITE_PORT, path: req.url, method: req.method, headers: { ...req.headers, 'x-forwarded-host': req.headers.host ?? '' } }, (r) => {
    res.writeHead(r.statusCode ?? 502, r.headers);
    r.pipe(res);
  });
  up.on('error', () => {
    if (res.headersSent) { res.destroy(); return; }
    res.statusCode = 503;
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.setHeader('retry-after', '5');
    res.end('<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="5"><title>ReactioN MMO</title><body style="font:16px system-ui;background:#0b1020;color:#cfd8ff;display:grid;place-items:center;height:100vh;margin:0"><div style="text-align:center"><h2>O site está iniciando…</h2><p>Esta página recarrega sozinha. O jogo já está em <a style="color:#7ad" href="/game/">/game/</a>.</p></div>');
  });
  req.pipe(up);
}

function serveStatic(req: http.IncomingMessage, res: http.ServerResponse) {
  const url = new URL(req.url ?? '/', 'http://x');
  // /game/... é servido de client/ (a pasta do cliente), /editor/ de editor/
  let p = path.resolve(DIST, '.' + path.sep + decodeURIComponent(pageAlias(url.pathname)));
  if (p !== DIST && !p.startsWith(DIST + path.sep)) { res.statusCode = 403; res.end(); return; }
  if (fs.existsSync(p) && fs.statSync(p).isDirectory()) p = path.join(p, 'index.html');
  if (!fs.existsSync(p)) {
    // /game e /editor sem barra final → redireciona para a página
    if (fs.existsSync(path.join(p, 'index.html'))) { res.statusCode = 301; res.setHeader('location', url.pathname + '/'); res.end(); return; }
    res.statusCode = 404; res.end('não encontrado'); return;
  }
  res.setHeader('content-type', TYPES[path.extname(p).toLowerCase()] ?? 'application/octet-stream');
  // arquivos com hash do Vite (assets/) podem ficar em cache; HTML sempre revalida
  res.setHeader('cache-control', p.includes(`${path.sep}assets${path.sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache');
  fs.createReadStream(p).pipe(res);
}

if (!fs.existsSync(path.join(DIST, 'index.html'))) {
  console.error(`dist/ não encontrado em ${DIST} — rode "npm run build" antes de "npm start".`);
  process.exit(1);
}
if (!fs.existsSync(RES_DIR)) console.warn(`Aviso: pasta Resource não encontrada em ${RES_DIR} (defina FLYFF_RESOURCE; padrão original/Resource dentro de ${ROOT}).`);

let internal: ReturnType<typeof internalMiddleware> | null = null;
const server = http.createServer((req, res) => {
  const route = () => {
    const p = (req.url ?? '/').split('?')[0];
    if (siteEnabled && !isGamePath(p)) proxyToSite(req, res); else serveStatic(req, res);
  };
  const rest = () => api(req, res, () => sounds(req, res, () => resources(req, res, route)));
  if (internal) internal(req, res, rest); else rest();
});
// World: dentro deste processo (padrão) ou num processo só do mapa (WORLD_NODE=host:porta → este processo vira o portão:
// Auth, site e arquivos aqui; o WebSocket /ws é repassado ao World Server de `npm run world`)
const NODE = process.env.WORLD_NODE;
const CRLF = String.fromCharCode(13, 10);
if (NODE) {
  const [host, port] = NODE.split(':');
  console.log(`World Server externo em ${host}:${port} (o /ws é repassado)`);
  server.on('upgrade', (req, socket, head) => {
    if ((req.url ?? '').split('?')[0] !== '/ws') return;
    const up = net.connect(Number(port), host, () => {
      const lines = Object.entries(req.headers).map(([k, v]) => `${k}: ${v}`);
      up.write([`${req.method} ${req.url} HTTP/1.1`, ...lines, '', ''].join(CRLF));
      if (head.length) up.write(head);
      socket.pipe(up).pipe(socket);
    });
    up.on('error', () => socket.destroy());
    socket.on('error', () => up.destroy());
  });
}
const realtime = NODE ? null : startWorld(server);
internal = internalMiddleware(realtime); // sem World aqui só responde /internal/session
if (realtime) saveOnSignals(realtime); // /internal/* para o painel admin (só com ADMIN_TOKEN, só loopback)
server.listen(PORT, '0.0.0.0', () => {
  const ips = Object.values(os.networkInterfaces()).flat().filter((a) => a && a.family === 'IPv4' && !a.internal).map((a) => a!.address);
  console.log(`Servidor do jogo em http://localhost:${PORT}/game/`);
  for (const ip of ips) console.log(`  rede local: http://${ip}:${PORT}/game/`);
  console.log(`Resource: ${RES_DIR}`);
});
