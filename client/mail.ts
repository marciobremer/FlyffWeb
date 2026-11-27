import { itemIcon } from '../shared/tga';
import { hideItemTip, moveItemTip, showItemTip } from './itemtip';
import { t, tr, trAttr } from './lang';
import { ELEMENT_NAMES, GameWindow, invItem, type InvDef, type InvItem, type InvRow } from './ui';
import './mail.css';

/**
 * Correio (Post Box do FlyFF): aba Receber (cartas, com item e penya para pegar) e aba Enviar (destinatário, título, texto,
 * uma pilha de item da bolsa e penya). O servidor confere tudo; a janela só desenha o que ele manda.
 */
export interface MailData { list: { id: number; from: string; title: string; body: string; gold: number; read: boolean; at: number; item: InvRow | null }[]; defs: Record<number, InvDef>; postage: number; sent?: number }
export interface MailDraft { to: string; title: string; body: string; s: number; n: number; gold: number }

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '') => { const x = document.createElement(tag); if (cls) x.className = cls; return x; };
const button = (text: string, run: () => void, cls = 'gm-btn') => { const x = el('button', cls); x.type = 'button'; tr(x, text); x.addEventListener('click', run); return x; };

export class MailWindow extends GameWindow {
  /** chave da caixa de correio que abriu ('' = menu, mensageiro, GM/Premium) */
  npc = '';
  onSend: (d: MailDraft) => void = () => {};
  onTake: (id: number, what: 'item' | 'gold') => void = () => {};
  onRead: (id: number) => void = () => {};
  onDelete: (id: number) => void = () => {};
  /** item da bolsa (para o anexo): nome, ícone e quantidade */
  bagItem: (slot: number) => { id: number; name: string; icon: string; n: number } | null = () => null;

  private data: MailData = { list: [], defs: {}, postage: 500 };
  private tab: 'in' | 'out' = 'in';
  private open = 0;
  private tabs = new Map<string, HTMLButtonElement>();
  private inbox = el('div', 'ml-page');
  private list = el('div', 'ml-list');
  private view = el('div', 'ml-view');
  private form = el('form', 'ml-page ml-form');
  private to = el('input');
  private subject = el('input');
  private text = el('textarea');
  private gold = el('input');
  private slot = el('div', 'inv-slot ml-slot');
  private count = el('input', 'ml-count');
  private attached: { s: number; id: number; n: number } | null = null;
  private cost = el('p', 'ml-cost');

  constructor(parent: HTMLElement) {
    super(parent, { id: 'mailWnd', title: 'Correio', store: 'flyff.wnd.mail', initial: { x: 320, y: 120, w: 320, h: 400 }, min: { w: 320, h: 400 }, resizable: false });
    const b = this.body;
    b.classList.add('ml');
    const bar = el('div', 'ml-tabs');
    for (const [id, label] of [['in', 'Receber'], ['out', 'Enviar']] as const) {
      const x = button(label, () => this.show_(id), '');
      this.tabs.set(id, x);
      bar.appendChild(x);
    }
    this.inbox.append(this.list, this.view);
    this.buildForm();
    b.append(bar, this.inbox, this.form);
    this.show_('in');
  }

  private buildForm() {
    const field = (label: string, input: HTMLInputElement | HTMLTextAreaElement, max: number) => {
      const l = el('label');
      const s = el('span'); tr(s, label);
      input.maxLength = max;
      l.append(s, input);
      return l;
    };
    this.text.rows = 5;
    this.gold.type = 'number'; this.gold.min = '0'; this.gold.value = '';
    this.count.type = 'number'; this.count.min = '1'; this.count.hidden = true;
    trAttr(this.count, 'aria-label', 'Quantidade');
    const attach = el('div', 'ml-attach');
    const hint = el('span'); tr(hint, 'Arraste um item da bolsa');
    attach.append(this.slot, this.count, hint);
    this.slot.addEventListener('dragover', (e) => { if (e.dataTransfer?.types.includes('application/x-flyff-item')) e.preventDefault(); });
    this.slot.addEventListener('drop', (e) => {
      e.preventDefault();
      try {
        const it = JSON.parse(e.dataTransfer!.getData('application/x-flyff-item')) as { c: number; s: number };
        if (it.c === 0) this.attach(it.s);
      } catch { /* arrasto que não é item */ }
    });
    this.slot.addEventListener('dblclick', () => this.attach(-1));
    trAttr(this.slot, 'title', 'Duplo clique tira o item');
    const send = el('button', 'gm-btn'); send.type = 'submit'; tr(send, 'Enviar carta');
    this.form.append(field('Para', this.to, 24), field('Título', this.subject, 32), field('Mensagem', this.text, 256), attach, field('Penya', this.gold, 10), this.cost, send);
    this.form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (!this.to.value.trim()) { this.to.focus(); return; }
      if (!this.subject.value.trim()) { this.subject.focus(); return; }
      const n = this.attached ? Math.max(1, Math.min(this.attached.n, Math.floor(Number(this.count.value)) || this.attached.n)) : 0;
      this.onSend({ to: this.to.value.trim(), title: this.subject.value.trim(), body: this.text.value, s: this.attached?.s ?? -1, n, gold: Math.max(0, Math.floor(Number(this.gold.value)) || 0) });
    });
    this.gold.addEventListener('input', () => this.paintCost());
    this.paintCost();
  }

  private paintCost() {
    const g = Math.max(0, Math.floor(Number(this.gold.value)) || 0);
    this.cost.textContent = t('Custo do envio: {n} penya', { n: (this.data.postage + g).toLocaleString('pt-BR') });
  }

  /** anexa o item do espaço da bolsa (-1 tira o anexo) */
  attach(slot: number) {
    const it = slot >= 0 ? this.bagItem(slot) : null;
    this.attached = it ? { s: slot, id: it.id, n: it.n } : null;
    this.slot.replaceChildren();
    this.slot.classList.toggle('has', !!it);
    this.count.hidden = !it || it.n <= 1;
    if (!it) return;
    this.count.max = String(it.n);
    this.count.value = String(it.n);
    const img = el('img');
    img.alt = it.name; img.title = it.name;
    if (it.icon) void itemIcon(it.icon).then((u) => { if (u) img.src = u; });
    this.slot.appendChild(img);
  }

  /** o inventário mudou: o anexo some se o item saiu do espaço */
  refreshAttachment() {
    if (!this.attached) return;
    const it = this.bagItem(this.attached.s);
    if (!it || it.id !== this.attached.id) this.attach(-1);
    else if (it.n !== this.attached.n) this.attach(this.attached.s);
  }

  /** está na aba Enviar (o duplo clique num item da bolsa anexa) */
  get composing() { return this.visible && this.tab === 'out'; }

  private show_(tab: 'in' | 'out') {
    this.tab = tab;
    for (const [id, x] of this.tabs) x.classList.toggle('on', id === tab);
    this.inbox.hidden = tab !== 'in';
    this.form.hidden = tab !== 'out';
    hideItemTip();
  }

  set(d: MailData) {
    this.data = d;
    if (d.sent) { this.form.reset(); this.attach(-1); this.show_('in'); }
    if (!d.list.some((m) => m.id === this.open)) this.open = 0;
    this.render();
    this.paintCost();
  }

  override hide() { hideItemTip(); super.hide(); }

  private render() {
    hideItemTip();
    const rows = this.data.list.map((m) => {
      const x = el('button', 'ml-row');
      x.type = 'button';
      x.classList.toggle('new', !m.read);
      x.classList.toggle('on', m.id === this.open);
      const who = el('b'); who.textContent = m.from;
      const title = el('span'); title.textContent = m.title;
      const has = el('i'); has.textContent = [m.item ? '📦' : '', m.gold ? '💰' : ''].join('');
      x.append(who, title, has);
      x.addEventListener('click', () => { this.open = m.id; this.render(); if (!m.read) this.onRead(m.id); });
      return x;
    });
    if (!rows.length) { const p = el('p', 'ml-empty'); tr(p, 'Nenhuma carta.'); this.list.replaceChildren(p); } else this.list.replaceChildren(...rows);
    this.renderOpen();
  }

  private renderOpen() {
    const m = this.data.list.find((x) => x.id === this.open);
    this.view.hidden = !m;
    this.view.replaceChildren();
    if (!m) return;
    const head = el('p', 'ml-head');
    head.textContent = `${m.from} · ${new Date(m.at).toLocaleDateString('pt-BR')} · ${m.title}`;
    const body = el('p', 'ml-body');
    body.textContent = m.body;
    const foot = el('div', 'ml-foot');
    if (m.item) {
      const it: InvItem = invItem(m.item), d = this.data.defs[it.id];
      const cell = el('div', 'inv-slot has ml-slot');
      const img = el('img');
      img.alt = d?.name ?? `item ${it.id}`;
      if (d?.icon) void itemIcon(d.icon).then((u) => { if (u) img.src = u; });
      cell.appendChild(img);
      const tag = [it.u ? `+${it.u}` : '', it.n > 1 ? String(it.n) : ''].filter(Boolean).join(' ');
      if (tag) { const n = el('b'); n.textContent = tag; cell.appendChild(n); }
      if (d) {
        cell.addEventListener('mouseenter', (ev) => showItemTip(ev, d, it, ELEMENT_NAMES));
        cell.addEventListener('mousemove', moveItemTip);
        cell.addEventListener('mouseleave', hideItemTip);
      }
      foot.append(cell, button('Receber item', () => this.onTake(m.id, 'item')));
    }
    if (m.gold) {
      const g = button('Receber penya', () => this.onTake(m.id, 'gold'));
      const v = el('span'); v.textContent = `${m.gold.toLocaleString('pt-BR')} penya`;
      foot.append(v, g);
    }
    const reply = button('Responder', () => { this.to.value = m.from; this.subject.value = `Re: ${m.title}`.slice(0, 32); this.show_('out'); this.text.focus(); });
    const del = button('Apagar', () => this.onDelete(m.id));
    del.disabled = !!m.item || !!m.gold;
    const actions = el('div', 'ml-actions');
    actions.append(reply, del);
    this.view.append(head, body, foot, actions);
  }
}
