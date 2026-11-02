import path from 'node:path';
import { ItemCatalog } from '../servers/common/items';
import { SkillCatalog } from '../servers/world/skills';

/** regras de skill: arma exigida por disciplina e quais skills são debuff de mob (Sneaker…). `npx tsx tools/test-skill-rules.ts` */
const res = path.join(import.meta.dirname, '..', 'original', 'Resource');
const items = new ItemCatalog(res, false).load();
const cat = new SkillCatalog(res, items, false);
const by = (sym: string) => [...cat.byId.values()].find((s) => s.symbol === sym)!;
let bad = 0;
const check = (ok: boolean, msg: string) => { if (!ok) { bad++; console.error('FALHOU:', msg); } else console.log('ok:', msg); };

const sneaker = by('SI_MER_ONE_SNEAKER');
check(sneaker.hostile && sneaker.kind === 'buff' && sneaker.weapon === null, 'Sneaker é debuff em mob e não exige arma');
check(sneaker.levels.some((l) => l.prob > 0 && l.time > 0), `Sneaker tem chance e duração (nv1 ${sneaker.levels[0].prob}% / ${sneaker.levels[0].time} ms)`);
const mag = [...cat.byId.values()].filter((s) => s.kind === 'magic');
check(mag.length > 0 && mag.every((s) => !cat.weaponOk(s, { kind3: 2 }) && cat.weaponOk(s, { kind3: 7 }) && cat.weaponOk(s, { kind3: 6 }) && !cat.weaponOk(s, null)), `${mag.length} magias exigem varinha/cajado (espada e mão vazia não lançam)`);
const spl = by('SI_MER_ONE_SPLMASH');
check(cat.weaponOk(spl, { kind3: 2 }) && !cat.weaponOk(spl, { kind3: 6 }), 'Splmash (Mercenary) exige espada/machado');
check(!cat.weaponOk(by('SI_KNT_TWOSW_CHARGE'), { kind3: 2 }) && cat.weaponOk(by('SI_KNT_TWOSW_CHARGE'), { kind3: 8 }), 'golpe de espada de duas mãos exige a de duas mãos');
const hostile = [...cat.byId.values()].filter((s) => s.hostile).map((s) => s.symbol);
console.log('skills debuff:', hostile.join(', '));
process.exit(bad ? 1 : 0);
