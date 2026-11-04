import os from 'node:os';
import readline from 'node:readline';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import WebSocket from 'ws';

/**
 * Teste de carga: N bots entram no mundo pelo WebSocket, como jogadores de verdade, e andam/conversam enquanto as medidas são
 * coletadas. Quem inicia é o painel admin (admin/loadtest.ts → aba "Teste de carga"), que cria as contas `lt_bot0001…`, pede as
 * sessões ao jogo e manda a configuração na primeira linha da entrada; "stop" numa linha seguinte encerra antes da hora.
 * A saída é uma linha JSON por segundo ({ t: 'tick', … }) e { t: 'done' } no fim.
 *
 * Os bots ficam em várias threads (workers) para que o próprio teste não vire o gargalo: cada worker mede o atraso do próprio
 * event loop (`botLag`) — se ele subir, quem não aguenta é a máquina dos bots, não o servidor.
 * Para não gastar CPU à toa, as mensagens recebidas só são contadas (bytes); só as poucas que importam são lidas
 * (welcome, states, pong, teleport, error).
 */
export interface LoadConfig {
  url: string;
  bots: { token: string; characterId: number }[];
  /** bots entrando por segundo */
  ramp: number;
  /** duração total em segundos (conta a partir do primeiro bot) */
  duration: number;
  /** raio (u) da área onde os bots nascem e andam, em volta de `center` (x, z) */
  spread: number;
  center: [number, number];
  y: number;
  behavior: 'idle' | 'walk' | 'walk-chat';
  workers: number;
}

/** o que cada worker manda por segundo (somado/juntado na thread principal) */
interface WorkerTick { connected: number; joined: number; failed: number; rxBytes: number; rxMsgs: number; txMsgs: number; pulls: number; rtts: number[]; gaps: number[]; lag: number; errors: string[] }

const WALK_SPEED = 3.5;   // u/s — abaixo da corrida (o anti-speedhack do servidor não puxa de volta)
const STEP_MS = 100;      // como o cliente: estado no máximo a cada 100 ms
const PING_MS = 2000;
const CHAT_MS = 20_000;
const SAMPLE_MAX = 3000;  // amostras de RTT/intervalo por worker por segundo

const pct = (a: number[], p: number) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]; };
const push = (a: number[], v: number) => { if (a.length < SAMPLE_MAX) a.push(v); else a[Math.floor(Math.random() * SAMPLE_MAX)] = v; };

// ---------------------------------------------------------------- worker: um grupo de bots
function runWorker(cfg: LoadConfig, mine: { token: string; characterId: number; startAt: number }[]) {
  interface Bot { ws: WebSocket | null; joined: boolean; p: [number, number, number]; to: [number, number]; h: number; moving: boolean; waitUntil: number; lastStates: number; nextPing: number; nextChat: number; sentStand: boolean }
  const bots: Bot[] = [];
  let failed = 0, rxBytes = 0, rxMsgs = 0, txMsgs = 0, pulls = 0, rtts: number[] = [], gaps: number[] = [], errors: string[] = [];
  let stopping = false;
  const lag = monitorEventLoopDelay({ resolution: 10 });
  lag.enable();
  const r = Math.max(10, cfg.spread);
  const randomPoint = (): [number, number] => {
    const a = Math.random() * Math.PI * 2, d = Math.sqrt(Math.random()) * r;
    return [cfg.center[0] + Math.cos(a) * d, cfg.center[1] + Math.sin(a) * d];
  };
  const send = (b: Bot, msg: unknown) => { if (b.ws?.readyState === WebSocket.OPEN) { b.ws.send(JSON.stringify(msg)); txMsgs++; } };
  const fail = (text: string) => { failed++; if (errors.length < 5) errors.push(text); };

  function connect(token: string, characterId: number) {
    const [x, z] = randomPoint();
    const b: Bot = { ws: null, joined: false, p: [x, cfg.y, z], to: [x, z], h: 0, moving: false, waitUntil: 0, lastStates: 0, nextPing: 0, nextChat: Date.now() + Math.random() * CHAT_MS, sentStand: true };
    bots.push(b);
    /** abre a conexão; o servidor pode mandar o jogo para o WebSocket dedicado do Rust (`redirect`), como faz o cliente */
    const open = (url: string, canRedirect: boolean) => {
      const ws = new WebSocket(url, { perMessageDeflate: false, handshakeTimeout: 15000 });
      b.ws = ws;
      let moved = false, bad = false;
      ws.on('open', () => send(b, { t: 'join', token, characterId, p: b.p }));
      ws.on('message', (data: Buffer) => {
        rxBytes += data.length; rxMsgs++;
        const head = data.toString('latin1', 0, 16);
        if (head.startsWith('{"t":"states"')) {
          const now = Date.now();
          if (b.lastStates && now - b.lastStates < 3000) push(gaps, now - b.lastStates);
          b.lastStates = now;
        } else if (head.startsWith('{"t":"pong"')) {
          const m = JSON.parse(String(data)) as { c: number };
          push(rtts, performance.now() - m.c);
        } else if (head.startsWith('{"t":"welcome"')) {
          const m = JSON.parse(String(data)) as { p: [number, number, number] };
          b.p = [...m.p]; b.to = [m.p[0], m.p[2]]; b.joined = true; b.nextPing = Date.now() + Math.random() * PING_MS;
        } else if (head.startsWith('{"t":"teleport"')) {
          const m = JSON.parse(String(data)) as { p: [number, number, number] };
          b.p = [...m.p]; pulls++;
        } else if (head.startsWith('{"t":"redirect"') && canRedirect) {
          const m = JSON.parse(String(data)) as { port?: number };
          if (Number.isInteger(m.port)) { moved = true; const u = new URL(url); u.port = String(m.port); open(u.toString(), false); }
        } else if (head.startsWith('{"t":"error"')) {
          bad = true; fail((JSON.parse(String(data)) as { error?: string }).error ?? 'erro do servidor');
        }
      });
      ws.on('error', (e) => { if (!b.joined) { bad = true; fail(e.message); } });
      ws.on('close', () => {
        if (moved) return; // a conexão nova assume
        if (b.joined && !stopping) fail('conexão fechada pelo servidor');
        else if (!b.joined && !stopping && !bad) fail('conexão fechada antes de entrar no mundo');
        b.joined = false; b.ws = null;
      });
    };
    open(cfg.url, true);
  }

  // entrada escalonada: cada bot no seu horário (a rampa é global, repartida entre os workers)
  for (const m of mine) setTimeout(() => { if (!stopping) connect(m.token, m.characterId); }, m.startAt);

  // passo de todos os bots deste worker: anda até um ponto sorteado, para um pouco, sorteia outro
  const walking = cfg.behavior !== 'idle';
  const stepTimer = setInterval(() => {
    const now = Date.now(), dt = STEP_MS / 1000;
    for (const b of bots) {
      if (!b.joined) continue;
      if (now >= b.nextPing) { b.nextPing = now + PING_MS; send(b, { t: 'ping', c: performance.now() }); }
      if (cfg.behavior === 'walk-chat' && now >= b.nextChat) { b.nextChat = now + CHAT_MS * (0.5 + Math.random()); send(b, { t: 'chat', text: 'teste de carga' }); }
      if (!walking || now < b.waitUntil) continue;
      const dx = b.to[0] - b.p[0], dz = b.to[1] - b.p[2], d = Math.hypot(dx, dz);
      if (d < 0.5) {
        b.to = randomPoint();
        b.waitUntil = now + Math.random() * 3000;
        if (!b.sentStand) { b.sentStand = true; send(b, { t: 'state', p: b.p.map((v) => +v.toFixed(2)), h: Math.round(b.h), s: 'stand' }); }
        continue;
      }
      const k = Math.min(1, (WALK_SPEED * dt) / d);
      b.p = [b.p[0] + dx * k, b.p[1], b.p[2] + dz * k];
      b.h = ((Math.atan2(dx, -dz) * 180) / Math.PI + 360) % 360;
      b.sentStand = false;
      send(b, { t: 'state', p: b.p.map((v) => +v.toFixed(2)), h: Math.round(b.h), s: 'walk' });
    }
  }, STEP_MS);

  const tickTimer = setInterval(() => {
    let connected = 0, joined = 0;
    for (const b of bots) { if (b.ws?.readyState === WebSocket.OPEN) connected++; if (b.joined) joined++; }
    const tick: WorkerTick = { connected, joined, failed, rxBytes, rxMsgs, txMsgs, pulls, rtts, gaps, lag: Math.max(0, lag.percentile(99) / 1e6 - 10), errors };
    parentPort!.postMessage(tick);
    rxBytes = rxMsgs = txMsgs = pulls = 0; rtts = []; gaps = []; errors = [];
    lag.reset();
  }, 1000);

  parentPort!.on('message', (m: string) => {
    if (m !== 'stop' || stopping) return;
    stopping = true;
    clearInterval(stepTimer);
    for (const b of bots) b.ws?.close();
    setTimeout(() => { clearInterval(tickTimer); process.exit(0); }, 1500);
  });
}

// ---------------------------------------------------------------- principal: reparte os bots, junta as medidas
async function main() {
  const rl = readline.createInterface({ input: process.stdin });
  const lines = rl[Symbol.asyncIterator]();
  const first = await lines.next();
  const cfg = JSON.parse(String(first.value ?? '{}')) as LoadConfig;
  const out = (o: unknown) => process.stdout.write(JSON.stringify(o) + '\n');

  const nWorkers = Math.max(1, Math.min(cfg.workers || Math.max(1, Math.floor(os.cpus().length / 2)), cfg.bots.length || 1));
  const groups: { token: string; characterId: number; startAt: number }[][] = Array.from({ length: nWorkers }, () => []);
  cfg.bots.forEach((b, i) => groups[i % nWorkers].push({ ...b, startAt: (i / Math.max(0.1, cfg.ramp)) * 1000 }));
  out({ t: 'log', text: `${cfg.bots.length} bots em ${nWorkers} threads, ${cfg.ramp}/s, ${cfg.duration} s, comportamento ${cfg.behavior}` });

  // contagens (conectados, no mundo, falhas) = o último relatório de cada worker; o resto soma tudo o que chegou desde o
  // relatório anterior — um worker atrasado não some da conta daquele segundo, entra no seguinte
  const gauges = new Map<Worker, WorkerTick>();
  let acc = { rxBytes: 0, rxMsgs: 0, txMsgs: 0, pulls: 0, rtts: [] as number[], gaps: [] as number[], lag: 0, errors: [] as string[] };
  const workers = groups.map((mine) => {
    const w = new Worker(new URL(import.meta.url), { workerData: { cfg: { ...cfg, bots: [] }, mine } });
    w.on('message', (t: WorkerTick) => {
      gauges.set(w, t);
      acc.rxBytes += t.rxBytes; acc.rxMsgs += t.rxMsgs; acc.txMsgs += t.txMsgs; acc.pulls += t.pulls;
      for (const v of t.rtts) push(acc.rtts, v);
      for (const v of t.gaps) push(acc.gaps, v);
      acc.lag = Math.max(acc.lag, t.lag);
      acc.errors.push(...t.errors);
    });
    w.on('error', (e) => out({ t: 'log', text: 'worker: ' + e.message }));
    return w;
  });

  const started = Date.now();
  let failedBefore = 0, lastAt = Date.now();
  const report = setInterval(() => {
    if (!gauges.size) return;
    const now = Date.now(), secs = (now - lastAt) / 1000, a = acc;
    lastAt = now;
    acc = { rxBytes: 0, rxMsgs: 0, txMsgs: 0, pulls: 0, rtts: [], gaps: [], lag: 0, errors: [] };
    const sum = (k: 'connected' | 'joined' | 'failed') => [...gauges.values()].reduce((s, t) => s + t[k], 0);
    const failed = sum('failed');
    out({
      t: 'tick', at: now - started, connected: sum('connected'), joined: sum('joined'), failed, newFailed: failed - failedBefore,
      rxKBps: Math.round(a.rxBytes / 1024 / secs), rxMsgs: Math.round(a.rxMsgs / secs), txMsgs: Math.round(a.txMsgs / secs), pulls: a.pulls,
      rttP50: pct(a.rtts, 50), rttP95: pct(a.rtts, 95), rttMax: pct(a.rtts, 100), gapP95: pct(a.gaps, 95), gapMax: pct(a.gaps, 100),
      botLag: Math.round(a.lag), errors: a.errors.slice(0, 5),
    });
    failedBefore = failed;
  }, 1000);

  let finished = false;
  const finish = async (why: string) => {
    if (finished) return;
    finished = true;
    out({ t: 'log', text: why });
    for (const w of workers) w.postMessage('stop');
    await Promise.all(workers.map((w) => new Promise((r) => w.once('exit', r))));
    clearInterval(report);
    out({ t: 'done' });
    process.exit(0);
  };
  setTimeout(() => void finish('Tempo do teste encerrado.'), cfg.duration * 1000);
  for await (const line of lines) if (line.trim() === 'stop') { void finish('Teste interrompido pelo painel.'); break; }
  void finish('Entrada fechada (painel saiu).');
}

if (isMainThread) main().catch((e) => { process.stdout.write(JSON.stringify({ t: 'log', text: 'Erro: ' + (e as Error).message }) + '\n'); process.exit(1); });
else runWorker(workerData.cfg as LoadConfig, workerData.mine);
