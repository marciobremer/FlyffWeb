import { itemIcon, skillIcon, themeImage, themeTiles } from '../shared/tga';
import type { ItemView } from './net';
import { hideItemTip, moveItemTip, showItemTip } from './itemtip';
import { InventoryPreview } from './invpreview';
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
export interface InvItem { c: number; s: number; id: number; n: number; u: number; e: number; el: number; /** piercing: carta por espaço aberto (0 = vazio) */ p?: number[]; /** item de tempo ativado (ticket): vale até (ms) */ x?: number }
export const ELEMENT_NAMES = ['', 'Fogo', 'Água', 'Elétrico', 'Vento', 'Terra'];
export interface InvDef extends ItemView {}

const BAG = 0, EQUIPPED = 1;
const keyOf = (c: number, s: number) => `${c}:${s}`;

export class InventoryWindow extends GameWindow {
  /** slots abertos da bolsa (o servidor manda o número; os demais aparecem trancados) */
  private open = 42;
  private grid = document.createElement('div');
  private penya = document.createElement('output');
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
  /** personagem 3D no centro (client/invpreview.ts) */
  readonly preview = new InventoryPreview();
  private hideMask = 0;
  private checks = new Map<number, HTMLButtonElement>();

  constructor(parent: HTMLElement) {
    super(parent, { id: 'invWnd', title: 'Inventário', store: 'flyff.wnd.inventory3d', initial: { x: -12, y: 110, w: 312, h: 580 }, min: { w: 310, h: 470 } });
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

    const money = document.createElement('div');
    money.className = 'inv-money';
    const bag = document.createElement('i');
    bag.setAttribute('aria-hidden', 'true');
    void themeImage('WndInventory.tga').then((u) => { if (u) bag.style.backgroundImage = `url(${u})`; });
    this.penya.setAttribute('aria-label', 'Penya');
    this.penya.value = '0';
    money.append(bag, this.penya);

    b.append(equip, this.search, this.grid, money);
    this.onResize = () => this.layoutGrid();
    this.renderChecks();
    this.bindDrag(b);
    this.renderEquip();
  }

  /** estado vindo do servidor */
  setState(gold: number, open: number, items: [number, number, number, number, number?, number?, number?, number[]?, number?][], defs: Record<number, InvDef>) {
    this.penya.value = gold.toLocaleString('pt-BR');
    for (const d of Object.values(defs)) this.defs.set(d.id, d);
    this.items.clear();
    for (const [c, s, id, n, u = 0, e = 0, el = 0, p, x] of items) this.items.set(keyOf(c, s), { c, s, id, n, u, e, el, ...(p?.length ? { p } : {}), ...(x ? { x } : {}) });
    // itens de tempo: repinta de minuto em minuto (o visto some e o item fica cinza quando acaba)
    clearInterval(this.timedTimer);
    if ([...this.items.values()].some((i) => i.x)) this.timedTimer = window.setInterval(() => { this.renderBag(); }, 60_000);
    if (open !== this.open) { this.open = open; this.grid.replaceChildren(); this.layoutGrid(); }
    else this.renderBag();
    this.renderEquip();
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

  /** dica do item ao passar o mouse: dados do item e, para peça de equipar na bolsa, o que está equipado no mesmo espaço */
  private bindTip(el: HTMLElement) {
    if (this.bound.has(el)) return;
    this.bound.add(el);
    const show = (ev: MouseEvent) => {
      const it = this.tipItem.get(el), d = it && this.defs.get(it.id);
      if (!it || !d || el.classList.contains('dragging')) { hideItemTip(); return; }
      let eq: { d: ItemView; it: InvItem } | undefined;
      if (it.c === BAG && d.parts >= 0) {
        const part = d.parts, slots = part === 20 || part === 21 ? [20, 21] : part === 22 || part === 23 ? [22, 23] : [part];
        for (const s of slots) { const e = this.items.get(keyOf(EQUIPPED, s)), ed = e && this.defs.get(e.id); if (e && ed) { eq = { d: ed, it: e }; break; } }
      }
      showItemTip(ev, d, it, ELEMENT_NAMES, eq);
    };
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
    const sig = it ? `${it.id}:${it.n}:${it.u}:${it.e}:${it.el}:${timed}` : '';
    if (el.dataset.sig === sig && el.dataset.painted) return;
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

  /** arrastar um item para outro espaço (bolsa ↔ bolsa ↔ equipamento) e duplo clique para equipar/desequipar */
  private bindDrag(root: HTMLElement) {
    const at = (t: EventTarget | null) => (t as HTMLElement | null)?.closest<HTMLElement>('[data-c][data-s]') ?? null;
    const clearDrop = () => root.querySelectorAll('.drop').forEach((x) => x.classList.remove('drop'));
    let from: [number, number] | null = null;
    root.addEventListener('dragstart', (e) => {
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
    root.addEventListener('dragover', (e) => {
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
      if (!from || !el) return;
      const to: [number, number] = [Number(el.dataset.c), Number(el.dataset.s)];
      if (to[0] !== from[0] || to[1] !== from[1]) this.onMove(from, to);
    });
    root.addEventListener('dblclick', (e) => {
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
