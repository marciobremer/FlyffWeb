import WebSocket from 'ws';
import { query } from '../servers/common/db/index';

/**
 * Teste de persistência do inventário em memória: entra, move um item e pede para o painel parar o jogo NA HORA (antes da
 * gravação agrupada de ~2 s); depois confere no banco que o slot novo foi gravado. Religa o jogo no fim.
 *   npm run test:persist -- [conta] [senha] [personagem]     (jogo e painel no ar)
 */
const [user = 'teste', pass = 'teste', charName = 'Bremer'] = process.argv.slice(2);
const GAME = 'http://localhost:8080', ADMIN = 'http://127.0.0.1:8090';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const post = (p: string) => fetch(ADMIN + '/admin/api' + p, { method: 'POST', headers: { 'x-admin': '1' } });

async function main() {
  const login = await (await fetch(`${GAME}/gapi/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: user, password: pass }) })).json() as { token: string; characters: { id: number; name: string }[] };
  const ch = login.characters.find((c) => c.name.toLowerCase() === charName.toLowerCase()) ?? login.characters[0];
  const ws = new WebSocket(GAME.replace(/^http/, 'ws') + '/ws');
  let inv: { items: number[][] } | null = null;
  ws.on('message', (raw) => { const m = JSON.parse(String(raw)); if (m.t === 'inv') inv = m; });
  await new Promise((r) => ws.once('open', r));
  ws.send(JSON.stringify({ t: 'join', token: login.token, characterId: ch.id, p: [6976, 100, 3327] }));
  while (!inv) await sleep(100);
  const bag = (inv as { items: number[][] }).items.filter((i) => i[0] === 0);
  const it = bag[0];
  const free = [...Array(42).keys()].find((s) => !bag.some((i) => i[1] === s))!;
  ws.send(JSON.stringify({ t: 'invMove', from: [0, it[1]], to: [0, free] }));
  await sleep(300); // só o bastante para o servidor processar; a gravação agrupada ainda não aconteceu
  const early = await query('SELECT 1 FROM character_items WHERE character_id=$1 AND container=0 AND slot=$2', [ch.id, free]);
  console.log(`logo após mover: item ${it[2]} do slot ${it[1]} para ${free}; no banco ainda? ${early.rowCount ? 'sim (gravou rápido)' : 'não (esperado: está só na memória)'}`);
  await post('/game/stop');
  const r = await query<{ item_id: number }>('SELECT item_id FROM character_items WHERE character_id=$1 AND container=0 AND slot=$2', [ch.id, free]);
  const ok = r.rows[0]?.item_id === it[2];
  console.log(ok ? 'OK: o desligamento gravou o inventário.' : 'FALHOU: o item não está no slot novo do banco.');
  // desfaz a mudança de teste e religa o jogo
  await query('UPDATE character_items SET slot=$3 WHERE character_id=$1 AND container=0 AND slot=$2', [ch.id, free, it[1]]);
  await post('/game/start');
  if (!ok) process.exitCode = 1;
}
main().catch((e) => { console.error('Erro:', (e as Error).message); process.exitCode = 1; }).finally(() => setTimeout(() => process.exit(), 200));
