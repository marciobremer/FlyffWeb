import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { query, pool } from '../servers/common/db/index';

/**
 * Compara os dois motores com bots (tools/loadtest.ts): sobe o servidor do jogo SOZINHO numa porta própria, com o motor
 * escolhido, entra com N bots na mesma área, mede e desliga.
 *
 *   npx tsx tools/bench-engines.ts <node|rust|rust-ws> [bots=200] [duração(s)=60] [spread(u)=300] [x=6744] [z=2995] [behavior=walk]
 *
 * Mede: CPU do processo Node (e do game-server), memória, atraso do event loop do servidor (perf do /internal/stats), tráfego
 * que chega aos bots (KB/s e msgs/s), RTT do ping e o intervalo entre atualizações de posição (gapP95). Usa as contas lt_bot*
 * (as do painel → Teste de carga). Em modo rust, os bots caem em área com mobs agressivos.
 */
const [engine = 'node', botsArg = '200', durArg = '60', spreadArg = '300', xArg = '6744', zArg = '2995', behavior = 'walk'] = process.argv.slice(2);
const N = Number(botsArg), DURATION = Number(durArg), PORT = 9080, TOKEN = 'bench-' + Math.random().toString(36).slice(2);
const ROOT = path.resolve(import.meta.dirname, '..');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const http = (p: string, init: RequestInit = {}) => fetch(`http://127.0.0.1:${PORT}${p}`, { ...init, headers: { 'x-admin-token': TOKEN, 'content-type': 'application/json', ...(init.headers ?? {}) }, signal: AbortSignal.timeout(5000) });

/** segundos de CPU acumulados de um pid (Windows) */
function cpuSeconds(pid: number): number {
  const r = spawnSync('powershell', ['-NoProfile', '-Command', `(Get-Process -Id ${pid} -ErrorAction SilentlyContinue).TotalProcessorTime.TotalSeconds`], { encoding: 'utf8' });
  const v = parseFloat(String(r.stdout).replace(',', '.'));
  return Number.isFinite(v) ? v : 0;
}
function pidOf(image: string): number | null {
  const r = spawnSync('tasklist', ['/FI', `IMAGENAME eq ${image}`, '/FO', 'CSV', '/NH'], { encoding: 'utf8' }).stdout;
  const m = /"[^"]+","(\d+)"/.exec(r);
  return m ? Number(m[1]) : null;
}
const pct = (a: number[], p: number) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]; };
const avg = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);

spawnSync('taskkill', ['/F', '/IM', 'game-server.exe'], { stdio: 'ignore' });
const WS_PORT = 9081; // rust-ws: os bots conectam direto no servidor WebSocket do Rust
const env = { ...process.env, PORT: String(PORT), ADMIN_TOKEN: TOKEN, GAME_ENGINE: engine.startsWith('rust') ? 'rust' : '', FORCE_COLOR: '0', PGAPPNAME: 'bench', ...(engine === 'rust-ws' ? { RUST_WS_PORT: String(WS_PORT) } : {}) };
const server: ChildProcess = spawn(process.execPath, ['--import', 'tsx', 'servers/main.ts'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
const log: string[] = [];
server.stdout!.on('data', (d) => log.push(String(d)));
server.stderr!.on('data', (d) => log.push(String(d)));
let loadChild: ChildProcess | null = null;
const cleanup = () => { loadChild?.kill(); server.kill(); spawnSync('taskkill', ['/F', '/PID', String(server.pid), '/T'], { stdio: 'ignore' }); spawnSync('taskkill', ['/F', '/IM', 'game-server.exe'], { stdio: 'ignore' }); };
process.on('exit', cleanup);

// espera o servidor responder
let up = false;
for (let i = 0; i < 180 && !up; i++) { try { up = (await http('/internal/stats')).ok; } catch { /* ainda subindo */ } if (!up) await sleep(1000); }
if (!up) { console.error('servidor não subiu:\n' + log.join('').slice(-1500)); process.exit(1); }
if (engine.startsWith('rust')) {
  for (let i = 0; i < 30 && !log.join('').includes('rust-link: conectado'); i++) await sleep(500);
  if (!log.join('').includes('rust-link: conectado')) { console.error('o Rust não conectou:\n' + log.join('').slice(-1500)); process.exit(1); }
}
console.log(`servidor (${engine}) no ar; ${N} bots, ${DURATION}s, centro ${xArg},${zArg}, espalhados em ${spreadArg} u`);

const bots = (await query<{ account_id: string; character_id: string }>(`SELECT a.id AS account_id, min(c.id) AS character_id FROM accounts a JOIN characters c ON c.account_id = a.id AND NOT c.deleted WHERE a.username ~ '^lt_bot[0-9]{4}$' GROUP BY a.id ORDER BY a.id LIMIT $1`, [N])).rows;
if (bots.length < N) { console.error(`só há ${bots.length} bots no banco (rode o teste de carga uma vez pelo painel para criar mais)`); process.exit(1); }
const tk = (await (await http('/internal/loadtest/sessions', { method: 'POST', body: JSON.stringify({ accountIds: bots.map((b) => Number(b.account_id)) }) })).json()) as { tokens: Record<number, string> };
await pool.end();

const cfg = { url: `ws://127.0.0.1:${engine === 'rust-ws' ? WS_PORT : PORT}/ws`, bots: bots.map((b) => ({ token: tk.tokens[Number(b.account_id)], characterId: Number(b.character_id) })), ramp: Math.max(20, Math.round(N / 5)), duration: DURATION, spread: Number(spreadArg), center: [Number(xArg), Number(zArg)], y: 100, behavior, workers: 0 };
loadChild = spawn(process.execPath, ['--import', 'tsx', 'tools/loadtest.ts'], { cwd: ROOT, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, env: { ...process.env, FORCE_COLOR: '0' } });
loadChild.stdin!.write(JSON.stringify(cfg) + '\n');
const ticks: any[] = [];
let done = false;
readline.createInterface({ input: loadChild.stdout! }).on('line', (l) => { try { const m = JSON.parse(l); if (m.t === 'tick') ticks.push(m); else if (m.t === 'done') done = true; } catch { /* log */ } });
loadChild.stderr!.on('data', (d) => process.stderr.write(String(d)));

// amostragem do servidor
const nodePid = server.pid!;
const samples: { cpuNode: number; cpuRust: number; rss: number; perf: any }[] = [];
let lastNode = cpuSeconds(nodePid), rustPid = engine.startsWith('rust') ? pidOf('game-server.exe') : null, lastRust = rustPid ? cpuSeconds(rustPid) : 0, lastAt = Date.now();
const warm = Math.min(15, Math.round(DURATION * 0.25)); // ignora a subida dos bots
const start = Date.now();
while (!done && Date.now() - start < (DURATION + 20) * 1000) {
  await sleep(5000);
  const now = Date.now(), dt = (now - lastAt) / 1000; lastAt = now;
  const cn = cpuSeconds(nodePid), cr = rustPid ? cpuSeconds(rustPid) : 0;
  const st = await (await http('/internal/stats')).json().catch(() => null) as any;
  if ((now - start) / 1000 > warm && st) samples.push({ cpuNode: ((cn - lastNode) / dt) * 100, cpuRust: rustPid ? ((cr - lastRust) / dt) * 100 : 0, rss: st.rssMb, perf: st.perf });
  if (process.env.BENCH_VERBOSE) console.log(`t=${Math.round((now - start) / 1000)}s joined=${ticks[ticks.length - 1]?.joined} nodeCPU=${(((cn - lastNode) / dt) * 100).toFixed(0)}% lagMax=${st?.perf?.lagMax} lagP99=${st?.perf?.lagP99}`);
  lastNode = cn; lastRust = cr;
}
const steady = ticks.filter((t) => t.at / 1000 > warm + 5);
const last = ticks[ticks.length - 1];
const perfKeys = samples[0]?.perf ? Object.keys(samples[0].perf) : [];
const out: Record<string, unknown> = {
  motor: engine, bots: N, joined: last?.joined, failed: last?.failed,
  'CPU Node % (médio / pior)': `${avg(samples.map((s) => s.cpuNode)).toFixed(1)} / ${Math.max(0, ...samples.map((s) => s.cpuNode)).toFixed(1)}`,
  'CPU game-server % (médio)': engine.startsWith('rust') ? avg(samples.map((s) => s.cpuRust)).toFixed(1) : '-',
  'RAM Node MB': Math.max(0, ...samples.map((s) => s.rss)),
  'bots recebem KB/s (total)': Math.round(avg(steady.map((t) => t.rxKBps))), 'msgs/s (total)': Math.round(avg(steady.map((t) => t.rxMsgs))),
  'RTT p50/p95 ms': `${pct(steady.map((t) => t.rttP50), 50)} / ${pct(steady.map((t) => t.rttP95), 95)}`,
  'gap atualização p95 ms': pct(steady.map((t) => t.gapP95), 95), 'botLag ms (máx)': Math.max(0, ...steady.map((t) => t.botLag)),
};
if (perfKeys.length) for (const k of perfKeys) { const vals = samples.map((s) => Number(s.perf[k])).filter(Number.isFinite); if (vals.length) out[`perf.${k} (máx)`] = Math.round(Math.max(...vals) * 100) / 100; }
console.log('\n' + JSON.stringify(out, null, 2));
fs.mkdirSync(path.join(ROOT, 'data', 'bench'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'data', 'bench', `${engine}-${N}.json`), JSON.stringify(out, null, 2));
cleanup();
process.exit(0);
