import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { query } from '../servers/common/db/index';
import { AdminError } from '../servers/common/errors';
import type { GameProcess } from './game-process';
import type { LoadConfig } from '../tools/loadtest';

/**
 * Teste de carga pelo painel (aba "Teste de carga"): cria as contas de bot `lt_bot0001…` (sem senha: ninguém entra nelas pelo
 * login) com um personagem `LtBot0001…` cada, pede ao jogo uma sessão para cada uma (/internal/loadtest/sessions) e roda
 * `tools/loadtest.ts` num processo à parte. A cada segundo junta o que os bots viram (RTT, intervalo entre 'states', bytes) com
 * o que o servidor mediu de si mesmo (atraso do event loop, CPU, RAM) e, no fim, grava tudo em data/loadtests/<data>.json.
 *
 * "Degradou" = 3 segundos seguidos com algum limite estourado (LIMITS). O resultado diz com quantos bots isso aconteceu.
 */
export const LIMITS = { lagP99: 50, rttP95: 150, gapP95: 300 };
const DIR = (root: string) => path.join(root, 'data', 'loadtests');
const BOT_RE = '^lt_bot[0-9]{4}$';
export const BOTS_MAX = 2000;

export interface Sample {
  at: number; bots: number; connected: number; failed: number; rxKBps: number; rxMsgs: number; txMsgs: number; pulls: number;
  rttP50: number | null; rttP95: number | null; gapP95: number | null; botLag: number;
  lagP99: number | null; lagMax: number | null; cpu: number | null; rssMb: number | null; players: number; srvMsgOut: number | null;
  /** medidas do navegador com ?perf (null sem navegador): intervalo entre 'states' e entre quaisquer mensagens (mín/máx, ms), fps, ping e maior quadro */
  cSgMin: number | null; cSgMax: number | null; cMgMin: number | null; cMgMax: number | null; cFps: number | null; cPing: number | null; cFm: number | null;
  ok: boolean;
}
export interface Summary {
  bots: number; peakJoined: number; failed: number; degradedAt: number | null; degradedWhy: string | null; maxOkBots: number;
  worst: { lagP99: number; rttP95: number; gapP95: number; cpu: number; rssMb: number; rxMBps: number; botLag: number };
  stoppedEarly: boolean;
  /** motor do jogo no teste (rust/node) */ engine: string | null;
  /** resumo das medidas do navegador (null se nenhum navegador com ?perf mandou medidas) */
  client: { samples: number; sgMin: number; sgMax: number; mgMin: number; mgMax: number; fpsMin: number; pingMax: number; fmMax: number } | null;
}
type Options = Omit<LoadConfig, 'url' | 'bots'> & { count: number };

export class LoadTest {
  status: 'parado' | 'preparando' | 'rodando' | 'parando' = 'parado';
  options: Options | null = null;
  startedAt = 0;
  samples: Sample[] = [];
  logs: { t: number; text: string }[] = [];
  lastResult: string | null = null;
  private child: ChildProcess | null = null;
  private accountIds: number[] = [];
  private failures = 0;
  private badStreak = 0;
  private degraded: { at: number; bots: number; why: string } | null = null;
  private lastMsgOut: { t: number; n: number } | null = null;
  private stoppedEarly = false;
  private engine: string | null = null;

  constructor(private root: string, private game: GameProcess, private port: number) {}

  private log(text: string) {
    this.logs.push({ t: Date.now(), text });
    if (this.logs.length > 200) this.logs.shift();
    this.game.log('painel', 'Teste de carga: ' + text);
  }

  state() {
    return { status: this.status, options: this.options, startedAt: this.startedAt, samples: this.samples, logs: this.logs, limits: LIMITS, lastResult: this.lastResult, botsMax: BOTS_MAX, summary: this.samples.length ? this.summary() : null };
  }

  async start(o: Partial<Options>) {
    if (this.status !== 'parado') throw new AdminError('Já existe um teste em andamento.');
    if (!this.game.pid || this.game.status !== 'rodando') throw new AdminError('Inicie o servidor do jogo antes (Dashboard → Iniciar).');
    const num = (v: unknown, def: number, min: number, max: number) => { const n = Number(v); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def; };
    const opts: Options = {
      count: Math.round(num(o.count, 100, 1, BOTS_MAX)), ramp: num(o.ramp, 20, 1, 500), duration: Math.round(num(o.duration, 120, 10, 3600)),
      spread: Math.round(num(o.spread, 150, 0, 3000)), center: [num(o.center?.[0], 6976, 1, 15359), num(o.center?.[1], 3327, 1, 15359)], y: num(o.y, 100, -400, 2900),
      behavior: o.behavior === 'idle' || o.behavior === 'walk-chat' ? o.behavior : 'walk', workers: Math.round(num(o.workers, 0, 0, 32)),
    };
    this.status = 'preparando';
    this.options = opts;
    this.samples = []; this.logs = []; this.failures = 0; this.badStreak = 0; this.degraded = null; this.lastMsgOut = null; this.stoppedEarly = false; this.lastResult = null;
    try {
      const bots = await this.prepare(opts.count);
      const tokens = await this.game.loadtest<{ tokens: Record<number, string> }>('sessions', bots.map((b) => b.accountId));
      if (!tokens) throw new AdminError('O servidor do jogo não respondeu ao pedido de sessões (reinicie o jogo pelo painel para carregar a versão nova).');
      this.accountIds = bots.map((b) => b.accountId);
      const cfg: LoadConfig = { ...opts, url: `ws://127.0.0.1:${this.port}/ws`, bots: bots.filter((b) => tokens.tokens[b.accountId]).map((b) => ({ token: tokens.tokens[b.accountId], characterId: b.characterId })) };
      this.run(cfg);
    } catch (e) {
      this.status = 'parado';
      throw e instanceof AdminError ? e : new AdminError('Não consegui preparar o teste: ' + (e as Error).message);
    }
  }

  /** garante `n` contas de bot com um personagem cada (as que já existem são reaproveitadas) */
  private async prepare(n: number) {
    this.log(`preparando ${n} contas de bot…`);
    await query(`INSERT INTO accounts (username, authority) SELECT 'lt_bot' || lpad(i::text, 4, '0'), 'F' FROM generate_series(1, $1::int) i ON CONFLICT DO NOTHING`, [n]);
    await query(`INSERT INTO characters (account_id, slot, name, sex, hair_mesh, head_mesh)
      SELECT a.id, 0, 'LtBot' || substr(a.username, 7), (random() < .5)::int, 1 + floor(random() * 5)::int, 1 + floor(random() * 5)::int
      FROM accounts a WHERE a.username ~ $1 AND NOT EXISTS (SELECT 1 FROM characters c WHERE c.account_id = a.id AND NOT c.deleted)
      ON CONFLICT DO NOTHING`, [BOT_RE]);
    const r = await query<{ account_id: string; character_id: string }>(`
      SELECT a.id AS account_id, min(c.id) AS character_id FROM accounts a JOIN characters c ON c.account_id = a.id AND NOT c.deleted
      WHERE a.username ~ $1 GROUP BY a.id, a.username ORDER BY a.username LIMIT $2`, [BOT_RE, n]);
    if (r.rows.length < n) this.log(`só ${r.rows.length} bots com personagem (nome em uso por outro jogador?)`);
    return r.rows.map((x) => ({ accountId: Number(x.account_id), characterId: Number(x.character_id) }));
  }

  private run(cfg: LoadConfig) {
    const child = spawn(process.execPath, ['--import', 'tsx', 'tools/loadtest.ts'], { cwd: this.root, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, env: { ...process.env, FORCE_COLOR: '0' } });
    this.child = child;
    this.status = 'rodando';
    this.startedAt = Date.now();
    child.stdin!.write(JSON.stringify(cfg) + '\n');
    readline.createInterface({ input: child.stdout! }).on('line', (line) => {
      let m: Record<string, unknown>;
      try { m = JSON.parse(line); } catch { return; }
      if (m.t === 'log') this.log(String(m.text));
      else if (m.t === 'tick') void this.onTick(m);
    });
    child.stderr!.on('data', (d) => this.log(String(d).trim()));
    child.on('exit', () => void this.finish());
  }

  private async onTick(m: Record<string, unknown>) {
    const st = await this.game.stats();
    const g = st?.data, perf = g?.perf ?? null, cp = g?.clientPerf ?? null;
    const now = Date.now(), out = g ? g.msgOut : null;
    let srvMsgOut: number | null = null;
    if (out !== null && this.lastMsgOut) srvMsgOut = Math.round((out - this.lastMsgOut.n) / ((now - this.lastMsgOut.t) / 1000));
    if (out !== null) this.lastMsgOut = { t: now, n: out };
    const n = (k: string) => (typeof m[k] === 'number' ? m[k] as number : null);
    const s: Sample = {
      at: n('at') ?? 0, bots: n('joined') ?? 0, connected: n('connected') ?? 0, failed: n('failed') ?? 0, rxKBps: n('rxKBps') ?? 0, rxMsgs: n('rxMsgs') ?? 0, txMsgs: n('txMsgs') ?? 0, pulls: n('pulls') ?? 0,
      rttP50: n('rttP50') === null ? null : Math.round(n('rttP50')!), rttP95: n('rttP95') === null ? null : Math.round(n('rttP95')!), gapP95: n('gapP95'), botLag: n('botLag') ?? 0,
      lagP99: perf?.lagP99 ?? null, lagMax: perf?.lagMax ?? null, cpu: perf?.cpu ?? null, rssMb: g?.rssMb ?? null, players: g?.players.length ?? 0, srvMsgOut, ok: true,
      cSgMin: cp?.sg[0] ?? null, cSgMax: cp?.sg[1] ?? null, cMgMin: cp?.mg[0] ?? null, cMgMax: cp?.mg[1] ?? null, cFps: cp?.fps ?? null, cPing: cp?.ping ?? null, cFm: cp?.fm ?? null,
    };
    if (g?.engine) this.engine = g.engine;
    const why: string[] = [];
    if (s.lagP99 !== null && s.lagP99 > LIMITS.lagP99) why.push(`event loop ${s.lagP99} ms`);
    if (s.rttP95 !== null && s.rttP95 > LIMITS.rttP95) why.push(`RTT p95 ${s.rttP95} ms`);
    if (s.gapP95 !== null && s.gapP95 > LIMITS.gapP95) why.push(`intervalo dos 'states' ${s.gapP95} ms`);
    if ((n('newFailed') ?? 0) > 0) why.push(`${n('newFailed')} bots caíram/falharam`);
    if (!st) why.push('servidor não respondeu às estatísticas');
    s.ok = !why.length;
    this.badStreak = s.ok ? 0 : this.badStreak + 1;
    if (!this.degraded && this.badStreak >= 3) {
      const first = this.samples[this.samples.length - 2] ?? s;
      this.degraded = { at: s.at, bots: first.bots, why: why.join(', ') };
      this.log(`degradou com ~${first.bots} bots: ${why.join(', ')}`);
    }
    for (const e of (m.errors as string[] | undefined) ?? []) if (this.failures++ < 20) this.log('bot: ' + e);
    this.samples.push(s);
    if (this.samples.length > 3600) this.samples.shift();
  }

  summary(): Summary {
    const ok = this.samples.filter((s) => s.ok);
    const max = (f: (s: Sample) => number | null) => Math.max(0, ...this.samples.map((s) => f(s) ?? 0));
    return {
      bots: this.options?.count ?? 0, peakJoined: max((s) => s.bots), failed: this.samples.at(-1)?.failed ?? 0,
      degradedAt: this.degraded?.bots ?? null, degradedWhy: this.degraded?.why ?? null,
      maxOkBots: Math.max(0, ...ok.filter((s) => !this.degraded || s.at < this.degraded.at).map((s) => s.bots)),
      worst: { lagP99: max((s) => s.lagP99), rttP95: max((s) => s.rttP95), gapP95: max((s) => s.gapP95), cpu: max((s) => s.cpu), rssMb: max((s) => s.rssMb), rxMBps: Math.round(max((s) => s.rxKBps) / 102.4) / 10, botLag: max((s) => s.botLag) },
      stoppedEarly: this.stoppedEarly,
      engine: this.engine,
      client: (() => {
        const c = this.samples.filter((s) => s.cSgMax !== null);
        if (!c.length) return null;
        const mx = (f: (s: Sample) => number | null) => Math.max(0, ...c.map((s) => f(s) ?? 0));
        const mn = (f: (s: Sample) => number | null) => Math.min(...c.map((s) => f(s) ?? Infinity));
        return { samples: c.length, sgMin: mn((s) => s.cSgMin), sgMax: mx((s) => s.cSgMax), mgMin: mn((s) => s.cMgMin), mgMax: mx((s) => s.cMgMax), fpsMin: mn((s) => (s.cFps ? s.cFps : null)), pingMax: mx((s) => s.cPing), fmMax: mx((s) => s.cFm) };
      })(),
    };
  }

  stop() {
    if (this.status !== 'rodando' || !this.child) throw new AdminError('Nenhum teste rodando.');
    this.status = 'parando';
    this.stoppedEarly = true;
    this.child.stdin!.write('stop\n');
    const child = this.child;
    setTimeout(() => { if (this.child === child) child.kill(); }, 10_000);
  }

  private async finish() {
    this.child = null;
    if (this.accountIds.length) await this.game.loadtest('revoke', this.accountIds);
    const file = new Date(this.startedAt).toISOString().replace(/[:T]/g, '-').slice(0, 19) + '.json';
    try {
      fs.mkdirSync(DIR(this.root), { recursive: true });
      fs.writeFileSync(path.join(DIR(this.root), file), JSON.stringify({ startedAt: new Date(this.startedAt).toISOString(), options: this.options, limits: LIMITS, summary: this.summary(), samples: this.samples }));
      this.lastResult = file;
      this.log(`resultado salvo em data/loadtests/${file}`);
    } catch (e) { this.log('não consegui salvar o resultado: ' + (e as Error).message); }
    this.status = 'parado';
  }

  /** testes anteriores (mais novo primeiro), só o resumo */
  history() {
    let files: string[] = [];
    try { files = fs.readdirSync(DIR(this.root)).filter((f) => /^[\d-]+\.json$/.test(f)).sort().reverse(); } catch { return []; }
    return files.slice(0, 50).flatMap((f) => {
      try {
        const j = JSON.parse(fs.readFileSync(path.join(DIR(this.root), f), 'utf8')) as { startedAt: string; options: Options; summary: Summary };
        return [{ file: f, startedAt: j.startedAt, options: j.options, summary: j.summary }];
      } catch { return []; }
    });
  }

  result(file: string) {
    if (!/^[\d-]+\.json$/.test(file)) throw new AdminError('Arquivo inválido.');
    try { return JSON.parse(fs.readFileSync(path.join(DIR(this.root), file), 'utf8')); } catch { throw new AdminError('Resultado não encontrado.'); }
  }

  deleteResult(file: string) {
    if (!/^[\d-]+\.json$/.test(file)) throw new AdminError('Arquivo inválido.');
    fs.rmSync(path.join(DIR(this.root), file), { force: true });
  }

  /** apaga as contas de bot (e, em cascata, os personagens e itens delas) */
  async removeBots() {
    if (this.status !== 'parado') throw new AdminError('Espere o teste terminar.');
    const ids = (await query<{ id: string }>('SELECT id FROM accounts WHERE username ~ $1', [BOT_RE])).rows.map((r) => Number(r.id));
    if (!ids.length) return 0;
    if (this.game.pid) { await this.game.loadtest('revoke', ids); await new Promise((r) => setTimeout(r, 1500)); } // gravações de saída antes de apagar
    const r = await query('DELETE FROM accounts WHERE username ~ $1', [BOT_RE]);
    this.log(`${r.rowCount} contas de bot apagadas`);
    return r.rowCount ?? 0;
  }

  async botCount() {
    return Number((await query<{ n: string }>('SELECT count(*) AS n FROM accounts WHERE username ~ $1', [BOT_RE])).rows[0]?.n ?? 0);
  }

  /** painel fechando: encerra o teste junto */
  kill() { this.child?.kill(); }
}
