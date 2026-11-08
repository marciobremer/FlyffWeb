import { RES_DIR } from '../servers/common/config';
import { ItemCatalog } from '../servers/common/items';
import { applyCraft, CraftingRules, RECYCLE_CATEGORY } from '../servers/world/crafting';
import type { InvItem } from '../servers/character/inventory';

/** craft: receitas do AegonCrafting.inc, níveis e a aplicação na bolsa (componentes, espaço, empilhar). `npx tsx tools/test-crafting.ts` */
let bad = 0;
const check = (ok: boolean, msg: string) => { if (!ok) { bad++; console.error('FALHOU:', msg); } else console.log('ok:', msg); };
const items = new ItemCatalog(RES_DIR, false).load();
const cr = new CraftingRules(RES_DIR, items);
const cats = new Map<string, number>(); for (const r of cr.recipes.values()) cats.set(r.cat, (cats.get(r.cat) ?? 0) + 1);
console.log([...cats].map(([c, n]) => `${c}=${n}`).join(', '));
check(cr.recipes.size >= 100, `${cr.recipes.size} receitas carregadas`);
check(cr.levels.length === 25 && cr.levels[0] === 0 && cr.levels[24] === 55850, 'tabela de 25 níveis (0 … 55850)');
check(cr.levelOf(0) === 1 && cr.levelOf(299) === 1 && cr.levelOf(300) === 2 && cr.levelOf(999999) === 25, 'nível de craft pela experiência');
const r0 = cr.recipes.get(0)!;
check(r0.name === 'Gold Bead of Gladiator' && r0.cat === 'Pets' && r0.comps.length === 4 && r0.lv === 5 && r0.exp === 500 && r0.desc.length > 5, `receita 0 ok (${r0.desc.slice(0, 40)}…)`);
const rec = [...cr.recipes.values()].find((r) => r.recycle)!;
check(!!rec && rec.cat === RECYCLE_CATEGORY && rec.comps.length === 1, 'receita de reciclagem com um só componente');
const bag = (n: number, id: number, s: number): InvItem => ({ c: 0, s, id, n, u: 0, e: 0, el: 0 } as InvItem);
const pk = (id: number) => items.byId.get(id)?.packMax ?? 1;
// ensaio: tem tudo + espaço
let inv: InvItem[] = r0.comps.map((c, k) => bag(c.n + 5, c.id, k));
check(applyCraft(inv, r0, 42, pk), 'com tudo e espaço, o craft aplica');
check(inv.some((i) => i.id === r0.result.id) && r0.comps.every((c, k) => inv.find((i) => i.id === c.id)?.n === 5), 'resultado entrou e os componentes foram gastos');
inv = r0.comps.map((c, k) => bag(k === 2 ? c.n - 1 : c.n, c.id, k));
check(!applyCraft(inv, r0, 42, pk), 'falta 1 componente: recusa');
inv = r0.comps.map((c, k) => bag(c.n, c.id, k));
check(applyCraft(inv, r0, 4, pk), 'bolsa de 4 espaços: os componentes gastos liberam espaço para o resultado');
inv = [...r0.comps.map((c, k) => bag(c.n + 1, c.id, k)), ...Array.from({ length: 38 }, (_, k) => bag(1, 99999 + k, 4 + k))];
check(!applyCraft(inv, r0, 42, pk), 'bolsa cheia (nenhum componente some inteiro): recusa');
process.exit(bad ? 1 : 0);
