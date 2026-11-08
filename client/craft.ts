import { itemIcon } from '../shared/tga';
import { GameWindow } from './ui';
import './craft.css';

/**
 * Janela de craft (tecla B ou /craft; WndAegonCrafting do original): categorias à esquerda, receitas no meio (busca no alto) e,
 * à direita, o resultado, os componentes (o que tem / o que precisa) e o botão Craft, que espera o tempo da receita antes de pedir
 * ao servidor. No alto, o nível de craft e a barra de experiência. As receitas, o nível e o que a bolsa tem vêm do servidor.
 */
type Item = readonly [id: number, n: number, name: string, icon: string];
export interface CraftRecipe { id: number; name: string; cat: string; desc: string; time: number; exp: number; lv: number; rec: number; res: Item; comps: Item[] }
export interface CraftStatus { lvl: number; exp: number; lo: number; hi: number; have: Record<number, number> }

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, unknown> = {}, ...kids: (Node | string)[]): HTMLElementTagNameMap[K] => {
  const e = Object.assign(document.createElement(tag), props) as HTMLElementTagNameMap[K];
  e.append(...kids);
  return e;
};

export class CraftWindow extends GameWindow {
  /** pede as receitas e o estado ao servidor (false = desconectado) */
  request: () => boolean = () => false;
  /** pede o craft da receita (false = desconectado) */
  doCraft: (id: number) => boolean = () => false;
  /** mensagem de aviso (o chat do jogo) */
  notify: (text: string) => void = () => {};

  private recipes: CraftRecipe[] = [];
  private st: CraftStatus = { lvl: 1, exp: 0, lo: 0, hi: 0, have: {} };
  private cat = '';
  private sel = 0;
  private busy: { id: number; until: number } | null = null;
  private timer = 0;
  private levelEl = el('div', { className: 'cr-level' });
  private expFill = el('i');
  private expText = el('span');
  private cats = el('ul', { className: 'cr-cats' });
  private list = el('ul', { className: 'cr-list' });
  private q = el('input', { className: 'cr-q', type: 'search', placeholder: 'Search…', maxLength: 32 });
  private detail = el('div', { className: 'cr-detail' });

  constructor(parent: HTMLElement) {
    super(parent, { id: 'craftWnd', title: 'Crafting', store: 'flyff.wnd.craft', initial: { x: 160, y: 70, w: 780, h: 500 }, min: { w: 640, h: 360 } });
    const b = this.body;
    b.classList.add('cr');
    const bar = el('div', { className: 'cr-exp' }, this.expFill, this.expText);
    b.append(el('div', { className: 'cr-head' }, this.levelEl, bar));
    this.q.addEventListener('input', () => this.paintList());
    this.q.addEventListener('keydown', (e) => e.stopPropagation());
    b.append(el('div', { className: 'cr-main' }, el('div', { className: 'cr-left' }, this.cats), el('div', { className: 'cr-mid' }, this.q, this.list), this.detail));
  }

  override show() {
    super.show();
    if (!this.request()) this.notify('Sem conexão com o servidor.');
  }

  /** receitas + estado (mensagem `craft`) */
  setAll(recipes: CraftRecipe[], st: CraftStatus) {
    this.recipes = recipes;
    if (!this.cat || !recipes.some((r) => r.cat === this.cat)) this.cat = recipes[0]?.cat ?? '';
    this.setStatus(st);
    this.paintCats();
    this.paintList();
  }

  /** estado novo (mensagem `craftResult`/`craft`): nível, experiência e o que a bolsa tem */
  setStatus(st: Partial<CraftStatus>) {
    this.st = { ...this.st, ...st };
    const { lvl, exp, lo, hi } = this.st;
    this.levelEl.textContent = `Crafting Level ${lvl}`;
    const k = hi > lo ? Math.min(1, (exp - lo) / (hi - lo)) : 1;
    this.expFill.style.width = `${k * 100}%`;
    this.expText.textContent = hi > lo ? `${exp} / ${hi}` : `${exp} (max)`;
    this.paintList();
    this.paintDetail();
  }

  /** resposta do pedido de craft */
  result(ok: boolean, text: string) {
    this.stopBusy();
    if (!ok && text) this.notify(text);
    this.paintDetail();
  }

  private paintCats() {
    const cats: string[] = [];
    for (const r of this.recipes) if (!cats.includes(r.cat)) cats.push(r.cat);
    cats.sort((a, b) => (a.includes('Recycl') ? 1 : 0) - (b.includes('Recycl') ? 1 : 0)); // a reciclagem fica por último
    this.cats.replaceChildren(...cats.map((c) => {
      const li = el('li', { textContent: c, className: c === this.cat ? 'on' : '' });
      li.addEventListener('click', () => { this.cat = c; this.q.value = ''; this.paintCats(); this.paintList(); });
      return li;
    }));
  }

  private canMake(r: CraftRecipe) { return r.lv <= this.st.lvl && r.comps.every((c) => (this.st.have[c[0]] ?? 0) >= c[1]); }

  private paintList() {
    const q = this.q.value.trim().toLowerCase();
    const rows = this.recipes.filter((r) => (q ? r.name.toLowerCase().includes(q) || r.res[2].toLowerCase().includes(q) : r.cat === this.cat));
    this.list.replaceChildren(...rows.map((r) => {
      const li = el('li', { className: `${r.id === this.sel ? 'on ' : ''}${r.lv > this.st.lvl ? 'locked ' : ''}${this.canMake(r) ? 'can' : ''}` });
      const img = el('img', { alt: '', draggable: false });
      void itemIcon(r.res[3]).then((u) => { if (u) img.src = u; });
      li.append(img, el('b', { textContent: r.rec ? r.res[2] : r.name }), el('span', { textContent: `Lv ${r.lv}` }));
      li.addEventListener('click', () => { this.sel = r.id; this.paintList(); this.paintDetail(); });
      return li;
    }));
    if (!rows.length) this.list.append(el('li', { className: 'none', textContent: 'Nothing found' }));
  }

  private item(it: Item, have?: number) {
    const img = el('img', { alt: '', draggable: false });
    void itemIcon(it[3]).then((u) => { if (u) img.src = u; });
    const missing = have !== undefined && have < it[1];
    return el('div', { className: `cr-item${missing ? ' miss' : ''}`, title: it[2] }, img,
      el('span', { className: 'nm', textContent: it[2] }),
      el('span', { className: 'n', textContent: have === undefined ? (it[1] > 1 ? `×${it[1]}` : '') : `${have} / ${it[1]}` }));
  }

  private paintDetail() {
    const r = this.recipes.find((x) => x.id === this.sel);
    if (!r) { this.detail.replaceChildren(el('p', { className: 'hint', textContent: 'Choose a recipe.' })); return; }
    const can = this.canMake(r), busy = !!this.busy;
    const btn = el('button', { type: 'button', className: 'cr-go', textContent: busy ? 'Crafting…' : 'Craft', disabled: !can || busy });
    btn.addEventListener('click', () => this.start(r));
    const prog = el('div', { className: 'cr-prog' }, el('i'));
    prog.hidden = !busy;
    this.detail.replaceChildren(
      el('h3', { textContent: r.rec ? 'Recycling' : r.name }),
      el('p', { className: 'desc', textContent: r.desc }),
      el('h4', { textContent: 'Result' }), this.item(r.res),
      el('h4', { textContent: 'Materials' }), ...r.comps.map((c) => this.item(c, this.st.have[c[0]] ?? 0)),
      el('div', { className: 'cr-meta' },
        el('span', { className: r.lv > this.st.lvl ? 'bad' : '', textContent: `Crafting level ${r.lv}` }),
        el('span', { textContent: `${r.time} s` }), el('span', { textContent: `+${r.exp} exp` })),
      prog, btn,
    );
  }

  /** começa o craft: espera o tempo da receita e pede ao servidor (o servidor confere de novo) */
  private start(r: CraftRecipe) {
    if (this.busy || !this.canMake(r)) return;
    const ms = Math.max(0, r.time) * 1000, t0 = performance.now();
    this.busy = { id: r.id, until: t0 + ms };
    this.paintDetail();
    const tick = () => {
      const k = ms > 0 ? Math.min(1, (performance.now() - t0) / ms) : 1;
      const fill = this.detail.querySelector<HTMLElement>('.cr-prog i');
      if (fill) fill.style.width = `${k * 100}%`;
      if (k >= 1) {
        this.timer = 0;
        if (!this.doCraft(r.id)) { this.notify('Sem conexão com o servidor.'); this.stopBusy(); this.paintDetail(); }
        return;
      }
      this.timer = requestAnimationFrame(tick);
    };
    this.timer = requestAnimationFrame(tick);
  }

  private stopBusy() { this.busy = null; if (this.timer) { cancelAnimationFrame(this.timer); this.timer = 0; } }
}
