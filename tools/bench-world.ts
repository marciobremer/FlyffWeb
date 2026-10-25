import WebSocket from 'ws';

/**
 * Medição rápida do servidor do jogo: entra com um personagem pelo WebSocket, faz ações de inventário (usar poção, mover
 * itens) e mostra quantas consultas ao banco o servidor fez (contador do painel admin).
 *   npm run bench -- [conta] [senha] [personagem]        (padrão: teste teste Bremer; o jogo e o painel precisam estar no ar)
 */
const [user = 'teste', pass = 'teste', charName = 'Bremer'] = process.argv.slice(2);
const GAME = process.env.GAME_URL ?? 'http://localhost:8080';
const ADMIN = process.env.ADMIN_URL ?? 'http://127.0.0.1:8090';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function dbQueries() {
  const r = await fetch(`${ADMIN}/admin/api/status`, { headers: { 'x-admin': '1' } });
  const d = await r.json() as { game: { dbQueries: number } };
  return d.game.dbQueries;
}

async function main() {
  const login = await (await fetch(`${GAME}/gapi/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: user, password: pass }) })).json() as { token?: string; characters?: { id: number; name: string }[]; error?: string };
  if (!login.token) throw new Error(login.error ?? 'login falhou');
  const ch = login.characters!.find((c) => c.name.toLowerCase() === charName.toLowerCase()) ?? login.characters![0];
  const ws = new WebSocket(GAME.replace(/^http/, 'ws') + '/ws');
  let inv: { items: number[][]; gold: number } | null = null;
  ws.on('message', (raw) => { const m = JSON.parse(String(raw)); if (m.t === 'inv') inv = m; });
  await new Promise((r) => ws.once('open', r));
  ws.send(JSON.stringify({ t: 'join', token: login.token, characterId: ch.id, p: [6976, 100, 3327] }));
  while (!inv) await sleep(100);
  await sleep(1500);

  const bag = (inv as { items: number[][] }).items.filter((i) => i[0] === 0);
  const potion = bag.find((i) => i[2] === 2544); // VitalDrink 100 (FP)
  const free = [...Array(42).keys()].find((s) => !bag.some((i) => i[1] === s))!;
  const mover = bag[0];

  const q0 = await dbQueries();
  const t0 = Date.now();
  let actions = 0;
  if (potion) for (let k = 0; k < 4; k++) { ws.send(JSON.stringify({ t: 'use', id: 2544 })); actions++; await sleep(1100); }
  for (let k = 0; k < 10 && mover; k++) { ws.send(JSON.stringify({ t: 'invMove', from: [0, k % 2 ? free : mover[1]], to: [0, k % 2 ? mover[1] : free] })); actions++; await sleep(120); }
  await sleep(1500);
  const q1 = await dbQueries();
  console.log(`${actions} ações de inventário em ${((Date.now() - t0) / 1000).toFixed(1)} s → ${q1 - q0} consultas ao banco (${((q1 - q0) / Math.max(1, actions)).toFixed(1)} por ação)`);
  ws.close();
  await sleep(500);
}

main().catch((e) => { console.error('Erro:', (e as Error).message); process.exitCode = 1; });
