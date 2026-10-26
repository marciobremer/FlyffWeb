import type { ItemView } from './net';
import { gradeOf } from '../shared/grade';
import { JOBS } from './jobs';

/**
 * Dica do item (passar o mouse): nome com o enchant, ataque/defesa (com o multiplicador e o bônus do enchant, como o
 * original — expUpitem e enchant^1.5), velocidade de ataque, sexo, nível, bônus (FOR, VIG, HP…), elemento e preço.
 * Para peça equipável aparece uma segunda dica ao lado: "[ Equipado ]" com o que já está no espaço, para comparar.
 */
export interface TipItem { id: number; n: number; u: number; e: number; el: number; /** piercing: carta por furo (0 = vazio) */ p?: number[]; /** joias da ultimate por espaço (0 = vazio) */ g?: number[] }

/** DST_* (defineAttribute.h) → nome; cobre todos os bônus usados por armas e armaduras (o resto aparece como "Efeito #n") */
const DST: Record<number, string> = {
  1: 'FOR', 2: 'DES', 3: 'INT', 4: 'VIG', 5: 'Dano de ioiô', 6: 'Dano de arco', 8: 'Bloqueio à distância', 9: 'Chance de crítico',
  11: 'Velocidade de movimento', 14: 'Bloqueio corpo a corpo', 17: 'Maestria de fogo', 19: 'Maestria elétrica', 20: 'Maestria de vento',
  21: 'Dano de knuckle', 22: 'Dano em PvP', 24: 'Velocidade de ataque', 25: 'Dano de espada', 26: 'Defesa', 29: 'Refletir dano', 34: 'Dano de machado',
  35: 'HP máx.', 36: 'MP máx.', 37: 'FP máx.', 41: 'Recuperação de HP', 47: 'Precisão', 51: 'Velocidade de ataque', 52: 'HP máx.', 53: 'MP máx.', 54: 'FP máx.',
  55: 'Ataque da arma', 62: 'Magia extra', 63: 'Dano', 64: 'Estado especial', 65: 'Esquiva', 66: 'Ataque', 67: 'Experiência', 68: 'Pulo', 72: 'Defesa',
  73: 'Consumo de MP', 75: 'Velocidade de conjuração', 77: 'Dano crítico', 79: 'Dano em monstros', 80: 'Dano em PvP', 83: 'Ataque', 92: 'Caixa de presente',
  99: 'Chance de drop', 101: 'Dano de fogo (PvE)', 102: 'Dano de água (PvE)', 103: 'Dano elétrico (PvE)', 104: 'Dano de vento (PvE)', 105: 'Dano de terra (PvE)',
  108: 'Dano em atordoados', 109: 'Dano em cegos', 110: 'Dano em envenenados', 111: 'Dano em lentos', 112: 'Dano em sangrando', 118: 'Drop de penya',
  10003: 'Todos os atributos',
};
/** DST em percentual (IsDst_Rate do original) */
const PCT = new Set([8, 9, 11, 14, 17, 19, 20, 24, 29, 47, 51, 52, 53, 54, 65, 66, 67, 72, 73, 75, 77, 79, 80, 99, 101, 102, 103, 104, 105, 108, 109, 110, 111, 112]);
/**
 * "FOR +5", "Ataque +10%" — velocidade de ataque (DST_ATTACKSPEED) aparece como valor/20 %, como o original; velocidade de
 * movimento (DST_SPEED) vale por mil no GetSpeed (__JEFF_11), então mostra valor/10 % (o efeito de verdade)
 */
export const fxText = (k: number, v: number) => {
  const shown = k === 24 ? Math.trunc(v / 2 / 10) : k === 11 ? v / 10 : v;
  return `${DST[k] ?? `Efeito #${k}`} ${shown >= 0 ? '+' : ''}${shown}${PCT.has(k) ? '%' : ''}`;
};

/** enchant → % extra (expUpitem: arma / capacete / traje / luva / bota / escudo) */
const EXPUP_WEAPON = [0, 2, 4, 6, 8, 10, 13, 16, 19, 21, 24];
const EXPUP_ARMOR = [0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20];

const speedName = (s: number) => (s < 0.035 ? 'Muito lenta' : s < 0.05 ? 'Lenta' : s < 0.07 ? 'Normal' : s < 0.08 ? 'Rápida' : s < 0.17 ? 'Muito rápida' : 'Altíssima');
const SEX = ['Masculino', 'Feminino'];

/** ataque (arma, kind1 = 1) ou defesa (armadura, kind2 = 7/8) com o enchant aplicado; null se o item não tem */
function power(d: ItemView, u: number): { label: string; min: number; max: number; baseMin: number; baseMax: number } | null {
  const w = d.k1 === 1, a = d.k2 === 7 || d.k2 === 8;
  if (!w && !a) return null;
  const mul = 1 + (w ? EXPUP_WEAPON : EXPUP_ARMOR)[Math.min(u, 10)] / 100, opt = u > 0 ? Math.floor(Math.pow(u, 1.5)) : 0;
  const baseMin = d.amin ?? 0, baseMax = d.amax ?? 0;
  return { label: w ? 'Ataque' : 'Defesa', baseMin, baseMax, min: Math.floor(baseMin * mul) + opt, max: Math.floor(baseMax * mul) + opt };
}

/** definição de outro item (as cartas espetadas na suit), vinda do inventário */
let lookup: (id: number) => ItemView | undefined = () => undefined;
export function setTipLookup(fn: (id: number) => ItemView | undefined) { lookup = fn; }

function lines(d: ItemView, it: TipItem, elementNames: string[], sellable = true): { text: string; cls?: string }[] {
  const out: { text: string; cls?: string }[] = [];
  const p = power(d, it.u);
  if (p && (p.baseMin || p.baseMax)) out.push({ text: `${p.label}: ${p.min} ~ ${p.max}`, cls: it.u ? 'up' : undefined });
  if (d.k1 === 1 && d.aspd) out.push({ text: `Velocidade de ataque: ${speedName(d.aspd)}` });
  if (d.k1 === 1 && d.hand === 2) out.push({ text: 'Arma de duas mãos' });
  for (const [k, v] of d.fx ?? []) out.push({ text: fxText(k, v), cls: 'fx' });
  if (it.e) out.push({ text: `${elementNames[it.e] ?? 'Elemento'} +${it.el}`, cls: `e${it.e}` });
  // piercing (suit): um losango por furo aberto — cheio com carta, vazio sem
  if (it.p?.length) {
    out.push({ text: `Piercing: ${it.p.map((c) => (c ? '◆' : '◇')).join(' ')} (${it.p.filter((c) => c).length}/${it.p.length} cartas)`, cls: 'pierce' });
    // bônus das cartas somados por atributo, sem os nomes (como GetPiercingAvail soma os DST): "Ataque +20%", "MP máx. +10%"
    const sum = new Map<number, number>();
    for (const card of it.p) if (card) for (const [k, v] of lookup(card)?.fx ?? []) sum.set(k, (sum.get(k) ?? 0) + v);
    for (const [k, v] of sum) out.push({ text: fxText(k, v), cls: 'pierce fx' });
  }
  // arma ultimate: espaços de joia (abre 1 por nível do +6 ao +10) e as joias engastadas
  if (it.g?.length) {
    out.push({ text: `Joias: ${it.g.map((g) => (g ? '◆' : '◇')).join(' ')} (${it.g.filter((g) => g).length}/${it.g.length})`, cls: 'pierce' });
    const count = new Map<number, number>();
    for (const g of it.g) if (g) count.set(g, (count.get(g) ?? 0) + 1);
    for (const [g, n] of count) out.push({ text: `${lookup(g)?.name ?? 'Joia'}${n > 1 ? ` ×${n}` : ''}`, cls: 'pierce fx' });
  }
  // joia: bônus do enchant atual (accessory.inc)
  if (d.acc && it.u) for (const [k, v] of d.acc[it.u] ?? []) out.push({ text: `+${it.u}: ${fxText(k, v)}`, cls: 'up fx' });
  if (d.card) out.push({ text: 'Duplo clique e escolha a suit na bolsa para aplicar.', cls: 'hint' });
  if (d.sex === 0 || d.sex === 1) out.push({ text: `Sexo: ${SEX[d.sex]}` });
  if (d.job !== undefined && d.job > 0 && JOBS[d.job]) out.push({ text: `Classe: ${JOBS[d.job].name}` });
  if (d.lv > 1) out.push({ text: `Nível: ${d.lv}` });
  // conjunto (SetItem): nome, total de peças e o bônus de cada quantidade equipada
  if (d.set) {
    out.push({ text: `Conjunto: ${d.set.name} (${d.set.pieces} peças)`, cls: 'set' });
    for (const [n, k, v] of d.set.avail) out.push({ text: `  ${n} peças: ${fxText(k, v)}`, cls: 'set fx' });
  }
  if (d.k1 === 1 || d.k1 === 2) { const g = gradeOf(d.gr); out.push({ text: `Raridade: ${g.name}`, cls: `rare ${g.cls}` }); }
  if (d.cost && sellable) out.push({ text: `Preço de venda: ${Math.floor(d.cost / 4).toLocaleString('pt-BR')} penya`, cls: 'price' });
  if (it.n > 1) out.push({ text: `Quantidade: ${it.n}` });
  return out;
}

function box(d: ItemView, it: TipItem, elementNames: string[], header?: string): HTMLElement {
  const el = document.createElement('div');
  el.className = 'item-tip';
  if (header) { const h = document.createElement('div'); h.className = 'tip-head'; h.textContent = header; el.appendChild(h); }
  const name = document.createElement('div');
  name.className = `tip-name ${gradeOf(d.gr).cls}`;
  name.textContent = `${d.name}${it.u ? ` +${it.u}` : ''}`;
  el.appendChild(name);
  for (const l of lines(d, it, elementNames)) {
    const row = document.createElement('div');
    row.textContent = l.text;
    if (l.cls) row.className = l.cls;
    el.appendChild(row);
  }
  return el;
}

let layer: HTMLElement | null = null;

export function hideItemTip() { layer?.remove(); layer = null; }

/** mostra a dica perto do mouse; `equipped` (o que está no mesmo espaço) vira a 2ª caixa */
export function showItemTip(ev: { clientX: number; clientY: number }, d: ItemView, it: TipItem, elementNames: string[], equipped?: { d: ItemView; it: TipItem }) {
  hideItemTip();
  const wrap = document.createElement('div');
  wrap.className = 'item-tip-layer';
  wrap.setAttribute('role', 'tooltip');
  wrap.appendChild(box(d, it, elementNames));
  if (equipped) wrap.appendChild(box(equipped.d, equipped.it, elementNames, '[ Equipado ]'));
  document.body.appendChild(wrap);
  layer = wrap;
  moveItemTip(ev);
}

/** acompanha o mouse */
export function moveItemTip(ev: { clientX: number; clientY: number }) {
  if (!layer) return;
  const r = layer.getBoundingClientRect();
  const x = ev.clientX + 16 + r.width > innerWidth ? Math.max(4, ev.clientX - 16 - r.width) : ev.clientX + 16;
  const y = Math.max(4, Math.min(ev.clientY + 12, innerHeight - r.height - 4));
  layer.style.left = `${x}px`;
  layer.style.top = `${y}px`;
}
