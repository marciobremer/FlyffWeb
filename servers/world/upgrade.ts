import fs from 'node:fs';
import path from 'node:path';
import { decodeText } from '../../shared/formats/rgn';
import { maxPiercing } from '../../shared/upgrade';
import type { ItemCatalog, ItemDef } from '../common/items';
import { BAG, BAG_SLOTS, type InvEdit, type InvItem } from '../character/inventory';

/**
 * Ferreiro: upgrade de equipamento, joias, elemento e piercing (CItemUpgrade, WORLDSERVER/ItemUpgrade.cpp) e a linha das armas
 * ultimate (CUltimateWeapon, _Common/UltimateWeapon.cpp), com as chances dos mesmos arquivos do servidor oficial:
 *   ItemUpgrade.lua            tSuitProb (abrir furo na suit), tGeneral (upgrade geral +1…+10), AddAttribute (elemento +1…+20)
 *   UpgradeSuccess.inc         "fail stack" (__UPGRADE_SUCCESS): depois de N falhas seguidas no mesmo nível o próximo sai garantido
 *   accessory.inc              Probability { … } das joias (este servidor não tem o bloco: a chance é 0 e vale só o fail stack)
 *   Ultimate_UltimateWeapon.txt  chances de engastar/tirar joia, converter arma, extrair joia e do upgrade da ultimate
 *   Ultimate_GemAbility.txt    o que cada joia dá na ultimate (por quantas iguais) e qual joia sai de cada faixa de nível
 *
 * Como no original: o material sempre é gasto; sem pergaminho de proteção, falhar a partir do +3 (geral, joia, elemento),
 * na ultimate ou ao abrir furo na suit DESTRÓI o item. Com proteção (janela do ferreiro, "upgrade seguro") só se perde o material.
 * Chances em n/10000, menos as da ultimate (n/1.000.000).
 */

/** elemento da carta base de cada elemento (WhatEleCard): só ela sobe o elemento */
const ELEMENT_CARD: Record<number, string> = { 1: 'II_GEN_MAT_ELE_FLAME', 2: 'II_GEN_MAT_ELE_RIVER', 3: 'II_GEN_MAT_ELE_GENERATOR', 5: 'II_GEN_MAT_ELE_DESERT', 4: 'II_GEN_MAT_ELE_CYCLON' };
/** tabela de vantagem dos elementos (GetDamagePropertyFactor): 0 nada, 1 igual, 2 desvantagem, 3 vantagem — [atacante][defensor] */
const ELEMENT_TABLE = [[0, 0, 0, 0, 0, 0], [0, 1, 2, 0, 3, 0], [0, 3, 1, 2, 0, 0], [0, 0, 3, 1, 0, 2], [0, 2, 0, 0, 1, 3], [0, 0, 0, 3, 2, 1]];

export interface SmithResult {
  ok: boolean;
  /** mensagem para o chat */
  text: string;
  /** efeito/som do resultado (XI_INT_SUCCESS / XI_INT_FAIL, SND_INF_UPGRADESUCCESS / FAIL); sem = recusado antes de tentar */
  fx?: 'success' | 'fail';
  /** espaço do item principal depois (para a janela continuar nele); undefined se ele sumiu */
  slot?: number;
}

const rand = (n: number) => Math.floor(Math.random() * n);
const refuse = (text: string): SmithResult => ({ ok: false, text });

export class UpgradeRules {
  suitProb: number[] = [];
  generalProb: number[] = [];
  attribute: { prob: number; dmg: number; def: number; addAtk: number }[] = [];
  accessoryProb: number[] = [];
  /** fail stack: categoria (dwReferStat1: 0 geral, 1 unique, 2 ultimate, 3 set de armadura; 'acc' joias) → nível → tentativas */
  failStack = new Map<number | 'acc', Map<number, number>>();
  ult = { setGem: 900000, removeGem: 1000000, gen2uni: 20000, uni2ulti: 20000, makeGem: new Map<number, [number, number, number, number]>(), enchant: new Map<number, number>() };
  /** joia por faixa de nível da arma (LEVEL_GEM) e o que cada joia vira na ultimate, por DST (ABILITY) */
  gemLevels: { gem: number; min: number; max: number }[] = [];
  gemAbility: { dst: number; list: { gem: number; ability: number; values: number[] }[] }[] = [];
  private id: Record<string, number> = {};
  private k: Record<string, number> = {};

  constructor(private items: ItemCatalog) {
    const read = (f: string) => { try { const b = fs.readFileSync(path.join(items.resDir, f)); return decodeText(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer, 'windows-1252'); } catch { return ''; } };
    const D = (s: string) => (/^-?\d+$/.test(s) ? Number(s) : items.defines.get(s) ?? -1);
    const strip = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ').replace(/--[^\n]*/g, ' ');
    // ItemUpgrade.lua
    const lua = strip(read('ItemUpgrade.lua'));
    const arr = (name: string) => (new RegExp(`${name}\\s*=\\s*\\{([^}]*)\\}`).exec(lua)?.[1] ?? '').split(',').map((v) => Number(v.trim())).filter((v) => Number.isFinite(v));
    this.suitProb = arr('tSuitProb');
    this.generalProb = arr('tGeneral');
    for (const m of lua.matchAll(/AddAttribute\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/g)) this.attribute[Number(m[1])] = { prob: Number(m[2]), dmg: Number(m[3]), def: Number(m[4]), addAtk: Number(m[5]) };
    // UpgradeSuccess.inc: NOME { nível tentativas … }
    for (const m of strip(read('UpgradeSuccess.inc')).matchAll(/(\w+)\s*\{([^}]*)\}/g)) {
      const key = m[1] === 'ACCESSORY_NORMAL' ? 'acc' : m[1] === 'ACCESSORY_SET' ? null : D(m[1]);
      if (key === null || key === -1) continue;
      const nums = m[2].trim().split(/\s+/).map(Number);
      const t = new Map<number, number>();
      for (let i = 0; i + 1 < nums.length; i += 2) t.set(nums[i], nums[i + 1]);
      this.failStack.set(key, t);
    }
    // accessory.inc: Probability { … } (opcional)
    const acc = /Probability\s*\{([^}]*)\}/.exec(strip(read('accessory.inc')))?.[1];
    if (acc) this.accessoryProb = acc.trim().split(/\s+/).map(Number).filter(Number.isFinite);
    // Ultimate_UltimateWeapon.txt
    const uw = strip(read('Ultimate_UltimateWeapon.txt'));
    const one = (k: string, def: number) => Number(new RegExp(`${k}\\s+(\\d+)`).exec(uw)?.[1] ?? def);
    this.ult.setGem = one('SET_GEM', 900000); this.ult.removeGem = one('REMOVE_GEM', 1000000);
    this.ult.gen2uni = one('GENERAL2UNIQUE', 20000); this.ult.uni2ulti = one('UNIQUE2ULTIMATE', 20000);
    const block = (k: string) => (new RegExp(`${k}\\s*\\{([^}]*)\\}`).exec(uw)?.[1] ?? '').trim().split(/\s+/).map(Number).filter(Number.isFinite);
    const mg = block('MAKE_GEM');
    for (let i = 0; i + 4 < mg.length; i += 5) this.ult.makeGem.set(mg[i], [mg[i + 1], mg[i + 2], mg[i + 3], mg[i + 4]]);
    const ue = block('ULTIMATE_ENCHANT');
    for (let i = 0; i + 1 < ue.length; i += 2) this.ult.enchant.set(ue[i], ue[i + 1]);
    // Ultimate_GemAbility.txt
    const ga = strip(read('Ultimate_GemAbility.txt'));
    for (const m of ga.matchAll(/ABILITY\s+(\w+)\s*\{([^}]*)\}/g)) {
      const tok = m[2].trim().split(/\s+/);
      const list: { gem: number; ability: number; values: number[] }[] = [];
      for (let i = 0; i + 6 < tok.length; i += 7) list.push({ gem: D(tok[i]), ability: D(tok[i + 1]), values: tok.slice(i + 2, i + 7).map(Number) });
      this.gemAbility.push({ dst: D(m[1]), list });
    }
    const lg = (/LEVEL_GEM\s*\{([^}]*)\}/.exec(ga)?.[1] ?? '').trim().split(/\s+/);
    for (let i = 0; i + 2 < lg.length; i += 3) this.gemLevels.push({ gem: D(lg[i]), min: Number(lg[i + 1]), max: Number(lg[i + 2]) });
    for (const s of ['II_GEN_MAT_ORICHALCUM01', 'II_GEN_MAT_ORICHALCUM01_1', 'II_GEN_MAT_ORICHALCUM02', 'II_GEN_MAT_MOONSTONE', 'II_GEN_MAT_MOONSTONE_1',
      'II_SYS_SYS_SCR_SMELPROT', 'II_SYS_SYS_SCR_SMELPROT3', 'II_SYS_SYS_SCR_SMELPROT4', 'II_SYS_SYS_SCR_PIEPROT', 'II_SYS_SYS_SCR_SMELTING', 'II_SYS_SYS_SCR_SMELTING2']) this.id[s] = items.defines.get(s) ?? -1;
    for (const s of ['IK1_WEAPON', 'IK2_WEAPON_DIRECT', 'IK2_WEAPON_MAGIC', 'IK2_ARMOR', 'IK2_ARMORETC', 'IK3_SUIT', 'IK3_ELECARD', 'IK3_PIERDICE', 'IK3_ENCHANT']) this.k[s] = items.defines.get(s) ?? -999;
    console.log(`Ferreiro: upgrade ${this.generalProb.length} níveis, elemento ${this.attribute.filter(Boolean).length}, furos da suit ${this.suitProb.length}, ` +
      `${this.gemAbility.length} tipos de joia da ultimate, fail stack em ${this.failStack.size} categorias${this.accessoryProb.length ? '' : ' (joias sem chance base no accessory.inc)'}`);
  }

  // ---------- classificação dos itens ----------
  private def(it: InvItem | undefined) { return it ? this.items.byId.get(it.id) : undefined; }
  private is(d: ItemDef | undefined, ...syms: string[]) { return !!d && syms.some((s) => this.id[s] === d.id); }
  isSunstone(d: ItemDef | undefined) { return this.is(d, 'II_GEN_MAT_ORICHALCUM01', 'II_GEN_MAT_ORICHALCUM01_1'); }
  isMoonstone(d: ItemDef | undefined) { return this.is(d, 'II_GEN_MAT_MOONSTONE', 'II_GEN_MAT_MOONSTONE_1'); }
  isShiningOri(d: ItemDef | undefined) { return this.is(d, 'II_GEN_MAT_ORICHALCUM02'); }
  /** IsDiceRefineryAble: arma ou armadura (não a baruna, que não existe aqui) */
  refinable(d: ItemDef) { const k = this.k; return d.kind2 === k.IK2_ARMOR || d.kind2 === k.IK2_WEAPON_MAGIC || d.kind2 === k.IK2_WEAPON_DIRECT || d.kind2 === k.IK2_ARMORETC; }
  /** IsEleRefineryAble: suit ou arma */
  eleRefinable(d: ItemDef) { const k = this.k; return d.kind3 === k.IK3_SUIT || d.kind2 === k.IK2_WEAPON_MAGIC || d.kind2 === k.IK2_WEAPON_DIRECT; }
  isAccessory(d: ItemDef) { return this.items.accessory.has(d.id); }
  isWeapon(d: ItemDef) { return d.kind1 === this.k.IK1_WEAPON; }
  isElementCard(d: ItemDef | undefined) { return !!d && d.kind3 === this.k.IK3_ELECARD; }
  /** material que o upgrade com duplo clique / martelo aceita (Sunstone, orichalcum brilhante, moonstone em joia, carta de elemento) */
  isUpgradeMaterial(d: ItemDef | undefined) { return !!d && (d.kind3 === this.k.IK3_ENCHANT || d.kind3 === this.k.IK3_ELECARD || d.kind3 === this.k.IK3_PIERDICE); }
  /** joia que a arma do nível `level` dá / pede (GetGemKind) */
  gemFor(level: number) { return this.gemLevels.find((g) => level >= g.min && level <= g.max)?.gem ?? -1; }
  isGem(d: ItemDef | undefined) { return !!d && this.gemLevels.some((g) => g.gem === d.id); }

  /** chance (n/10000) do próximo upgrade geral: tGeneral[u+1], −10% do +4 em diante (fora da Coreia, como o original) */
  generalChance(u: number) { const p = this.generalProb[u] ?? 0; return u >= 3 ? Math.floor(p * 0.9) : p; }
  private stackFor(d: ItemDef) { return this.isAccessory(d) ? this.failStack.get('acc') : d.referStat1 >= 0 ? this.failStack.get(d.referStat1) : undefined; }
  /** tentativas para o upgrade garantido no nível atual (undefined = sem fail stack) */
  stackNeed(d: ItemDef, u: number) { const n = this.stackFor(d)?.get(u); return n && n > 0 ? n : undefined; }

  /**
   * Bônus das joias engastadas na arma ultimate (GetDestParamUltimate): soma por joia igual — 1 joia vale values[0], 2 iguais
   * values[1]… — o DST é o dwReferStat2 do item da joia.
   */
  gemDst(gems: number[] | undefined): [number, number][] {
    const count = new Map<number, number>();
    for (const g of gems ?? []) { if (!g) break; count.set(g, (count.get(g) ?? 0) + 1); }
    const out = new Map<number, number>();
    for (const [g, n] of count) {
      const dst = this.items.byId.get(g)?.referStat2 ?? -1;
      const v = this.gemAbility.find((a) => a.dst === dst)?.list.find((e) => e.ability === g)?.values[Math.min(5, n) - 1] ?? 0;
      if (dst > 0 && v) out.set(dst, (out.get(dst) ?? 0) + v);
    }
    return [...out];
  }

  /**
   * Fator do elemento no golpe (GetDamagePropertyFactor, __EXT_ATTRIBUTE): n/10000 a somar ao dano. Atacante e defensor com
   * elemento e nível (0 = sem elemento). Igual/neutro: quem tem nível maior leva; vantagem/desvantagem deslocam 5 níveis.
   */
  elementFactor(atkType: number, atkLevel: number, defType: number, defLevel: number) {
    if (!atkType && !defType) return 0;
    const dmg = (n: number) => this.attribute[Math.min(n, this.attribute.length - 1)]?.dmg ?? 0;
    const def = (n: number) => (n > 0 ? this.attribute[Math.min(n, this.attribute.length - 1)]?.def ?? 0 : 0);
    const addAtk = (n: number) => this.attribute[Math.min(n, this.attribute.length - 1)]?.addAtk ?? 0;
    let factor = 0, level = 0;
    switch (ELEMENT_TABLE[atkType]?.[defType] ?? 0) {
      case 0: case 1:
        if (atkLevel > 0 && defLevel === 0) factor += dmg(atkLevel);
        else if (atkLevel === 0 && defLevel > 0) factor -= def(defLevel - 3);
        else if (atkLevel > 0 && defLevel > 0) level = atkLevel - defLevel;
        break;
      case 2: level = atkLevel - 5 - defLevel; break;
      case 3:
        level = atkLevel - (defLevel > 5 ? defLevel - 5 : 0);
        if (level > 0) factor += addAtk(level);
        break;
    }
    if (level) factor += level > 0 ? dmg(level) : -def(-level);
    return factor;
  }

  // ---------- ajudantes de inventário ----------
  private bag(x: InvEdit, s: number) { return x.state.items.find((i) => i.c === BAG && i.s === s); }
  private findBag(x: InvEdit, pred: (d: ItemDef) => boolean) { return x.state.items.find((i) => i.c === BAG && !i.x && pred(this.items.byId.get(i.id)!)); }
  private take(x: InvEdit, it: InvItem, n = 1) { if (it.n > n) it.n -= n; else x.state.items.splice(x.state.items.indexOf(it), 1); x.touch(BAG, it.s); }
  private destroy(x: InvEdit, it: InvItem) { x.state.items.splice(x.state.items.indexOf(it), 1); x.touch(BAG, it.s); }
  private countBag(x: InvEdit, pred: (d: ItemDef) => boolean) { let n = 0; for (const i of x.state.items) if (i.c === BAG && pred(this.items.byId.get(i.id)!)) n += i.n; return n; }
  /** gasta `n` de itens que batem com `pred`, de quantos espaços precisar */
  private spend(x: InvEdit, pred: (d: ItemDef) => boolean, n: number) {
    for (const it of [...x.state.items]) {
      if (n <= 0) break;
      if (it.c !== BAG || !pred(this.items.byId.get(it.id)!)) continue;
      const k = Math.min(n, it.n);
      this.take(x, it, k);
      n -= k;
    }
  }
  /** cabe `n` do item `id` (empilhando)? */
  private fits(x: InvEdit, id: number, n: number) {
    const d = this.items.byId.get(id);
    if (!d) return false;
    let room = 0;
    for (const i of x.state.items) if (i.c === BAG && i.id === id && !i.u && !i.p?.length && !i.x && i.n < d.packMax) room += d.packMax - i.n;
    const used = new Set(x.state.items.filter((i) => i.c === BAG).map((i) => i.s));
    for (let s = 0; s < BAG_SLOTS; s++) if (!used.has(s)) room += d.packMax;
    return room >= n;
  }
  private give(x: InvEdit, id: number, n: number) {
    const d = this.items.byId.get(id)!;
    for (const i of x.state.items) {
      if (n <= 0) break;
      if (i.c !== BAG || i.id !== id || i.u || i.p?.length || i.x || i.n >= d.packMax) continue;
      const k = Math.min(n, d.packMax - i.n);
      i.n += k; n -= k; x.touch(BAG, i.s);
    }
    const used = new Set(x.state.items.filter((i) => i.c === BAG).map((i) => i.s));
    for (let s = 0; s < BAG_SLOTS && n > 0; s++) {
      if (used.has(s)) continue;
      const k = Math.min(n, d.packMax);
      x.state.items.push({ c: BAG, s, id, n: k, u: 0, e: 0, el: 0 });
      x.touch(BAG, s);
      n -= k;
    }
  }
  /** pergaminho (proteção ou chance) da bolsa: o 1º espaço com ele */
  private scroll(x: InvEdit, sym: string) { return this.findBag(x, (d) => d.id === this.id[sym]); }
  private name(d: ItemDef, it?: InvItem) { return `${d.name}${it?.u ? ` +${it.u}` : ''}`; }

  /** sucesso pela chance ou garantido pelo fail stack; atualiza as tentativas */
  private roll(it: InvItem, d: ItemDef, chance: number, scale: number) {
    const need = this.stackNeed(d, it.u);
    const forced = need !== undefined && (it.t ?? 0) + 1 >= need;
    const ok = forced || rand(scale) < chance;
    if (ok) delete it.t; else if (need !== undefined) it.t = (it.t ?? 0) + 1;
    return { ok, forced };
  }

  // ---------- upgrade (duplo clique no material ou janela do ferreiro) ----------
  /**
   * Upgrade do item `s` da bolsa com o material `m` (CItemUpgrade::OnEnchant / OnSmeltSafety): Sunstone = upgrade geral,
   * orichalcum brilhante = upgrade da ultimate, moonstone = joia, carta de elemento = elemento. `safe` usa o pergaminho de
   * proteção da bolsa (obrigatório nesse caso); `rate` usa o pergaminho de chance (+10%, como o original) se houver.
   */
  enchant(x: InvEdit, s: number, m: number, opts: { safe: boolean; rate: boolean }): SmithResult {
    const it = this.bag(x, s), mat = this.bag(x, m), d = this.def(it), md = this.def(mat);
    if (!it || !d) return refuse('Escolha o item a melhorar (na bolsa; o equipado não serve).');
    if (!mat || !md) return refuse('Escolha o material.');
    if (it === mat) return refuse('O material não pode ser o próprio item.');
    if (it.x) return refuse('Itens de tempo não recebem upgrade.');
    if (this.isSunstone(md)) return this.general(x, it, d, mat, opts);
    if (this.isShiningOri(md)) return this.ultimateEnchant(x, it, d, mat, opts.safe);
    if (this.isMoonstone(md)) {
      if (this.isAccessory(d)) return this.accessory(x, it, d, mat, opts.safe);
      return refuse('A moonstone sobe joias (anel, brinco, colar). Para abrir furo na suit, fale com o ferreiro (Bobochan).');
    }
    if (this.isElementCard(md)) return this.attributeUp(x, it, d, mat, md, opts);
    return refuse(`${md.name} não é material de upgrade.`);
  }

  /** EnchantGeneral / SmeltSafetyGeneral */
  private general(x: InvEdit, it: InvItem, d: ItemDef, mat: InvItem, opts: { safe: boolean; rate: boolean }): SmithResult {
    if (d.referStat1 === 2) return refuse(`${d.name} é ultimate: o upgrade dela é com orichalcum brilhante.`);
    if (!this.refinable(d)) return refuse(`${d.name} não recebe upgrade com Sunstone.`);
    if (it.u >= this.generalProb.length) return refuse(`${this.name(d, it)} já está no máximo.`);
    const prot = opts.safe ? this.scroll(x, 'II_SYS_SYS_SCR_SMELPROT') : undefined;
    if (opts.safe && !prot) return refuse('Falta o pergaminho de proteção (Scroll of SProtect) na bolsa.');
    let chance = this.generalChance(it.u);
    const rate = opts.rate && it.u < 7 ? this.scroll(x, 'II_SYS_SYS_SCR_SMELTING') : undefined;
    if (rate) { chance += 1000; this.take(x, rate); }
    if (prot) this.take(x, prot);
    this.take(x, mat);
    return this.finish(x, it, d, this.roll(it, d, chance, 10000), !prot && it.u >= 3, 'u');
  }

  /** RefineAccessory / SmeltSafetyAccessory: joia até +20 com moonstone */
  private accessory(x: InvEdit, it: InvItem, d: ItemDef, mat: InvItem, safe: boolean): SmithResult {
    if (it.u >= 20) return refuse(`${this.name(d, it)} já está no máximo (+20).`);
    const prot = safe ? this.scroll(x, 'II_SYS_SYS_SCR_SMELPROT4') : undefined;
    if (safe && !prot) return refuse('Falta o pergaminho de proteção de joias (Scroll of AProtect) na bolsa.');
    if (prot) this.take(x, prot);
    this.take(x, mat);
    return this.finish(x, it, d, this.roll(it, d, this.accessoryProb[it.u] ?? 0, 10000), !prot && it.u >= 3, 'u');
  }

  /** EnchantAttribute / SmeltSafetyAttribute: elemento +1…+20 com a carta base do elemento; um elemento por item */
  private attributeUp(x: InvEdit, it: InvItem, d: ItemDef, mat: InvItem, md: ItemDef, opts: { safe: boolean; rate: boolean }): SmithResult {
    if (!this.eleRefinable(d)) return refuse(`${d.name} não recebe elemento: só armas e suits.`);
    if (it.e && it.e !== md.element) return refuse(`${d.name} já tem outro elemento: um item tem um elemento só.`);
    if (ELEMENT_CARD[md.element] !== md.symbol) return refuse(`${md.name} não sobe o elemento: use a carta base (Flame, River, Generator, Cyclone, Desert Card).`);
    const max = this.attribute.length - 1;
    if (it.el >= max) return refuse(`${d.name} já está com o elemento no máximo (+${max}).`);
    const prot = opts.safe ? this.scroll(x, 'II_SYS_SYS_SCR_SMELPROT') : undefined;
    if (opts.safe && !prot) return refuse('Falta o pergaminho de proteção (Scroll of SProtect) na bolsa.');
    let chance = this.attribute[it.el + 1]?.prob ?? 0;
    const rate = opts.rate && it.el < 10 ? this.scroll(x, 'II_SYS_SYS_SCR_SMELTING2') : undefined;
    if (rate) { chance += 1000; this.take(x, rate); }
    if (prot) this.take(x, prot);
    const element = md.element;
    this.take(x, mat);
    // elemento não tem fail stack
    const ok = rand(10000) < chance;
    if (ok) { it.e = element; it.el++; x.touch(BAG, it.s); }
    return this.outcome(x, it, d, ok, false, !prot && it.el >= 3, `elemento +${it.el}`);
  }

  /** CUltimateWeapon::EnchantWeapon / SmeltSafetyUltimate: ultimate +1…+10; do +6 em diante abre um espaço de joia por nível */
  private ultimateEnchant(x: InvEdit, it: InvItem, d: ItemDef, mat: InvItem, safe: boolean): SmithResult {
    if (d.referStat1 !== 2) return refuse('O orichalcum brilhante sobe só armas ultimate.');
    if (it.u >= 10) return refuse(`${this.name(d, it)} já está no máximo.`);
    const prot = safe ? this.scroll(x, 'II_SYS_SYS_SCR_SMELPROT3') : undefined;
    if (safe && !prot) return refuse('Falta o pergaminho de proteção da ultimate (Scroll of UProtect) na bolsa.');
    if (prot) this.take(x, prot);
    this.take(x, mat);
    const r = this.roll(it, d, this.ult.enchant.get(it.u + 1) ?? 0, 1000000);
    const res = this.finish(x, it, d, r, !prot, 'u');
    if (r.ok && it.u > 5) { const g = it.g ?? []; while (g.length < it.u - 5) g.push(0); it.g = g; x.touch(BAG, it.s); }
    return res;
  }

  /** aplica o resultado de um upgrade geral/joia/ultimate (sobe o nível ou destrói/mantém) */
  private finish(x: InvEdit, it: InvItem, d: ItemDef, r: { ok: boolean; forced: boolean }, destroyOnFail: boolean, _field: 'u'): SmithResult {
    if (r.ok) { it.u++; x.touch(BAG, it.s); } else x.touch(BAG, it.s);
    return this.outcome(x, it, d, r.ok, r.forced, destroyOnFail, `+${it.u}`);
  }

  private outcome(x: InvEdit, it: InvItem, d: ItemDef, ok: boolean, forced: boolean, destroyOnFail: boolean, level: string): SmithResult {
    if (ok) return { ok: true, fx: 'success', slot: it.s, text: `Sucesso! ${d.name} agora está ${level}.${forced ? ' (garantido pelas falhas seguidas)' : ''}` };
    if (destroyOnFail) { this.destroy(x, it); return { ok: false, fx: 'fail', text: `Falhou… ${this.name(d, it)} foi destruído.` }; }
    const need = this.stackNeed(d, it.u);
    return { ok: false, fx: 'fail', slot: it.s, text: `Falhou. ${this.name(d, it)} continua igual.${need ? ` (${it.t ?? 0}/${need} para o garantido)` : ''}` };
  }

  // ---------- piercing (Bobochan) ----------
  /** CItemUpgrade::OnPiercingSize / SmeltSafetyPiercingSize: abre um furo na suit com moonstone e 100.000 de penya */
  pierceSize(x: InvEdit, s: number, safe: boolean): SmithResult {
    const it = this.bag(x, s), d = this.def(it);
    if (!it || !d) return refuse('Escolha a suit (na bolsa; a equipada não serve).');
    const max = maxPiercing(d.parts);
    if (!max) return refuse(`${d.name} não abre furos: só a suit.`);
    const size = it.p?.length ?? 0;
    if (size >= max) return refuse(`${d.name} já tem todos os ${max} furos.`);
    const moon = this.findBag(x, (k) => this.isMoonstone(k));
    if (!moon) return refuse('Falta a moonstone na bolsa.');
    const prot = safe ? this.scroll(x, 'II_SYS_SYS_SCR_PIEPROT') : undefined;
    if (safe && !prot) return refuse('Falta o pergaminho de proteção de piercing (Scroll of PProtect) na bolsa.');
    if (x.state.gold < 100000) return refuse('Abrir um furo custa 100.000 de penya.');
    x.gold(-100000);
    this.take(x, moon);
    if (prot) this.take(x, prot);
    const ok = rand(10000) < (this.suitProb[size] ?? 0);
    if (ok) { it.p = [...(it.p ?? []), 0]; x.touch(BAG, it.s); }
    return this.outcome(x, it, d, ok, false, !prot, `com ${size + 1} furo${size ? 's' : ''}`);
  }

  /** CItemUpgrade::OnPiercingRemove: tira a última carta espetada por 1.000.000 de penya (a carta se perde) */
  pierceRemove(x: InvEdit, s: number): SmithResult {
    const it = this.bag(x, s), d = this.def(it);
    if (!it || !d) return refuse('Escolha o item (na bolsa; o equipado não serve).');
    const i = (it.p ?? []).map((c) => !!c).lastIndexOf(true);
    if (i < 0) return refuse(`${d.name} não tem cartas espetadas.`);
    if (x.state.gold < 1000000) return refuse('Tirar uma carta custa 1.000.000 de penya.');
    x.gold(-1000000);
    const card = this.items.byId.get(it.p![i])?.name ?? 'Carta';
    it.p = it.p!.map((c, k) => (k === i ? 0 : c));
    x.touch(BAG, it.s);
    return { ok: true, fx: 'success', slot: it.s, text: `${card} retirada de ${d.name}.` };
  }

  // ---------- ultimate (Peach e Bobochan) ----------
  /** CUltimateWeapon::MakeGem: desmancha uma arma geral/unique (nível 60+) e tira joias, pela faixa de nível e o enchant */
  makeGem(x: InvEdit, s: number): SmithResult {
    const it = this.bag(x, s), d = this.def(it);
    if (!it || !d || !this.isWeapon(d)) return refuse('Escolha uma arma (na bolsa).');
    if (d.referStat1 !== 0 && d.referStat1 !== 1) return refuse(`${d.name} não dá joia: só armas gerais e unique.`);
    const gem = this.gemFor(d.level);
    const row = this.ult.makeGem.get(it.u);
    if (gem < 0 || !row) return refuse(`${d.name} (nível ${d.level}) não dá joia: só armas do nível 60 em diante.`);
    const [prob, num] = d.referStat1 === 1 ? [row[2], row[3]] : [row[0], row[1]];
    if (!this.fits(x, gem, num)) return refuse('A bolsa não tem espaço para as joias.');
    this.destroy(x, it);
    const gd = this.items.byId.get(gem)!;
    if (rand(1000000) < prob) { this.give(x, gem, num); return { ok: true, fx: 'success', text: `${this.name(d, it)} virou ${num > 1 ? `${num}× ` : ''}${gd.name}.` }; }
    return { ok: false, fx: 'fail', text: `Falhou: ${this.name(d, it)} se desfez sem deixar joia.` };
  }

  /** CUltimateWeapon::MakeItem: 5 Sunstone + 5 moonstone = 1 orichalcum brilhante */
  mixJewel(x: InvEdit): SmithResult {
    const ori = this.items.byId.get(this.id.II_GEN_MAT_ORICHALCUM02);
    if (!ori) return refuse('Orichalcum brilhante não existe neste servidor.');
    if (this.countBag(x, (k) => this.isSunstone(k)) < 5 || this.countBag(x, (k) => this.isMoonstone(k)) < 5) return refuse('Precisa de 5 Sunstone e 5 moonstone na bolsa.');
    this.spend(x, (k) => this.isSunstone(k), 5);
    this.spend(x, (k) => this.isMoonstone(k), 5);
    if (!this.fits(x, ori.id, 1)) return refuse('A bolsa não tem espaço.');
    this.give(x, ori.id, 1);
    return { ok: true, fx: 'success', text: `${ori.name} criado.` };
  }

  /** CUltimateWeapon::SetGem: engasta uma joia no 1º espaço livre da ultimate (90%); a habilidade sai sorteada (GemAbility) */
  setGem(x: InvEdit, s: number, gs: number): SmithResult {
    const it = this.bag(x, s), d = this.def(it), gem = this.bag(x, gs), gd = this.def(gem);
    if (!it || !d || d.referStat1 !== 2) return refuse('Escolha uma arma ultimate (na bolsa).');
    if (!gem || !gd || !this.isGem(gd)) return refuse('Escolha a joia (Topaz, Ruby, Sapphire, Emerald, Diamond…).');
    const free = (it.g ?? []).indexOf(0);
    if (free < 0) return refuse(`${this.name(d, it)} não tem espaço livre para joia (abre 1 por nível do +6 ao +10).`);
    const groups = this.gemAbility;
    const pick = groups[rand(groups.length)]?.list.find((e) => e.gem === gd.id)?.ability ?? -1;
    if (pick < 0) return refuse(`${gd.name} não tem habilidade definida.`);
    this.take(x, gem);
    if (rand(1000000) < this.ult.setGem) {
      it.g = it.g!.map((v, k) => (k === free ? pick : v));
      x.touch(BAG, it.s);
      return { ok: true, fx: 'success', slot: it.s, text: `${this.items.byId.get(pick)?.name ?? gd.name} engastado em ${d.name}.` };
    }
    return { ok: false, fx: 'fail', slot: it.s, text: `Falhou: ${gd.name} se perdeu.` };
  }

  /** CUltimateWeapon::RemoveGem: tira a última joia engastada gastando uma moonstone */
  removeGem(x: InvEdit, s: number): SmithResult {
    const it = this.bag(x, s), d = this.def(it);
    if (!it || !d || d.referStat1 !== 2) return refuse('Escolha uma arma ultimate (na bolsa).');
    const i = (it.g ?? []).map((v) => !!v).lastIndexOf(true);
    if (i < 0) return refuse(`${d.name} não tem joias engastadas.`);
    const moon = this.findBag(x, (k) => this.isMoonstone(k));
    if (!moon) return refuse('Falta a moonstone na bolsa.');
    this.take(x, moon);
    if (rand(1000000) < this.ult.removeGem) {
      it.g = it.g!.map((v, k) => (k === i ? 0 : v));
      x.touch(BAG, it.s);
      return { ok: true, fx: 'success', slot: it.s, text: `Joia retirada de ${d.name}.` };
    }
    return { ok: false, fx: 'fail', slot: it.s, text: 'Falhou ao tirar a joia.' };
  }

  /**
   * CUltimateWeapon::TransWeapon: arma geral → unique, ou unique +10 → ultimate (volta a +0), com a joia do nível dela e um
   * orichalcum brilhante. Falhar destrói a arma, menos unique com o pergaminho de proteção da ultimate (`safe`).
   */
  transWeapon(x: InvEdit, s: number, safe: boolean): SmithResult {
    const it = this.bag(x, s), d = this.def(it);
    if (!it || !d || !this.isWeapon(d)) return refuse('Escolha uma arma (na bolsa).');
    const target = this.items.byId.get(d.referTarget1);
    if ((d.referStat1 !== 0 && d.referStat1 !== 1) || !target) return refuse(`${d.name} não tem conversão.`);
    const unique = d.referStat1 === 1;
    if (unique && it.u !== 10) return refuse('Para virar ultimate, a arma unique precisa estar +10.');
    const gemId = this.gemFor(d.level);
    const gem = this.findBag(x, (k) => k.id === gemId), ori = this.findBag(x, (k) => this.isShiningOri(k));
    if (!gem || !ori) return refuse(`Precisa de ${this.items.byId.get(gemId)?.name ?? 'a joia do nível da arma'} e de um orichalcum brilhante na bolsa.`);
    const prot = safe && unique ? this.scroll(x, 'II_SYS_SYS_SCR_SMELPROT3') : undefined;
    if (safe && unique && !prot) return refuse('Falta o pergaminho de proteção da ultimate (Scroll of UProtect) na bolsa.');
    const prob = d.referTarget2 > 0 ? d.referTarget2 : unique ? this.ult.uni2ulti : this.ult.gen2uni;
    this.take(x, gem); this.take(x, ori);
    if (prot) this.take(x, prot);
    if (rand(1000000) < prob) {
      it.id = target.id;
      if (unique) it.u = 0;
      delete it.t;
      x.touch(BAG, it.s);
      return { ok: true, fx: 'success', slot: it.s, text: `Sucesso! ${d.name} virou ${target.name}.` };
    }
    if (prot) return { ok: false, fx: 'fail', slot: it.s, text: `Falhou. ${this.name(d, it)} foi protegida pelo pergaminho.` };
    this.destroy(x, it);
    return { ok: false, fx: 'fail', text: `Falhou… ${this.name(d, it)} foi destruída.` };
  }

  /** chance mostrada na janela (n/10000) do próximo passo, para o item e o material escolhidos */
  chanceFor(it: InvItem, d: ItemDef, md: ItemDef | undefined): number | null {
    if (!md) return null;
    if (this.isSunstone(md)) return this.generalChance(it.u);
    if (this.isShiningOri(md)) return Math.floor((this.ult.enchant.get(it.u + 1) ?? 0) / 100);
    if (this.isMoonstone(md)) return this.isAccessory(d) ? this.accessoryProb[it.u] ?? 0 : this.suitProb[it.p?.length ?? 0] ?? 0;
    if (this.isElementCard(md)) return this.attribute[it.el + 1]?.prob ?? 0;
    return null;
  }
}
