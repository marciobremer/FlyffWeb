import fs from 'node:fs';
import path from 'node:path';
import { decodeText } from '../../shared/formats/rgn';
import type { ItemCatalog, ItemDef } from '../common/items';
import { BAG, type InvEdit, type InvItem } from '../character/inventory';
import type { SmithResult } from './upgrade';

/**
 * Despertar (CRandomOptionProperty, _Common/randomoption.cpp + randomoption.inc):
 *   Scroll of Awakening (II_SYS_SYS_SCR_AWAKE)   arma, suit, escudo, luva, bota e capacete sem despertar: sorteia 1 a 3 opções
 *   Scroll of Reversion (II_SYS_SYS_SCR_AWAKECANCEL, 02 = evento) tira o despertar para poder despertar de novo
 *   Blessing of the Goddess (…BLESSEDNESS, 02)  o mesmo para as peças de aparência (cloth, capa, chapéu, luva, bota, máscara); vale
 *                                                 de novo mesmo com opções (sorteia outras)
 * O bloco `Awakening a b c { DST_X peso { valor chance … } … }` dá: as chances (cumulativas) de 1, 2 ou 3 opções, o peso de cada DST e a
 * chance de cada valor (sobre 1.000.000.000). Luva, bota e capacete só sorteiam os DST de AwakeningExtension.
 * O item guarda a lista [DST, valor, …] (`InvItem.a`); os DST entram nos atributos do personagem ao equipar (combat.buildFighter).
 */
interface Opt { dst: number; weight: number; adj: { v: number; cum: number }[] }
interface Table { size: number[]; opts: Opt[] }

/** partes (defineNeuz.h) */
const AWAKE_PARTS = new Set([2, 4, 5, 6, 10, 11]);
const BLESS_PARTS = new Set([8, 12, 26, 27, 28, 29]);
/** AwakeningExtension: DST permitidos em luva (4), bota (5) e capacete (6) */
const EXT: Record<number, string[]> = {
  4: ['DST_CHR_CHANCECRITICAL', 'DST_ATKPOWER', 'DST_SPELL_RATE', 'DST_ATTACKSPEED', 'DST_MP_MAX', 'DST_FP_MAX'],
  5: ['DST_CRITICAL_BONUS', 'DST_SPEED', 'DST_ADJDEF', 'DST_HP_MAX', 'DST_MP_MAX', 'DST_FP_MAX'],
  6: ['DST_STR', 'DST_DEX', 'DST_INT', 'DST_STA', 'DST_MP_MAX', 'DST_FP_MAX'],
};

export type AwakeKind = 'awake' | 'bless';

export class Awakening {
  private tables: Record<AwakeKind, Table | null> = { awake: null, bless: null };
  private scrolls = new Map<number, 'awake' | 'cancel' | 'bless'>();

  constructor(private items: ItemCatalog) {
    let text = '';
    try { const b = fs.readFileSync(path.join(items.resDir, 'randomoption.inc')); text = decodeText(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer, 'windows-1252'); } catch { return; }
    const tok = text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ').match(/[{}]|[^\s{}]+/g) ?? [];
    const D = (s: string) => (/^-?\d+$/.test(s) ? Number(s) : items.defines.get(s) ?? -1);
    for (let i = 0; i < tok.length; i++) {
      const kind: AwakeKind | null = tok[i] === 'Awakening' ? 'awake' : tok[i] === 'Blessing' ? 'bless' : null;
      if (!kind || tok[i + 4] !== '{') continue;
      let cum = 0;
      const size = [1, 2, 3].map((k) => (cum += Number(tok[i + k]) || 0));
      const opts: Opt[] = [];
      let k = i + 5;
      while (k < tok.length && tok[k] !== '}') {
        const dst = D(tok[k]), weight = Number(tok[k + 1]) || 0;
        if (tok[k + 2] !== '{') break;
        k += 3;
        const adj: Opt['adj'] = [];
        let total = 0;
        while (k < tok.length && tok[k] !== '}') { total += Number(tok[k + 1]) || 0; adj.push({ v: Number(tok[k]), cum: total }); k += 2; }
        k++; // }
        if (dst > 0 && adj.length) opts.push({ dst, weight, adj });
      }
      this.tables[kind] = { size, opts };
      i = k;
    }
    for (const [sym, what] of [['II_SYS_SYS_SCR_AWAKE', 'awake'], ['II_SYS_SYS_SCR_AWAKECANCEL', 'cancel'], ['II_SYS_SYS_SCR_AWAKECANCEL02', 'cancel'], ['II_SYS_SYS_SCR_BLESSEDNESS', 'bless'], ['II_SYS_SYS_SCR_BLESSEDNESS02', 'bless']] as const) {
      const id = items.defines.get(sym);
      if (id !== undefined) this.scrolls.set(id, what);
    }
  }

  /** o item é um dos pergaminhos de despertar (usa o modo "escolher o item") */
  handles(d: ItemDef | undefined) { return !!d && this.scrolls.has(d.id); }

  /** que tipo de despertar o item aceita (null = nenhum) */
  kindOf(d: ItemDef): AwakeKind | null {
    if (d.parts < 0 || (d.kind1 !== 1 && d.kind1 !== 2)) return null;
    if (AWAKE_PARTS.has(d.parts)) return 'awake';
    if (BLESS_PARTS.has(d.parts)) return 'bless';
    return null;
  }

  /** sorteia as opções do item (GenRandomOption): [DST, valor, …] */
  roll(kind: AwakeKind, parts: number): number[] {
    const t = this.tables[kind];
    if (!t || !t.opts.length) return [];
    const allowed = kind === 'awake' && EXT[parts] ? new Set(EXT[parts].map((n) => this.items.defines.get(n))) : null;
    const opts = allowed ? t.opts.filter((o) => allowed.has(o.dst)) : t.opts;
    const total = opts.reduce((n, o) => n + o.weight, 0);
    if (total <= 0) return [];
    const r = Math.random() * t.size[2];
    const count = t.size.findIndex((c) => r < c) + 1 || 1;
    const out: number[] = [];
    for (let n = 0; n < count; n++) {
      let w = Math.random() * total, o = opts[opts.length - 1];
      for (const c of opts) { if (w < c.weight) { o = c; break; } w -= c.weight; }
      const a = Math.random() * 1_000_000_000;
      out.push(o.dst, (o.adj.find((x) => a < x.cum) ?? o.adj[o.adj.length - 1]).v);
    }
    return out;
  }

  /** usa o pergaminho `mat` (já escolhido) no item `it` da bolsa; o pergaminho só é gasto se der certo */
  use(x: InvEdit, it: InvItem, d: ItemDef, mat: InvItem, md: ItemDef): SmithResult {
    const what = this.scrolls.get(md.id)!;
    const kind = this.kindOf(d);
    const take = () => { if (mat.n > 1) mat.n--; else x.state.items.splice(x.state.items.indexOf(mat), 1); x.touch(BAG, mat.s); };
    const has = !!it.a?.length;
    if (what === 'cancel') {
      if (kind !== 'awake' || !has) return { ok: false, text: kind !== 'awake' ? `${d.name} não pode ser despertado, então não há o que reverter.` : `${d.name} não tem despertar.` };
      delete it.a; x.touch(BAG, it.s); take();
      return { ok: true, fx: 'success', slot: it.s, text: `${d.name}: despertar removido.` };
    }
    const want: AwakeKind = what;
    if (kind !== want) return { ok: false, text: want === 'awake' ? `${d.name} não aceita o Scroll of Awakening (só arma, suit, escudo, luva, bota e capacete).` : `${d.name} não aceita a Blessing of the Goddess (só cloth, capa, chapéu, luva, bota e máscara de aparência).` };
    if (want === 'awake' && has) return { ok: false, text: `${d.name} já está despertado. Use o Scroll of Reversion antes.` };
    const a = this.roll(want, d.parts);
    if (!a.length) return { ok: false, text: 'Despertar indisponível: faltam as tabelas do randomoption.inc.' };
    it.a = a; x.touch(BAG, it.s); take();
    return { ok: true, fx: 'success', slot: it.s, text: `${d.name} despertado!` };
  }
}
