import net from 'node:net';
import WebSocket from 'ws';

/**
 * Ponta a ponta da visão de JOGADORES no Rust (GAME_ENGINE=rust): dois jogadores reais pelo WebSocket do jogo.
 *   BASE=localhost:9080 npx tsx tools/test-rust-players.ts <GM> <senha> <jogador2> <senha2> <segredo-do-link>
 * A primeira conta precisa ser GM (usa //summon, //tp, //invis). Confere: ver o outro por perto, `states` de movimento,
 * `leave` ao se afastar, GM invisível some para quem não é staff e volta, e as contagens do Rust (see_enter, state_updates).
 */
const BASE = process.env.BASE ?? 'localhost:9080';
const [u1, p1, u2, p2, secret = 'teste'] = process.argv.slice(2);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const check = (ok: boolean, what: string) => { console.log(`${ok ? 'OK  ' : 'FALHA'} ${what}`); if (!ok) fails++; };

async function login(u: string, p: string) {
  const r = await fetch(`http://${BASE}/gapi/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: u, password: p }) });
  return (await r.json()) as any;
}
interface C { ws: WebSocket; id: number; name: string; msgs: any[]; send(m: unknown): void }
async function join(u: string, p: string): Promise<C> {
  const a = await login(u, p), ch = a.characters[0];
  const ws = new WebSocket(`ws://${process.env.WS_BASE ?? BASE}/ws`);
  const c: C = { ws, id: ch.id, name: ch.name, msgs: [], send: (m) => ws.send(JSON.stringify(m)) };
  ws.on('message', (raw) => c.msgs.push(JSON.parse(String(raw))));
  await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
  c.send({ t: 'join', token: a.token, characterId: ch.id });
  for (let i = 0; i < 50 && !c.msgs.some((m) => m.t === 'welcome'); i++) await sleep(100);
  return c;
}
const saw = (c: C, from: number, t: string, id: number) => c.msgs.slice(from).some((m) => m.t === t && (m.id === id || m.player?.id === id));
const stats = () => new Promise<any>((resolve, reject) => {
  const s = net.connect(9201, '127.0.0.1'); let buf = Buffer.alloc(0), step = 0;
  const w = (v: unknown) => { const b = Buffer.from(JSON.stringify(v)); const h = Buffer.alloc(4); h.writeUInt32BE(b.length); s.write(Buffer.concat([h, b])); };
  s.on('connect', () => w({ k: 'hello', secret, version: 1, probe: true })); s.on('error', reject);
  s.on('data', (d) => { buf = Buffer.concat([buf, d]); while (buf.length >= 4 && buf.length >= 4 + buf.readUInt32BE(0)) { const n = buf.readUInt32BE(0); const m = JSON.parse(buf.subarray(4, 4 + n).toString()); buf = buf.subarray(4 + n); if (m.k === 'hello_ok' && step++ === 0) w({ k: 'stats' }); else if (m.k === 'stats') { s.end(); resolve(m); } } });
  setTimeout(() => reject(new Error('stats timeout')), 3000);
});

const A = await join(u1, p1), B = await join(u2, p2);
const st0 = await stats();
// começa com os dois longe um do outro (B é G: pode //tp; A vai para o outro lado do mapa)
B.send({ t: 'chat', text: '//tp 12000 3000' }); A.send({ t: 'chat', text: '//tp 6744 2995' }); await sleep(2500);
let ma = A.msgs.length, mb = B.msgs.length;
A.send({ t: 'chat', text: `//summon ${B.name}` }); await sleep(2500); // B vem até A (longe do ponto em que estava)
check(saw(A, ma, 'enter', B.id), `A vê ${B.name} depois de trazê-lo (enter)`);
check(saw(B, mb, 'enter', A.id), `${B.name} vê ${A.name} (enter)`);

// B anda: A recebe `states` com ele
ma = A.msgs.length;
const tpB = [...B.msgs].reverse().find((m) => m.t === 'teleport'); // onde o //summon deixou B
let pos: number[] = tpB ? [...tpB.p] : [6745, 100, 2995];
for (let i = 0; i < 10; i++) { pos = [pos[0] + 0.8, 100, pos[2]]; B.send({ t: 'state', p: pos, h: 90, s: 'run' }); await sleep(110); }
await sleep(400);
const states = A.msgs.slice(ma).filter((m) => m.t === 'states').flatMap((m) => m.list).filter((e: any) => e[0] === B.id);
check(states.length >= 3, `A recebeu ${states.length} atualizações de posição de ${B.name} (states do Rust)`);

// A fica invisível: B aqui é staff (teste2 = autoridade G), então CONTINUA vendo (o 'invis' chega, sem leave).
// Quem não é staff sumir é coberto pelo teste Rust (cargo test --test link) e por um jogador comum (F), que não há com senha aqui.
mb = B.msgs.length;
A.send({ t: 'chat', text: '//invis' }); await sleep(1500);
check(!saw(B, mb, 'leave', A.id) && B.msgs.slice(mb).some((m) => m.t === 'invis' && m.id === A.id && m.on), `GM invisível: ${B.name} (staff) segue vendo, recebe 'invis'`);
A.send({ t: 'chat', text: '//invis' }); await sleep(800);

// A vai para longe: os dois se esquecem
ma = A.msgs.length; mb = B.msgs.length;
A.send({ t: 'chat', text: '//tp 12000 3000' }); await sleep(2500);
check(saw(B, mb, 'leave', A.id), `${B.name} deixa de ver o GM que foi para longe (leave)`);
check(saw(A, ma, 'leave', B.id), 'GM deixa de ver B (leave)');

const st1 = await stats();
check(st1.see_enter > st0.see_enter && st1.state_updates > st0.state_updates, `Rust contou: see_enter +${st1.see_enter - st0.see_enter}, see_leave +${st1.see_leave - st0.see_leave}, state_updates +${st1.state_updates - st0.state_updates}`);
A.ws.close(); B.ws.close();
console.log(fails ? `\n${fails} falha(s)` : '\ntudo certo');
process.exit(fails ? 1 : 0);
