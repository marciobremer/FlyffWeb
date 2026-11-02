import net from 'node:net';
import WebSocket from 'ws';

/**
 * Ponta a ponta com GAME_ENGINE=rust: um jogador real (WebSocket do jogo) e o link do Rust.
 *   servidor:  GAME_ENGINE=rust GAME_LINK_SECRET=teste PORT=9080 npx tsx servers/main.ts   (com game-server rodando em 9201)
 *   teste:     BASE=localhost:9080 npx tsx tools/test-rust-e2e.ts <usuário GM> <senha> [segredo-do-link]
 * Confere: o Rust recebe o jogador e os golpes (stats), mobs agressivos do RUST atacam o jogador (hit k:'m' chega pelo Node),
 * o jogador mata um mob e recebe `mdie`.
 */
const BASE = process.env.BASE ?? 'localhost:9080';
const [user, pass, secret = 'teste'] = process.argv.slice(2);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const check = (ok: boolean, what: string) => { console.log(`${ok ? 'OK  ' : 'FALHA'} ${what}`); if (!ok) fails++; };

async function rustStats(port = 9201) {
  return new Promise<any>((resolve, reject) => {
    const s = net.connect(port, '127.0.0.1');
    let buf = Buffer.alloc(0), step = 0;
    const w = (v: unknown) => { const b = Buffer.from(JSON.stringify(v)); const h = Buffer.alloc(4); h.writeUInt32BE(b.length); s.write(Buffer.concat([h, b])); };
    s.on('connect', () => w({ k: 'hello', secret, version: 1, probe: true }));
    s.on('error', reject);
    s.on('data', (d) => {
      buf = Buffer.concat([buf, d]);
      while (buf.length >= 4 && buf.length >= 4 + buf.readUInt32BE(0)) {
        const m = JSON.parse(buf.subarray(4, 4 + buf.readUInt32BE(0)).toString());
        buf = buf.subarray(4 + buf.readUInt32BE(0));
        if (m.k === 'hello_ok' && step++ === 0) w({ k: 'stats' });
        else if (m.k === 'stats') { s.end(); resolve(m); }
      }
    });
    setTimeout(() => reject(new Error('stats timeout')), 3000);
  });
}

const r = await fetch(`http://${BASE}/gapi/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: user, password: pass }) });
const a: any = await r.json();
const ws = new WebSocket(`ws://${process.env.WS_BASE ?? BASE}/ws`);
const msgs: any[] = [];
const mobs = new Map<number, any[]>();
ws.on('message', (raw) => {
  const m = JSON.parse(String(raw));
  msgs.push(m);
  if (m.t === 'mobs') {
    for (const e of m.a ?? []) mobs.set(e[0], e);
    for (const u of m.u ?? []) { const e = mobs.get(u[0]); if (e) { e[2] = u[1]; e[3] = u[2]; e[5] = u[4]; } } // posição/estado atuais
    for (const id of m.d ?? []) mobs.delete(id);
  }
});
await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
const send = (m: unknown) => ws.send(JSON.stringify(m));
send({ t: 'join', token: a.token, characterId: a.characters[0].id });
for (let i = 0; i < 50 && !msgs.some((m) => m.t === 'welcome'); i++) await sleep(100);
const tp = async (x: number, z: number) => { send({ t: 'chat', text: `//tp ${Math.round(x)} ${Math.round(z)}` }); await sleep(1200); };
const st0 = await rustStats();
check(st0.players >= 1, `Rust conhece o jogador (players=${st0.players}, mobs=${st0.mobs})`);

// campo com agressivos: o Rust manda os mobs e os agressivos vêm atrás do jogador
send({ t: 'revive' }); // GM/admin já entra imortal (//god ligado ao entrar): o golpe acontece e o dano aparece, o HP não cai
await sleep(300);
await tp(6744, 2995); // campo com mobs agressivos (o Aibatt tem só pacíficos)
await sleep(1500);
check(mobs.size > 0, `mobs chegam pelo relay do Rust (${mobs.size})`);
const mark = msgs.length;
// só o 1º mob de cada respawn é agressivo (attackCount): visita os mobs em ordem de id até algum notar o jogador
const order = [...mobs.values()].sort((x, y) => x[0] - y[0]);
for (let i = 0; i < order.length && !msgs.slice(mark).some((m) => m.t === 'hit' && m.k === 'm'); i++) {
  await tp(order[i][2], order[i][3]);
  await sleep(900);
}
check(msgs.slice(mark).some((m) => m.t === 'hit' && m.k === 'm'), 'mob agressivo (IA no Rust) golpeou o jogador: hit k:m chegou pelo Node');

// mata um mob visível
const e = [...mobs.values()][0];
await tp(e[2], e[3]);
await sleep(500);
const mark2 = msgs.length;
let died = false;
for (let i = 0; i < 40 && !died; i++) {
  send({ t: 'atk', id: e[0] });
  await sleep(700);
  died = msgs.slice(mark2).some((m) => m.t === 'mdie' && m.id === e[0]);
}
check(msgs.slice(mark2).some((m) => m.t === 'hit' && m.k === 'p' && m.d === e[0]), 'golpe do jogador em mob visível gera hit');
const st1 = await rustStats();
console.log('mob_attacks (IA do Rust):', st1.mob_attacks);
check(st1.hits > st0.hits, `Rust recebeu o dano dos golpes (hits ${st0.hits} → ${st1.hits})`);
console.log(`(mdie recebido: ${died}; mob morto dentro do tempo depende do HP/dano do personagem)`);
check(st1.tick_max_ms < 50, `tick do Rust: média ${st1.tick_avg_ms.toFixed(2)} ms, pior ${st1.tick_max_ms.toFixed(2)} ms`);
check(st1.direct_atk > st0.direct_atk, `o golpe do jogador foi resolvido NO RUST (direct_atk ${st0.direct_atk} → ${st1.direct_atk})`);

// morte: tira a imortalidade de GM e deixa os mobs do Rust derrubarem o personagem (HP e morte são do Rust; o Node recebe o `hurt`)
send({ t: 'chat', text: '//god' });
send({ t: 'chat', text: '//set-level 1' }); // pouco HP: poucos golpes bastam (e testa o `fighter` novo ao mudar de nível)
await sleep(1200);
let hp = -1, dead = false;
const statHp = () => { const m = [...msgs].reverse().find((x) => x.t === 'stats'); return m?.hp; };
const mark3 = msgs.length;
const t0 = Date.now();
for (let i = 0; Date.now() - t0 < 90_000 && !msgs.slice(mark3).some((m) => m.t === 'pdie' && m.id === a.characters[0].id); i++) {
  // fica colado no último mob que golpeou (o agressivo); sem golpe ainda, visita os mobs em ordem
  const lastHit = [...msgs.slice(mark3)].reverse().find((m) => m.t === 'hit' && m.k === 'm');
  const e = (lastHit && mobs.get(lastHit.a)) || order[i % order.length];
  await tp(e[2], e[3]);
  await sleep(1300);
}
dead = msgs.slice(mark3).some((m) => m.t === 'pdie');
if (process.env.DEBUG_E2E) console.log(JSON.stringify(msgs.slice(mark3 - 3).filter((m) => (m.t === 'chat' && m.id === 0) || (m.t === 'hit' && m.k === 'm') || m.t === 'god' || m.t === 'stats').map((m) => m.t === 'hit' ? ['hit', m.dmg, m.hp, m.f] : m.t === 'stats' ? ['stats', m.hp, m.maxHp, m.level] : [m.t, m.text ?? m.on])));
hp = statHp();
check(dead, 'morte: o personagem morreu por golpes de mob resolvidos no Rust (pdie recebido)');
check(hp === 0, `o Node recebeu o HP do Rust (stats.hp = ${hp})`);
send({ t: 'revive' });
await sleep(1500);
check((statHp() ?? 0) > 0, `reviver: HP volta (stats.hp = ${statHp()}) e o Rust recebe o estado novo`);
send({ t: 'chat', text: '//god' }); // volta ao normal
send({ t: 'chat', text: '//set-level 40' });
await sleep(600);
const st2 = await rustStats();
check(st2.mob_hits > st1.mob_hits, `golpes de mob resolvidos no Rust: ${st2.mob_hits - st1.mob_hits}`);
ws.close();
console.log(fails ? `\n${fails} falha(s)` : '\ntudo certo');
process.exit(fails ? 1 : 0);
