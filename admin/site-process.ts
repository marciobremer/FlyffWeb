import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { AdminError } from '../servers/common/errors';

/**
 * O site (htdocs, Next.js): processo próprio, só em 127.0.0.1 — o servidor do jogo (porta 8080) repassa a ele tudo que não é do
 * jogo (`servers/main.ts`), então http://localhost:8080 mostra o site. Controlado pelo painel junto com o jogo.
 * Roda `next start` (produção; precisa do `npm run build` na pasta htdocs — o painel compila se faltar).
 */
export type SiteStatus = 'parado' | 'iniciando' | 'rodando' | 'parando' | 'compilando' | 'erro';

export class SiteProcess {
  status: SiteStatus = 'parado';
  pid: number | null = null;
  private child: ChildProcess | null = null;

  constructor(readonly dir: string, readonly port: number, private log: (text: string) => void) {}

  get exists() { return fs.existsSync(path.join(this.dir, 'package.json')); }
  get built() { return fs.existsSync(path.join(this.dir, '.next', 'BUILD_ID')); }

  private portBusy(): Promise<boolean> {
    return new Promise((resolve) => {
      const s = net.connect({ port: this.port, host: '127.0.0.1' });
      s.once('connect', () => { s.destroy(); resolve(true); });
      s.once('error', () => resolve(false));
      s.setTimeout(800, () => { s.destroy(); resolve(false); });
    });
  }

  async start() {
    if (this.child) return;
    if (!this.exists) throw new AdminError('Pasta do site (htdocs) não encontrada.');
    if (!this.built) throw new AdminError('O site ainda não foi compilado (use "Compilar").');
    if (await this.portBusy()) throw new AdminError(`A porta ${this.port} do site já está em uso por outro processo.`);
    this.status = 'iniciando';
    this.log(`Iniciando o site na porta ${this.port}…`);
    const child = spawn(process.execPath, [path.join('node_modules', 'next', 'dist', 'bin', 'next'), 'start', '-p', String(this.port), '-H', '127.0.0.1'], {
      cwd: this.dir, env: { ...process.env, NODE_ENV: 'production', FORCE_COLOR: '0' }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
    });
    this.child = child;
    this.pid = child.pid ?? null;
    const onData = (d: Buffer) => { const t = String(d); this.log(t); if (this.status === 'iniciando' && /Ready|ready in|Local:/.test(t)) this.status = 'rodando'; };
    child.stdout!.on('data', onData);
    child.stderr!.on('data', onData);
    child.on('exit', (code, signal) => {
      this.log(`Site encerrado (${signal ?? 'código ' + code}).`);
      this.status = this.status === 'parando' || code === 0 ? 'parado' : 'erro';
      this.child = null; this.pid = null;
    });
    child.on('error', (e) => { this.log('Falha ao iniciar o site: ' + e.message); this.status = 'erro'; });
  }

  async stop() {
    const child = this.child;
    if (!child) return;
    this.status = 'parando';
    const done = new Promise<void>((r) => child.once('exit', () => r()));
    child.kill();
    const timer = setTimeout(() => { if (this.child === child) child.kill('SIGKILL'); }, 5000);
    await done;
    clearTimeout(timer);
  }

  /** `npm run build` (next build) na pasta do site */
  build(): Promise<boolean> {
    if (!this.exists) return Promise.resolve(false);
    const before = this.status;
    this.status = 'compilando';
    this.log('Compilando o site (next build)…');
    return new Promise((resolve) => {
      const child = spawn('npm', ['run', 'build'], { cwd: this.dir, shell: true, windowsHide: true, env: { ...process.env, FORCE_COLOR: '0', NEXT_TELEMETRY_DISABLED: '1' } });
      child.stdout.on('data', (d) => this.log(String(d)));
      child.stderr.on('data', (d) => this.log(String(d)));
      child.on('exit', (code) => {
        this.log(code === 0 ? 'Site compilado.' : `Compilação do site falhou (código ${code}).`);
        this.status = this.child ? 'rodando' : before === 'erro' ? 'erro' : 'parado';
        resolve(code === 0);
      });
    });
  }
}
