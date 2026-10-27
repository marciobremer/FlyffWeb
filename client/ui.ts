import { itemIcon, skillIcon, themeDds, themeImage, themeTiles } from '../shared/tga';
import type { ItemView } from './net';
import { hideItemTip, moveItemTip, setTipContext, setTipLookup, showItemTip } from './itemtip';
import { InventoryPreview } from './invpreview';
import { loadAniCursor, type AniCursor } from './anicursor';
import { hideBit, type LookPiece } from '../shared/look';

/**
 * Janelas do jogo (inventário, chat) e barra de atalhos, com as imagens de Data/Theme/Default:
 * - GameWindow: moldura WndTile00–11 (título 3 fatias + corpo 9 fatias), arrastável pelo título, redimensionável pelas bordas
 *   direita/inferior e pelo canto, fecha no X; posição e tamanho lembrados no navegador (localStorage), sempre dentro da tela;
 * - InventoryWindow (tecla I): equipamentos (topo do WndInventory.tga), busca, grade de slots que se ajusta à largura
 *   (slots além do limite aparecem trancados com ButtLock.tga) e penya; itens com ícone de Data/Item, arrastar para mover/
 *   equipar e duplo clique para equipar/desequipar — quem decide é o servidor (server/inventory.ts);
 * - ActionBar: WndNewTASKBAR.tga embaixo ao centro, slots 1–0 (teclas 1…0): arraste itens da bolsa (poções, comida) para
 *   usar com a tecla; mostra a quantidade na bolsa e a espera depois de usar; à direita a Action Slot (5 skills em
 *   sequência, como o m_aSlotQueue do CWndTaskBar original: clique direito no monstro ou tecla C);
 * - ChatWindow: mensagens + caixa de texto (Enter abre/manda, Esc sai), redimensionável e móvel.
 * Nada é atualizado por quadro.
 */

const frameTiles = {
  title: themeTiles(['WndTile00.tga', 'WndTile01.tga', 'WndTile02.tga'], 3, 1),
  body: themeTiles([3, 4, 5, 6, 7, 8, 9, 10, 11].map((i) => `WndTile${String(i).padStart(2, '0')}.tga`), 3, 3),
};

let topZ = 20;

interface Rect { x: number; y: number; w: number; h: number }

export interface WindowOptions {
  id: string; title: string; store: string;
  /** posição/tamanho iniciais (x/y negativos contam da direita/de baixo) */
  initial: Rect; min: { w: number; h: number }; resizable?: boolean; closable?: boolean;
}

export class GameWindow {
  readonly el = document.createElement('section');
  readonly body = document.createElement('div');
  private titleEl = document.createElement('header');
  private titleText!: HTMLElement;
  /** muda o título (ex.: nome do NPC na loja) */
  setTitle(text: string) { this.titleText.textContent = text; this.el.setAttribute('aria-label', text); }
  onClose: () => void = () => {};
  onResize: () => void = () => {};

  constructor(parent: HTMLElement, private o: WindowOptions) {
    this.rect = this.load();
    const el = this.el;
    el.id = o.id;
    el.className = 'gwnd';
    el.hidden = true;
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', o.title);
    this.titleEl.className = 'gwnd-title';
    const label = document.createElement('span');
    label.textContent = o.title;
    this.titleText = label;
    this.titleEl.appendChild(label);
    if (o.closable !== false) {
      const x = document.createElement('button');
      x.type = 'button';
      x.className = 'gwnd-close';
      x.setAttribute('aria-label', `Fechar ${o.title}`);
      x.textContent = '×';
      x.addEventListener('pointerdown', (e) => e.stopPropagation());
      x.addEventListener('click', () => { this.hide(); this.onClose(); });
      void themeImage('ButtWndExit.tga').then((u) => { if (u) { x.style.backgroundImage = `url(${u})`; x.classList.add('img'); } });
      this.titleEl.appendChild(x);
    }
    this.body.className = 'gwnd-body';
    el.append(this.titleEl, this.body);
    void frameTiles.title.then((t) => { if (t) this.titleEl.style.borderImageSource = `url(${t.url})`; });
    void frameTiles.body.then((t) => { if (t) this.body.style.borderImageSource = `url(${t.url})`; });
    parent.appendChild(el);

    el.addEventListener('pointerdown', () => this.front(), true);
    this.dragBy(this.titleEl, (r, dx, dy) => ({ ...r, x: r.x + dx, y: r.y + dy }));
    if (o.resizable !== false) {
      for (const side of ['e', 's', 'se'] as const) {
        const g = document.createElement('div');
        g.className = `gwnd-grip ${side}`;
        g.setAttribute('aria-hidden', 'true');
        el.appendChild(g);
        this.dragBy(g, (r, dx, dy) => ({ ...r, w: side === 's' ? r.w : r.w + dx, h: side === 'e' ? r.h : r.h + dy }));
      }
    }
    addEventListener('resize', () => { if (!el.hidden) this.apply(this.rect); });
  }

  private rect!: Rect;

  private load(): Rect {
    try {
      const r = JSON.parse(localStorage.getItem(this.o.store) ?? 'null') as Rect | null;
      if (r && [r.x, r.y, r.w, r.h].every(Number.isFinite)) return r;
    } catch { /* sem armazenamento */ }
    const i = this.o.initial;
    return { x: i.x < 0 ? innerWidth + i.x - i.w : i.x, y: i.y < 0 ? innerHeight + i.y - i.h : i.y, w: i.w, h: i.h };
  }

  private save() { try { localStorage.setItem(this.o.store, JSON.stringify(this.rect)); } catch { /* sem armazenamento */ } }

  /** aplica o retângulo respeitando o tamanho mínimo e a tela */
  /** muda o tamanho mínimo (ex.: a loja precisa caber todas as abas) e reaplica se a janela estiver menor */
  setMinSize(w: number, h = this.o.min.h) {
    this.o.min = { w: Math.ceil(w), h: Math.ceil(h) };
    if (this.visible) this.apply(this.rect);
  }

  private apply(r: Rect) {
    const { min } = this.o;
    const w = Math.max(min.w, Math.min(innerWidth, r.w)), h = Math.max(min.h, Math.min(innerHeight, r.h));
    const x = Math.max(0, Math.min(innerWidth - w, r.x)), y = Math.max(0, Math.min(innerHeight - h, r.y));
    const changed = w !== this.rect.w || h !== this.rect.h;
    this.rect = { x, y, w, h };
    Object.assign(this.el.style, { left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px` });
    if (changed || !this.el.dataset.sized) { this.el.dataset.sized = '1'; this.onResize(); }
  }

  private dragBy(handle: HTMLElement, next: (start: Rect, dx: number, dy: number) => Rect) {
    handle.style.touchAction = 'none';
    let d: { x: number; y: number; r: Rect; id: number } | null = null;
    handle.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      d = { x: e.clientX, y: e.clientY, r: { ...this.rect }, id: e.pointerId };
      handle.setPointerCapture(e.pointerId);
      this.el.classList.add('moving');
      e.preventDefault();
    });
    handle.addEventListener('pointermove', (e) => { if (d && e.pointerId === d.id) this.apply(next(d.r, e.clientX - d.x, e.clientY - d.y)); });
    const end = (e: PointerEvent) => { if (!d || e.pointerId !== d.id) return; d = null; this.el.classList.remove('moving'); this.save(); };
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
  }

  front() { if (Number(this.el.style.zIndex) !== topZ) this.el.style.zIndex = String(++topZ); }
  get visible() { return !this.el.hidden; }
  show() { this.el.hidden = false; this.front(); this.apply(this.rect); }
  hide() { this.el.hidden = true; }
  toggle() { if (this.visible) this.hide(); else this.show(); }
}

// ---------- inventário ----------

/**
 * Espaços de equipamento sobre o topo do WndInventory3D.tga (o inventário com o personagem 3D, como no FlyFF Universe), em
 * pixels da imagem (centro x, y e lado), com o PARTS_* do FlyFF — mesma ordem do CWndInventory (WIDC_CUSTOM1–19):
 * 5 joias em cima; à esquerda arma, escudo, munição, capa, máscara; à direita capacete, roupa, luvas, botas, montaria;
 * embaixo, as 4 peças de cash (chapéu, roupa, luvas, botas). A área mostrada começa em (9, 25) da imagem (.inv-equip no CSS).
 */
const EQUIP: [part: number, name: string, cx: number, cy: number, size: number][] = [
  [20, 'Anel', 99, 38, 22], [22, 'Brinco', 124, 38, 22], [19, 'Colar', 149, 38, 22], [23, 'Brinco', 174, 38, 22], [21, 'Anel', 199, 38, 22],
  [10, 'Arma', 31, 49, 34], [11, 'Escudo', 31, 97, 34], [25, 'Munição', 31, 145, 34], [8, 'Capa', 31, 193, 34], [12, 'Máscara', 31, 241, 34],
  [6, 'Capacete', 268, 49, 34], [2, 'Roupa', 268, 97, 34], [4, 'Luvas', 268, 145, 34], [5, 'Botas', 268, 193, 34], [13, 'Montaria', 268, 241, 34],
  [26, 'Chapéu (cash)', 103, 247, 28], [27, 'Roupa (cash)', 133, 247, 28], [28, 'Luvas (cash)', 164, 247, 28], [29, 'Botas (cash)', 194, 247, 28],
];
const EQUIP_OFFSET = [9, 25];
/** área do personagem 3D (pixels da imagem) */
const MODEL_RECT = { x: 58, y: 52, w: 184, h: 176 };

/** u = enchant (+0–10), e = elemento (0 nenhum, 1 fogo, 2 água, 3 elétrico, 4 vento, 5 terra), el = nível do elemento */
export interface InvItem { c: number; s: number; id: number; n: number; u: number; e: number; el: number; /** piercing: carta por espaço aberto (0 = vazio) */ p?: number[]; /** item de tempo ativado (ticket): vale até (ms) */ x?: number;
  /** arma ultimate: joias engastadas por espaço aberto (0 = vazio) */ g?: number[]; /** raridade da arma (0 = Common) */ r?: number; /** falhas seguidas de upgrade no nível atual */ t?: number }
export const ELEMENT_NAMES = ['', 'Fogo', 'Água', 'Elétrico', 'Vento', 'Terra'];
export interface InvDef extends ItemView {}

const BAG = 0, EQUIPPED = 1;

/**
 * Pergunta no visual do jogo (a caixinha da lixeira, no lugar do confirm() do navegador) dentro de `host`: texto e os botões
 * `okLabel` (vermelho) e Cancelar. Enter confirma, Esc cancela. Resolve true/false; `close()` cancela de fora.
 */
export function askBox(host: HTMLElement, text: string, okLabel: string): { done: Promise<boolean>; close: () => void } {
  const box = document.createElement('div');
  box.className = 'inv-ask';
  box.setAttribute('role', 'alertdialog');
  box.setAttribute('aria-label', text);
  const msg = document.createElement('p');
  msg.textContent = text;
  const ok = document.createElement('button');
  ok.type = 'button'; ok.className = 'gm-btn danger'; ok.textContent = okLabel;
  const cancel = document.createElement('button');
  cancel.type = 'button'; cancel.className = 'gm-btn'; cancel.textContent = 'Cancelar';
  let finish: (v: boolean) => void = () => {};
  const done = new Promise<boolean>((resolve) => { finish = (v) => { box.remove(); resolve(v); finish = () => {}; }; });
  ok.addEventListener('click', () => finish(true));
  cancel.addEventListener('click', () => finish(false));
  box.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false); }
    else if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); finish(true); }
  });
  const row = document.createElement('div');
  row.append(ok, cancel);
  box.append(msg, row);
  host.appendChild(box);
  cancel.focus();
  return { done, close: () => finish(false) };
}
/** PARTS_UPPER_BODY: a suit, única peça com piercing */
const SUIT_PART = 2;
/**
 * Martelo do modo de piercing: o cursor CUR_HAMMER do Neuz é o `anvil` de Data/Cursors; o do tema CurDefault6 é o .ani animado
 * (2 quadros, levanta e bate). Carregado na 1ª vez; sem ele, fica o SVG reserva (cabo de madeira, cabeça de ferro).
 */
const HAMMER_ANI = '/res/Data/Cursors/CurDefault6/anvil.ani';
let hammerAni: Promise<AniCursor | null> | null = null;
/** último ponto do mouse na tela: o martelo aparece ali na hora, sem esperar o mouse mexer */
const mouse = { x: innerWidth / 2, y: innerHeight / 2 };
addEventListener('pointermove', (e) => { mouse.x = e.clientX; mouse.y = e.clientY; }, { capture: true, passive: true });
addEventListener('pointerdown', (e) => { mouse.x = e.clientX; mouse.y = e.clientY; }, { capture: true, passive: true });
const HAMMER_SVG = '<svg viewBox="0 0 32 32" width="32" height="32"><g transform="rotate(-35 16 16)"><rect x="14.5" y="10" width="3.2" height="20" rx="1.4" fill="#9a6a3a" stroke="#4a2e14" stroke-width="1"/><rect x="7" y="3" width="18" height="8.5" rx="1.6" fill="#c9ced6" stroke="#3b4048" stroke-width="1.2"/><rect x="8.4" y="4.2" width="15.2" height="2.2" rx="1" fill="#f2f5f9" opacity=".8"/></g></svg>';
const keyOf = (c: number, s: number) => `${c}:${s}`;

export class InventoryWindow extends GameWindow {
  /** slots abertos da bolsa (o servidor manda o número; os demais aparecem trancados) */
  private open = 42;
  private grid = document.createElement('div');
  private penya = document.createElement('output');
  /** Red Chip: contador fora da bolsa (II_CHP_RED não ocupa espaço) */
  private chips = document.createElement('output');
  /** lixeira (soltar um item da bolsa aqui pergunta e apaga) e o botão de organizar a bolsa por tipo */
  private trash = document.createElement('button');
  private sortBtn = document.createElement('button');
  /** caixinha "apagar este item?" aberta sobre o inventário */
  private ask: HTMLElement | null = null;
  private search = document.createElement('input');
  private equipEls = new Map<number, HTMLElement>();
  private items = new Map<string, InvItem>();
  private defs = new Map<number, InvDef>();
  /** o que está na bolsa e equipado (somente leitura) e a definição de um item */
  get all(): ReadonlyMap<string, InvItem> { return this.items; }
  def(id: number) { return this.defs.get(id); }
  /** pedidos ao servidor: mover [container, slot] → outro, ou "usar" (duplo clique) */
  onMove: (from: [number, number], to: [number, number]) => void = () => {};
  onUse: (c: number, s: number) => void = () => {};
  /** caixinhas de mostrar/esconder (capacete, capa, máscara, cash): máscara de bits de shared/look.ts */
  onHide: (mask: number) => void = () => {};
  /** lixeira: apagar `n` do item do espaço `s` da bolsa / organizar a bolsa por tipo */
  onDiscard: (s: number, n: number) => void = () => {};
  onSort: () => void = () => {};
  /** piercing: espetar a carta do espaço `card` da bolsa na suit do espaço `target` / aviso para o chat */
  onPierce: (card: number, target: number) => void = () => {};
  /** martelo de upgrade: material do espaço `material` no item do espaço `target` (bolsa) */
  onUpgrade: (material: number, target: number) => void = () => {};
  /** janela do ferreiro aberta: clicar num item da bolsa escolhe ele para a janela (null = clique normal) */
  pick: ((c: number, s: number) => void) | null = null;
  onNotice: (text: string) => void = () => {};
  /** carta escolhida (duplo clique) esperando o clique na suit; o martelinho segue o mouse enquanto isso */
  private pierceCard: number | null = null;
  private hammer: HTMLElement | null = null;
  /** hotspot do martelo (pixels a descontar da posição do mouse) e o timer que troca os quadros */
  private hammerHot: [number, number] = [0, 0];
  private hammerTimer = 0;
  private pierceWaiting = false;
  /** o martelo é de upgrade (Sunstone, moonstone, carta de elemento…) e não de carta de piercing */
  private hammerUpgrade = false;
  /** personagem 3D no centro (client/invpreview.ts) */
  readonly preview = new InventoryPreview();
  private hideMask = 0;
  private checks = new Map<number, HTMLButtonElement>();

  constructor(parent: HTMLElement) {
    super(parent, { id: 'invWnd', title: 'Inventário', store: 'flyff.wnd.inventory3d', initial: { x: -12, y: 110, w: 312, h: 580 }, min: { w: 310, h: 470 } });
    setTipLookup((id) => this.defs.get(id));
    // dica: o que está equipado (peças do conjunto em azul) e o menor enchant das 4 armaduras (bônus do set +N)
    setTipContext(() => {
      const eq = [...this.items.values()].filter((i) => i.c === EQUIPPED);
      const armor = [2, 4, 5, 6].map((s) => eq.find((i) => i.s === s));
      return { equipped: eq.map((i) => i.id), setUp: armor.every((a) => a) ? Math.min(...armor.map((a) => a!.u)) : 0 };
    });
    const b = this.body;
    b.classList.add('inv');

    const equip = document.createElement('div');
    equip.className = 'inv-equip';
    // o WndInventory3D.tga de 300×510 (as posições de EQUIP são dele); o das versões novas é outro, de 240×464 — fica em data/res-extra
    void themeImage('WndInventory3DWeb.tga').then((u) => { if (u) equip.style.backgroundImage = `url(${u})`; });
    const model = this.preview.canvas;
    Object.assign(model.style, { left: `${MODEL_RECT.x - EQUIP_OFFSET[0]}px`, top: `${MODEL_RECT.y - EQUIP_OFFSET[1]}px`, width: `${MODEL_RECT.w}px`, height: `${MODEL_RECT.h}px` });
    equip.appendChild(model);
    for (const [part, name, cx, cy, size] of EQUIP) {
      const slot = document.createElement('div');
      slot.className = 'inv-eq';
      slot.dataset.c = String(EQUIPPED);
      slot.dataset.s = String(part);
      slot.dataset.label = name;
      Object.assign(slot.style, { left: `${cx - size / 2 - EQUIP_OFFSET[0]}px`, top: `${cy - size / 2 - EQUIP_OFFSET[1]}px`, width: `${size}px`, height: `${size}px` });
      this.equipEls.set(part, slot);
      equip.appendChild(slot);
      const bit = hideBit(part);
      if (bit) {
        // caixinha no canto do espaço (marcada = aparece no personagem), só com algo equipado — como m_awndCheckHide
        const ck = document.createElement('button');
        ck.type = 'button';
        ck.className = 'inv-check';
        ck.hidden = true;
        Object.assign(ck.style, { left: `${cx - size / 2 - EQUIP_OFFSET[0] - 2}px`, top: `${cy - size / 2 - EQUIP_OFFSET[1] - 2}px` });
        ck.addEventListener('click', () => { this.setHide(this.hideMask ^ bit); this.onHide(this.hideMask); });
        this.checks.set(part, ck);
        equip.appendChild(ck);
      }
    }
    void themeImage('ButtCheck.tga').then((u) => { if (u) equip.style.setProperty('--check', `url(${u})`); });

    this.search.className = 'inv-search';
    this.search.type = 'search';
    this.search.placeholder = 'Buscar';
    this.search.setAttribute('aria-label', 'Buscar item no inventário');
    this.search.maxLength = 40;
    this.search.addEventListener('input', () => this.applySearch());

    this.grid.className = 'inv-grid';
    this.grid.setAttribute('role', 'grid');
    this.grid.setAttribute('aria-label', 'Itens');

    // rodapé como o inventário das versões novas: lixeira e organizar à esquerda; penya e red chip à direita
    const foot = document.createElement('div');
    foot.className = 'inv-foot';
    const tool = (btn: HTMLButtonElement, cls: string, label: string, icon: string) => {
      btn.type = 'button';
      btn.className = `inv-tool ${cls}`;
      btn.title = label;
      btn.setAttribute('aria-label', label);
      void themeDds(icon).then((u) => { if (u) btn.style.backgroundImage = `url(${u})`; });
    };
    tool(this.trash, 'inv-trash', 'Lixeira: arraste um item da bolsa até aqui para apagar', 'WndInventoryGarbage.dds');
    tool(this.sortBtn, 'inv-sort', 'Organizar a bolsa por tipo', 'WndInventoryAlign.dds');
    this.sortBtn.addEventListener('click', () => { this.closeAsk(); this.onSort(); });
    const field = (out: HTMLOutputElement, label: string, icon: Promise<string | null>, cls: string) => {
      const row = document.createElement('div');
      row.className = `inv-money ${cls}`;
      const i = document.createElement('i');
      i.setAttribute('aria-hidden', 'true');
      void icon.then((u) => { if (u) i.style.backgroundImage = `url(${u})`; });
      out.setAttribute('aria-label', label);
      out.value = '0';
      row.append(i, out);
      return row;
    };
    foot.append(this.trash, field(this.penya, 'Penya', themeImage('WndInventory.tga'), 'penya'),
      this.sortBtn, field(this.chips, 'Red Chip', itemIcon('Itm_ChpRed.dds'), 'chip'));

    b.append(equip, this.search, this.grid, foot);
    this.onResize = () => this.layoutGrid();
    this.renderChecks();
    this.bindDrag(b);
    this.renderEquip();
  }

  /** estado vindo do servidor */
  setState(gold: number, open: number, items: [number, number, number, number, number?, number?, number?, number[]?, number?, number[]?, number?, number?][], defs: Record<number, InvDef>, chips = 0) {
    this.penya.value = gold.toLocaleString('pt-BR');
    this.chips.value = chips.toLocaleString('pt-BR');
    for (const d of Object.values(defs)) this.defs.set(d.id, d);
    this.items.clear();
    for (const [c, s, id, n, u = 0, e = 0, el = 0, p, x, g, r, t] of items) this.items.set(keyOf(c, s), { c, s, id, n, u, e, el, ...(p?.length ? { p } : {}), ...(x ? { x } : {}), ...(g?.length ? { g } : {}), ...(r ? { r } : {}), ...(t ? { t } : {}) });
    // a carta/o material escolhido sumiu (gasto, movido, trocado): sai do modo martelo
    if (this.pierceCard !== null && !this.pierceWaiting) { const it = this.items.get(keyOf(BAG, this.pierceCard)); if (!it || (!this.hammerUpgrade && !this.defs.get(it.id)?.card)) this.cancelPierce(); }
    // itens de tempo: repinta de minuto em minuto (o visto some e o item fica cinza quando acaba)
    clearInterval(this.timedTimer);
    if ([...this.items.values()].some((i) => i.x)) this.timedTimer = window.setInterval(() => { this.renderBag(); }, 60_000);
    if (open !== this.open) { this.open = open; this.grid.replaceChildren(); this.layoutGrid(); }
    else this.renderBag();
    this.renderEquip();
    this.markPierce();
    this.refreshTip();
    // o item da caixinha da lixeira sumiu ou mudou: fecha a pergunta
    if (this.ask) { const s = Number(this.ask.dataset.s), it = this.items.get(keyOf(BAG, s)); if (!it || it.id !== Number(this.ask.dataset.id)) this.closeAsk(); }
  }

  // ---------- lixeira ----------
  /** pergunta antes de apagar o item do espaço `slot` da bolsa (pilha: quantos) — não volta atrás */
  private askDiscard(slot: number) {
    const it = this.items.get(keyOf(BAG, slot)), d = it && this.defs.get(it.id);
    if (!it || !d) return;
    this.closeAsk();
    hideItemTip();
    const box = document.createElement('div');
    box.className = 'inv-ask';
    box.setAttribute('role', 'alertdialog');
    box.dataset.s = String(slot);
    box.dataset.id = String(it.id);
    const name = `${d.name}${it.u ? ` +${it.u}` : ''}`;
    const msg = document.createElement('p');
    msg.textContent = it.n > 1 ? `Apagar quantos ${name}? Itens apagados não voltam.` : `Apagar ${name}? O item apagado não volta.`;
    box.setAttribute('aria-label', msg.textContent);
    const qty = document.createElement('input');
    qty.type = 'number'; qty.min = '1'; qty.max = String(it.n); qty.value = String(it.n);
    qty.className = 'gm-in num';
    qty.setAttribute('aria-label', 'Quantidade');
    qty.hidden = it.n <= 1;
    const ok = document.createElement('button');
    ok.type = 'button'; ok.className = 'gm-btn danger'; ok.textContent = 'Apagar';
    const cancel = document.createElement('button');
    cancel.type = 'button'; cancel.className = 'gm-btn'; cancel.textContent = 'Cancelar';
    const confirm = () => {
      const n = Math.max(1, Math.min(it.n, Math.floor(Number(qty.value) || 0)));
      this.closeAsk();
      this.onDiscard(slot, n);
    };
    ok.addEventListener('click', confirm);
    cancel.addEventListener('click', () => this.closeAsk());
    box.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.closeAsk(); }
      else if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); confirm(); }
    });
    const row = document.createElement('div');
    row.append(qty, ok, cancel);
    box.append(msg, row);
    this.body.appendChild(box);
    this.ask = box;
    (it.n > 1 ? qty : cancel).focus();
    if (it.n > 1) qty.select();
  }

  private closeAsk() { this.ask?.remove(); this.ask = null; this.askClose?.(); this.askClose = null; }
  private askClose: (() => void) | null = null;

  /** pergunta no inventário (mesma caixinha da lixeira); fecha uma que estivesse aberta */
  confirm(text: string, okLabel: string): Promise<boolean> {
    this.closeAsk();
    hideItemTip();
    const a = askBox(this.body, text, okLabel);
    this.askClose = a.close;
    return a.done.then((v) => { if (this.askClose === a.close) this.askClose = null; return v; });
  }

  /**
   * O item sob o mouse mudou (carta espetada, enchant, troca…): redesenha a dica dele na hora. Sem isso a dica só voltava
   * ao sair e entrar de novo no espaço (o clique esconde a dica e o mouse parado não gera outro mouseenter).
   */
  private refreshTip() {
    if (this.piercing && !this.pierceWaiting) return; // escolhendo a suit: o martelo é o cursor, sem dica
    // pelo ponto do mouse (o martelo não recebe eventos): o espaço pode ter sido redesenhado sem o mouse mexer
    const el = (document.elementFromPoint(mouse.x, mouse.y) as HTMLElement | null)?.closest<HTMLElement>('[data-c][data-s]');
    if (el && this.el.contains(el)) this.tipShow.get(el)?.({ clientX: mouse.x, clientY: mouse.y });
  }

  clear() { this.items.clear(); this.penya.value = '0'; this.renderBag(); this.renderEquip(); }

  /** partes escondidas (bits de shared/look.ts) */
  get hidden() { return this.hideMask; }
  setHide(mask: number) { this.hideMask = mask; this.renderChecks(); }

  /** peças equipadas como o visual precisa (espaço, símbolo, enchant, elemento) */
  equippedPieces(): LookPiece[] {
    const out: LookPiece[] = [];
    for (const it of this.items.values()) { const sym = it.c === EQUIPPED ? this.defs.get(it.id)?.sym : undefined; if (sym) out.push({ s: it.s, sym, u: it.u, e: it.e, el: it.el }); }
    return out;
  }

  private renderChecks() {
    for (const [part, ck] of this.checks) {
      const on = !(this.hideMask & hideBit(part));
      ck.hidden = !this.items.has(keyOf(EQUIPPED, part));
      ck.setAttribute('aria-pressed', String(on));
      const label = this.equipEls.get(part)?.dataset.label ?? '';
      ck.setAttribute('aria-label', `${on ? 'Esconder' : 'Mostrar'} ${label} no personagem`);
      ck.title = `${label}: ${on ? 'aparece' : 'escondido'} no personagem`;
    }
  }

  show() { super.show(); this.preview.start(); }
  hide() { super.hide(); this.preview.stop(); }

  /** preenche a grade com linhas completas que cabem na largura atual (no mínimo os slots abertos) */
  private layoutGrid() {
    const cols = Math.max(5, Math.floor((this.grid.clientWidth - 2) / 34));
    const rows = Math.max(Math.ceil(this.open / cols), Math.floor((this.grid.clientHeight - 2) / 34));
    const total = cols * rows;
    if (this.grid.childElementCount !== total || this.grid.style.getPropertyValue('--cols') !== String(cols)) {
      this.grid.style.setProperty('--cols', String(cols));
      const frag = document.createDocumentFragment();
      for (let k = 0; k < total; k++) {
        const s = document.createElement('div');
        s.setAttribute('role', 'gridcell');
        if (k < this.open) { s.className = 'inv-slot'; s.dataset.c = String(BAG); s.dataset.s = String(k); }
        else { s.className = 'inv-slot locked'; s.title = 'Slot trancado'; s.setAttribute('aria-label', 'Slot trancado'); }
        frag.appendChild(s);
      }
      this.grid.replaceChildren(frag);
      void lockImage.then((u) => { if (u) this.grid.style.setProperty('--lock', `url(${u})`); });
    }
    this.renderBag();
  }

  /** item de cada espaço desenhado (para a dica) */
  private tipItem = new WeakMap<HTMLElement, InvItem>();
  private bound = new WeakSet<HTMLElement>();
  /** função que mostra a dica de cada espaço (para redesenhar a do espaço sob o mouse quando o item muda) */
  private tipShow = new WeakMap<HTMLElement, (ev: { clientX: number; clientY: number }) => void>();

  /** dica do item ao passar o mouse: dados do item e, para peça de equipar na bolsa, o que está equipado no mesmo espaço */
  private bindTip(el: HTMLElement) {
    if (this.bound.has(el)) return;
    this.bound.add(el);
    const show = (ev: { clientX: number; clientY: number }) => {
      const it = this.tipItem.get(el), d = it && this.defs.get(it.id);
      if (!it || !d || el.classList.contains('dragging')) { hideItemTip(); return; }
      let eq: { d: ItemView; it: InvItem } | undefined;
      if (it.c === BAG && d.parts >= 0) {
        const part = d.parts, slots = part === 20 || part === 21 ? [20, 21] : part === 22 || part === 23 ? [22, 23] : [part];
        for (const s of slots) { const e = this.items.get(keyOf(EQUIPPED, s)), ed = e && this.defs.get(e.id); if (e && ed) { eq = { d: ed, it: e }; break; } }
      }
      showItemTip(ev, d, it, ELEMENT_NAMES, eq);
    };
    this.tipShow.set(el, show);
    el.addEventListener('mouseenter', show);
    el.addEventListener('mousemove', moveItemTip);
    el.addEventListener('mouseleave', hideItemTip);
    el.addEventListener('dragstart', hideItemTip);
    el.addEventListener('mousedown', hideItemTip);
  }

  /** desenha o item (ícone, quantidade, dica) dentro de um espaço; vazio limpa */
  private timedTimer = 0;
  private paint(el: HTMLElement, it: InvItem | undefined, emptyLabel: string) {
    const d = it ? this.defs.get(it.id) : undefined;
    // ticket e afins: ativado = visto ao lado; vencido = cinza (não usa mais)
    const timed = it?.x ? (it.x > Date.now() ? 'on' : 'off') : '';
    // as cartas espetadas entram na assinatura: sem isso, espetar uma carta não trocava o item do espaço (a dica ficava velha)
    const sig = it ? `${it.id}:${it.n}:${it.u}:${it.e}:${it.el}:${timed}:${it.p?.join(',') ?? ''}` : '';
    if (el.dataset.sig === sig && el.dataset.painted) { if (it) this.tipItem.set(el, it); return; }
    el.dataset.sig = sig;
    el.dataset.painted = '1';
    el.replaceChildren();
    el.classList.toggle('has', !!it);
    el.draggable = !!it;
    this.tipItem.delete(el);
    el.removeAttribute('title');
    if (!it) { el.setAttribute('aria-label', emptyLabel); return; }
    this.tipItem.set(el, it);
    this.bindTip(el);
    const name = `${d?.name ?? `Item ${it.id}`}${it.u ? ` +${it.u}` : ''}`;
    const elem = it.e ? `${ELEMENT_NAMES[it.e]} +${it.el}` : '';
    const left = it.x ? it.x - Date.now() : 0;
    const timeTxt = !it.x ? '' : left <= 0 ? ' — expirado' : ` — em uso, resta ${left >= 86_400_000 ? `${Math.floor(left / 86_400_000)} dia(s) e ${Math.floor((left % 86_400_000) / 3_600_000)} h` : left >= 3_600_000 ? `${Math.floor(left / 3_600_000)} h ${Math.floor((left % 3_600_000) / 60_000)} min` : `${Math.max(1, Math.ceil(left / 60_000))} min`}`;
    el.setAttribute('aria-label', `${name}${elem ? ` (${elem})` : ''}${it.n > 1 ? ` ×${it.n}` : ''}${timeTxt}`);
    el.classList.toggle('timed-on', timed === 'on');
    el.classList.toggle('timed-off', timed === 'off');
    if (timeTxt) el.dataset.time = timeTxt.slice(3); else delete el.dataset.time;
    const img = document.createElement('img');
    img.alt = '';
    img.draggable = false;
    if (d?.icon) void itemIcon(d.icon).then((u) => { if (u && el.dataset.sig === sig) img.src = u; });
    el.appendChild(img);
    if (it.n > 1) { const n = document.createElement('b'); n.textContent = String(it.n); el.appendChild(n); }
    if (it.u) { const u = document.createElement('i'); u.className = 'up'; u.textContent = `+${it.u}`; el.appendChild(u); }
    if (it.e) { const e = document.createElement('i'); e.className = `elem e${it.e}`; e.setAttribute('aria-hidden', 'true'); el.appendChild(e); }
    if (timed === 'on') { const v = document.createElement('i'); v.className = 'tick'; v.textContent = '✓'; v.setAttribute('aria-hidden', 'true'); el.appendChild(v); }
  }

  private renderBag() {
    for (const el of this.grid.querySelectorAll<HTMLElement>('.inv-slot:not(.locked)')) {
      const s = Number(el.dataset.s);
      this.paint(el, this.items.get(keyOf(BAG, s)), `Slot ${s + 1} (vazio)`);
    }
    this.applySearch();
  }

  private renderEquip() {
    for (const [part, el] of this.equipEls) {
      // a arma da mão esquerda (PARTS_LWEAPON) aparece no espaço do escudo, como no original (m_InvenRect[9] = [11])
      const at = part === 11 && !this.items.has(keyOf(EQUIPPED, 11)) && this.items.has(keyOf(EQUIPPED, 9)) ? 9 : part;
      el.dataset.s = String(at);
      this.paint(el, this.items.get(keyOf(EQUIPPED, at)), `${el.dataset.label} (vazio)`);
      if (!el.classList.contains('has')) el.title = el.dataset.label!;
    }
    this.renderChecks();
  }

  /** busca: apaga os itens que não batem com o texto */
  private applySearch() {
    const q = this.search.value.trim().toLowerCase();
    for (const el of this.grid.querySelectorAll<HTMLElement>('.inv-slot:not(.locked)')) {
      const it = this.items.get(keyOf(BAG, Number(el.dataset.s)));
      const name = (it && this.defs.get(it.id)?.name.toLowerCase()) ?? '';
      el.classList.toggle('dim', !!q && !name.includes(q));
    }
  }

  // ---------- piercing (cartas na suit) ----------
  /** está escolhendo onde aplicar uma carta? */
  get piercing() { return this.pierceCard !== null; }

  /**
   * Duplo clique numa carta: o cursor vira um martelinho (como o modo de upgrade do CWndInventory) e o próximo clique numa
   * suit da bolsa aplica a carta. Clique fora, botão direito ou Esc cancelam. As suits que ainda têm furo vazio piscam.
   */
  startPierce(cardSlot: number, upgrade = false) {
    this.cancelPierce();
    hideItemTip();
    this.show();
    this.pierceCard = cardSlot;
    this.hammerUpgrade = upgrade;
    const h = document.createElement('div');
    h.className = 'pierce-hammer';
    h.setAttribute('aria-hidden', 'true');
    h.style.visibility = 'hidden'; // até os quadros chegarem (na 1ª vez é um fetch; depois já está pronto)
    document.body.appendChild(h);
    this.hammer = h;
    this.hammerHot = [0, 0];
    this.pierceMove(mouse);
    document.body.classList.add('piercing');
    void (hammerAni ??= loadAniCursor(HAMMER_ANI)).then((ani) => {
      if (this.hammer !== h) return; // cancelado enquanto carregava
      if (!ani) { h.classList.add('svg'); h.innerHTML = HAMMER_SVG; h.style.visibility = ''; return; }
      const img = document.createElement('img');
      img.alt = '';
      img.draggable = false;
      h.replaceChildren(img);
      this.hammerHot = ani.hotspot;
      this.pierceMove(mouse);
      // anima como o Windows toca o .ani: cada quadro pelo tempo dele, em laço
      let i = 0;
      const step = () => { img.src = ani.frames[i]; this.hammerTimer = window.setTimeout(() => { i = (i + 1) % ani.frames.length; step(); }, ani.ms[i]); };
      step();
      h.style.visibility = '';
    });
    addEventListener('mousemove', this.pierceMove, true);
    addEventListener('click', this.pierceClick, true);
    addEventListener('contextmenu', this.pierceCancel, true);
    addEventListener('keydown', this.pierceKey, true);
    this.markPierce();
    this.onNotice(upgrade ? 'Clique no item (na bolsa) que quer melhorar. Botão direito ou Esc cancela.' : 'Clique na suit (na bolsa) onde quer aplicar a carta. Botão direito ou Esc cancela.');
  }

  /** item de um espaço (c = 0 bolsa, 1 equipado) — para a janela do ferreiro */
  item(c: number, s: number) { return this.items.get(keyOf(c, s)); }
  /** itens da bolsa (para contar materiais) */
  bagItems() { return [...this.items.values()].filter((i) => i.c === BAG); }

  cancelPierce() {
    if (this.pierceCard === null && !this.hammer) return;
    this.pierceCard = null;
    this.pierceWaiting = false;
    clearTimeout(this.hammerTimer);
    this.hammer?.remove();
    this.hammer = null;
    document.body.classList.remove('piercing');
    removeEventListener('mousemove', this.pierceMove, true);
    removeEventListener('click', this.pierceClick, true);
    removeEventListener('contextmenu', this.pierceCancel, true);
    removeEventListener('keydown', this.pierceKey, true);
    this.markPierce();
  }

  /** resposta do servidor: martelada na suit (deu certo) e sai do modo */
  pierced(ok: boolean, slot?: number) {
    const h = this.hammer;
    if (!ok || !h) { this.cancelPierce(); return; }
    const el = slot === undefined ? null : this.grid.querySelector<HTMLElement>(`.inv-slot[data-s="${slot}"]`);
    el?.classList.add('pierce-done');
    h.classList.add('hit');
    // a martelada termina e o cursor volta ao normal
    setTimeout(() => { el?.classList.remove('pierce-done'); this.cancelPierce(); }, 520);
  }

  private pierceMove = (e: { clientX: number; clientY: number } | { x: number; y: number }) => {
    const [x, y] = 'clientX' in e ? [e.clientX, e.clientY] : [e.x, e.y];
    if (this.hammer) { this.hammer.style.left = `${x - this.hammerHot[0]}px`; this.hammer.style.top = `${y - this.hammerHot[1]}px`; }
  };
  private pierceCancel = (e: Event) => { e.preventDefault(); e.stopPropagation(); this.cancelPierce(); };
  private pierceKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.cancelPierce(); } };
  private pierceClick = (e: MouseEvent) => {
    if (this.pierceCard === null || this.pierceWaiting) return;
    e.preventDefault();
    e.stopPropagation();
    const el = (e.target as HTMLElement | null)?.closest<HTMLElement>('[data-c][data-s]');
    if (!el || !this.el.contains(el)) { this.cancelPierce(); return; }
    const c = Number(el.dataset.c), s = Number(el.dataset.s);
    if (c === EQUIPPED) { this.onNotice(this.hammerUpgrade ? 'O item equipado não recebe upgrade: tire ele e coloque na bolsa antes.' : 'A carta não pode ser aplicada na suit equipada. Tire a suit e coloque na bolsa antes.'); return; }
    const it = this.items.get(keyOf(BAG, s)), d = it && this.defs.get(it.id);
    if (!it || !d) return;
    if (s === this.pierceCard) return;
    if (this.hammerUpgrade) {
      if (d.parts < 0) { this.onNotice(`${d.name} não recebe upgrade: só equipamentos.`); return; }
      this.pierceWaiting = true;
      this.onUpgrade(this.pierceCard, s);
      return;
    }
    if (d.parts !== SUIT_PART) { this.onNotice(`${d.name} não aceita cartas: só a suit tem piercing.`); return; }
    if (!it.p?.length) { this.onNotice(`${d.name} não tem furos de piercing abertos.`); return; }
    if (!it.p.includes(0)) { this.onNotice(`Todos os furos de ${d.name} já têm carta.`); return; }
    this.pierceWaiting = true;
    this.onPierce(this.pierceCard, s);
  };

  /** destaca a carta escolhida e as suits da bolsa com furo vazio */
  private markPierce() {
    for (const el of this.grid.querySelectorAll<HTMLElement>('.inv-slot')) {
      const s = Number(el.dataset.s), it = this.items.get(keyOf(BAG, s)), d = it && this.defs.get(it.id);
      el.classList.toggle('pierce-src', this.pierceCard === s);
      el.classList.toggle('pierce-ok', this.pierceCard !== null && !!d && (this.hammerUpgrade ? d.parts >= 0 && s !== this.pierceCard : d.parts === SUIT_PART && !!it?.p?.includes(0)));
    }
  }

  /** arrastar um item para outro espaço (bolsa ↔ bolsa ↔ equipamento) e duplo clique para equipar/desequipar */
  private bindDrag(root: HTMLElement) {
    const at = (t: EventTarget | null) => (t as HTMLElement | null)?.closest<HTMLElement>('[data-c][data-s]') ?? null;
    const clearDrop = () => root.querySelectorAll('.drop').forEach((x) => x.classList.remove('drop'));
    let from: [number, number] | null = null;
    root.addEventListener('dragstart', (e) => {
      if (this.piercing) { e.preventDefault(); return; } // com o martelinho, clicar escolhe a suit (não arrasta)
      const el = at(e.target);
      if (!el?.classList.contains('has')) { e.preventDefault(); return; }
      from = [Number(el.dataset.c), Number(el.dataset.s)];
      e.dataTransfer!.effectAllowed = 'move';
      e.dataTransfer!.setData('text/plain', keyOf(from[0], from[1]));
      const it = this.items.get(keyOf(from[0], from[1])), d = it && this.defs.get(it.id);
      if (d && it) e.dataTransfer!.setData('application/x-flyff-item', JSON.stringify({ id: d.id, icon: d.icon, name: d.name, n: it.n, cost: d.cost ?? 0, c: it.c, s: it.s }));
      e.dataTransfer!.effectAllowed = 'copyMove';
      const img = el.querySelector('img');
      if (img?.src) e.dataTransfer!.setDragImage(img, 16, 16);
      el.classList.add('dragging');
    });
    root.addEventListener('dragend', (e) => { at(e.target)?.classList.remove('dragging'); from = null; clearDrop(); });
    const trashAt = (t: EventTarget | null) => (t as HTMLElement | null)?.closest('.inv-trash') ?? null;
    root.addEventListener('dragover', (e) => {
      // lixeira: aceita item da bolsa (o equipado precisa sair antes)
      if (from && trashAt(e.target)) {
        e.preventDefault();
        e.dataTransfer!.dropEffect = from[0] === BAG ? 'move' : 'none';
        if (!this.trash.classList.contains('drop')) { clearDrop(); this.trash.classList.add('drop'); }
        return;
      }
      const el = at(e.target);
      if (!from || !el) return;
      e.preventDefault();
      e.dataTransfer!.dropEffect = 'move';
      if (!el.classList.contains('drop')) { clearDrop(); el.classList.add('drop'); }
    });
    root.addEventListener('drop', (e) => {
      const el = at(e.target);
      e.preventDefault();
      clearDrop();
      if (from && trashAt(e.target)) {
        if (from[0] === BAG) this.askDiscard(from[1]);
        else this.onNotice('Tire o item antes de apagar: só itens da bolsa vão para a lixeira.');
        return;
      }
      if (!from || !el) return;
      const to: [number, number] = [Number(el.dataset.c), Number(el.dataset.s)];
      if (to[0] !== from[0] || to[1] !== from[1]) this.onMove(from, to);
    });
    // janela do ferreiro aberta: um clique escolhe o item para ela
    root.addEventListener('click', (e) => {
      if (!this.pick || this.piercing) return;
      const el = at(e.target);
      if (el?.classList.contains('has')) this.pick(Number(el.dataset.c), Number(el.dataset.s));
    });
    root.addEventListener('dblclick', (e) => {
      if (this.piercing) return;
      const el = at(e.target);
      if (el?.classList.contains('has')) this.onUse(Number(el.dataset.c), Number(el.dataset.s));
    });
  }
}

const lockImage = themeImage('ButtLock.tga');

// ---------- barra de atalhos ----------

/** MAX_SLOT_QUEUE do original */
const QUEUE_SIZE = 5;

/** atalho de item na barra (o servidor guarda a lista; ícone/nome vêm com ela) */
export interface BarItem { k?: 'item' | 'skill'; id: number; icon: string; name: string }

export class ActionBar {
  readonly el = document.createElement('div');
  private slots: HTMLButtonElement[] = [];
  private items: (BarItem | null)[] = Array(10).fill(null);
  private counts = new Map<number, number>();
  /** Action Slot: até 5 skills lançadas em sequência no alvo */
  private queue: (BarItem | null)[] = Array(QUEUE_SIZE).fill(null);
  private queueEls: HTMLButtonElement[] = [];
  /** a Action Slot mudou (guardar) */
  onQueueChange: (ids: (number | null)[]) => void = () => {};
  /** usar o item / lançar a skill do atalho */
  onUseItem: (id: number) => void = () => {};
  onUseSkill: (id: number) => void = () => {};
  /** a barra mudou (arrastar/soltar/remover): salvar no servidor */
  onChange: (slots: ({ k: 'item' | 'skill'; id: number } | null)[]) => void = () => {};

  constructor(parent: HTMLElement) {
    const el = this.el;
    el.id = 'actionBar';
    el.hidden = true;
    el.setAttribute('role', 'toolbar');
    el.setAttribute('aria-label', 'Atalhos (teclas 1 a 0); arraste itens da bolsa para cá');
    void themeImage('WndNewTASKBAR.tga').then((u) => { if (u) el.style.backgroundImage = `url(${u})`; });
    for (let k = 0; k < 10; k++) {
      const s = document.createElement('button');
      s.type = 'button';
      s.className = 'ab-slot';
      s.style.left = `${37 + k * 36}px`;
      s.addEventListener('click', () => this.use(k));
      // botão direito tira o atalho
      s.addEventListener('contextmenu', (e) => { e.preventDefault(); if (this.items[k]) { this.items[k] = null; this.paint(k); this.changed(); } });
      // arrastar: da bolsa para cá (application/x-flyff-item = id do item) ou entre atalhos
      s.draggable = true;
      s.addEventListener('dragstart', (e) => {
        if (!this.items[k]) { e.preventDefault(); return; }
        e.dataTransfer!.setData('application/x-flyff-slot', String(k));
        e.dataTransfer!.effectAllowed = 'move';
      });
      s.addEventListener('dragend', (e) => {
        // soltou fora da barra: tira o atalho
        if (e.dataTransfer?.dropEffect === 'none' && this.items[k]) { this.items[k] = null; this.paint(k); this.changed(); }
      });
      s.addEventListener('dragover', (e) => {
        const t = e.dataTransfer?.types ?? [];
        if (t.includes('application/x-flyff-item') || t.includes('application/x-flyff-slot')) { e.preventDefault(); s.classList.add('drop'); }
      });
      s.addEventListener('dragleave', () => s.classList.remove('drop'));
      s.addEventListener('drop', (e) => {
        e.preventDefault();
        s.classList.remove('drop');
        const dt = e.dataTransfer!;
        const from = dt.getData('application/x-flyff-slot');
        if (from !== '') {
          const f = Number(from);
          if (f !== k) { [this.items[f], this.items[k]] = [this.items[k], this.items[f]]; this.paint(f); this.paint(k); this.changed(); }
          return;
        }
        const raw = dt.getData('application/x-flyff-item');
        if (!raw) return;
        try {
          const it = JSON.parse(raw) as BarItem;
          if (Number.isInteger(it.id)) { this.items[k] = it; this.paint(k); this.changed(); }
        } catch { /* arrasto inválido */ }
      });
      this.slots.push(s);
      el.appendChild(s);
      this.paint(k);
    }
    // Action Slot: painel sobre a parte direita da barra (HP/MP/FP já ficam na janela de status)
    const q = document.createElement('div');
    q.className = 'ab-queue';
    q.setAttribute('role', 'group');
    q.setAttribute('aria-label', 'Action Slot: skills em sequência (clique direito no monstro ou tecla C)');
    const title = document.createElement('span');
    title.textContent = 'ACTION SLOT';
    title.setAttribute('aria-hidden', 'true');
    q.appendChild(title);
    for (let k = 0; k < QUEUE_SIZE; k++) {
      const s = document.createElement('button');
      s.type = 'button';
      s.className = 'ab-slot ab-q';
      s.style.left = `${6 + k * 24}px`;
      s.draggable = true;
      s.addEventListener('contextmenu', (e) => { e.preventDefault(); this.setQueueAt(k, null); });
      s.addEventListener('dragstart', (e) => {
        if (!this.queue[k]) { e.preventDefault(); return; }
        e.dataTransfer!.setData('application/x-flyff-queue', String(k));
        e.dataTransfer!.effectAllowed = 'move';
      });
      s.addEventListener('dragend', (e) => { if (e.dataTransfer?.dropEffect === 'none') this.setQueueAt(k, null); });
      s.addEventListener('dragover', (e) => {
        const t = e.dataTransfer?.types ?? [];
        if (t.includes('application/x-flyff-item') || t.includes('application/x-flyff-queue')) { e.preventDefault(); s.classList.add('drop'); }
      });
      s.addEventListener('dragleave', () => s.classList.remove('drop'));
      s.addEventListener('drop', (e) => {
        e.preventDefault();
        s.classList.remove('drop');
        const dt = e.dataTransfer!;
        const from = dt.getData('application/x-flyff-queue');
        if (from !== '') { const f = Number(from), a = this.queue[f]; this.queue[f] = this.queue[k]; this.setQueueAt(k, a); return; }
        try {
          const it = JSON.parse(dt.getData('application/x-flyff-item') || 'null') as BarItem | null;
          if (it?.k === 'skill' && Number.isInteger(it.id)) this.setQueueAt(k, it);
        } catch { /* arrasto inválido */ }
      });
      this.queueEls.push(s);
      q.appendChild(s);
    }
    el.appendChild(q);
    this.paintQueue();
    void themeImage('UseSlot.tga').then((u) => { if (u) el.style.setProperty('--use', `url(${u})`); });
    parent.appendChild(el);
  }

  private changed() { this.onChange(this.items.map((it) => (it ? { k: it.k ?? 'item', id: it.id } : null))); }

  private paint(k: number) {
    const s = this.slots[k], it = this.items[k];
    const key = k === 9 ? '0' : String(k + 1);
    s.replaceChildren();
    const kbd = document.createElement('kbd');
    kbd.textContent = key;
    if (it?.k === 'skill') {
      const img = document.createElement('img');
      img.alt = '';
      img.draggable = false;
      void skillIcon(it.icon).then((u) => { if (u && this.items[k] === it) img.src = u; });
      s.appendChild(img);
      s.classList.remove('empty-stack');
      s.title = `${it.name} — tecla ${key} (lança no alvo selecionado); botão direito ou arrastar para fora tira`;
      s.setAttribute('aria-label', `Atalho ${key}: skill ${it.name}`);
    } else if (it) {
      const img = document.createElement('img');
      img.alt = '';
      img.draggable = false;
      void itemIcon(it.icon).then((u) => { if (u && this.items[k] === it) img.src = u; });
      s.appendChild(img);
      const n = this.counts.get(it.id) ?? 0;
      const b = document.createElement('b');
      b.textContent = String(n);
      s.appendChild(b);
      s.classList.toggle('empty-stack', n === 0);
      s.title = `${it.name} (${n}) — tecla ${key}; botão direito ou arrastar para fora tira`;
      s.setAttribute('aria-label', `Atalho ${key}: ${it.name} (${n})`);
    } else {
      s.classList.remove('empty-stack');
      s.title = `Atalho ${key}: arraste um item da bolsa para cá`;
      s.setAttribute('aria-label', `Atalho ${key} (vazio)`);
    }
    const cd = document.createElement('i');
    cd.className = 'ab-cd';
    s.append(kbd, cd);
  }

  /** atalhos vindos do servidor */
  setItems(slots: (BarItem | null)[]) {
    for (let k = 0; k < 10; k++) this.items[k] = slots[k] ?? null;
    for (let k = 0; k < 10; k++) this.paint(k);
  }

  /** quantidade de cada item na bolsa (atualiza os números dos atalhos) */
  setCounts(counts: Map<number, number>) {
    this.counts = counts;
    for (let k = 0; k < 10; k++) if (this.items[k]) this.paint(k);
  }

  /** espera depois de usar o item `id`: escurece os atalhos dele e vai clareando */
  cooldown(id: number, ms: number, kind: 'item' | 'skill' = 'item') {
    this.slots.forEach((s, k) => {
      const it = this.items[k];
      if (it?.id !== id || (it.k ?? 'item') !== kind) return;
      const cd = s.querySelector<HTMLElement>('.ab-cd');
      if (!cd) return;
      cd.style.animation = 'none';
      void cd.offsetWidth;
      cd.style.animation = `abCooldown ${ms}ms linear forwards`;
    });
  }

  /** aperta o atalho: efeito e usa o item */
  use(k: number) {
    const s = this.slots[k];
    s.classList.remove('used');
    void s.offsetWidth; // reinicia a animação
    s.classList.add('used');
    const it = this.items[k];
    if (it?.k === 'skill') this.onUseSkill(it.id);
    else if (it) this.onUseItem(it.id);
  }

  /** skills da Action Slot (na ordem, sem buracos) */
  get queueSkills() { return this.queue.filter((x): x is BarItem => !!x); }
  /** os 5 espaços como estão (para guardar) */
  get queueList() { return [...this.queue]; }
  setQueue(list: (BarItem | null)[]) { for (let k = 0; k < QUEUE_SIZE; k++) this.queue[k] = list[k] ?? null; this.paintQueue(); }
  private setQueueAt(k: number, it: BarItem | null) {
    this.queue[k] = it;
    this.paintQueue();
    this.onQueueChange(this.queue.map((x) => x?.id ?? null));
  }
  /** realça a skill da Action Slot que está sendo lançada (-1 = nenhuma) */
  markQueue(i: number) {
    const filled = this.queueEls.filter((_, k) => this.queue[k]);
    this.queueEls.forEach((s) => s.classList.remove('active'));
    filled[i]?.classList.add('active');
  }
  private paintQueue() {
    this.queueEls.forEach((s, k) => {
      const it = this.queue[k];
      s.replaceChildren();
      if (it) {
        const img = document.createElement('img');
        img.alt = '';
        img.draggable = false;
        void skillIcon(it.icon).then((u) => { if (u && this.queue[k] === it) img.src = u; });
        s.appendChild(img);
      }
      s.title = it ? `${k + 1}ª da Action Slot: ${it.name} — botão direito tira` : `Action Slot ${k + 1}: arraste uma skill para cá`;
      s.setAttribute('aria-label', it ? `Action Slot ${k + 1}: ${it.name}` : `Action Slot ${k + 1} (vazio)`);
    });
  }

  show() { this.el.hidden = false; }
  hide() { this.el.hidden = true; }
}

// ---------- chat ----------

export class ChatWindow extends GameWindow {
  private log = document.createElement('ol');
  readonly input = document.createElement('input');
  onSend: (text: string) => boolean = () => false;
  private static readonly MAX_LINES = 150;

  constructor(parent: HTMLElement) {
    super(parent, { id: 'chatWnd', title: 'Chat', store: 'flyff.wnd.chat', initial: { x: 6, y: -64, w: 380, h: 210 }, min: { w: 220, h: 120 }, closable: false });
    const b = this.body;
    b.classList.add('chat');
    this.log.className = 'chat-log';
    this.log.setAttribute('aria-live', 'polite');
    this.log.setAttribute('aria-label', 'Mensagens do chat');
    const form = document.createElement('form');
    form.className = 'chat-edit';
    void themeImage('WndChatEdit00.tga').then((u) => { if (u) form.style.setProperty('--edit', `url(${u})`); });
    this.input.className = 'fedit';
    this.input.maxLength = 200;
    this.input.placeholder = 'Enter para conversar';
    this.input.setAttribute('aria-label', 'Mensagem');
    this.input.autocomplete = 'off';
    this.input.spellcheck = false;
    form.appendChild(this.input);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const text = this.input.value.trim();
      if (text && !this.onSend(text)) this.system('Sem conexão com o servidor — mensagem não enviada.');
      this.input.value = '';
      this.input.blur();
    });
    this.input.addEventListener('keydown', (e) => { if (e.key === 'Escape') { this.input.value = ''; this.input.blur(); } e.stopPropagation(); });
    b.append(this.log, form);
  }

  private push(li: HTMLLIElement) {
    const atBottom = this.log.scrollHeight - this.log.scrollTop - this.log.clientHeight < 8;
    this.log.appendChild(li);
    while (this.log.childElementCount > ChatWindow.MAX_LINES) this.log.firstElementChild!.remove();
    if (atBottom) this.log.scrollTop = this.log.scrollHeight;
  }

  /** mensagem de jogador (texto puro, sem HTML) */
  message(name: string, text: string, mine = false) {
    const li = document.createElement('li');
    if (mine) li.className = 'mine';
    const who = document.createElement('b');
    who.textContent = `${name}: `;
    li.append(who, document.createTextNode(text));
    this.push(li);
  }

  system(text: string) {
    const li = document.createElement('li');
    li.className = 'sys';
    li.textContent = text;
    this.push(li);
  }

  clear() { this.log.replaceChildren(); }
  focus() { if (!this.visible) this.show(); this.input.focus(); }
}
