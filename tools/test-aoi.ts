import WebSocket from 'ws';

/**
 * Teste da área de visão (interest management) contra um servidor LOCAL já ligado:
 *   PORT=9080 npx tsx servers/main.ts   e depois   BASE=localhost:9080 npx tsx tools/test-aoi.ts <usuário> <senha> <usuário2> <senha2>
 * Usa //tp (a primeira conta precisa ser GM). Confere: (1) atacar mob fora da visão não gera golpe, atacar mob visível gera;
 * (2) a party não revela a posição de um membro que o jogador não vê.
 */
const BASE = process.env.BASE ?? 'localhost:9080';
const [u1, p1, u2, p2] = process.argv.slice(2);
if (!u2) { console.error('uso: test-aoi.ts <user1> <pass1> <user2> <pass2>'); process.exit(2); }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const check = (ok: boolean, what: string) => { console.log(`${ok ? 'OK  ' : 'FALHA'} ${what}`); if (!ok) fails++; };

async function login(user: string, pass: string) {
  const r = await fetch(`http://${BASE}/gapi/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: user, password: pass }) });
  if (!r.ok) throw new Error(`login ${user}: ${r.status}`);
  return (await r.json()) as { token: string; characters: { id: number; name: string }[] };
}

interface Client { ws: WebSocket; id: number; msgs: Record<string, any>[]; mobs: Map<number, [number, number]>; send(m: unknown): void }
async function join(user: string, pass: string): Promise<Client> {
  const a = await login(user, pass), ch = a.characters[0];
  const ws = new WebSocket(`ws://${BASE}/ws`);
  const c: Client = { ws, id: ch.id, msgs: [], mobs: new Map(), send: (m) => ws.send(JSON.stringify(m)) };
  ws.on('message', (raw) => {
    const m = JSON.parse(String(raw));
    c.msgs.push(m);
    if (m.t === 'mobs') {
      for (const x of m.a ?? []) c.mobs.set(x[0], [x[2], x[3]]);
      for (const x of m.u ?? []) c.mobs.set(x[0], [x[1], x[2]]);
      for (const id of m.d ?? []) c.mobs.delete(id);
    }
  });
  await new Promise((r, j) => { ws.on('open', r); ws.on('error', j); });
  c.send({ t: 'join', token: a.token, characterId: ch.id });
  for (let i = 0; i < 50 && !c.msgs.some((m) => m.t === 'welcome'); i++) await sleep(100);
  if (!c.msgs.some((m) => m.t === 'welcome')) throw new Error(`${user} não entrou: ${JSON.stringify(c.msgs.find((m) => m.t === 'error'))}`);
  return c;
}
const tp = async (c: Client, x: number, z: number) => { c.send({ t: 'chat', text: `//tp ${Math.round(x)} ${Math.round(z)}` }); await sleep(1200); };

const A = await join(u1, p1);
const B = await join(u2, p2);
try {
  // ---- 1) ações sobre mobs ----
  await tp(A, 7024, 3438); // campo de Aibatt
  await sleep(1500);
  const known = [...A.mobs.entries()];
  check(known.length > 0, `A vê mobs no campo (${known.length})`);
  const [mobId, [mx, mz]] = known[0];
  await tp(A, mx, mz); // colado no mob
  await sleep(600);
  const mark = A.msgs.length;
  for (let i = 0; i < 4; i++) { A.send({ t: 'atk', id: mobId }); await sleep(700); }
  check(A.msgs.slice(mark).some((m) => m.t === 'hit' && m.d === mobId), 'controle: atk em mob visível e perto gera golpe');
  // vai para longe e tenta atacar o mesmo id
  await tp(A, 12000, 3000);
  await sleep(1500);
  check(!A.mobs.has(mobId), 'mob antigo saiu do conjunto de A');
  const mark2 = A.msgs.length;
  for (let i = 0; i < 4; i++) { A.send({ t: 'atk', id: mobId }); A.send({ t: 'skill', id: 1, target: mobId }); await sleep(500); }
  check(!A.msgs.slice(mark2).some((m) => m.t === 'hit' && m.d === mobId), 'atk/skill em mob fora da visão: nenhum golpe');

  // ---- 2) party não vaza posição ----
  await tp(B, 6976, 3327); // B em Flaris
  B.send({ t: 'partyInvite', id: A.id }); // B convida A
  await sleep(500);
  A.send({ t: 'partyAnswer', id: B.id, ok: true });
  await sleep(1500);
  const party = [...A.msgs].reverse().find((m) => m.t === 'party' && m.p);
  const mem = party?.p.members.find((m: any) => m.id === B.id);
  if (!mem) console.log('(aviso) A não entrou na party do B; party não testada:', JSON.stringify(party)?.slice(0, 200));
  else {
    check(mem.x === undefined && mem.z === undefined && mem.w === undefined, 'A (longe) não recebe w/x/z do membro B');
    await tp(A, 6980, 3330); // A perto de B
    await sleep(4000);
    const near = [...A.msgs].reverse().find((m) => m.t === 'party' && m.p);
    const m2 = near?.p.members.find((m: any) => m.id === B.id);
    check(m2?.x !== undefined, 'A perto de B (vê B) recebe a posição');
  }
} finally { A.ws.close(); B.ws.close(); }
console.log(fails ? `\n${fails} falha(s)` : '\ntudo certo');
process.exit(fails ? 1 : 0);
