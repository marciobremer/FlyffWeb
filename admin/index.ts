import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { dbConfig, dbEnvFixed, dbPassword, pool, reconfigureDb } from '../servers/common/db/index';
import { ADMIN_PORT, ANNOUNCE_MAX, GAME_PORT, ROOT, SITE_DIR, SITE_PORT } from '../servers/common/config';
import { GameProcess } from './game-process';
import { SiteProcess } from './site-process';
import { RATES_FILE, RATE_MAX, RATE_MIN, rates, saveRates } from '../servers/common/rates';
import { AdminError, banAccount, createAccount, dbStatus, listAccounts, setPassword, unbanAccount, unbanByName } from '../servers/auth/accounts';
import { dbHealth, installDatabase } from '../servers/common/db/install';
import { ADMIN_APP, DbOpError, backupPath, createBackup, deleteBackup, listBackups, otherConnections, resetDatabase, restoreBackup, toolsReady } from '../servers/common/db/backup';

// conexões do painel com o nome dele (o jogo e o site que ele inicia usam outro): "banco em uso" não conta o próprio painel
process.env.PGAPPNAME = ADMIN_APP;

/**
 * Painel admin (local): inicia/para/compila o servidor do jogo e administra contas.
 *   npm run admin            → http://127.0.0.1:8090 (abre o navegador; `--no-open` não abre; `--start-game` já liga o
 *                              servidor do jogo, compilando antes se faltar o dist/ — usado pelo ".Iniciar Servidor.bat")
 * Variáveis: ADMIN_PORT (8090), GAME_PORT (8080), ADMIN_HOST (127.0.0.1).
 * Segurança: escuta só na própria máquina; a API exige o cabeçalho `x-admin: 1` (outros sites não conseguem enviá-lo sem CORS,
 * que o painel não libera) e confere o Host (contra DNS rebinding). Sem login — não exponha na rede.
 * Ao fechar o painel (Ctrl+C), o servidor do jogo que ele iniciou também é parado.
 */
const PUBLIC = path.join(ROOT, 'admin', 'public');
const PORT = ADMIN_PORT;
const HOST = process.env.ADMIN_HOST ?? '127.0.0.1';
const game = new GameProcess(ROOT, GAME_PORT);
/** o site (htdocs) liga e desliga junto com o jogo */
const site = new SiteProcess(SITE_DIR, SITE_PORT, (t) => game.log('site', t));
const bootedAt = Date.now();

const TYPES: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };

// ---------------- mensagens do letreiro: slots guardados e loop ----------------
/** data/announce.json: textos guardados nos slots e a mensagem que repete sozinha (o painel manda a cada `every` min) */
const ANN_FILE = path.join(ROOT, 'data', 'announce.json'), ANN_SLOTS = 8;
interface AnnLoop { text: string; loops: number; every: number }
const ann: { slots: string[]; loop: AnnLoop | null } = (() => {
  try {
    const j = JSON.parse(fs.readFileSync(ANN_FILE, 'utf8')) as { slots?: unknown; loop?: AnnLoop | null };
    return { slots: Array.from({ length: ANN_SLOTS }, (_, i) => String((Array.isArray(j.slots) ? j.slots[i] : '') ?? '')), loop: j.loop?.text ? j.loop : null };
  } catch { return { slots: Array(ANN_SLOTS).fill(''), loop: null }; }
})();
/** quando o loop manda de novo (ms); ao abrir o painel com loop salvo, a primeira vai depois de um intervalo */
let annNext = ann.loop ? Date.now() + ann.loop.every * 60_000 : 0;
function saveAnn() { fs.mkdirSync(path.dirname(ANN_FILE), { recursive: true }); fs.writeFileSync(ANN_FILE, JSON.stringify(ann, null, 2)); }
const annState = () => ({ slots: ann.slots, loop: ann.loop, nextAt: ann.loop ? annNext : null });
async function annTick() {
  if (!ann.loop || Date.now() < annNext) return null;
  annNext = Date.now() + ann.loop.every * 60_000;
  return game.announce(ann.loop.text, ann.loop.loops).catch(() => null);
}
setInterval(() => { void annTick(); }, 10_000);

function send(res: http.ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(body));
}

async function readJson(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  let raw = '';
  for await (const c of req) { raw += c; if (raw.length > 8192) throw new AdminError('Requisição grande demais.'); }
  try { const v = JSON.parse(raw || '{}'); return v && typeof v === 'object' ? v : {}; } catch { throw new AdminError('JSON inválido.'); }
}

/** contas online (do jogo) para marcar na lista */
async function onlineAccounts() {
  const s = await game.stats();
  return new Map((s?.data.players ?? []).map((p) => [p.accountId, p.name]));
}

/** uma operação de banco por vez (backup/restaurar/zerar); erros delas viram mensagem para o painel */
let dbBusy = '';
async function dbOp<T>(fn: () => Promise<T>): Promise<T> {
  if (dbBusy) throw new AdminError(`Aguarde: ${dbBusy} em andamento.`);
  dbBusy = 'operação no banco';
  try { return await fn(); } catch (e) { throw e instanceof DbOpError ? new AdminError(e.message) : e; } finally { dbBusy = ''; }
}

async function api(req: http.IncomingMessage, res: http.ServerResponse, url: URL) {
  const p = url.pathname.replace(/^\/admin\/api/, '');
  const m = req.method ?? 'GET';

  if (p === '/status' && m === 'GET') {
    const [st, db] = await Promise.all([game.stats(), dbStatus()]);
    const since = Number(url.searchParams.get('since') ?? 0);
    return send(res, 200, {
      panel: { uptimeMs: Date.now() - bootedAt },
      site: { status: site.status, pid: site.pid, port: site.port, exists: site.exists, built: site.built },
      game: {
        status: game.status, pid: game.pid, port: game.port, distReady: game.distReady,
        uptimeMs: game.startedAt ? Date.now() - game.startedAt : 0, latencyMs: st?.latencyMs ?? null,
        rssMb: st?.data.rssMb ?? null, sessions: st?.data.sessions ?? 0, players: st?.data.players ?? [],
        connections: st?.data.connections ?? 0, sockets: st?.data.sockets ?? 0, msgIn: st?.data.msgIn ?? 0, msgOut: st?.data.msgOut ?? 0,
        mobs: st?.data.mobs ?? 0, dbQueries: st?.data.dbQueries ?? 0, dbTransactions: st?.data.dbTransactions ?? 0,
      },
      db,
      logs: game.logs.filter((l) => l.t > since),
    });
  }
  if (p === '/game/start' && m === 'POST') { await game.start(); void startSite(); return send(res, 200, { ok: true }); }
  if (p === '/game/stop' && m === 'POST') { await site.stop(); await game.stop(); return send(res, 200, { ok: true }); }
  if (p === '/game/restart' && m === 'POST') { if (game.pid) await game.stop(); await game.start(); if (!site.pid) void startSite(); return send(res, 200, { ok: true }); }
  if (p === '/game/build' && m === 'POST') {
    // responde na hora; o progresso aparece nos logs (jogo e depois o site)
    void game.build().then(() => (site.exists ? site.build() : undefined));
    return send(res, 202, { ok: true });
  }
  if (p === '/site/restart' && m === 'POST') { await site.stop(); void startSite(); return send(res, 200, { ok: true }); }
  if (p === '/site/build' && m === 'POST') { void (async () => { const wasUp = !!site.pid; await site.stop(); if ((await site.build()) && wasUp) await site.start(); })(); return send(res, 202, { ok: true }); }

  // taxas do servidor (data/server-rates.json): o jogo relê sozinho, sem reiniciar
  if (p === '/rates' && m === 'GET') return send(res, 200, { rates: rates(), min: RATE_MIN, max: RATE_MAX, file: path.relative(ROOT, RATES_FILE) });
  if (p === '/rates' && m === 'PUT') {
    try { return send(res, 200, { rates: saveRates(await readJson(req)) }); } catch (e) { throw e instanceof AdminError ? e : new AdminError((e as Error).message); }
  }

  // mensagens guardadas (slots) e mensagem em loop
  if (p === '/announce/state' && m === 'GET') return send(res, 200, annState());
  if (p === '/announce/slots' && m === 'PUT') {
    const b = await readJson(req);
    const slots = Array.isArray(b.slots) ? b.slots : [];
    ann.slots = Array.from({ length: ANN_SLOTS }, (_, i) => String(slots[i] ?? '').replace(/\s+/g, ' ').trim().slice(0, ANNOUNCE_MAX));
    saveAnn();
    return send(res, 200, annState());
  }
  if (p === '/announce/loop' && m === 'POST') {
    const b = await readJson(req);
    const text = String(b.text ?? '').replace(/\s+/g, ' ').trim();
    if (!text) throw new AdminError('Escreva a mensagem.');
    if (text.length > ANNOUNCE_MAX) throw new AdminError(`Mensagem longa demais (máximo ${ANNOUNCE_MAX} caracteres).`);
    const every = Math.min(240, Math.max(1, Math.round(Number(b.every) || 5)));
    ann.loop = { text, loops: Math.min(5, Math.max(1, Math.round(Number(b.loops) || 1))), every };
    annNext = 0; // manda agora e depois a cada `every` minutos
    saveAnn();
    const r = await annTick();
    return send(res, 200, { ...annState(), sent: r?.sent ?? null });
  }
  if (p === '/announce/loop' && m === 'DELETE') { ann.loop = null; saveAnn(); return send(res, 200, annState()); }

  // anúncio: letreiro no meio da tela de todos os jogadores online
  if (p === '/announce' && m === 'POST') {
    const b = await readJson(req);
    const text = String(b.text ?? '').replace(/\s+/g, ' ').trim();
    if (!text) throw new AdminError('Escreva a mensagem.');
    if (text.length > ANNOUNCE_MAX) throw new AdminError(`Mensagem longa demais (máximo ${ANNOUNCE_MAX} caracteres).`);
    const r = await game.announce(text, Number(b.loops ?? 1));
    if (!r) throw new AdminError('O servidor do jogo não está rodando pelo painel (ou não respondeu).');
    return send(res, 200, r);
  }

  // ---------------- Database: backup, baixar, apagar, restaurar e zerar ----------------
  if (p === '/db' && m === 'GET') {
    // abre mesmo com o banco fora do ar (é quando a parte de instalar faz falta)
    const health = await dbHealth();
    const others = health.state === 'ok' ? await otherConnections().catch(() => []) : [];
    return send(res, 200, { health, connection: { ...dbConfig, hasPassword: !!dbPassword(), fixed: dbEnvFixed }, database: dbConfig.database, user: dbConfig.user, backups: listBackups(), tools: toolsReady(), others, gameRunning: !!game.pid, siteRunning: !!site.pid, busy: dbBusy });
  }
  if (p === '/db/backup' && m === 'POST') {
    const b = await readJson(req);
    return send(res, 201, await dbOp(() => createBackup(String(b.label ?? ''))));
  }
  const bk = /^\/db\/backups\/([\w.-]+\.dump)$/.exec(p);
  if (bk && m === 'GET') {
    const file = backupPath(bk[1]);
    res.statusCode = 200;
    res.setHeader('content-type', 'application/octet-stream');
    res.setHeader('content-disposition', `attachment; filename="${bk[1]}"`);
    res.setHeader('content-length', String(fs.statSync(file).size));
    fs.createReadStream(file).pipe(res);
    return;
  }
  if (bk && m === 'DELETE') { deleteBackup(bk[1]); return send(res, 200, { ok: true }); }
  // conexão: host/porta/banco/usuário em data/database.json e a senha do usuário do jogo no pgpass.conf; testa na hora
  if (p === '/db/connection' && m === 'PUT') {
    const b = await readJson(req);
    if (game.pid || site.pid) throw new AdminError('Pare o servidor do jogo antes de trocar a conexão (ele continua na antiga até reiniciar).');
    const host = String(b.host ?? '').trim(), database = String(b.database ?? '').trim(), user = String(b.user ?? '').trim(), port = Math.round(Number(b.port));
    if (!host || !/^[\w.-]+$/.test(host)) throw new AdminError('Host inválido.');
    if (!(port >= 1 && port <= 65535)) throw new AdminError('Porta inválida.');
    if (!/^[A-Za-z_][\w$]{0,62}$/.test(database)) throw new AdminError('Nome do banco: letras, números e _ (começando por letra).');
    if (!/^[A-Za-z_][\w$]{0,62}$/.test(user)) throw new AdminError('Usuário: letras, números e _ (começando por letra).');
    const password = String(b.password ?? '');
    reconfigureDb({ host, port, database, user }, password || undefined);
    return send(res, 200, { health: await dbHealth(), connection: { ...dbConfig, hasPassword: !!dbPassword(), fixed: dbEnvFixed } });
  }
  if (p === '/db/install' && m === 'POST') {
    const b = await readJson(req);
    if (game.pid || site.pid) throw new AdminError('Pare o servidor do jogo (Dashboard → Parar) antes de instalar o banco.');
    const ownerUser = String(b.ownerUser ?? '').trim();
    return send(res, 200, await dbOp(() => installDatabase(
      { adminUser: String(b.adminUser ?? 'postgres'), adminPassword: String(b.adminPassword ?? ''), owner: ownerUser ? { username: ownerUser, password: String(b.ownerPassword ?? '') } : undefined },
      (u, pw) => createAccount({ username: u, password: pw, authority: 'Z' }),
    )));
  }
  if ((p === '/db/restore' || p === '/db/reset') && m === 'POST') {
    const b = await readJson(req);
    if (game.pid || site.pid) throw new AdminError('Pare o servidor do jogo (Dashboard → Parar) antes: ele está usando o banco.');
    const log = (t: string) => game.log('painel', t);
    if (p === '/db/reset') {
      if (b.confirm !== 'ZERAR') throw new AdminError('Digite ZERAR para confirmar.');
      return send(res, 200, await dbOp(() => resetDatabase(log)));
    }
    const name = String(b.name ?? '');
    if (b.confirm !== name) throw new AdminError('Digite o nome do backup para confirmar.');
    return send(res, 200, await dbOp(() => restoreBackup(name, log)));
  }

  if (p === '/accounts' && m === 'GET') {
    const [list, online] = await Promise.all([
      listAccounts({ user: url.searchParams.get('user') ?? '', nick: url.searchParams.get('nick') ?? '', page: Number(url.searchParams.get('page') ?? 1), size: Number(url.searchParams.get('size') ?? 25) }),
      onlineAccounts(),
    ]);
    return send(res, 200, { ...list, rows: list.rows.map((r) => ({ ...r, online: online.get(r.id) ?? null })), gameRunning: !!game.pid });
  }
  if (p === '/accounts' && m === 'POST') {
    const b = await readJson(req);
    const id = await createAccount({ username: String(b.username ?? ''), password: String(b.password ?? ''), nickname: String(b.nickname ?? ''), authority: String(b.authority ?? 'F') });
    return send(res, 201, { id });
  }
  if (p === '/accounts/unban-by-name' && m === 'POST') {
    const b = await readJson(req);
    return send(res, 200, { usernames: await unbanByName(String(b.name ?? '')) });
  }
  const act = /^\/accounts\/(\d+)\/(ban|unban|kick|password)$/.exec(p);
  if (act && m === 'POST') {
    const id = Number(act[1]);
    const b = await readJson(req);
    if (act[2] === 'ban') {
      const until = await banAccount(id, Math.max(0, Number(b.days ?? 0)));
      const k = await game.kick(id, 'Sua conta foi bloqueada pelo administrador.');
      return send(res, 200, { until, kicked: k?.kicked ?? 0 });
    }
    if (act[2] === 'unban') { await unbanAccount(id); return send(res, 200, { ok: true }); }
    if (act[2] === 'kick') {
      const k = await game.kick(id, 'Você foi desconectado pelo administrador.');
      if (!k) throw new AdminError('O servidor do jogo não está rodando pelo painel.');
      return send(res, 200, k);
    }
    if (act[2] === 'password') { await setPassword(id, String(b.password ?? '')); return send(res, 200, { ok: true }); }
  }
  send(res, 404, { error: 'Rota desconhecida.' });
}

function serveStatic(res: http.ServerResponse, pathname: string) {
  const file = path.resolve(PUBLIC, '.' + path.sep + (pathname === '/' ? 'index.html' : decodeURIComponent(pathname)));
  if (!file.startsWith(PUBLIC + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.statusCode = 404; res.end('não encontrado'); return; }
  res.setHeader('content-type', TYPES[path.extname(file)] ?? 'application/octet-stream');
  res.setHeader('cache-control', 'no-cache');
  // a página não pode ser embutida em outros sites (clickjacking)
  res.setHeader('x-frame-options', 'DENY');
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  const host = (req.headers.host ?? '').toLowerCase();
  // só pelo nome desta máquina (contra DNS rebinding); a porta pode ser outra quando o Docker mapeia o painel
  const hostName = host.replace(/:\d+$/, '');
  if (hostName !== '127.0.0.1' && hostName !== 'localhost' && host !== `${HOST}:${PORT}`) { res.statusCode = 421; res.end('host não permitido'); return; }
  if (url.pathname.startsWith('/admin/api/')) {
    if (req.headers['x-admin'] !== '1') return send(res, 403, { error: 'Cabeçalho x-admin ausente.' });
    api(req, res, url).catch((e) => {
      if (e instanceof AdminError || e instanceof DbOpError) return send(res, 400, { error: e.message });
      console.error('admin', url.pathname, e);
      send(res, 500, { error: 'Erro interno: ' + (e as Error).message });
    });
    return;
  }
  serveStatic(res, url.pathname);
});

const openLink = (link: string) => { if (!process.argv.includes('--no-open') && process.platform === 'win32') spawn('cmd', ['/c', 'start', '', link], { detached: true, stdio: 'ignore', windowsHide: true }).unref(); };

// painel já aberto em outra janela: só mostra o painel que está rodando e sai
server.on('error', (e: NodeJS.ErrnoException) => {
  if (e.code !== 'EADDRINUSE') throw e;
  const link = `http://127.0.0.1:${PORT}/`;
  console.log(`O painel admin já está aberto em ${link} (outra janela). Abrindo no navegador…`);
  openLink(link);
  setTimeout(() => process.exit(0), 1500);
});

server.listen(PORT, HOST, () => {
  const link = `http://127.0.0.1:${PORT}/`;
  console.log(`Painel admin em ${link}  (Ctrl+C fecha o painel e para o servidor do jogo iniciado por ele)`);
  openLink(link);
  if (process.argv.includes('--start-game')) void autoStart();
});

/** liga o site; sem build, compila primeiro (demora um pouco na primeira vez) */
async function startSite() {
  if (!site.exists || site.pid) return;
  try {
    if (!site.built && !(await site.build())) return;
    await site.start();
  } catch (e) { game.log('site', 'Não consegui iniciar o site: ' + (e as Error).message); }
}

/** --start-game: compila se faltar o dist/ e liga o servidor do jogo e o site */
async function autoStart() {
  try {
    if (!game.distReady && !(await game.build())) { console.log('Não consegui compilar o jogo; veja os logs no painel.'); return; }
    await game.start();
    console.log(`Servidor do jogo iniciando em http://localhost:${game.port}/game/`);
  } catch (e) { console.log('Não consegui iniciar o servidor do jogo:', (e as Error).message); }
  await startSite();
  if (site.pid) console.log(`Site em http://localhost:${game.port}/`);
}

async function shutdown() {
  console.log('\nFechando o painel…');
  if (site.pid) { try { await site.stop(); } catch { /* já parado */ } }
  if (game.pid) { try { await game.stop(); } catch { /* já parado */ } }
  await pool.end().catch(() => {});
  process.exit(0);
}
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
