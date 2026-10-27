import type { ItemView } from './net';
import { gradeOf } from '../shared/grade';
import { JOBS } from './jobs';
import { EXPUP_ROWS, SETITEM_ROWS, effectiveExpUp } from '../shared/expup';

/**
 * Dica do item (passar o mouse), na ordem e nas cores do CWndMgr::MakeToolTipText do original: nome (+enchant), tentativas até
 * o upgrade garantido, sexo, ataque/defesa, velocidade, elemento, bônus do item, bônus do conjunto pelo enchant (set +N),
 * classe e nível exigidos, o conjunto (peças equipadas em azul, efeitos ativos em laranja), piercing e "pode ser despertado".
 * Para peça equipável aparece uma segunda dica ao lado: "[ Equipado ]" com o que já está no espaço, para comparar.
 */
export interface TipItem { id: number; n: number; u: number; e: number; el: number; /** piercing: carta por furo (0 = vazio) */ p?: number[]; /** joias da ultimate por espaço (0 = vazio) */ g?: number[]; /** raridade da arma (0 = Common) */ r?: number;
  /** container (1 = equipado) e falhas seguidas de upgrade no nível atual */ c?: number; t?: number }

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
 * "FOR +5", "Ataque +10%" — velocidade de ataque (DST_ATTACKSPEED) aparece como valor/20 %, como o original; o resto, como a
 * dica do original (IsDst_Rate), com o valor cru — inclusive a velocidade de movimento (DST_SPEED 5 = "+5%")
 */
export const fxText = (k: number, v: number) => {
  const shown = k === 24 ? Math.trunc(v / 2 / 10) : v;
  return `${DST[k] ?? `Efeito #${k}`} ${shown >= 0 ? '+' : ''}${shown}${PCT.has(k) ? '%' : ''}`;
};

/** enchant → % extra como o servidor oficial aplica (com o transbordo da tabela, shared/expup.ts) */
const EXPUP = effectiveExpUp(EXPUP_ROWS);
/** coluna do expUpitem pelo IK3 (GetExpUpItem): escudo 16, capacete 17, traje 18, luva 19, bota 20; arma = 0 */
const expUpCol = (k3: number | undefined) => ({ 17: 1, 18: 2, 19: 3, 20: 4, 16: 5 } as Record<number, number>)[k3 ?? -1] ?? 0;

const speedName = (s: number) => (s < 0.035 ? 'Muito lenta' : s < 0.05 ? 'Lenta' : s < 0.07 ? 'Normal' : s < 0.08 ? 'Rápida' : s < 0.17 ? 'Muito rápida' : 'Altíssima');
const SEX = ['Masculino', 'Feminino'];
/** espaços que podem ser despertados (GetRandomOptionKind: traje, arma, escudo, luva, bota, capacete) */
const AWAKE_PARTS = new Set([2, 10, 11, 4, 5, 6]);
/** espaços do bônus de conjunto pelo enchant (GetSetItem: traje, luva, bota, capacete) */
const SET_PARTS = new Set([2, 4, 5, 6]);

/** `float` do C++: int × float (32 bits) antes do (int), como o servidor */
const f32mul = (a: number, b: number) => Math.trunc(Math.fround(a * Math.fround(b)));

/**
 * ataque (arma, kind1 = 1) ou defesa (armadura, kind2 = 7/8) como o PutItemMinMax: dwAbility × (100 + expUp)% + enchant^1.5;
 * null se o item não tem
 */
function power(d: ItemView, u: number): { label: string; min: number; max: number; baseMin: number; baseMax: number } | null {
  const w = d.k1 === 1, a = d.k2 === 7 || d.k2 === 8;
  if (!w && !a) return null;
  const pct = u > 0 ? EXPUP[Math.min(u, 10)][w ? 0 : expUpCol(d.k3)] : 0;
  const mul = Math.fround((100 + pct) / 100), opt = u > 0 ? Math.floor(Math.pow(u, 1.5)) : 0;
  const baseMin = d.amin ?? 0, baseMax = d.amax ?? 0;
  return { label: w ? 'Ataque' : 'Defesa', baseMin, baseMax, min: f32mul(baseMin, mul) + opt, max: f32mul(baseMax, mul) + opt };
}

/** definição de outro item (as cartas espetadas na suit), vinda do inventário */
let lookup: (id: number) => ItemView | undefined = () => undefined;
export function setTipLookup(fn: (id: number) => ItemView | undefined) { lookup = fn; }

/** raridades da arma (WeaponRarity.inc, vindas do servidor): nome, cor, × ataque e × bônus */
let rarities: { name: string; color: string; atk: number; stats: number }[] = [];
export function setRarities(list: [string, number, number, number][]) {
  rarities = list.map(([name, c, atk, stats]) => ({ name, color: `#${(c & 0xffffff).toString(16).padStart(6, '0')}`, atk, stats }));
}

/** fail stack (UpgradeSuccess.inc, do servidor): categoria (dwReferStat1 ou 'acc') → enchant → tentativas para o garantido */
let failStack: Record<string, Record<number, number>> = {};
export function setFailStack(s: Record<string, Record<number, number>>) { failStack = s; }

/** quem olha a dica: o que está equipado (ids), o menor enchant das 4 peças de armadura (0 = falta peça), sexo, classe e nível */
export interface TipContext { equipped: number[]; setUp: number; sex?: number; job?: number; level?: number }
let context: () => TipContext = () => ({ equipped: [], setUp: 0 });
export function setTipContext(fn: () => TipContext) { context = fn; }
let player: { sex?: number; job?: number; level?: number } = {};
/** sexo, classe e nível do personagem (para pintar de vermelho o que ele não pode usar) */
export function setTipPlayer(p: { sex?: number; job?: number; level?: number }) { player = { ...player, ...p }; }

type Line = { text: string; cls?: string; color?: string; gap?: boolean };

function lines(d: ItemView, it: TipItem, elementNames: string[]): Line[] {
  const out: Line[] = [];
  const ctx = context();
  const isJewel = !!d.acc;
  if (d.desc) out.push({ text: `Descrição: ${d.desc}` });
  // tentativas até o upgrade garantido (__UPGRADE_SUCCESS: "Attempts until upgrade", vermelho)
  const stack = failStack[isJewel ? 'acc' : String(d.ref ?? -1)]?.[it.u];
  if (stack && stack > 0) out.push({ text: `Tentativas até o upgrade: ${Math.max(0, stack - (it.t ?? 0))}`, cls: 'bad' });
  if (d.k1 === 1 && d.hand === 2) out.push({ text: 'Arma de duas mãos' });
  if (d.sex === 0 || d.sex === 1) out.push({ text: `Sexo: ${SEX[d.sex]}`, cls: player.sex !== undefined && player.sex !== d.sex ? 'bad' : undefined });
  // raridade (__WEAPON_RARITY): ataque × fAttackRate, bônus do item × fStatsRate, na cor da raridade
  const rare = it.r ? rarities[it.r] : undefined;
  const p = power(d, it.u);
  if (p && rare && d.k1 === 1) { p.min = f32mul(p.min, rare.atk); p.max = f32mul(p.max, rare.atk); }
  if (p && (p.baseMin || p.baseMax)) out.push({ text: `${p.label} ${p.min} ~ ${p.max}`, color: rare?.color });
  if (d.k1 === 1 && d.aspd) out.push({ text: `Velocidade de ataque: ${speedName(d.aspd)}` });
  if (it.e) out.push({ text: `${elementNames[it.e] ?? 'Elemento'} +${it.el}`, cls: `e${it.e}` });
  for (const [k, v] of d.fx ?? []) out.push({ text: fxText(k, rare ? f32mul(v, rare.stats) : v) });
  if (rare) out.push({ text: `Raridade da arma: ${rare.name}`, color: rare.color });
  // joia: bônus do enchant atual (accessory.inc)
  if (d.acc && it.u) for (const [k, v] of d.acc[it.u] ?? []) out.push({ text: fxText(k, v) });
  // conjunto pelo enchant (PutEnchantOpt): só na peça equipada, com as 4 armaduras e o menor enchant > 0
  if (it.c === 1 && SET_PARTS.has(d.parts) && ctx.setUp > 0) {
    const [hit, block, hp, magic, all] = SETITEM_ROWS[Math.min(ctx.setUp, SETITEM_ROWS.length) - 1] ?? [];
    if (hit) out.push({ text: `Precisão+${hit}%` });
    if (block) out.push({ text: `Bloqueio+${block}%` });
    if (hp) out.push({ text: `HP máx.+${hp}%` });
    if (magic) out.push({ text: `Magia extra+${magic}` });
    if (all) out.push({ text: `Todos os atributos+${all}` });
  }
  if (d.card) out.push({ text: 'Duplo clique e escolha a suit na bolsa para aplicar.', cls: 'hint' });
  // classe e nível exigidos (PutJob / PutLevel; nível 1 não aparece, __LEESE_REMOVE_LVL1)
  if (d.job !== undefined && d.job >= 0 && JOBS[d.job]) out.push({ text: `Classe: ${JOBS[d.job].name}`, cls: player.job !== undefined && d.job > 0 && player.job !== d.job ? 'bad' : undefined });
  if (d.lv > 1) out.push({ text: `Nível: ${d.lv}`, cls: player.level !== undefined && player.level < d.lv ? 'bad' : undefined });
  if (it.n > 1) out.push({ text: `Quantidade: ${it.n}` });
  // conjunto (PutSetItemOpt): nome (equipadas/total), peças (azul = equipada), efeitos que valem com as equipadas (laranja)
  if (d.set) {
    // cada item equipado preenche uma peça só (2 vagas de anel precisam de 2 anéis)
    const left = new Map<number, number>();
    for (const id of ctx.equipped) left.set(id, (left.get(id) ?? 0) + 1);
    const pieces = (d.set.items ?? []).map(([id, name]) => { const k = left.get(id) ?? 0; if (k) left.set(id, k - 1); return { id, name, on: k > 0 }; });
    const n = pieces.filter((p) => p.on).length;
    out.push({ text: `${d.set.name} (${n}/${d.set.pieces})`, gap: true });
    for (const p of pieces) out.push({ text: p.name || lookup(p.id)?.name || '?', cls: p.on ? 'set-on' : 'set-off' });
    for (const [need, k, v] of d.set.avail) if (need <= n) out.push({ text: `Efeito do conjunto: ${fxText(k, v)}`, cls: 'set-fx' });
  }
  // piercing (suit): um losango por furo aberto — cheio com carta, vazio sem; bônus das cartas somados por atributo
  if (it.p?.length) {
    out.push({ text: `Piercing: ${it.p.map((c) => (c ? '◆' : '◇')).join(' ')} (${it.p.filter((c) => c).length}/${it.p.length} cartas)`, cls: 'pierce', gap: true });
    const sum = new Map<number, number>();
    for (const card of it.p) if (card) for (const [k, v] of lookup(card)?.fx ?? []) sum.set(k, (sum.get(k) ?? 0) + v);
    for (const [k, v] of sum) out.push({ text: fxText(k, v), cls: 'pierce' });
  }
  // arma ultimate: espaços de joia (abre 1 por nível do +6 ao +10) e as joias engastadas
  if (it.g?.length) {
    out.push({ text: `Joias: ${it.g.map((g) => (g ? '◆' : '◇')).join(' ')} (${it.g.filter((g) => g).length}/${it.g.length})`, cls: 'pierce' });
    const count = new Map<number, number>();
    for (const g of it.g) if (g) count.set(g, (count.get(g) ?? 0) + 1);
    for (const [g, c] of count) out.push({ text: `${lookup(g)?.name ?? 'Joia'}${c > 1 ? ` ×${c}` : ''}`, cls: 'pierce' });
  }
  // caixa: o que vem dentro (duplo clique abre tudo na bolsa)
  if (d.box?.length) {
    out.push({ text: 'Contém:', cls: 'box-head', gap: true });
    for (const [name, n] of d.box) out.push({ text: `- ${name}${n > 1 ? ` (${n}x)` : ''}` });
    out.push({ text: 'Duplo clique para abrir.', cls: 'hint' });
  }
  // PutAwakeningBlessing: equipamento sem despertar ainda
  if (AWAKE_PARTS.has(d.parts) && (d.k1 === 1 || d.k1 === 2) && !d.card) out.push({ text: '"Pode ser despertado"', cls: 'awake' });
  return out;
}

/** cor do nome: raridade da arma, senão a do grau do item (verde unique, roxo ultimate, laranja baruna; preto comum) */
function box(d: ItemView, it: TipItem, elementNames: string[], header?: string): HTMLElement {
  const el = document.createElement('div');
  el.className = 'item-tip';
  if (header) { const h = document.createElement('div'); h.className = 'tip-head'; h.textContent = header; el.appendChild(h); }
  const name = document.createElement('div');
  const rare = it.r ? rarities[it.r] : undefined;
  name.className = `tip-name ${gradeOf(d.gr).cls}`;
  name.textContent = `${rare ? `${rare.name} ` : ''}${d.name}${it.u ? ` +${it.u}` : ''}`;
  if (rare) name.style.color = rare.color;
  el.appendChild(name);
  for (const l of lines(d, it, elementNames)) {
    const row = document.createElement('div');
    row.textContent = l.text;
    if (l.cls) row.className = l.cls;
    if (l.color) row.style.color = l.color;
    if (l.gap) row.style.marginTop = '1em';
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
