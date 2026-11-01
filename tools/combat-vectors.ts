import fs from 'node:fs';
import path from 'node:path';
import { CombatRules } from '../servers/world/combat';

/**
 * Gera os vetores de equivalência Node ↔ Rust: casos de golpe jogador→mob e mob→jogador calculados pelo
 * `CombatRules` de verdade, com `Math.random` trocado por uma sequência fixa (guardada no caso). O Rust
 * (game-server/tests/equivalence.rs) refaz cada caso com a mesma sequência e precisa dar o mesmo resultado.
 *
 *   npx tsx tools/combat-vectors.ts      → game-server/tests/vectors.json
 */
let seed = 20261101;
const lcg = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
const int = (a: number, b: number) => a + Math.floor(lcg() * (b - a + 1));

const rules = Object.create(CombatRules.prototype) as any;
rules.D = { ADJ_HITRATE: 1, CRITICAL_BONUS: 2, ATKPOWER_RATE: 3, MONSTER_DMG: 4, ATKPOWER: 5, PARRY: 6 };
rules.items = { bySymbol: new Map() };
rules.hand = null;

const realRandom = Math.random;
function withRolls<T>(seq: number[], fn: () => T): T {
  let i = 0;
  Math.random = () => seq[i++ % seq.length];
  try { return fn(); } finally { Math.random = realRandom; }
}

const RARE = [1, 1.1, 1.3, 0.9, 1.5];
const players: unknown[] = [], mobsHit: unknown[] = [];
for (let n = 0; n < 400; n++) {
  const mob = { symbol: 'MI_X', level: int(1, 130), sta: int(10, 200), dex: int(10, 200), hr: int(5, 300), er: int(1, 200), hp: 1000, naturalArmor: int(0, 120), atkMin: int(1, 400), atkMax: 0, atk1: '', exp: 0, element: 0, elementLevel: 0 };
  mob.atkMax = mob.atkMin + int(0, 300);
  const elem = int(-3000, 6000);
  const seq = [lcg(), lcg(), lcg(), lcg(), lcg()];

  // jogador → mob
  const a = { level: int(1, 130), dex: int(15, 400), hitBonus: int(-20, 40), atkMin: int(1, 3000), atkMax: 0, crit: int(0, 60), critBonus: int(0, 80), atkRate: int(-10, 80), monsterDmg: int(0, 60), atkPower: int(0, 500), wRare: RARE[int(0, RARE.length - 1)] };
  a.atkMax = a.atkMin + int(0, 2000);
  const f = { level: a.level, dex: a.dex, adjHit: 0, parry: 0, weapon: null, wRare: a.wRare, wElem: [0, 0], sElem: [0, 0],
    dst: new Map([[1, a.hitBonus], [2, a.critBonus], [3, a.atkRate], [4, a.monsterDmg], [5, a.atkPower]]) };
  rules.playerAtk = () => [a.atkMin, a.atkMax];
  rules.critChance = () => a.crit;
  rules.upgrade = { elementFactor: () => elem };
  const r = withRolls(seq, () => rules.playerHitsMob(f, mob));
  players.push({ a, m: mob, elem, seq, expected: r });

  // mob → jogador
  const d = { level: int(1, 130), dex: int(15, 400), parry: int(0, 80), parryDst: int(0, 40), def: int(0, 1500) };
  const g = { level: d.level, dex: d.dex, parry: d.parry, dst: new Map([[6, d.parryDst]]), sElem: [0, 0] };
  rules.defense = () => d.def;
  rules.upgrade = { elementFactor: () => elem };
  const r2 = withRolls(seq, () => rules.mobHitsPlayer(mob, g));
  mobsHit.push({ d: { level: d.level, dodge: Math.floor(d.dex * 0.5 + d.parry + d.parryDst), def: d.def }, m: mob, elem, seq, expected: r2 });
}

const out = path.join(import.meta.dirname, '..', 'game-server', 'tests', 'vectors.json');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify({ playerHitsMob: players, mobHitsPlayer: mobsHit }));
const hits = (players as { expected: { hit: boolean } }[]).filter((p) => p.expected.hit).length;
console.log(`${players.length + mobsHit.length} casos em ${out} (jogador acertou em ${hits}/${players.length})`);
