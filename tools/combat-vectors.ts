import fs from 'node:fs';
import path from 'node:path';
import { CombatRules } from '../servers/world/combat';
import { UpgradeRules } from '../servers/world/upgrade';
import { SkillCatalog } from '../servers/world/skills';

/**
 * Gera os vetores de equivalência Node ↔ Rust: casos de golpe jogador→mob e mob→jogador calculados pelo `CombatRules` e
 * pelo `UpgradeRules.elementFactor` de verdade, com `Math.random` trocado por uma sequência fixa (guardada no caso). As
 * entradas do Rust vêm do `fightSnapshot` (o mesmo que o Node manda ao game-server), então o teste cobre também o formato
 * do snapshot. O Rust (game-server/tests/equivalence.rs) refaz cada caso e precisa dar o mesmo resultado.
 *
 *   npx tsx tools/combat-vectors.ts      → game-server/tests/vectors.json
 */
let seed = 20261101;
const lcg = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
const int = (a: number, b: number) => a + Math.floor(lcg() * (b - a + 1));

// DST_* usados (o id é só o número de cada chave neste teste)
const D = { ADJ_HITRATE: 1, CRITICAL_BONUS: 2, ATKPOWER_RATE: 3, MONSTER_DMG: 4, ATKPOWER: 5, PARRY: 6, ADJDEF: 7, ADJDEF_RATE: 8, CHR_CHANCECRITICAL: 9 };
const rules = Object.create(CombatRules.prototype) as any;
rules.D = D;
rules.items = { bySymbol: new Map() };
rules.hand = null;
rules.ar = [];
const JOB = { atkSpeed: 75, maxHp: 1, maxMp: 1, maxFp: 1, def: 1.3, hpRec: 1, swd: 4, axe: 5, staff: 1, stick: 3, knuckle: 5, wand: 6, blocking: 0.2, yoyo: 4, critical: 1.5, bow: 1 };
rules.jobs = new Map([[0, JOB]]);

const realRandom = Math.random;
function withRolls<T>(seq: number[], fn: () => T): T {
  let i = 0;
  Math.random = () => seq[i++ % seq.length];
  try { return fn(); } finally { Math.random = realRandom; }
}

const RARE = [1, 1.1, 1.3, 0.9, 1.5];
const players: unknown[] = [], mobsHit: unknown[] = [], elements: unknown[] = [], skillCases: unknown[] = [];
// skills: o Node sorteia na faixa de `powerRange`; o Rust refaz o sorteio
const skillCat = Object.create(SkillCatalog.prototype) as any;
const SK_D: Record<string, number> = { DST_STR: 1, DST_DEX: 2, DST_INT: 3, DST_STA: 4, RT_ATTACK: 9 };
skillCat.D = (n: string) => SK_D[n] ?? -999;
for (let n = 0; n < 400; n++) {
  // tabela de elementos aleatória (a de verdade vem do Lua do servidor)
  const attribute = Array.from({ length: int(2, 16) }, () => ({ prob: 0, dmg: int(0, 3000), def: int(0, 3000), addAtk: int(0, 2000) }));
  const up = Object.create(UpgradeRules.prototype) as any;
  up.attribute = attribute;
  const table = attribute.map((a) => [a.dmg, a.def, a.addAtk]);
  rules.upgrade = up;

  const mob = { symbol: 'MI_X', level: int(1, 130), sta: int(10, 200), dex: int(10, 200), hr: int(5, 300), er: int(1, 200), hp: 1000, naturalArmor: int(0, 120), atkMin: int(1, 400), atkMax: 0, atk1: '', exp: 0,
    element: int(0, 5), elementLevel: int(0, 20), attackSpeed: 1000 };
  mob.atkMax = mob.atkMin + int(0, 300);
  const seq = [lcg(), lcg(), lcg(), lcg(), lcg(), lcg()];
  const wElem = [int(0, 5), int(0, 20)], sElem = [int(0, 5), int(0, 20)];

  // jogador → mob
  const a = { level: int(1, 130), dex: int(15, 400), hitBonus: int(-20, 40), atkMin: int(1, 3000), atkMax: 0, crit: int(0, 60), critBonus: int(0, 80), atkRate: int(-10, 80), monsterDmg: int(0, 60), atkPower: int(0, 500), wRare: RARE[int(0, RARE.length - 1)] };
  a.atkMax = a.atkMin + int(0, 2000);
  const f = { level: a.level, dex: a.dex, sta: 30, adjHit: 0, parry: 0, weapon: null, wRare: a.wRare, wElem, sElem, job: 0, defMin: 0, defMax: 0,
    dst: new Map([[D.ADJ_HITRATE, a.hitBonus], [D.CRITICAL_BONUS, a.critBonus], [D.ATKPOWER_RATE, a.atkRate], [D.MONSTER_DMG, a.monsterDmg], [D.ATKPOWER, a.atkPower]]) };
  rules.playerAtk = () => [a.atkMin, a.atkMax];
  rules.critChance = () => a.crit;
  const snapA = rules.fightSnapshot(f).attacker;
  const r = withRolls(seq, () => rules.playerHitsMob(f, mob));
  players.push({ attacker: snapA, wElem, table, m: mob, seq, expected: r });

  // mob → jogador (defesa de verdade, com o item sorteado entre defMin e defMax)
  const d = { level: int(1, 130), dex: int(15, 400), sta: int(10, 200), parry: int(0, 80), parryDst: int(0, 40), defMin: int(0, 800), defMax: 0, adjDef: int(0, 100), adjDefRate: int(0, 40) };
  d.defMax = d.defMin + int(0, 400);
  const g = { level: d.level, dex: d.dex, sta: d.sta, parry: d.parry, job: 0, defMin: d.defMin, defMax: d.defMax, weapon: null, wRare: 1, wElem, sElem, adjHit: 0,
    dst: new Map([[D.PARRY, d.parryDst], [D.ADJDEF, d.adjDef], [D.ADJDEF_RATE, d.adjDefRate]]) };
  rules.playerAtk = () => [1, 1];
  rules.critChance = () => 0;
  const snapD = rules.fightSnapshot(g).defender;
  const r2 = withRolls(seq, () => rules.mobHitsPlayer(mob, g));
  mobsHit.push({ defender: snapD, sElem, table, m: mob, seq, expected: r2 });

  // skill de ataque: faixa do poder (powerRange) e dano final (meleePower − defesa do mob) com o sorteio forçado
  {
    const lv = int(1, 10), levels = Array.from({ length: 10 }, () => { const mn = int(1, 60); return { min: mn, max: mn + int(0, 60) }; });
    const sd = { refer: [{ stat: SK_D.DST_STR, target: SK_D.RT_ATTACK, value: int(0, 20) }, { stat: SK_D.DST_DEX, target: 0, value: 0 }].slice(0, int(1, 2)), levels };
    const wp = lcg() < 0.7 ? { abilityMin: int(5, 300), abilityMax: 0 } : null;
    if (wp) wp.abilityMax = wp.abilityMin + int(0, 200);
    const sf = { weapon: wp, weaponUpgrade: int(0, 10), str: int(15, 300), dex: int(15, 300), int: int(15, 300), sta: int(15, 300) };
    const hand = { abilityMin: 1, abilityMax: 2 };
    const range = skillCat.powerRange(sf, sd, lv, hand);
    const roll = lcg();
    const dmg = withRolls([roll], () => Math.max(1, skillCat.meleePower(sf, sd, lv, hand) - skillCat.mobSkillDefense(mob)));
    skillCases.push({ range, roll, naturalArmor: mob.naturalArmor, expected: dmg });
  }

  // o fator do elemento sozinho (inclui níveis fora da tabela e negativos)
  for (let k = 0; k < 4; k++) {
    const q = [int(0, 5), int(-1, 22), int(0, 5), int(-1, 22)];
    elements.push({ table, q, expected: up.elementFactor(q[0], q[1], q[2], q[3]) });
  }
}

const out = path.join(import.meta.dirname, '..', 'game-server', 'tests', 'vectors.json');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify({ playerHitsMob: players, mobHitsPlayer: mobsHit, elementFactor: elements, skillDamage: skillCases }));
const hits = (players as { expected: { hit: boolean } }[]).filter((p) => p.expected.hit).length;
console.log(`${players.length + mobsHit.length + elements.length + skillCases.length} casos em ${out} (jogador acertou em ${hits}/${players.length})`);
