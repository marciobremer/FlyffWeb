import http from 'node:http';
import WebSocket from 'ws';

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
/** o bot não tem terreno: quem anda de verdade é o cliente, que calcula a altura. Para ficar no chão, copia a posição (e a altura) de quem segue. */
setInterval(() => {
  if (!follow || ws?.readyState !== WebSocket.OPEN) return;
  const id = [...names.entries()].find(([, n]) => n === follow)?.[0];
  const p = id !== undefined ? others.get(id) : undefined;
  if (!p) return;
  const to = [p[0] + 1.5, p[1], p[2] + 1.5];
  if (Math.hypot(to[0] - myPos[0], to[2] - myPos[2]) < 0.3 && Math.abs(to[1] - myPos[1]) < 0.3) return;
  ws.send(JSON.stringify({ t: 'state', p: to, h: 0, s: 'stand' }));
  myPos = to;
}, 500);
setInterval(() => {
  if (!auto || ws?.readyState !== WebSocket.OPEN) return;
  const t = nearest();
  if (!t) return;
  if (t.d > 3) { if (Date.now() - lastTp > 1600) { lastTp = Date.now(); ws.send(JSON.stringify({ t: 'chat', text: `//tp ${Math.round(t.x)} ${Math.round(t.z)}` })); } return; }
  ws.send(JSON.stringify({ t: 'atk', id: t.id }));
}, 700);

http.createServer((req, res) => {
  let body = '';
  req.on('data', (d) => { body += d; if (body.length > 2000) req.destroy(); });
  req.on('end', () => {
    const text = body.trim();
    if (req.url === '/say' && text && ws?.readyState === WebSocket.OPEN) { ws.send(JSON.stringify({ t: 'chat', text })); res.end('ok'); }
    else if (req.url === '/move' && ws?.readyState === WebSocket.OPEN) { const q = text.split(/\s+/).map(Number); follow = ''; ws.send(JSON.stringify({ t: 'state', p: q.slice(0, 3), h: q[3] ?? 0, s: 'stand' })); myPos = q.slice(0, 3); res.end('ok'); }
    else if (req.url === '/follow') { follow = text === 'off' ? '' : text; res.end(`follow ${follow || 'off'}`); }
    else if (req.url === '/auto') { auto = text !== 'off'; res.end(`auto ${auto}`); }
    else if (req.url === '/mobs') res.end(JSON.stringify([...mobs.entries()].slice(0, 15).map(([id, v]) => ({ id, model: v[0], x: v[1], z: v[2], s: v[3], hp: v[4] }))));
    else if (req.url === '/atk' && ws?.readyState === WebSocket.OPEN) { ws.send(JSON.stringify({ t: 'atk', id: Number(text) })); res.end('ok'); }
    else if (req.url === '/who') res.end(JSON.stringify({ me, pos: myPos, near: [...names.values()], mobs: mobs.size }));
    else if (req.url === '/quit') { res.end('bye'); setTimeout(() => process.exit(0), 100); }
    else { res.statusCode = 400; res.end('use POST /say, GET /who, /quit'); }
  });
}).listen(Number(ctlPort), '127.0.0.1');
