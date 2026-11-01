import net from 'node:net';

/**
 * Smoke test do Game Server em Rust com o mapa REAL, falando o protocolo do link como o Gateway fará:
 *   cd game-server && cargo build --release
 *   game-server\target\release\game-server.exe --pack data\mappack\WdMadrigal --secret teste --listen 127.0.0.1:9201
 *   npx tsx tools/test-rust-link.ts [porta] [segredo]
 * Confere: hello, attach no campo de Aibatt, mobs vizinhos, ataque a mob visível (hit), a mob longe (recusado) e o tick.
 */
const port = Number(process.argv[2] ?? 9201), secret = process.argv[3] ?? 'teste';
const sock = net.connect(port, '127.0.0.1');
sock.setNoDelay(true);
let buf = Buffer.alloc(0);
const frames: any[] = [];
sock.on('data', (d) => {
  buf = Buffer.concat([buf, d]);
  while (buf.length >= 4 && buf.length >= 4 + buf.readUInt32BE(0)) {
    const n = buf.readUInt32BE(0);
    frames.push(JSON.parse(buf.subarray(4, 4 + n).toString()));
    buf = buf.subarray(4 + n);
  }
});
const send = (v: unknown) => { const b = Buffer.from(JSON.stringify(v)); const h = Buffer.alloc(4); h.writeUInt32BE(b.length); sock.write(Buffer.concat([h, b])); };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until<T>(f: () => T | undefined, ms = 5000): Promise<T> { const end = Date.now() + ms; while (Date.now() < end) { const v = f(); if (v !== undefined) return v; await sleep(20); } throw new Error('timeout'); }
let fails = 0;
const check = (ok: boolean, what: string) => { console.log(`${ok ? 'OK  ' : 'FALHA'} ${what}`); if (!ok) fails++; };

await new Promise((r, j) => { sock.on('connect', r); sock.on('error', j); });
send({ k: 'hello', secret, version: 1 });
await until(() => frames.find((f) => f.k === 'hello_ok'));
check(true, 'hello_ok');

send({ k: 'attach', conn: 1, ch: { id: 1, name: 'Novato', level: 40, x: 7024, z: 3438, hp: 1760, maxHp: 1760, reach: 60,
  attacker: { level: 40, dex: 200, atkMin: 150, atkMax: 220, crit: 10 }, defender: { level: 40, dodge: 60, def: 80 } } });
const mobs = await until(() => frames.find((f) => f.k === 's2c' && f.msg.t === 'mobs'));
const near: any[] = mobs.msg.a;
check(near.length > 0 && near.length <= 80, `recebeu ${near.length} mobs vizinhos (máx. 80)`);
const dist = (e: any) => Math.hypot(e[2] - 7024, e[3] - 3438);
check(near.every((e) => dist(e) <= 460), `todos a ≤ ~450 u (maior: ${Math.max(...near.map(dist)).toFixed(0)})`);

const stat = async () => { frames.length = 0; send({ k: 'stats' }); return (await until(() => frames.find((f) => f.k === 'stats'))); };
const known = new Set(near.map((e) => e[0]));
const unseen = 5000; // id de mob existente em outro canto do mapa
check(!known.has(unseen), `mob ${unseen} (longe) não está na lista`);
const s0 = await stat();
send({ k: 'c2s', conn: 1, msg: { t: 'atk', id: unseen } });
const s1 = await stat();
check(s1.rejects_not_visible === s0.rejects_not_visible + 1, 'atk em mob fora da visão: recusado (rejects_not_visible +1)');

// teleporta colado em um mob visível e ataca
const t = near[0];
send({ k: 'c2s', conn: 1, msg: { t: 'state', p: [t[2], 100, t[3]], h: 0, s: 'stand' } });
await sleep(300);
frames.length = 0;
send({ k: 'c2s', conn: 1, msg: { t: 'atk', id: t[0] } });
const hit = await until(() => frames.find((f) => f.k === 's2c' && f.msg.t === 'hit')).catch(() => null);
check(!!hit && hit.msg.d === t[0], 'atk em mob visível: hit recebido');
const s2 = await stat();
check(s2.tick_max_ms < 50, `tick do mapa: média ${s2.tick_avg_ms.toFixed(2)} ms, pior ${s2.tick_max_ms.toFixed(2)} ms (${s2.mobs} mobs, ${s2.ticks} ticks)`);
sock.end();
console.log(fails ? `\n${fails} falha(s)` : '\ntudo certo');
process.exit(fails ? 1 : 0);
