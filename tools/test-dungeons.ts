import { RES_DIR } from '../servers/common/config';
import { ServerWorld } from '../servers/world/world';
import { MobWorld } from '../servers/world/mobs';
import { ItemCatalog } from '../servers/common/items';
import { classOfJob, instanceRules, worldTable } from '../servers/world/dungeons';

/** dungeons: portas do Madrigal, regras do PartyDungeon.lua e a cópia de instância com os monstros do Lua. `npx tsx tools/test-dungeons.ts` */
let bad = 0;
const check = (ok: boolean, msg: string) => { if (!ok) { bad++; console.error('FALHOU:', msg); } else console.log('ok:', msg); };
const table = worldTable(RES_DIR), rules = instanceRules(RES_DIR);
const mad = new ServerWorld(RES_DIR, 'WdMadrigal').load();
const portals = mad.regions.filter((g) => g.teleportWorld > 0).map((g) => ({ ...g, to: table.byId.get(g.teleportWorld) }));
check(portals.length >= 10 && portals.every((p) => p.to), `Madrigal tem ${portals.length} portas, todas com mundo de destino conhecido`);
const rustia = portals.find((p) => p.to?.define === 'WI_INSTANCE_RUSTIA');
check(!!rustia && rustia.rect.xMax > rustia.rect.xMin, 'há uma porta para The Wilds (WI_INSTANCE_RUSTIA)');
const r = rules.get('WI_INSTANCE_RUSTIA')!;
check(r.classes.has('NORMAL') && !r.classes.has('MASTER') && r.level[0] === 60 && r.level[1] === 80 && r.coolMin === 60, 'The Wilds: só classe normal, níveis 60–80, espera de 60 min');
check(classOfJob(0) === 'NORMAL' && classOfJob(7) === 'NORMAL' && classOfJob(16) === 'MASTER' && classOfJob(24) === 'HERO' && classOfJob(32) === 'LEGEND_HERO', 'classe por id de job');
const items = new ItemCatalog(RES_DIR, false).load();
const sw = new ServerWorld(RES_DIR, 'DuRustia').load();
const mw = new MobWorld(sw);
const before = mw.mobs.length;
let made = 0;
for (const m of r.monsters) { const id = items.defines.get(m.mover); if (id !== undefined && mw.summon(id, m.pos[0], m.pos[2], m.pos[1], 1)) made++; }
check(made === r.monsters.length, `os ${r.monsters.length} monstros do Lua nasceram na cópia (${before} do .rgn + ${made})`);
const exits = sw.regions.filter((g) => g.teleportWorld > 0);
check(exits.length >= 1 && exits.every((g) => table.byId.get(g.teleportWorld)), `DuRustia tem ${exits.length} porta(s) de saída com destino`);
process.exit(bad ? 1 : 0);
