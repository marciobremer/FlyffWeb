import { itemIcon } from '../shared/tga';
import { GameWindow } from './ui';

/**
 * Loja de itens de dentro do jogo (menu → Itens especiais → Loja de itens), a mesma do site (preços e itens são cadastrados no
 * painel do site). À esquerda as categorias, o saldo de pontos e "Recarga" (abre a página de doação); no meio a busca e os
 * cartões; à direita os detalhes do item escolhido, a quantidade, o total e "Comprar". O servidor confere tudo e entrega na bolsa.
 */
export interface ShopItemView { id: number; itemId: number; name: string; description: string; icon: string; quantity: number; price: number; discount: number; final: number; currency: 'cash' | 'vote'; category: string }
export interface ItemShopData { items: ShopItemView[]; cash: number; votepoint: number; error?: string; bought?: boolean }

const POINTS = { cash: 'Cash Points', vote: 'Vote Points' } as const;
const ALL = 'Todos';
const make = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = '') => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
};
const iconImg = (file: string) => {
  const img = make('img', 'is-icon');
  img.alt = '';
  void itemIcon(file).then((u) => { if (u) img.src = u; });
  return img;
};

export class ItemShopWindow extends GameWindow {
  /** pede a vitrine ao servidor (cada vez que abre: preços e saldo atuais) */
  onLoad: () => void = () => {};
  onBuy: (item: ShopItemView, times: number) => void = () => {};
  private data: ItemShopData | null = null;
  private category = ALL;
  private selected: number | null = null;
  private times = 1;
  private cats = make('div', 'is-cats');
  private wallet = make('div', 'is-wallet');
  private search = make('input', 'is-search');
  private count = make('div', 'is-count');
  private grid = make('div', 'is-grid');
  private detail = make('div', 'is-detail');
  private message = make('div', 'is-msg');
  private buying = 0;

  constructor(parent: HTMLElement) {
    super(parent, { id: 'itemShopWnd', title: 'Loja de itens', store: 'flyff.wnd.itemshop', initial: { x: 90, y: 60, w: 860, h: 520 }, min: { w: 640, h: 380 } });
    this.body.classList.add('is');
    this.search.type = 'search';
    this.search.placeholder = 'Buscar:';
    this.search.setAttribute('aria-label', 'Buscar item');
    this.search.addEventListener('input', () => this.renderGrid());
    this.search.addEventListener('keydown', (e) => e.stopPropagation()); // digitar não move o personagem
    const recharge = make('button', 'is-recharge', 'RECARGA');
    recharge.type = 'button';
    recharge.addEventListener('click', () => window.open('/shops?tab=points', '_blank', 'noopener'));
    const left = make('div', 'is-left');
    left.append(this.cats, this.wallet, recharge);
    const mid = make('div', 'is-mid');
    this.message.setAttribute('role', 'status');
    mid.append(this.search, this.count, this.message, this.grid);
    this.body.append(left, mid, this.detail);
  }

  toggle() { if (this.visible) this.hide(); else this.open(); }
  open() {
    this.message.textContent = '';
    this.show();
    this.onLoad();
  }

  set(d: ItemShopData) {
    // erro sem vitrine (loja indisponível): mantém o que já estava na tela
    this.data = d.error && !d.items.length && this.data ? { ...this.data } : d;
    this.buying = 0;
    this.message.textContent = d.error ?? (d.bought ? 'Compra feita! O item vai para a sua bolsa.' : '');
    this.message.classList.toggle('error', !!d.error);
    if (this.category !== ALL && !this.data.items.some((i) => i.category === this.category)) this.category = ALL;
    if (!this.data.items.some((i) => i.id === this.selected)) this.selected = null;
    this.render();
  }

  private render() {
    const d = this.data;
    if (!d) return;
    this.cats.replaceChildren(...[ALL, ...new Set(d.items.map((i) => i.category))].map((name) => {
      const b = make('button', name === this.category ? 'on' : '', name);
      b.type = 'button';
      b.addEventListener('click', () => { this.category = name; this.render(); });
      return b;
    }));
    this.wallet.replaceChildren(make('div', '', `${d.cash.toLocaleString('pt-BR')} Cash Points`), make('div', '', `${d.votepoint.toLocaleString('pt-BR')} Vote Points`));
    this.renderGrid();
    this.renderDetail();
  }

  private renderGrid() {
    const q = this.search.value.trim().toLowerCase();
    const list = (this.data?.items ?? []).filter((i) => (this.category === ALL || i.category === this.category) && (!q || i.name.toLowerCase().includes(q)));
    this.count.textContent = list.length ? `${list.length} ${list.length === 1 ? 'item' : 'itens'} na categoria.` : 'Nenhum item à venda aqui.';
    this.grid.replaceChildren(...list.map((i) => {
      const card = make('button', `is-card${i.id === this.selected ? ' on' : ''}`);
      card.type = 'button';
      const info = make('span', 'is-info');
      const price = make('span', 'is-price');
      if (i.discount) price.append(make('s', '', `${i.price} ${POINTS[i.currency]}`));
      price.append(make('span', '', `${i.final} ${POINTS[i.currency]}`));
      info.append(make('b', '', i.quantity > 1 ? `${i.quantity}x ${i.name}` : i.name), price);
      card.append(iconImg(i.icon), info);
      if (i.discount) card.append(make('span', 'is-off', `-${i.discount}%`));
      card.addEventListener('click', () => { this.selected = i.id; this.times = 1; this.renderGrid(); this.renderDetail(); });
      return card;
    }));
  }

  private renderDetail() {
    const i = this.data?.items.find((x) => x.id === this.selected);
    if (!i) { this.detail.replaceChildren(make('p', 'is-hint', 'Escolha um item para ver os detalhes.')); return; }
    const row = (label: string, value: string) => { const r = make('div', 'is-row'); r.append(make('span', '', label), make('b', '', value)); return r; };
    const total = make('b');
    const qty = make('input', 'is-qty');
    qty.type = 'number'; qty.min = '1'; qty.max = '99';
    qty.setAttribute('aria-label', 'Quantidade');
    const setTimes = (n: number) => {
      this.times = Math.max(1, Math.min(99, Math.floor(n) || 1));
      qty.value = String(this.times);
      total.textContent = `${(i.final * this.times).toLocaleString('pt-BR')} ${POINTS[i.currency]}`;
    };
    qty.addEventListener('change', () => setTimes(Number(qty.value)));
    qty.addEventListener('keydown', (e) => e.stopPropagation());
    const step = (text: string, d: number, label: string) => { const b = make('button', 'is-step', text); b.type = 'button'; b.setAttribute('aria-label', label); b.addEventListener('click', () => setTimes(this.times + d)); return b; };
    const qtyRow = make('div', 'is-row');
    qtyRow.append(make('span', '', 'Quantidade:'), qty, step('−', -1, 'Menos um'), step('+', 1, 'Mais um'));
    const totalRow = make('div', 'is-row');
    totalRow.append(make('span', '', 'Preço total:'), total);
    const buy = make('button', 'is-buy', 'COMPRAR');
    buy.type = 'button';
    buy.addEventListener('click', () => {
      setTimes(Number(qty.value));
      if (this.buying && Date.now() - this.buying < 3000) return; // esperando a resposta
      this.buying = Date.now();
      this.onBuy(i, this.times);
    });
    const parts: HTMLElement[] = [make('h4', '', i.quantity > 1 ? `${i.quantity}x ${i.name}` : i.name), iconImg(i.icon), make('p', 'is-desc', i.description)];
    if (i.discount) parts.push(row('Preço original:', `${i.price} ${POINTS[i.currency]}`));
    parts.push(row('Unidade:', `${i.final} ${POINTS[i.currency]}${i.discount ? ` (-${i.discount}%)` : ''}`), qtyRow, totalRow, buy);
    this.detail.replaceChildren(...parts);
    setTimes(this.times);
  }
}
