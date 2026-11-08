import fs from 'node:fs';
import path from 'node:path';
import type { ItemCatalog } from '../common/items';
import type { InvItem } from '../character/inventory';

/**
 * Sistema de craft (AegonCrafting.inc + CAegonCraftingMng/OnCraftRecipe do servidor original).
 * Receitas: nome, categoria, descrição (TID), tempo (s), item resultado e 1–6 componentes, experiência de craft e nível pedido;
 * `recycling` = troca de materiais de reciclagem por material. Nível de craft: tabela `CraftingLevels` (25 níveis, pela experiência).
 * Regras do original: nível de craft ≥ o pedido, componentes certos e em quantidade, espera de `craftTime` desde o craft anterior
 * (a janela espera esse tempo antes de pedir), resultado precisa caber na bolsa; gasta os componentes, dá o item e a experiência.
 */
export interface Recipe {
  id: number; name: string; cat: string; descTid: string; desc: string; time: number; exp: number; lv: number; recycle: boolean;
  result: { id: number; n: number }; comps: { id: number; n: number }[];
}

export const RECYCLE_CATEGORY = 'Recycling';
export const MAX_COMPONENTS = 6;

export class CraftingRules {
  readonly recipes = new Map<number, Recipe>();
  /** experiência de craft que abre cada nível (índice 0 = nível 1) */
  readonly levels: number[] = [];

  constructor(resDir: string, private catalog: ItemCatalog) {
    let text = '';
    try { text = new TextDecoder('windows-1252').decode(fs.readFileSync(path.join(resDir, 'AegonCrafting.inc'))); } catch { return; }
    text = text.replace(/\/\/[^\n]*/g, ''); // comentários (as linhas // do cabeçalho)
    const descs = loadDescriptions(resDir);

    const lv = /CraftingLevels\s*\{([^}]*)\}/.exec(text);
    if (lv) for (const m of lv[1].matchAll(/Level\s+(\d+)\s+(\d+)/g)) this.levels[Number(m[1])] = Number(m[2]);
    for (let i = 0; i < this.levels.length; i++) if (this.levels[i] === undefined) this.levels[i] = this.levels[i - 1] ?? 0;

    for (const m of text.matchAll(/Recipe\s+(\d+)\s*\{([^}]*)\}/g)) {
      const id = Number(m[1]), body = m[2];
      const str = (k: string) => new RegExp(`${k}\\s+"([^"]*)"`).exec(body)?.[1]?.trim() ?? '';
      const num = (k: string) => Number(new RegExp(`${k}\\s+(-?\\d+)`).exec(body)?.[1] ?? 0);
      const sym = (k: string) => [...body.matchAll(new RegExp(`${k}\\s+(\\w+)\\s+(\\d+)`, 'g'))].map((x) => ({ sym: x[1], n: Number(x[2]) }));
      const res = sym('resultItem')[0];
      const resDef = res && catalog.bySymbol.get(res.sym);
      const comps = sym('componentItem').map((c) => ({ d: catalog.bySymbol.get(c.sym), n: c.n }));
      const recycle = /\brecycling\b/.test(body);
      const descTid = /descriptionTID\s+(\w+)/.exec(body)?.[1] ?? '';
      // IsValid do original: resultado e 1+ componentes existentes (reciclagem: um só componente; as demais: descrição)
      if (!resDef || res.n <= 0 || !comps.length || comps.some((c) => !c.d || c.n <= 0) || comps.length > MAX_COMPONENTS) continue;
      if (recycle && comps.length > 1) continue;
      this.recipes.set(id, {
        id, name: recycle ? 'Recycling' : str('name'), cat: recycle ? RECYCLE_CATEGORY : str('category'), descTid, desc: descs(descTid),
        time: num('craftTime'), exp: num('craftingExp'), lv: num('levelRequirement'), recycle,
        result: { id: resDef.id, n: res.n }, comps: comps.map((c) => ({ id: c.d!.id, n: c.n })),
      });
    }
  }

  /** nível de craft (1–25) para a experiência */
  levelOf(exp: number) {
    let out = 1;
    for (let i = 0; i < this.levels.length; i++) { if (this.levels[i] > exp) break; out = i + 1; }
    return out;
  }
  get maxExp() { return this.levels[this.levels.length - 1] ?? 0; }
  /** experiência em que o nível `lvl` começa e em que o próximo começa (barra de experiência da janela) */
  bounds(lvl: number): [number, number] { return [this.levels[lvl - 1] ?? 0, this.levels[lvl] ?? this.maxExp]; }

  /** receita para o cliente (ícones e nomes dos itens vêm do catálogo) */
  view(r: Recipe) {
    const it = (x: { id: number; n: number }) => { const d = this.catalog.byId.get(x.id); return [x.id, x.n, d?.name ?? '?', d?.icon ?? ''] as const; };
    return { id: r.id, name: r.name, cat: r.cat, desc: r.desc, time: r.time, exp: r.exp, lv: r.lv, rec: r.recycle ? 1 : 0, res: it(r.result), comps: r.comps.map(it) };
  }
}

/** TID_DESC_CRAFTING_* → texto (textClient.inc liga o TID ao IDS_*, textClient.txt.txt tem o texto; "\n" vira quebra de linha) */
function loadDescriptions(resDir: string): (tid: string) => string {
  const read = (f: string) => {
    try {
      const b = fs.readFileSync(path.join(resDir, f));
      return b[0] === 0xff && b[1] === 0xfe ? new TextDecoder('utf-16le').decode(b.subarray(2)) : new TextDecoder('windows-1252').decode(b);
    } catch { return ''; }
  };
  // cada TID_* tem entre chaves ou o texto entre aspas ou um IDS_* (textClient.txt.txt)
  const ids = new Map([...read('textClient.txt.txt').matchAll(/^(IDS_\w+)[ 	]+(.+?)\s*$/gm)].map((m) => [m[1], m[2]] as [string, string]));
  const tids = new Map([...read('textClient.inc').matchAll(/^\s*(TID_DESC_CRAFTING_\w+)\s+\S+\s*\{\s*(?:"([^"]*)"|(IDS_\w+))\s*\}/gm)].map((m) => [m[1], m[2] ?? ids.get(m[3]) ?? ''] as [string, string]));
  return (tid) => (tids.get(tid) ?? '').replace(/\\n/g, '\n').trim();
}

/**
 * Aplica o craft numa lista de itens (a mesma lógica serve de ensaio numa cópia e de verdade no estado): tira os componentes das
 * pilhas simples da bolsa e põe o resultado (empilha no que der, senão no primeiro espaço livre). Devolve false se faltar componente
 * ou espaço — nesse caso `items` pode ter sido alterada (por isso o ensaio é feito numa cópia). `touch` marca os espaços mexidos.
 */
export function applyCraft(items: InvItem[], r: Recipe, bagSlots: number, packMax: (id: number) => number, touch: (slot: number) => void = () => {}): boolean {
  const plain = (i: InvItem) => !i.u && !i.e && !i.el && !i.p?.length && !i.g?.length && !i.r && !i.x;
  for (const c of r.comps) {
    let need = c.n;
    for (const i of items) {
      if (need <= 0) break;
      if (i.c !== 0 || i.id !== c.id || !plain(i)) continue;
      const k = Math.min(need, i.n);
      i.n -= k; need -= k; touch(i.s);
    }
    if (need > 0) return false;
  }
  for (let k = items.length - 1; k >= 0; k--) if (items[k].c === 0 && items[k].n <= 0) items.splice(k, 1);
  let left = r.result.n;
  const max = packMax(r.result.id);
  for (const i of items) {
    if (left <= 0) break;
    if (i.c !== 0 || i.id !== r.result.id || !plain(i) || i.n >= max) continue;
    const k = Math.min(left, max - i.n);
    i.n += k; left -= k; touch(i.s);
  }
  const used = new Set(items.filter((i) => i.c === 0).map((i) => i.s));
  for (let s = 0; s < bagSlots && left > 0; s++) {
    if (used.has(s)) continue;
    const k = Math.min(left, max);
    items.push({ c: 0, s, id: r.result.id, n: k, u: 0, e: 0, el: 0 } as InvItem);
    touch(s); left -= k;
  }
  return left <= 0;
}
