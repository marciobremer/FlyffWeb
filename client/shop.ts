import { itemIcon } from '../shared/tga';
import { GameWindow } from './ui';
import type { ItemView } from './net';

/**
 * Loja do NPC (quem decide é o servidor — server/shops.ts): abas do character.inc, grade com os itens (ícone; nome,
 * nível e preço na dica). Clique escolhe e mostra a linha de compra (quantidade para os que empilham, total em penya);
 * duplo clique compra 1. Vender: arraste um item da bolsa para a janela, confirme a quantidade (dwCost/4 cada).
 */
export interface ShopView { key: string; name: string; tabs: { name: string; items: (ItemView & { price: number })[] }[] }
interface DragItem { id: number; icon: string; name: string; n: number; cost: number; c: number; s: number }

const fmt = (n: number) => n.toLocaleString('pt-BR');

export class ShopWindow extends GameWindow {
  onBuy: (key: string, id: number, n: number) => void = () => {};
  onSell: (key: string, slot: number, n: number) => void = () => {};

  shop: ShopView | null = null;
  private tab = 0;
  private gold = 0;
  private tabsEl = document.createElement('div');
  private grid = document.createElement('div');
  private bar = document.createElement('div');
  private goldEl = document.createElement('div');
  /** linha de confirmação: comprar um item da loja ou vender um da bolsa */
  private pending: { mode: 'buy'; item: ItemView & { price: number } } | { mode: 'sell'; item: DragItem } | null = null;

  constructor(parent: HTMLElement) {
    super(parent, { id: 'shopWnd', title: 'Loja', store: 'flyff.wnd.shop', initial: { x: 250, y: 110, w: 300, h: 380 }, min: { w: 260, h: 300 } });
    const b = this.body;
    b.classList.add('shop');
    this.tabsEl.className = 'gm-tabs';
    this.grid.className = 'shop-grid';
    this.bar.className = 'shop-bar';
    this.goldEl.className = 'shop-gold';
    const hint = document.createElement('p');
    hint.className = 'shop-hint';
    hint.textContent = 'Arraste um item da bolsa para cá para vender.';
    b.append(this.tabsEl, this.grid, this.bar, hint, this.goldEl);

    this.grid.addEventListener('click', (e) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>('[data-i]');
      const it = el && this.shop?.tabs[this.tab]?.items[Number(el.dataset.i)];
      if (it) { this.pending = { mode: 'buy', item: it }; this.renderBar(); }
    });
    this.grid.addEventListener('dblclick', (e) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>('[data-i]');
      const it = el && this.shop?.tabs[this.tab]?.items[Number(el.dataset.i)];
      if (it && this.shop) this.onBuy(this.shop.key, it.id, 1);
    });
    // vender: soltar um item arrastado da bolsa
    this.el.addEventListener('dragover', (e) => { if (e.dataTransfer?.types.includes('application/x-flyff-item')) { e.preventDefault(); this.el.classList.add('drop'); } });
    this.el.addEventListener('dragleave', (e) => { if (!this.el.contains(e.relatedTarget as Node)) this.el.classList.remove('drop'); });
    this.el.addEventListener('drop', (e) => {
      e.preventDefault();
      this.el.classList.remove('drop');
      try {
        const it = JSON.parse(e.dataTransfer!.getData('application/x-flyff-item')) as DragItem;
        if (it.c !== 0) return; // equipado: desequipe antes
        this.pending = { mode: 'sell', item: it };
        this.renderBar();
      } catch { /* arrasto que não é item */ }
    });
  }

  open(s: ShopView) {
    this.shop = s;
    this.tab = 0;
    this.pending = null;
    this.setTitle(s.name);
    this.renderTabs();
    this.renderGrid();
    this.renderBar();
    this.show();
    this.fitTabs();
  }

  /** a janela nunca fica mais estreita que a fileira de abas (ex.: Boboku com 4 abas) */
  private fitTabs() {
    const tabs = [...this.tabsEl.children] as HTMLElement[];
    const gap = 2, inner = tabs.reduce((s, t) => s + t.offsetWidth, 0) + gap * Math.max(0, tabs.length - 1);
    // corpo: borda 12 de cada lado + 2 de espaço; mínimo padrão 260
    this.setMinSize(Math.max(260, inner + 2 * 12 + 2 * 2 + 4));
  }

  setGold(n: number) { this.gold = n; this.goldEl.textContent = `Seu penya: ${fmt(n)}`; if (this.pending?.mode === 'buy') this.renderBar(); }

  private renderTabs() {
    this.tabsEl.replaceChildren();
    this.shop?.tabs.forEach((t, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'gm-tab';
      b.textContent = t.name;
      b.setAttribute('aria-selected', String(i === this.tab));
      b.addEventListener('click', () => { this.tab = i; this.renderTabs(); this.renderGrid(); });
      this.tabsEl.appendChild(b);
    });
  }

  private renderGrid() {
    const frag = document.createDocumentFragment();
    (this.shop?.tabs[this.tab]?.items ?? []).forEach((it, i) => {
      const s = document.createElement('div');
      s.className = 'inv-slot has';
      s.dataset.i = String(i);
      s.title = `${it.name}${it.lv ? `\nNível ${it.lv}` : ''}\n${fmt(it.price)} penya`;
      s.setAttribute('aria-label', `${it.name}, ${fmt(it.price)} penya`);
      const img = document.createElement('img');
      img.alt = '';
      void itemIcon(it.icon).then((u) => { if (u) img.src = u; });
      s.appendChild(img);
      frag.appendChild(s);
    });
    this.grid.replaceChildren(frag);
  }

  private renderBar() {
    const p = this.pending, shop = this.shop;
    this.bar.replaceChildren();
    if (!p || !shop) { this.bar.textContent = 'Clique num item para comprar (duplo clique compra 1).'; this.bar.classList.add('dim'); return; }
    this.bar.classList.remove('dim');
    const img = document.createElement('img');
    img.alt = '';
    void itemIcon(p.item.icon).then((u) => { if (u) img.src = u; });
    const name = document.createElement('b');
    name.textContent = p.item.name;
    const max = p.mode === 'buy' ? (p.item.pack > 1 ? Math.min(p.item.pack, 9999) : 1) : p.item.n;
    const unit = p.mode === 'buy' ? p.item.price : Math.max(1, Math.floor((p.item.cost || 0) / 4));
    const qty = document.createElement('input');
    qty.type = 'number'; qty.min = '1'; qty.max = String(max); qty.value = '1'; qty.className = 'gm-in num';
    qty.disabled = max <= 1;
    const total = document.createElement('span');
    const upd = () => {
      const n = Math.max(1, Math.min(max, Number(qty.value) || 1));
      total.textContent = `${fmt(unit * n)} penya`;
      total.classList.toggle('short', p.mode === 'buy' && unit * n > this.gold);
    };
    qty.addEventListener('input', upd);
    upd();
    const ok = document.createElement('button');
    ok.type = 'button'; ok.className = 'gm-btn'; ok.textContent = p.mode === 'buy' ? 'Comprar' : 'Vender';
    ok.addEventListener('click', () => {
      const n = Math.max(1, Math.min(max, Number(qty.value) || 1));
      if (p.mode === 'buy') this.onBuy(shop.key, p.item.id, n);
      else this.onSell(shop.key, p.item.s, n);
      if (p.mode === 'sell') { this.pending = null; this.renderBar(); }
    });
    const cancel = document.createElement('button');
    cancel.type = 'button'; cancel.className = 'gm-btn ghost'; cancel.textContent = '×';
    cancel.setAttribute('aria-label', 'Cancelar');
    cancel.addEventListener('click', () => { this.pending = null; this.renderBar(); });
    const top = document.createElement('div');
    top.className = 'shop-line';
    top.append(img, name);
    const bottom = document.createElement('div');
    bottom.className = 'shop-line';
    bottom.append(qty, total, ok, cancel);
    this.bar.append(top, bottom);
  }
}
