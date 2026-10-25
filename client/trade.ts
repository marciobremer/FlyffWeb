import { itemIcon } from '../shared/tga';
import { ELEMENT_NAMES, GameWindow } from './ui';
import { hideItemTip, moveItemTip, showItemTip } from './itemtip';
import type { ItemView } from './net';

/**
 * Trade (CWndTrade): janela de troca entre dois jogadores. Em cima a oferta do outro, embaixo a sua — 25 espaços cada e
 * penya. Arraste itens da bolsa para a sua parte (ou duplo clique no item da bolsa); pilha pergunta quantos. Clique num item
 * seu para tirar. "OK" trava a sua oferta (qualquer mudança tira o OK dos dois); com os dois em OK, "Trocar" confirma e o
 * servidor faz a troca de uma vez quando os dois confirmam. Fechar a janela cancela.
 */
export interface TradeItem { s?: number; it: { id: number; n: number; u: number; e: number; el: number; p?: number[]; x?: number }; d: ItemView }
export interface TradeSide { gold: number; items: TradeItem[] }
export interface TradeView { name: string; me: TradeSide; them: TradeSide; lock: [boolean, boolean]; ok: [boolean, boolean] }

const SLOTS = 25;

export class TradeWindow extends GameWindow {
  onItem: (s: number, n: number) => void = () => {};
  onRemove: (s: number) => void = () => {};
  onGold: (gold: number) => void = () => {};
  onLock: () => void = () => {};
  onOk: () => void = () => {};
  onCancel: () => void = () => {};

  private view: TradeView | null = null;
  private themTitle = document.createElement('div');
  private themGrid = document.createElement('div');
  private themGold = document.createElement('output');
  private meGrid = document.createElement('div');
  private meGold = document.createElement('input');
  private qtyRow = document.createElement('div');
  private status = document.createElement('p');
  private lockBtn = document.createElement('button');
  private okBtn = document.createElement('button');
  /** envia o penya digitado quando para de digitar */
  private goldTimer = 0;

  constructor(parent: HTMLElement) {
    super(parent, { id: 'tradeWnd', title: 'Troca', store: 'flyff.wnd.trade', initial: { x: 340, y: 90, w: 210, h: 560 }, min: { w: 200, h: 550 } });
    const b = this.body;
    b.classList.add('tr');
    this.themTitle.className = 'tr-sub';
    for (const g of [this.themGrid, this.meGrid]) {
      g.className = 'tr-grid';
      for (let i = 0; i < SLOTS; i++) { const s = document.createElement('div'); s.className = 'inv-slot'; s.dataset.i = String(i); g.append(s); }
    }
    this.themGold.className = 'tr-gold';
    const meTitle = document.createElement('div');
    meTitle.className = 'tr-sub';
    meTitle.textContent = 'Sua oferta';
    this.meGold.type = 'number';
    this.meGold.min = '0';
    this.meGold.className = 'tr-gold-in';
    this.meGold.placeholder = '0';
    this.meGold.setAttribute('aria-label', 'Penya que você oferece');
    this.meGold.addEventListener('keydown', (e) => e.stopPropagation());
    this.meGold.addEventListener('input', () => {
      clearTimeout(this.goldTimer);
      this.goldTimer = window.setTimeout(() => this.onGold(Math.max(0, Math.floor(Number(this.meGold.value) || 0))), 400);
    });
    const goldRow = (label: string, el: HTMLElement) => { const r = document.createElement('label'); r.className = 'tr-goldrow'; r.append(label, el, ' penya'); return r; };
    this.qtyRow.className = 'tr-qty';
    this.qtyRow.hidden = true;
    this.status.className = 'tr-status';
    const btns = document.createElement('div');
    btns.className = 'tr-btns';
    for (const [el, text, fn] of [[this.lockBtn, 'OK', () => this.onLock()], [this.okBtn, 'Trocar', () => this.onOk()]] as const) {
      el.type = 'button'; el.className = 'gm-btn'; el.textContent = text; el.addEventListener('click', fn); btns.append(el);
    }
    const cancel = document.createElement('button');
    cancel.type = 'button'; cancel.className = 'gm-btn'; cancel.textContent = 'Cancelar';
    cancel.addEventListener('click', () => this.onCancel());
    btns.append(cancel);
    b.append(this.themTitle, this.themGrid, goldRow('', this.themGold), meTitle, this.meGrid, goldRow('', this.meGold), this.qtyRow, this.status, btns);
    this.onClose = () => this.onCancel();
    this.bindTips(this.themGrid, () => this.view?.them.items ?? []);
    this.bindTips(this.meGrid, () => this.view?.me.items ?? []);

    // soltar um item arrastado da bolsa na sua parte
    this.meGrid.addEventListener('dragover', (e) => { if (e.dataTransfer?.types.includes('application/x-flyff-item')) { e.preventDefault(); this.meGrid.classList.add('drop'); } });
    this.meGrid.addEventListener('dragleave', (e) => { if (!this.meGrid.contains(e.relatedTarget as Node)) this.meGrid.classList.remove('drop'); });
    this.meGrid.addEventListener('drop', (e) => {
      e.preventDefault();
      this.meGrid.classList.remove('drop');
      try {
        const it = JSON.parse(e.dataTransfer!.getData('application/x-flyff-item')) as { c: number; s: number; n: number; name: string };
        if (it.c !== 0) return; // equipado: desequipe antes
        this.offer(it.s, it.n, it.name);
      } catch { /* arrasto que não é item */ }
    });
    // clicar num item seu: tira da troca
    this.meGrid.addEventListener('click', (e) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>('[data-i]');
      const t = el && this.view?.me.items[Number(el.dataset.i)];
      if (t?.s !== undefined) { hideItemTip(); this.onRemove(t.s); }
    });
  }

  get active() { return !!this.view; }

  /** pôr na troca o item do espaço `s` da bolsa; pilha pergunta quantos (até `max`) */
  offer(s: number, max: number, name: string) {
    if (max <= 1) { this.onItem(s, 1); return; }
    const qty = document.createElement('input');
    qty.type = 'number'; qty.min = '1'; qty.max = String(max); qty.value = String(max); qty.className = 'gm-in num';
    qty.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') ok.click(); if (e.key === 'Escape') this.qtyRow.hidden = true; });
    const ok = document.createElement('button');
    ok.type = 'button'; ok.className = 'gm-btn'; ok.textContent = 'Pôr';
    ok.addEventListener('click', () => { this.qtyRow.hidden = true; this.onItem(s, Math.max(1, Math.min(max, Math.floor(Number(qty.value) || 1)))); });
    const label = document.createElement('span');
    label.textContent = `${name}: quantos?`;
    this.qtyRow.replaceChildren(label, qty, ok);
    this.qtyRow.hidden = false;
    qty.focus(); qty.select();
  }

  set(v: TradeView) {
    const first = !this.view;
    this.view = v;
    this.setTitle(`Troca com ${v.name}`);
    this.themTitle.textContent = `Oferta de ${v.name}${v.lock[1] ? ' — OK' : ''}`;
    this.paintGrid(this.themGrid, v.them.items);
    this.paintGrid(this.meGrid, v.me.items);
    this.themGold.value = v.them.gold.toLocaleString('pt-BR');
    if (document.activeElement !== this.meGold) this.meGold.value = v.me.gold ? String(v.me.gold) : '';
    this.meGold.disabled = v.lock[0];
    this.themGrid.classList.toggle('locked', v.lock[1]);
    this.meGrid.classList.toggle('locked', v.lock[0]);
    this.lockBtn.disabled = v.lock[0];
    this.okBtn.disabled = !(v.lock[0] && v.lock[1]) || v.ok[0];
    this.status.textContent = v.ok[0] && !v.ok[1] ? `Esperando ${v.name} confirmar…`
      : v.ok[1] && !v.ok[0] ? `${v.name} confirmou. Clique em Trocar.`
      : v.lock[0] && v.lock[1] ? 'Os dois deram OK. Confira e clique em Trocar.'
      : v.lock[0] ? `Esperando ${v.name} dar OK…`
      : v.lock[1] ? `${v.name} deu OK. Confira e dê OK também.`
      : 'Arraste itens da bolsa para cá. Clique num item seu para tirar.';
    if (first) this.show();
  }

  /** a troca fechou (cancelada, concluída…) */
  close() {
    this.view = null;
    this.qtyRow.hidden = true;
    hideItemTip();
    this.hide();
  }

  private paintGrid(grid: HTMLElement, items: TradeItem[]) {
    grid.querySelectorAll<HTMLElement>('.inv-slot').forEach((el, i) => {
      const t = items[i];
      el.replaceChildren();
      el.classList.toggle('has', !!t);
      if (!t) { el.removeAttribute('aria-label'); return; }
      el.setAttribute('aria-label', `${t.d.name}${t.it.u ? ` +${t.it.u}` : ''}${t.it.n > 1 ? ` ×${t.it.n}` : ''}`);
      const img = document.createElement('img');
      img.alt = '';
      img.draggable = false;
      void itemIcon(t.d.icon).then((u) => { if (u) img.src = u; });
      el.append(img);
      if (t.it.n > 1) { const n = document.createElement('b'); n.textContent = String(t.it.n); el.append(n); }
      if (t.it.u) { const u = document.createElement('i'); u.className = 'up'; u.textContent = `+${t.it.u}`; el.append(u); }
      if (t.it.e) { const e = document.createElement('i'); e.className = `elem e${t.it.e}`; el.append(e); }
    });
  }

  private bindTips(grid: HTMLElement, list: () => TradeItem[]) {
    grid.addEventListener('mousemove', (e) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>('[data-i]');
      const t = el && list()[Number(el.dataset.i)];
      if (!t) { hideItemTip(); return; }
      if (!document.querySelector('.item-tip-layer')) showItemTip(e, t.d, t.it, ELEMENT_NAMES); else moveItemTip(e);
    });
    grid.addEventListener('mouseleave', hideItemTip);
    grid.addEventListener('mouseout', (e) => { if ((e.target as HTMLElement).closest('[data-i]') !== (e.relatedTarget as HTMLElement | null)?.closest('[data-i]')) hideItemTip(); });
  }
}
