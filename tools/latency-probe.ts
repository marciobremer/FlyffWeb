// Sonda de latência (temporária): 100 bots do loadtest + 1 observador que anda como o navegador (?perf) + métricas do Rust.
// uso: GAME_ENGINE=rust ADMIN_TOKEN=probe PORT=8080 RUST_WS_PORT=8081 node --import tsx servers/main.ts   (em outro terminal)
//      node --import tsx tools/latency-probe.ts [segundos]
import { spawn } from 'node:child_process';
import net from 'node:net';
import fs from 'node:fs';
import WebSocket from 'ws';
import { query } from '../servers/common/db/index';

const SECS = Number(process.argv[2] ?? 60), PORT = 8080, TOKEN = 'probe', BOTS = Number(process.env.BOTS ?? 100);
const ids = await query<{ account_id: string; character_id: string }>(`SELECT a.id AS account_id, min(c.id) AS character_id FROM accounts a JOIN characters c ON c.account_id=a.id AND NOT c.deleted WHERE a.username ~ '^lt_bot[0-9]{4}$' GROUP BY a.id, a.username ORDER BY a.username LIMIT $1`, [BOTS + 1]);
const rows = ids.rows.map((x) => ({ accountId: Number(x.account_id), characterId: Number(x.character_id) }));
const r = await fetch(`http://127.0.0.1:${PORT}/internal/loadtest/sessions`, { method: 'POST', headers: { 'x-admin-token': TOKEN, 'content-type': 'application/json' }, body: JSON.stringify({ accountIds: rows.slice(0, process.env.NOOBS ? BOTS : undefined).map((b) => b.accountId) }) });
const tokens = (await r.json() as any).tokens as Record<number, string>;
const bots = rows.slice(0, BOTS).map((b) => ({ token: tokens[b.accountId], characterId: b.characterId }));
const obs = rows[BOTS];
if (process.env.TOKENONLY) { console.log(JSON.stringify({ token: tokens[obs.accountId] })); process.exit(0); }
const NOOBS = !!process.env.NOOBS;
const cfg = { url: `ws://127.0.0.1:${PORT}/ws`, bots, count: BOTS, ramp: 10, duration: SECS + 25, spread: 150, center: [6976, 3327], y: 100, behavior: 'walk', workers: 0 };
const child = spawn(process.execPath, ['--import', 'tsx', 'tools/loadtest.ts'], { stdio: ['pipe', 'pipe', 'inherit'], windowsHide: true });
child.stdin.write(JSON.stringify(cfg) + '\n');
child.stdout.on('data', () => {});

async function rustStats() {
  return new Promise<any>((resolve, reject) => {
    const secret = fs.readFileSync('data/rust-link.secret', 'utf8').trim();
    const s = net.connect(9201, '127.0.0.1'); let buf = Buffer.alloc(0), step = 0;
    const w = (v: unknown) => { const b = Buffer.from(JSON.stringify(v)); const h = Buffer.alloc(4); h.writeUInt32BE(b.length); s.write(Buffer.concat([h, b])); };
    s.on('connect', () => w({ k: 'hello', secret, version: 1, probe: true })); s.on('error', reject);
    s.on('data', (d) => { buf = Buffer.concat([buf, d]); while (buf.length >= 4 && buf.length >= 4 + buf.readUInt32BE(0)) { const n = buf.readUInt32BE(0); const m = JSON.parse(buf.subarray(4, 4 + n).toString()); buf = buf.subarray(4 + n); if (m.k === 'hello_ok' && step++ === 0) w({ k: 'stats' }); else if (m.k === 'stats') { s.end(); resolve(m); } } });
    setTimeout(() => reject(new Error('stats timeout')), 3000);
  });
}

// ---- observador: anda e mede como o navegador
let lastS = 0, lastM = 0, sgMax = 0, mgMax = 0, ping = 0, pingMax = 0, lagMax = 0, nStates = 0, nMsgs = 0;
let p: [number, number, number] = [6976, 100, 3327], to: [number, number] = [7050, 3400], connectedAt = 0;
const mkWs = (url: string, first: boolean) => {
  const ws = new WebSocket(url, { perMessageDeflate: false });
  ws.on('open', () => ws.send(JSON.stringify({ t: 'join', token: tokens[obs.accountId], characterId: obs.characterId, p })));
  ws.on('message', (data: Buffer) => {
    const now = performance.now(), head = data.toString('latin1', 0, 16);
    if (head.startsWith('{"t":"redirect"') && first) { const m = JSON.parse(String(data)); const u = new URL(url); u.port = String(m.port); ws.close(); mkWs(u.toString(), false); return; }
    if (head.startsWith('{"t":"welcome"')) { p = JSON.parse(String(data)).p; connectedAt = now; lastS = lastM = now; (globalThis as any).ows = ws; }
    if (!connectedAt) return;
    nMsgs++; mgMax = Math.max(mgMax, now - lastM); lastM = now;
    if (head.startsWith('{"t":"states"')) { nStates++; sgMax = Math.max(sgMax, now - lastS); lastS = now; }
    if (head.startsWith('{"t":"pong"')) { const rtt = now - JSON.parse(String(data)).c; ping = ping ? ping * 0.7 + rtt * 0.3 : rtt; pingMax = Math.max(pingMax, rtt); }
  });
};
if (!NOOBS) mkWs(cfg.url, true);
let t = performance.now();
setInterval(() => { const n = performance.now(); lagMax = Math.max(lagMax, n - t - 20); t = n; }, 20);
setInterval(() => { const ws = (globalThis as any).ows as WebSocket; if (ws?.readyState === 1) ws.send(JSON.stringify({ t: 'ping', c: performance.now() })); }, 2000);
setInterval(() => {
  const ws = (globalThis as any).ows as WebSocket; if (ws?.readyState !== 1 || !connectedAt) return;
  const dx = to[0] - p[0], dz = to[1] - p[2], d = Math.hypot(dx, dz);
  if (d < 1) { to = [6976 + (Math.random() - .5) * 300, 3327 + (Math.random() - .5) * 300]; return; }
  const k = Math.min(1, 0.8 / d); p = [p[0] + dx * k, p[1], p[2] + dz * k];
  ws.send(JSON.stringify({ t: 'state', p: p.map((v) => +v.toFixed(2)), h: 0, s: 'walk' }));
}, 100);

const start = Date.now();
const rows2: string[] = [];
while (Date.now() - start < SECS * 1000) {
  await new Promise((res) => setTimeout(res, 3000));
  let s: any = {}; try { s = await rustStats(); } catch {}
  const line = `t=${Math.round((Date.now() - start) / 1000)}s obs: sg=${Math.round(sgMax)} mg=${Math.round(mgMax)} ping=${Math.round(ping)}/${Math.round(pingMax)} lag=${Math.round(lagMax)} states=${nStates} | rust: players=${s.players} tick avg=${s.tick_avg_ms?.toFixed(2)} gap=${s.tick_gap_max_ms?.toFixed(0)} late=${s.tick_late_max_ms?.toFixed(0)} batch=${s.input_batch_max} phase=${s.input_phase_max_ms?.toFixed(0)} handle=${s.handle_max_ms?.toFixed(1)} views avg=${s.views_avg_ms?.toFixed(2)} max=${s.views_max_ms?.toFixed(1)} linkW=${s.link_write_max_ms?.toFixed(1)} linkBatch=${s.link_batch_max} drop=${s.ws_dropped}`;
  console.log(line); rows2.push(line);
  sgMax = mgMax = pingMax = lagMax = 0;
}
child.stdin.write('stop\n');
setTimeout(() => process.exit(0), 3000);
