import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../common/config';

/**
 * Sobe e vigia o Game Server em Rust (game-server/) quando GAME_ENGINE=rust — assim o mesmo ".Iniciar Servidor.bat" liga tudo.
 * Chamado pelo `startWorld` antes do `attachRealtime`. Se algo faltar (binário, cargo, pacote do mapa) avisa e cai para o
 * Node (GAME_ENGINE vira vazio): o jogo sempre sobe.
 *
 *  - segredo do link: data/rust-link.secret (criado na 1ª vez; só loopback) → GAME_LINK_SECRET
 *  - binário: game-server/target/release/game-server(.exe); se não existe e há `cargo`, compila (a 1ª vez demora)
 *  - pacote do mapa: data/mappack/<Mundo>; se não existe, gera com tools/export-mappack.ts
 *  - reinicia o Rust se ele cair (o link do Node reconecta sozinho e, enquanto isso, o Node simula os mobs)
 *  - sobra de execução anterior (pid em data/rust.pid) é encerrada antes de subir
 */
const EXE = process.platform === 'win32' ? 'game-server.exe' : 'game-server';

let child: ChildProcess | null = null;
let stopping = false;

function killStale(pidFile: string) {
  try {
    const pid = Number(fs.readFileSync(pidFile, 'utf8'));
    if (!pid) return;
    // só mata se o pid ainda for mesmo o game-server (pid reaproveitado por outro programa não é tocado)
    const img = process.platform === 'win32'
      ? spawnSync('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], { encoding: 'utf8' }).stdout
      : spawnSync('ps', ['-p', String(pid), '-o', 'comm='], { encoding: 'utf8' }).stdout;
    if (img.toLowerCase().includes('game-server')) { process.kill(pid); console.log(`[rust] encerrei o game-server antigo (pid ${pid})`); }
  } catch { /* sem pid antigo */ }
}

export function startRustEngine(world: string): void {
  if (process.env.GAME_ENGINE !== 'rust') return;
  const fallback = (why: string) => { console.warn(`[rust] ${why} — seguindo com o motor Node.`); process.env.GAME_ENGINE = ''; };

  const dataDir = path.join(ROOT, 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  const secretFile = path.join(dataDir, 'rust-link.secret'), pidFile = path.join(dataDir, 'rust.pid');
  let secret = process.env.GAME_LINK_SECRET ?? '';
  if (!secret) {
    try { secret = fs.readFileSync(secretFile, 'utf8').trim(); } catch { /* ainda não existe */ }
    if (!secret) { secret = crypto.randomBytes(24).toString('base64url'); fs.writeFileSync(secretFile, secret); }
    process.env.GAME_LINK_SECRET = secret;
  }
  const port = Number(process.env.RUST_LINK_PORT ?? 9201);

  const crate = path.join(ROOT, 'game-server');
  const bin = path.join(crate, 'target', 'release', EXE);
  if (!fs.existsSync(bin)) {
    if (spawnSync('cargo', ['--version'], { shell: true }).status !== 0) return fallback('cargo não encontrado e game-server não está compilado');
    console.log('[rust] compilando o game-server (cargo build --release) — a primeira vez demora alguns minutos…');
    const b = spawnSync('cargo', ['build', '--release'], { cwd: crate, shell: true, stdio: 'inherit' });
    if (b.status !== 0 || !fs.existsSync(bin)) return fallback('a compilação do game-server falhou');
  }

  const pack = path.join(dataDir, 'mappack', world);
  if (!fs.existsSync(path.join(pack, 'pack.json'))) {
    console.log(`[rust] gerando o pacote do mapa ${world}…`);
    const e = spawnSync(process.execPath, ['--import', 'tsx', 'tools/export-mappack.ts', world], { cwd: ROOT, stdio: 'inherit' });
    if (e.status !== 0 || !fs.existsSync(path.join(pack, 'pack.json'))) return fallback('não consegui gerar o pacote do mapa');
  }

  killStale(pidFile);
  let delay = 1000;
  const run = () => {
    if (stopping) return;
    const args = ['--pack', pack, '--listen', `127.0.0.1:${port}`, '--secret', secret];
    if (process.env.RUST_COMBAT === '1') args.push('--rust-combat');
    const c = spawn(bin, args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    child = c;
    try { fs.writeFileSync(pidFile, String(c.pid)); } catch { /* sem pid */ }
    const out = (d: Buffer) => { for (const l of String(d).split(/\r?\n/)) if (l.trim()) console.log(`[rust] ${l}`); };
    c.stdout.on('data', (d) => { delay = 1000; out(d); });
    c.stderr.on('data', out);
    c.on('exit', (code, sig) => {
      child = null;
      if (stopping) return;
      console.error(`[rust] game-server saiu (${sig ?? 'código ' + code}) — reiniciando em ${Math.round(delay / 1000)} s`);
      setTimeout(run, delay);
      delay = Math.min(15_000, delay * 2);
    });
    c.on('error', (e) => console.error('[rust] falha ao iniciar:', e.message));
  };
  run();
  const stop = () => { stopping = true; child?.kill(); try { fs.unlinkSync(pidFile); } catch { /* ok */ } };
  process.on('exit', stop);
}
