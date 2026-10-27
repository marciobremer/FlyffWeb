import { itemIcon } from '../shared/tga';
import { FILTER_GROUPS, RARITY_NAMES, emptyPetFilter, type PetFilter } from '../shared/petfilter';
import { GameWindow } from './ui';

/**
 * Janela Pet Filter (tecla U), como a do Titanium (__SYS_PETFILTER): aba Filtros, com o que o pet NÃO deve pegar (marcar =
 * não pega) e a raridade mínima de arma e armadura; aba Listas, com a lista branca (pega sempre) e a negra (nunca pega).
 * "Salvar" manda ao servidor, que grava no personagem.
 */
export class PetFilterWindow extends GameWindow {
  onSave: (f: PetFilter) => void = () => {};
  onFind: (q: string) => void = () => {};
  private f: PetFilter = emptyPetFilter();
  private names = new Map<number, [string, string]>();
  private checks: [HTMLInputElement, number][] = [];
  private wr = document.createElement('select');
  private ar = document.createElement('select');
  private pages: HTMLElement[] = [];
  private tabs: HTMLButtonElement[] = [];
  private search = document.createElement('input');
  private results = document.createElement('ul');
  private lists: Record<'white' | 'black', HTMLUListElement> = { white: document.createElement('ul'), black: document.createElement('ul') };
  private picked: number | null = null;
  private selected: Record<'white' | 'black', number | null> = { white: null, black: null };
  private findTimer = 0;
  private status = document.createElement('p');

  constructor(parent: HTMLElement) {
    super(parent, { id: 'petFilterWnd', title: 'Pet Filter', store: 'flyff.wnd.petfilter', initial: { x: 360, y: 120, w: 430, h: 470 }, min: { w: 380, h: 400 } });
    const b = this.body;
    b.classList.add('pf');
    const tabs = document.createElement('div');
    tabs.className = 'mot-tabs';
    tabs.setAttribute('role', 'tablist');
    for (const [i, label] of ['Filtros', 'Listas'].entries()) {
      const t = document.createElement('button');
      t.type = 'button';
      t.className = 'mot-tab';
      t.setAttribute('role', 'tab');
      t.textContent = label;
      t.addEventListener('click', () => this.tab(i));
      this.tabs.push(t);
      tabs.appendChild(t);
    }
    this.pages = [this.filtersPage(), this.listsPage()];
    this.status.className = 'pf-status';
    this.status.setAttribute('aria-live', 'polite');
    b.append(tabs, ...this.pages, this.status);
    this.tab(0);
  }

  private tab(i: number) {
    this.tabs.forEach((t, k) => { t.classList.toggle('on', k === i); t.setAttribute('aria-selected', String(k === i)); });
    this.pages.forEach((p, k) => { p.hidden = k !== i; });
  }

  private filtersPage() {
    const page = document.createElement('div');
    page.className = 'pf-page';
    const grid = document.createElement('div');
    grid.className = 'pf-grid';
    for (const [title, opts] of FILTER_GROUPS) {
      const g = document.createElement('fieldset');
      g.className = 'pf-group';
      const lg = document.createElement('legend');
      lg.textContent = title;
      g.appendChild(lg);
      // arma e armadura: raridade mínima no topo do grupo
      if (title === 'Arma' || title === 'Armadura') {
        const sel = title === 'Arma' ? this.wr : this.ar;
        sel.className = 'pf-rarity';
        sel.setAttribute('aria-label', `Raridade mínima (${title.toLowerCase()})`);
        sel.append(new Option('Qualquer raridade', '-1'), ...RARITY_NAMES.map((n, i) => new Option(`A partir de ${n}`, String(i))));
        g.appendChild(sel);
      }
      for (const [label, bit] of opts) {
        const l = document.createElement('label');
        const c = document.createElement('input');
        c.type = 'checkbox';
        this.checks.push([c, bit]);
        l.append(c, ` ${label}`);
        g.appendChild(l);
      }
      grid.appendChild(g);
    }
    const foot = document.createElement('p');
    foot.className = 'pf-note';
    foot.textContent = 'Marque o que o pet NÃO deve pegar.';
    const btns = document.createElement('div');
    btns.className = 'pf-btns';
    btns.append(
      this.button('Todos', () => this.checks.forEach(([c]) => { c.checked = true; })),
      this.button('Nenhum', () => this.checks.forEach(([c]) => { c.checked = false; })),
      this.button('Salvar', () => this.store()),
    );
    page.append(grid, foot, btns);
    return page;
  }

  private listsPage() {
    const page = document.createElement('div');
    page.className = 'pf-page pf-lists';
    this.search.type = 'search';
    this.search.placeholder = 'Buscar item para adicionar (nome ou II_…)';
    this.search.setAttribute('aria-label', 'Buscar item');
    this.search.addEventListener('input', () => {
      clearTimeout(this.findTimer);
      this.findTimer = window.setTimeout(() => this.onFind(this.search.value.trim()), 250);
    });
    this.results.className = 'pf-list pf-results';
    this.results.setAttribute('aria-label', 'Resultado da busca');
    const cols = document.createElement('div');
    cols.className = 'pf-cols';
    for (const which of ['white', 'black'] as const) {
      const col = document.createElement('fieldset');
      col.className = 'pf-group';
      const lg = document.createElement('legend');
      lg.textContent = which === 'white' ? 'Lista branca (pega sempre)' : 'Lista negra (nunca pega)';
      this.lists[which].className = 'pf-list';
      const btns = document.createElement('div');
      btns.className = 'pf-btns';
      btns.append(
        this.button('Adicionar', () => this.addTo(which)),
        this.button('Remover', () => this.removeFrom(which)),
      );
      col.append(lg, this.lists[which], btns);
      cols.appendChild(col);
    }
    page.append(this.search, this.results, cols);
    return page;
  }

  private button(label: string, fn: () => void) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'pf-btn';
    b.textContent = label;
    b.addEventListener('click', fn);
    return b;
  }

  /** filtro vindo do servidor (ao entrar e depois de salvar) */
  set(f: PetFilter, names: Record<number, [string, string]>) {
    this.f = { ...f, white: [...f.white], black: [...f.black] };
    for (const [id, n] of Object.entries(names)) this.names.set(Number(id), n);
    for (const [c, bit] of this.checks) c.checked = (f.bits & bit) !== 0;
    this.wr.value = String(f.wr);
    this.ar.value = String(f.ar);
    this.renderLists();
  }

  /** resultado da busca de itens */
  found(list: [number, string, string][]) {
    this.results.replaceChildren();
    this.picked = null;
    for (const [id, name, icon] of list) {
      this.names.set(id, [name, icon]);
      this.results.appendChild(this.row(id, () => this.picked, (v) => { this.picked = v; this.highlight(this.results, v); }));
    }
    if (!list.length && this.search.value.trim().length >= 2) {
      const li = document.createElement('li');
      li.className = 'pf-empty';
      li.textContent = 'Nenhum item encontrado.';
      this.results.appendChild(li);
    }
  }

  private row(id: number, get: () => number | null, pick: (id: number) => void) {
    const li = document.createElement('li');
    li.tabIndex = 0;
    li.dataset.id = String(id);
    li.setAttribute('aria-selected', String(get() === id));
    const [name, icon] = this.names.get(id) ?? [`Item ${id}`, ''];
    const img = document.createElement('img');
    img.alt = '';
    img.width = img.height = 20;
    if (icon) void itemIcon(icon).then((u) => { if (u) img.src = u; });
    li.append(img, name);
    li.addEventListener('click', () => pick(id));
    li.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(id); } });
    return li;
  }

  private highlight(ul: HTMLElement, id: number | null) {
    for (const li of ul.querySelectorAll<HTMLElement>('li[data-id]')) li.setAttribute('aria-selected', String(Number(li.dataset.id) === id));
  }

  private renderLists() {
    for (const which of ['white', 'black'] as const) {
      const ul = this.lists[which];
      ul.replaceChildren();
      if (this.selected[which] !== null && !this.f[which].includes(this.selected[which]!)) this.selected[which] = null;
      for (const id of this.f[which]) ul.appendChild(this.row(id, () => this.selected[which], (v) => { this.selected[which] = v; this.highlight(ul, v); }));
    }
  }

  private addTo(which: 'white' | 'black') {
    if (this.picked === null) { this.say('Busque um item e clique nele primeiro.'); return; }
    const other = which === 'white' ? 'black' : 'white', id = this.picked;
    this.f[other] = this.f[other].filter((x) => x !== id); // um item fica só numa das listas
    if (!this.f[which].includes(id)) this.f[which].push(id);
    this.renderLists();
    this.store();
  }

  private removeFrom(which: 'white' | 'black') {
    const id = this.selected[which];
    if (id === null) { this.say('Clique em um item da lista primeiro.'); return; }
    this.f[which] = this.f[which].filter((x) => x !== id);
    this.renderLists();
    this.store();
  }

  private store() {
    let bits = 0;
    for (const [c, bit] of this.checks) if (c.checked) bits |= bit;
    this.f = { ...this.f, bits, wr: Number(this.wr.value), ar: Number(this.ar.value) };
    this.onSave(this.f);
    this.say('Filtro salvo.');
  }

  private say(text: string) {
    this.status.textContent = text;
    clearTimeout(Number(this.status.dataset.t));
    this.status.dataset.t = String(window.setTimeout(() => { this.status.textContent = ''; }, 2500));
  }
}
