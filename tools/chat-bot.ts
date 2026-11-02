import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import WebSocket from 'ws';
import { RES_DIR } from '../servers/common/config';
import { parseLnd } from '../shared/formats/lnd';
import { parseWld, tileFileName } from '../shared/formats/wld';
import { decodeText } from '../shared/formats/rgn';
import { MAP_SIZE } from '../shared/formats/types';

/**
 * Bot de chat de desenvolvimento: entra no jogo como um jogador comum (mesmo WebSocket do cliente, segue o redirect para o
 * Rust) e deixa conversar/testar por ele.
 *
 *   npx tsx tools/chat-bot.ts <usuário> <senha> [personagem] [servidor=localhost:8080] [porta-de-controle=9199]
 *
 * Saída (uma linha por evento, para acompanhar com `tail`/Monitor):
 *   CHAT <nome>: <texto>      chat de outros jogadores        SYS: <texto>   avisos do servidor (respostas de //comandos)
 *   ENTER <nome> / LEAVE <id> jogadores que entraram/saíram da visão
 *   HIT … / DIE …             golpes e mortes perto
 * Controle (só loopback):  curl -d "oi" localhost:9199/say     (texto de chat ou //comando)
 */
const [user, pass, wanted, base = 'localhost:8080', ctlPort = '9199'] = process.argv.slice(2);
if (!pass) { console.error('uso: chat-bot.ts <usuário> <senha> [personagem] [servidor] [porta-de-controle]'); process.exit(2); }

const out = (s: string) => console.log(s);

/**
 * Altura do terreno no ponto (x, z): o bot não tem terreno, e o cliente de verdade calcula o próprio Y e manda no `state`.
 * Lê os .lnd do cliente FlyFF (mesmos dados do jogo) e interpola entre os vértices; não conhece pontes/objetos.
 */
const WORLD = 'WdMadrigal';
const worldDir = path.join(RES_DIR, 'World', WORLD);
const fileOf = new Map(fs.readdirSync(worldDir).map((f) => [f.toLowerCase(), f]));
const readAb = (f: string) => { const b = fs.readFileSync(path.join(worldDir, fileOf.get(f.toLowerCase()) ?? f)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer; };
const wld = parseWld(decodeText(readAb(`${WORLD}.wld`)));
const tileSize = MAP_SIZE * wld.mpu;
const tiles = new Map<string, Float32Array | null>();
function tileHeights(tx: number, tz: number) {
  const k = `${tx},${tz}`;
  let h = tiles.get(k);
  if (h === undefined) { try { h = parseLnd(readAb(tileFileName(WORLD, tx, tz)), tx, tz, wld.mpu).heights; } catch { h = null; } tiles.set(k, h); }
  return h;
}
function groundY(x: number, z: number, fallback: number) {
  const tx = Math.floor(x / tileSize), tz = Math.floor(z / tileSize), h = tileHeights(tx, tz);
  if (!h) return fallback;
  const S = MAP_SIZE + 1, fx = (x - tx * tileSize) / wld.mpu, fz = (z - tz * tileSize) / wld.mpu;
  const i = Math.min(MAP_SIZE - 1, Math.max(0, Math.floor(fx))), j = Math.min(MAP_SIZE - 1, Math.max(0, Math.floor(fz))), u = fx - i, v = fz - j;
  const a = h[j * S + i], b = h[j * S + i + 1], c = h[(j + 1) * S + i], d = h[(j + 1) * S + i + 1];
  return a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v;
}
const r = await fetch(`http://${base}/gapi/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: user, password: pass }) });
if (!r.ok) { console.error('login recusado', r.status); process.exit(1); }
const acc: any = await r.json();
const ch = acc.characters.find((c: any) => c.name === wanted) ?? acc.characters[0];
out(`BOT conta ${user}, personagem ${ch.name} (nv ${ch.level})`);

let ws: WebSocket | null = null, me = 0, myPos: number[] = [0, 0, 0];
const names = new Map<number, string>();
/** mobs que o servidor mostra para o bot: id → [modelo, x, z, estado, hp em milésimos] */
const mobs = new Map<number, [number, number, number, string, number]>();
let auto = false;
/** última posição conhecida dos outros jogadores (id → [x, y, z]) e quem o bot está seguindo */
const others = new Map<number, number[]>();
let follow = '';
const hostName = base.split(':')[0];
function connect(url: string) {
  const s = new WebSocket(url);
  ws = s;
  let redirected = false;
  s.on('open', () => s.send(JSON.stringify({ t: 'join', token: acc.token, characterId: ch.id, p: [0, 0, 0] })));
  s.on('message', (raw) => {
    const m = JSON.parse(String(raw));
    switch (m.t) {
      case 'redirect': redirected = true; s.close(); connect(`ws://${hostName}:${m.port}/ws`); out(`BOT segue o redirect para a porta ${m.port}`); break;
      case 'welcome': me = m.id; myPos = m.p; out(`BOT no mundo em ${m.p.map((v: number) => Math.round(v)).join(', ')} (id ${m.id})`); break;
      case 'enter': others.set(m.player.id, m.player.p); names.set(m.player.id, m.player.name); out(`ENTER ${m.player.name} (nv ${m.player.level}) em ${m.player.p.map((v: number) => Math.round(v)).join(', ')}`); break;
      case 'states': for (const e of m.list) others.set(e[0], [e[1], e[2], e[3]]); break;
      case 'leave': out(`LEAVE ${names.get(m.id) ?? m.id}`); break;
      case 'chat': if (m.id === 0) out(`SYS: ${m.text}`); else if (m.id !== me) out(`CHAT ${m.name}: ${m.text}`); break;
      case 'mobs':
        for (const e of m.a ?? []) mobs.set(e[0], [e[1], e[2], e[3], e[5], e[7]]);
        for (const e of m.u ?? []) { const o = mobs.get(e[0]); if (o) { o[1] = e[1]; o[2] = e[2]; o[3] = e[4]; o[4] = e[5]; } }
        for (const id of m.d ?? []) mobs.delete(id);
        break;
      case 'pm': out(`PM ${m.name}: ${m.text}`); break;
      case 'teleport': myPos = m.p; out(`BOT teleportado para ${m.p.map((v: number) => Math.round(v)).join(', ')}`); break;
      case 'hit':
        if (m.k === 'm' && m.d === me) out(`HIT mob ${m.a} bateu em mim: ${m.dmg} (hp ${m.hp})`);
        else if (m.k === 'p' && m.a === me) out(`HIT eu bati no mob ${m.d}: ${m.dmg}${m.f & 1 ? ' (errou)' : ''}${m.f & 2 ? ' (crítico)' : ''} — mob com ${m.hp / 10}% do HP`);
        break;
      case 'mdie': if (m.k === me) out(`KILL matei o mob ${m.id}`); mobs.delete(m.id); break;
      case 'pdie': out(`DIE ${names.get(m.id) ?? (m.id === me ? 'EU' : m.id)} morreu`); break;
      case 'error': out(`ERRO ${m.error}`); break;
    }
  });
  s.on('close', () => { if (!redirected) { out('BOT desconectado'); process.exit(0); } });
  s.on('error', (e) => out(`BOT erro: ${e.message}`));
}
connect(`ws://${base}/ws`);
setInterval(() => { if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ t: 'ping', c: performance.now() })); }, 10_000);

/** o mob vivo mais perto do bot */
const nearest = () => [...mobs.entries()].filter(([, v]) => v[3] !== 'dead').map(([id, v]) => ({ id, x: v[1], z: v[2], d: Math.hypot(v[1] - myPos[0], v[2] - myPos[2]) })).sort((a, b) => a.d - b.d)[0];
let lastTp = 0;
/**
 * Seguir um jogador como um cliente de verdade: anda até perto dele a ~6 u/s mandando `state` a cada 100 ms com o estado
 * 'run' (é ele que faz o cliente tocar a animação de correr) e 'stand' ao parar, com a altura do terreno.
 */
let lastS = 'stand';
const RUN = 6;
setInterval(() => {
  if (!follow || ws?.readyState !== WebSocket.OPEN) return;
  const id = [...names.entries()].find(([, n]) => n === follow)?.[0];
  const t = id !== undefined ? others.get(id) : undefined;
  if (!t) return;
  const dx = t[0] - myPos[0], dz = t[2] - myPos[2], dist = Math.hypot(dx, dz);
  if (dist > 2.5) {
    const step = Math.min(dist - 2, RUN * 0.1);
    const x = myPos[0] + (dx / dist) * step, z = myPos[2] + (dz / dist) * step;
    myPos = [x, groundY(x, z, t[1]), z];
    ws.send(JSON.stringify({ t: 'state', p: myPos, h: (Math.atan2(dx, -dz) * 180) / Math.PI, s: 'run' }));
    lastS = 'run';
  } else if (lastS !== 'stand') {
    ws.send(JSON.stringify({ t: 'state', p: myPos, h: 0, s: 'stand' }));
    lastS = 'stand';
  }
}, 100);
setInterval(() => {
  if (!auto || ws?.readyState !== WebSocket.OPEN) return;
  const t = nearest();
  if (!t) return;
  if (t.d > 3) { if (Date.now() - lastTp > 1600) { lastTp = Date.now(); ws.send(JSON.stringify({ t: 'chat', text: `//tp ${Math.round(t.x)} ${Math.round(t.z)}` })); } return; }
  ws.send(JSON.stringify({ t: 'atk', id: t.id }));
}, 700);

http.createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on('data', (d: Buffer) => { chunks.push(d); if (chunks.reduce((n, c) => n + c.length, 0) > 2000) req.destroy(); });
  req.on('end', () => {
    const bytes = Buffer.concat(chunks);
    let text: string;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { text = new TextDecoder('windows-1252').decode(bytes); }
    text = text.trim();
    if (req.url === '/say' && text && ws?.readyState === WebSocket.OPEN) { ws.send(JSON.stringify({ t: 'chat', text })); res.end('ok'); }
    else if (req.url === '/move' && ws?.readyState === WebSocket.OPEN) { const q = text.split(/\s+/).map(Number); follow = ''; if (q.length === 2) q.splice(1, 0, groundY(q[0], q[1], myPos[1])); ws.send(JSON.stringify({ t: 'state', p: q.slice(0, 3), h: q[3] ?? 0, s: 'stand' })); myPos = q.slice(0, 3); res.end('ok'); }
    else if (req.url === '/follow') { follow = text === 'off' ? '' : text; res.end(`follow ${follow || 'off'}`); }
    else if (req.url === '/auto') { auto = text !== 'off'; res.end(`auto ${auto}`); }
    else if (req.url === '/mobs') res.end(JSON.stringify([...mobs.entries()].slice(0, 15).map(([id, v]) => ({ id, model: v[0], x: v[1], z: v[2], s: v[3], hp: v[4] }))));
    else if (req.url === '/atk' && ws?.readyState === WebSocket.OPEN) { ws.send(JSON.stringify({ t: 'atk', id: Number(text) })); res.end('ok'); }
    else if (req.url === '/who') res.end(JSON.stringify({ me, pos: myPos, near: [...names.values()], mobs: mobs.size }));
    else if (req.url === '/quit') { res.end('bye'); setTimeout(() => process.exit(0), 100); }
    else { res.statusCode = 400; res.end('use POST /say, GET /who, /quit'); }
  });
}).listen(Number(ctlPort), '127.0.0.1');
