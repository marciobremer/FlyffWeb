import { itemIcon, themeImage } from '../shared/tga';
import { ELEMENT_NAMES, GameWindow } from './ui';
import type { ItemView } from './net';
import { hideItemTip, moveItemTip, showItemTip } from './itemtip';
import { gradeOf } from '../shared/grade';

/**
 * Wikipedia de itens (tecla Y ou /wiki): o catálogo do servidor organizado como no cliente original — árvore de categorias à
 * esquerda, lista no meio (ícone, nome, nível; botões Item Name / Job / Level ordenam) e filtros à direita (busca, classe,
 * sexo e faixa de nível). A lista vem do servidor por páginas e carrega mais ao rolar; passar o mouse mostra a dica completa
 * do item. Qualquer jogador abre; o painel de GM (//gm) usa a mesma janela para escolher o item a criar.
 */
export interface WikiRow { id: number; sym: string; name: string; icon: string; lv: number; job: number; sex: number; k1: number; parts: number; pack: number; gr: number }

/** [id, rótulo, filhos?] — a árvore da janela (os ids são os do servidor, `ItemCatalog.wikiInCategory`) */
const TREE: [string, string, [string, string][]?][] = [
  ['all', 'All Items'], ['weapons', 'Weapons'], ['sets', 'Sets'], ['jewelry', 'Jewelry'], ['cs', 'CS Shop'], ['othercs', 'Other CS'], ['pets', 'Pets'], ['furniture', 'Furniture'],
  ['other', 'Other', [['cards', 'Cards'], ['beads', 'Beads'], ['gems', 'Gems'], ['tickets', 'Tickets'], ['powerup', 'Power-Up'], ['food', 'Food']]],
];
/** classes do filtro (valor = JOB_*; -1 = todas) */
const JOB_OPTIONS: [number, string][] = [[-1, 'All'], [0, 'Vagrant'], [1, 'Mercenary'], [2, 'Acrobat'], [3, 'Assist'], [4, 'Magician'], [6, 'Knight'], [7, 'Blade'], [8, 'Jester'], [9, 'Ranger'], [10, 'Ringmaster'], [11, 'Billposter'], [12, 'Psykeeper'], [13, 'Elementor']];
const SEX_OPTIONS: [number, string][] = [[-1, 'All'], [0, 'Male'], [1, 'Female']];
const PAGE = 40;

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, unknown> = {}, ...kids: (Node | string)[]): HTMLElementTagNameMap[K] => {
  const e = Object.assign(document.createElement(tag), props) as HTMLElementTagNameMap[K];
  e.append(...kids);
  return e;
};

export class WikiWindow extends GameWindow {
  /** pede uma página ao servidor (false = desconectado) */
  query: (p: { req: number; q: string; cat: string; job: number; sex: number; lo: number; hi: number; sort: string; desc: boolean; off: number; n: number }) => boolean = () => false;
  /** pede a dica completa de um item */
  tipFor: (id: number) => void = () => {};
  /** clique / duplo clique numa linha (o painel de GM usa para escolher e criar o item) */
  onPick: (row: WikiRow) => void = () => {};
  onActivate: (row: WikiRow) => void = () => {};

  private cat = 'all';
  private sort = 'name';
  private desc = false;
  private req = 0;
  private rows: WikiRow[] = [];
  private total = 0;
  private loading = false;
  private picked = 0;
  private list = el('ul', { className: 'wk-list' });
  private count = el('div', { className: 'wk-count' });
  private tree = el('ul', { className: 'wk-tree' });
  private q = el('input', { className: 'wk-in', type: 'search', placeholder: 'Search…', maxLength: 40 });
  private job = el('select', { className: 'wk-in' });
  private sex = el('select', { className: 'wk-in' });
  private lo = el('input', { className: 'wk-in num', type: 'number', min: '0', max: '999', value: '1' });
  private hi = el('input', { className: 'wk-in num', type: 'number', min: '0', max: '999', value: '175' });
  private tips = new Map<number, ItemView>();
  private tipWanted = 0;
  private timer = 0;
  private sortBtns = new Map<string, HTMLButtonElement>();

  constructor(parent: HTMLElement) {
    super(parent, { id: 'wikiWnd', title: 'Wikipedia - Items', store: 'flyff.wnd.wiki', initial: { x: 120, y: 60, w: 760, h: 540 }, min: { w: 600, h: 380 } });
    const b = this.body;
    b.classList.add('wk');

    // ---- árvore de categorias ----
    const treeWrap = el('div', { className: 'wk-left' }, this.tree);
    const addNode = (id: string, label: string, depth: number, expandable: boolean) => {
      const li = el('li', { className: `d${depth}` });
      li.dataset.cat = id;
      li.setAttribute('role', 'treeitem');
      li.append(el('i', { className: expandable ? 'dot open' : 'dot' }), el('span', { textContent: label }));
      li.addEventListener('click', () => this.setCat(id));
      this.tree.append(li);
    };
    for (const [id, label, kids] of TREE) {
      addNode(id, label, 0, id === 'all' || !!kids);
      for (const [kid, klabel] of kids ?? []) addNode(kid, klabel, 1, false);
    }

    // ---- centro: botões de ordenação + lista ----
    const heads = el('div', { className: 'wk-heads' });
    for (const [key, label] of [['name', 'Item Name'], ['job', 'Job'], ['level', 'Level']] as const) {
      const btn = el('button', { type: 'button', className: `wk-head ${key}`, textContent: label });
      btn.setAttribute('aria-label', `Ordenar por ${label}`);
      btn.addEventListener('click', () => { if (this.sort === key) this.desc = !this.desc; else { this.sort = key; this.desc = false; } this.refresh(); this.markSort(); });
      this.sortBtns.set(key, btn);
      heads.append(btn);
    }
    const bar = el('div', { className: 'wk-bar' });
    for (const [dir, file] of [['up', 'ButtUp.tga'], ['down', 'ButtDown.tga']] as const) {
      const a = el('button', { type: 'button', className: `wk-arrow ${dir}` });
      a.setAttribute('aria-label', dir === 'up' ? 'Rolar para cima' : 'Rolar para baixo');
      void themeImage(file).then((u) => { if (u) a.style.backgroundImage = `url(${u})`; });
      a.addEventListener('click', () => this.list.scrollBy({ top: dir === 'up' ? -120 : 120, behavior: 'smooth' }));
      bar.append(a);
    }
    const center = el('div', { className: 'wk-mid' }, heads, el('div', { className: 'wk-listbox' }, this.list, bar), this.count);
    this.list.setAttribute('role', 'listbox');
    this.list.setAttribute('aria-label', 'Itens');

    // ---- filtros ----
    for (const [v, t] of JOB_OPTIONS) this.job.append(el('option', { value: String(v), textContent: t }));
    for (const [v, t] of SEX_OPTIONS) this.sex.append(el('option', { value: String(v), textContent: t }));
    const reset = el('button', { type: 'button', className: 'wk-reset', textContent: 'Reset' });
    reset.addEventListener('click', () => { this.q.value = ''; this.job.value = '-1'; this.sex.value = '-1'; this.lo.value = '1'; this.hi.value = '175'; this.refresh(); });
    const right = el('div', { className: 'wk-right' },
      el('h4', { textContent: 'Search' }), this.q,
      el('h4', { textContent: 'Item Category' }), this.job,
      el('h4', { textContent: 'Sex' }), this.sex,
      el('h4', { textContent: 'Level Range' }), el('div', { className: 'wk-range' }, this.lo, el('span', { textContent: '-' }), this.hi),
      reset);
    for (const input of [this.q, this.lo, this.hi]) {
      input.addEventListener('keydown', (e) => e.stopPropagation()); // as teclas do jogo não valem enquanto digita
      input.addEventListener('input', () => { clearTimeout(this.timer); this.timer = window.setTimeout(() => this.refresh(), 250); });
    }
    this.job.addEventListener('change', () => this.refresh());
    this.sex.addEventListener('change', () => this.refresh());

    // ---- lista: carrega mais ao rolar, dica ao passar o mouse, clique escolhe ----
    this.list.addEventListener('scroll', () => { if (this.list.scrollTop + this.list.clientHeight > this.list.scrollHeight - 80) this.more(); });
    this.list.addEventListener('click', (e) => { const r = this.rowOf(e); if (r) { this.picked = r.id; this.markPicked(); this.onPick(r); } });
    this.list.addEventListener('dblclick', (e) => { const r = this.rowOf(e); if (r) this.onActivate(r); });
    this.list.addEventListener('mousemove', (e) => {
      const r = this.rowOf(e);
      if (!r) { hideItemTip(); this.tipWanted = 0; return; }
      const v = this.tips.get(r.id);
      if (v) { if (this.tipWanted !== r.id) { this.tipWanted = r.id; showItemTip(e, v, { id: r.id, n: 1, u: 0, e: 0, el: 0 }, ELEMENT_NAMES); } else moveItemTip(e); return; }
      if (this.tipWanted !== r.id) { this.tipWanted = r.id; this.tipFor(r.id); }
    });
    this.list.addEventListener('mouseleave', () => { hideItemTip(); this.tipWanted = 0; });

    b.append(treeWrap, center, right);
    void themeImage('WndTabTile01.tga'); // pré-carrega o tema
    this.setCat('all');
    this.markSort();
  }

  override show() {
    super.show();
    if (!this.rows.length && !this.loading) this.refresh();
  }

  /** a dica completa chegou do servidor */
  setTip(v: ItemView, ev?: { clientX: number; clientY: number }) {
    this.tips.set(v.id, v);
    if (this.tipWanted === v.id && ev) showItemTip(ev, v, { id: v.id, n: 1, u: 0, e: 0, el: 0 }, ELEMENT_NAMES);
    else if (this.tipWanted === v.id && this.lastMove) showItemTip(this.lastMove, v, { id: v.id, n: 1, u: 0, e: 0, el: 0 }, ELEMENT_NAMES);
  }
  private lastMove: { clientX: number; clientY: number } | null = null;

  private rowOf(e: Event) {
    const li = (e.target as HTMLElement).closest<HTMLLIElement>('li[data-i]');
    if (e instanceof MouseEvent) this.lastMove = { clientX: e.clientX, clientY: e.clientY };
    return li ? this.rows[Number(li.dataset.i)] : undefined;
  }

  private setCat(id: string) {
    this.cat = id;
    for (const li of this.tree.querySelectorAll<HTMLLIElement>('li')) li.classList.toggle('on', li.dataset.cat === id);
    this.refresh();
  }

  private markSort() {
    for (const [k, btn] of this.sortBtns) { btn.classList.toggle('on', k === this.sort); btn.classList.toggle('desc', k === this.sort && this.desc); }
  }

  private markPicked() {
    for (const li of this.list.querySelectorAll<HTMLLIElement>('li[data-i]')) li.classList.toggle('on', this.rows[Number(li.dataset.i)]?.id === this.picked);
  }

  /** recomeça a lista (filtro, categoria ou ordem mudou) */
  refresh() {
    this.rows = [];
    this.total = 0;
    this.list.replaceChildren();
    this.list.scrollTop = 0;
    this.count.textContent = '…';
    this.fetch(0);
  }

  private more() {
    if (this.loading || this.rows.length >= this.total) return;
    this.fetch(this.rows.length);
  }

  private fetch(off: number) {
    const req = ++this.req;
    this.loading = true;
    const ok = this.query({ req, q: this.q.value, cat: this.cat, job: Number(this.job.value), sex: Number(this.sex.value), lo: Number(this.lo.value) || 0, hi: Number(this.hi.value) || 0, sort: this.sort, desc: this.desc, off, n: PAGE });
    if (!ok) { this.loading = false; this.count.textContent = 'Sem conexão com o servidor.'; }
  }

  /** uma página chegou: [id, símbolo, nome, ícone, nível, classe, sexo, k1, parts, pack, raridade][] */
  setPage(m: { req: number; off: number; total: number; rows: (number | string)[][] }) {
    if (m.req !== this.req) return; // uma busca mais nova já saiu
    this.loading = false;
    this.total = m.total;
    const start = this.rows.length;
    if (m.off !== start) return;
    const frag = document.createDocumentFragment();
    m.rows.forEach((r, k) => {
      const row: WikiRow = { id: r[0] as number, sym: r[1] as string, name: r[2] as string, icon: r[3] as string, lv: r[4] as number, job: r[5] as number, sex: r[6] as number, k1: r[7] as number, parts: r[8] as number, pack: r[9] as number, gr: r[10] as number };
      this.rows.push(row);
      const img = el('img', { alt: '', width: 32, height: 32 });
      void itemIcon(row.icon).then((u) => { if (u) img.src = u; });
      const li = el('li', {}, img, el('span', { className: `nm ${gradeOf(row.gr).cls}`, textContent: row.name }), el('span', { className: 'lv', textContent: row.lv ? String(row.lv) : '' }));
      li.dataset.i = String(start + k);
      li.setAttribute('role', 'option');
      if (row.id === this.picked) li.classList.add('on');
      frag.append(li);
    });
    this.list.append(frag);
    this.count.textContent = this.total ? `${this.rows.length} / ${this.total}` : 'Nenhum item encontrado.';
    if (this.rows.length < this.total && this.list.scrollHeight <= this.list.clientHeight + 40) this.more(); // lista curta: completa a tela
  }
}
