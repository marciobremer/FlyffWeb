import { itemIcon } from '../shared/tga';
import { hideItemTip, moveItemTip, showItemTip } from './itemtip';
import { t, tr, trAttr } from './lang';
import { ELEMENT_NAMES, GameWindow, invItem, type InvDef, type InvItem, type InvRow } from './ui';

/**
 * Armazém do personagem (o banco do FlyFF): 42 espaços e penya guardado. Arraste da bolsa para cá (ou dê duplo clique com o
 * armazém aberto) para guardar; arraste daqui para a bolsa (ou duplo clique) para retirar. O servidor confere tudo; a janela
 * só desenha o que ele manda.
 */
export interface BankData { gold: number; slots: number; items: InvRow[]; defs: Record<number, InvDef> }

const BANK = 2;
export const BANK_DRAG = 'application/x-flyff-bank';

export class BankWindow extends GameWindow {
  private grid = document.createElement('div');
  private penya = document.createElement('output');
  private amount = document.createElement('input');
  private items = new Map<number, InvItem>();
  private defs: Record<number, InvDef> = {};
  private slots = 42;
  /** chave do NPC que abriu ('' = aberto por GM/Premium) */
  npc = '';
  /** guardar (bolsa → armazém), retirar e arrumar dentro do armazém; to = -1: onde couber */
  onMove: (from: [number, number], to: [number, number], n?: number) => void = () => {};
  /** > 0 guarda penya, < 0 retira */
  onGold: (delta: number) => void = () => {};
  /** soltou um item da bolsa num espaço do armazém: quem pergunta a quantidade é o dono */
  onDropItem: (bagSlot: number, bankSlot: number, count: number) => void = () => {};

  constructor(parent: HTMLElement) {
    super(parent, { id: 'bankWnd', title: 'Armazém', store: 'flyff.wnd.bank', initial: { x: 320, y: 140, w: 264, h: 330 }, min: { w: 264, h: 330 }, resizable: false });
    const b = this.body;
    b.classList.add('bank');
    this.grid.className = 'bank-grid';
    const total = document.createElement('div');
    total.className = 'bank-total';
    const label = document.createElement('span');
    tr(label, 'Penya guardado');
    total.append(label, this.penya);
    const bar = document.createElement('div');
    bar.className = 'bank-bar';
    this.amount.type = 'number';
    this.amount.min = '1';
    trAttr(this.amount, 'placeholder', 'Penya');
    trAttr(this.amount, 'aria-label', 'Quantidade de penya');
    const btn = (sign: 1 | -1) => {
      const x = document.createElement('button');
      x.type = 'button'; x.className = 'gm-btn';
      if (sign > 0) tr(x, 'Guardar'); else tr(x, 'Retirar');
      x.addEventListener('click', () => {
        const v = Math.floor(Number(this.amount.value));
        if (v >= 1) { this.onGold(sign * v); this.amount.value = ''; } else this.amount.focus();
      });
      return x;
    };
    bar.append(this.amount, btn(1), btn(-1));
    b.append(this.grid, total, bar);
    this.bind();
    this.render();
  }

  set(d: BankData) {
    this.slots = d.slots;
    this.defs = d.defs;
    this.items = new Map(d.items.map((row) => { const i = invItem(row); return [i.s, i]; }));
    this.penya.textContent = d.gold.toLocaleString('pt-BR');
    this.render();
  }

  item(slot: number) { return this.items.get(slot); }
  override hide() { hideItemTip(); this.prompt?.remove(); this.prompt = null; super.hide(); }

  private prompt: HTMLElement | null = null;
  /** "quantos?" para mover parte de uma pilha (Enter confirma, Esc cancela); pilha de 1 passa direto */
  askAmount(max: number, run: (n: number) => void) {
    this.prompt?.remove();
    this.prompt = null;
    if (max <= 1) { run(1); return; }
    const box = document.createElement('form');
    box.className = 'inv-ask bank-ask';
    const msg = document.createElement('p');
    msg.textContent = t('Quantos mover? (até {max})', { max });
    const input = document.createElement('input');
    input.type = 'number'; input.min = '1'; input.max = String(max); input.value = String(max); input.className = 'gm-in num';
    input.setAttribute('aria-label', t('Quantidade'));
    const ok = document.createElement('button');
    ok.type = 'submit'; ok.className = 'gm-btn'; ok.textContent = t('Ok');
    const cancel = document.createElement('button');
    cancel.type = 'button'; cancel.className = 'gm-btn'; cancel.textContent = t('Cancelar');
    const close = () => { box.remove(); this.prompt = null; };
    cancel.addEventListener('click', close);
    box.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } });
    box.addEventListener('submit', (e) => {
      e.preventDefault();
      const n = Math.min(max, Math.floor(Number(input.value)));
      if (n >= 1) { close(); run(n); }
    });
    const row = document.createElement('div');
    row.append(input, ok, cancel);
    box.append(msg, row);
    this.body.appendChild(box);
    this.prompt = box;
    input.select();
  }

  private render() {
    const cells: HTMLElement[] = [];
    for (let s = 0; s < this.slots; s++) {
      const el = document.createElement('div');
      el.className = 'inv-slot';
      el.dataset.slot = String(s);
      const it = this.items.get(s), d = it && this.defs[it.id];
      if (it) {
        el.classList.add('has');
        el.draggable = true;
        const img = document.createElement('img');
        img.alt = d?.name ?? `item ${it.id}`;
        if (d?.icon) void itemIcon(d.icon).then((u) => { if (u) img.src = u; });
        el.appendChild(img);
        const tag = [it.u ? `+${it.u}` : '', it.n > 1 ? String(it.n) : ''].filter(Boolean).join(' ');
        if (tag) { const n = document.createElement('b'); n.textContent = tag; el.appendChild(n); }
        if (d) {
          el.addEventListener('mouseenter', (ev) => showItemTip(ev, d, it, ELEMENT_NAMES));
          el.addEventListener('mousemove', moveItemTip);
          el.addEventListener('mouseleave', hideItemTip);
        }
      }
      cells.push(el);
    }
    hideItemTip();
    this.grid.replaceChildren(...cells);
  }

  private bind() {
    const at = (t: EventTarget | null) => (t as HTMLElement | null)?.closest<HTMLElement>('[data-slot]') ?? null;
    const g = this.grid;
    g.addEventListener('dragstart', (e) => {
      const el = at(e.target);
      if (!el?.classList.contains('has')) { e.preventDefault(); return; }
      hideItemTip();
      e.dataTransfer!.effectAllowed = 'move';
      e.dataTransfer!.setData(BANK_DRAG, el.dataset.slot!);
    });
    g.addEventListener('dragover', (e) => {
      const t = e.dataTransfer?.types ?? [];
      if (at(e.target) && (t.includes(BANK_DRAG) || t.includes('application/x-flyff-item'))) e.preventDefault();
    });
    g.addEventListener('drop', (e) => {
      const el = at(e.target);
      if (!el) return;
      e.preventDefault();
      const to = Number(el.dataset.slot);
      const own = e.dataTransfer!.getData(BANK_DRAG);
      if (own !== '') { if (Number(own) !== to) this.onMove([BANK, Number(own)], [BANK, to]); return; }
      try {
        const it = JSON.parse(e.dataTransfer!.getData('application/x-flyff-item')) as { c: number; s: number; n: number };
        if (it.c === 0) this.onDropItem(it.s, to, it.n); // equipado: tire antes
      } catch { /* arrasto que não é item */ }
    });
    g.addEventListener('dblclick', (e) => {
      const el = at(e.target);
      if (el?.classList.contains('has')) this.onMove([BANK, Number(el.dataset.slot)], [0, -1]);
    });
  }
}
