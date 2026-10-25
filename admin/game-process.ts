import { spawn, type ChildProcess } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { AdminError } from '../servers/common/errors';

/**
 * Processo do servidor do jogo (`servers/main.ts`) controlado pelo painel: iniciar, parar, compilar (`npm run build`) e logs.
 * Roda como `node --import tsx servers/main.ts` (um processo só — o CLI do tsx criaria um filho que ficaria órfão ao parar).
 * A cada início gera um ADMIN_TOKEN para os endpoints `/internal/*` do jogo.
 */
export type GameStatus = 'parado' | 'iniciando' | 'rodando' | 'parando' | 'compilando' | 'erro';

export interface LogLine { t: number; src: 'jogo' | 'build' | 'painel' | 'site'; text: string }

export class GameProcess {
  status: GameStatus = 'parado';
  pid: number | null = null;
  startedAt = 0;
  lastExit: number | null = null;
  readonly logs: LogLine[] = [];
  private child: ChildProcess | null = null;
  private token = '';

  constructor(readonly root: string, readonly port: number) {}

  log(src: LogLine['src'], text: string) {
    // tira os códigos de cor do terminal (o Vite colore mesmo com FORCE_COLOR=0)
    for (const line of text.replace(/\x1b\[[0-9;]*m/g, '').split(/\r?\n/)) {
      if (!line.trim()) continue;
      this.logs.push({ t: Date.now(), src, text: line });
    }
    if (this.logs.length > 600) this.logs.splice(0, this.logs.length - 600);
  }

  get distReady() { return fs.existsSync(path.join(this.root, 'dist', 'index.html')); }

  /** porta ocupada por outro processo (ex.: um `npm start` aberto fora do painel)? */
  private portBusy(): Promise<boolean> {
    return new Promise((resolve) => {
      const s = net.connect({ port: this.port, host: '127.0.0.1' });
      s.once('connect', () => { s.destroy(); resolve(true); });
      s.once('error', () => resolve(false));
      s.setTimeout(800, () => { s.destroy(); resolve(false); });
    });
  }

  async start() {
    if (this.child) throw new AdminError('O servidor já está rodando.');
    if (this.status === 'compilando') throw new AdminError('Aguarde a compilação terminar.');
    if (!this.distReady) throw new AdminError('Falta compilar o jogo (dist/ não existe). Use "Compilar".');
    if (await this.portBusy()) throw new AdminError(`A porta ${this.port} já está em uso por outro processo (um "npm start" aberto fora do painel?). Feche-o e tente de novo.`);
    this.token = crypto.randomBytes(24).toString('base64url');
    this.status = 'iniciando';
    this.log('painel', `Iniciando o servidor do jogo na porta ${this.port}…`);
    const child = spawn(process.execPath, ['--import', 'tsx', 'servers/main.ts'], {
      cwd: this.root,
      env: { ...process.env, PORT: String(this.port), ADMIN_TOKEN: this.token, FORCE_COLOR: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    this.child = child;
    this.pid = child.pid ?? null;
    this.startedAt = Date.now();
    child.stdout!.on('data', (d) => this.log('jogo', String(d)));
    child.stderr!.on('data', (d) => this.log('jogo', String(d)));
    child.on('exit', (code, signal) => {
      this.log('painel', `Servidor do jogo encerrado (${signal ?? 'código ' + code}).`);
      this.status = this.status === 'parando' || code === 0 ? 'parado' : 'erro';
      this.lastExit = code;
      this.child = null; this.pid = null; this.startedAt = 0; this.token = '';
    });
    child.on('error', (e) => { this.log('painel', 'Falha ao iniciar: ' + e.message); this.status = 'erro'; });
  }

  async stop() {
    const child = this.child;
    if (!child) throw new AdminError('O servidor não está rodando.');
    this.status = 'parando';
    this.log('painel', 'Parando o servidor do jogo… (jogadores online são desconectados; a posição de cada um é salva)');
    const done = new Promise<void>((r) => child.once('exit', () => r()));
    // pede para o jogo gravar todo mundo e sair sozinho (no Windows child.kill() mata na hora, sem chance de gravar)
    let graceful = false;
    if (this.token) {
      try { graceful = (await fetch(`http://127.0.0.1:${this.port}/internal/shutdown`, { method: 'POST', headers: { 'x-admin-token': this.token }, signal: AbortSignal.timeout(10000) })).ok; } catch { /* cai no kill */ }
    }
    if (!graceful) child.kill();
    const timer = setTimeout(() => { if (this.child === child) { this.log('painel', 'Não respondeu em 5 s — forçando o encerramento.'); child.kill('SIGKILL'); } }, 5000);
    await done;
    clearTimeout(timer);
  }

  /** `npm run build` (typecheck + vite build) com a saída nos logs */
  build(): Promise<boolean> {
    if (this.status === 'compilando') return Promise.reject(new AdminError('Já está compilando.'));
    const before = this.status;
    this.status = 'compilando';
    this.log('painel', 'Compilando o jogo (npm run build)…');
    return new Promise((resolve) => {
      const child = spawn('npm', ['run', 'build'], { cwd: this.root, shell: true, windowsHide: true, env: { ...process.env, FORCE_COLOR: '0' } });
      child.stdout.on('data', (d) => this.log('build', String(d)));
      child.stderr.on('data', (d) => this.log('build', String(d)));
      child.on('exit', (code) => {
        const ok = code === 0;
        this.log('painel', ok ? 'Compilação concluída.' : `Compilação falhou (código ${code}).`);
        this.status = this.child ? 'rodando' : before === 'erro' ? 'erro' : 'parado';
        resolve(ok);
      });
    });
  }

  /** estatísticas do jogo via /internal/stats (null se não responder) + latência da resposta */
  async stats(): Promise<{ latencyMs: number; data: GameStats } | null> {
    if (!this.child || !this.token) return null;
    const t0 = performance.now();
    try {
      const r = await fetch(`http://127.0.0.1:${this.port}/internal/stats`, { headers: { 'x-admin-token': this.token }, signal: AbortSignal.timeout(1500) });
      if (!r.ok) return null;
      const data = await r.json() as GameStats;
      if (this.status === 'iniciando') { this.status = 'rodando'; this.log('painel', 'Servidor do jogo respondendo.'); }
      return { latencyMs: Math.round(performance.now() - t0), data };
    } catch { return null; }
  }

  /** letreiro para todos os jogadores online; null se o jogo não estiver rodando pelo painel ou não responder */
  async announce(text: string, loops: number): Promise<{ sent: number } | null> {
    if (!this.child || !this.token) return null;
    try {
      const r = await fetch(`http://127.0.0.1:${this.port}/internal/announce`, {
        method: 'POST', headers: { 'x-admin-token': this.token, 'content-type': 'application/json' },
        body: JSON.stringify({ text, loops }), signal: AbortSignal.timeout(2000),
      });
      return r.ok ? await r.json() as { sent: number } : null;
    } catch { return null; }
  }

  async kick(accountId: number, reason: string): Promise<{ kicked: number; revoked: number } | null> {
    if (!this.child || !this.token) return null;
    try {
      const r = await fetch(`http://127.0.0.1:${this.port}/internal/kick`, {
        method: 'POST', headers: { 'x-admin-token': this.token, 'content-type': 'application/json' },
        body: JSON.stringify({ accountId, reason }), signal: AbortSignal.timeout(2000),
      });
      return r.ok ? await r.json() as { kicked: number; revoked: number } : null;
    } catch { return null; }
  }
}

export interface GameStats {
  uptimeMs: number; rssMb: number; inventory?: { cached: number; pending: number }; dbQueries?: number; dbTransactions?: number; sessions: number; connections: number; msgIn: number; msgOut: number; sockets: number; mobs: number;
  players: { accountId: number; characterId: number; name: string; level: number; p: [number, number, number] }[];
}
