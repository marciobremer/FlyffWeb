import type { Thumbs } from './thumbs';

/**
 * Lista "Elementos" do editor (a árvore da esquerda): tudo o que dá para colocar no mapa, num lugar só, como o Game elements do
 * ATools. Favoritos no topo; Objetos (mdlObj.inc) e NPCs (character.inc) em ordem alfabética por letra; Props 3D (.glb) por pasta.
 * Os grupos só desenham as linhas quando são abertos (são milhares de entradas) e a busca troca a árvore por uma lista plana.
 */
export type ItemKind = 'object' | 'npc' | 'prop';
export interface LibItem { kind: ItemKind; key: string; label: string }

const KINDS: { kind: ItemKind; title: string; icon: string }[] = [
  { kind: 'object', title: 'Objetos', icon: 'cube' },
  { kind: 'npc', title: 'NPCs', icon: 'user' },
  { kind: 'prop', title: 'Props 3D (.glb)', icon: 'prop' },
];
/** sem busca, no máximo isto por grupo aberto de uma vez; com busca, no máximo isto no total por tipo */
const SEARCH_CAP = 200;
const FAV_STORE = 'editor.favorites';

const svg = (id: string) => `<svg class="i" aria-hidden="true"><use href="#i-${id}"/></svg>`;
const idOf = (it: LibItem) => `${it.kind}:${it.key}`;

export class Library {
  onPick: (it: LibItem | null) => void = () => {};
  private items = new Map<ItemKind, LibItem[]>();
  private favs = new Set<string>();
  private active: string | null = null;
  private thumbObserver: IntersectionObserver;
  private query = '';
  /** itens favoritos que ainda existem (a lista de favoritos guarda só ids) */
  private byId = new Map<string, LibItem>();

  constructor(private root: HTMLElement, private search: HTMLInputElement, private thumbs: Thumbs) {
    try { for (const f of JSON.parse(localStorage.getItem(FAV_STORE) ?? '[]') as string[]) this.favs.add(f); } catch { /* sem armazenamento */ }
    this.thumbObserver = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        const el = e.target as HTMLElement;
        this.thumbObserver.unobserve(el);
        const file = el.dataset.file!;
        void this.thumbs.get(file).then((url) => {
          if (!url) return;
          const img = document.createElement('img');
          img.src = url; img.alt = ''; img.draggable = false;
          el.replaceChildren(img);
        });
      }
    }, { root, rootMargin: '120px' });
    search.addEventListener('input', () => { this.query = search.value.trim().toLowerCase(); this.render(); });
    root.addEventListener('click', (e) => this.click(e));
  }

  set(kind: ItemKind, list: LibItem[]) {
    this.items.set(kind, list);
    for (const it of list) this.byId.set(idOf(it), it);
    this.render();
  }

  setActive(it: LibItem | null) {
    this.active = it ? idOf(it) : null;
    for (const row of this.root.querySelectorAll<HTMLElement>('.row')) row.classList.toggle('on', row.dataset.id === this.active);
  }

  // ---------- desenho ----------
  private render() {
    const q = this.query;
    this.thumbObserver.disconnect();
    const frag = document.createDocumentFragment();
    const favs = [...this.favs].map((id) => this.byId.get(id)).filter((x): x is LibItem => !!x && (!q || x.label.toLowerCase().includes(q)));
    if (favs.length) frag.appendChild(this.section('Favoritos', 'star', favs.length, () => favs.map((it) => this.row(it)), true));
    for (const { kind, title, icon } of KINDS) {
      const all = this.items.get(kind) ?? [];
      if (!all.length) continue;
      if (q) {
        const hits = all.filter((it) => it.label.toLowerCase().includes(q) || it.key.toLowerCase().includes(q));
        if (!hits.length) continue;
        frag.appendChild(this.section(title, icon, hits.length, () => {
          const rows = hits.slice(0, SEARCH_CAP).map((it) => this.row(it));
          if (hits.length > SEARCH_CAP) rows.push(this.note(`Mostrando ${SEARCH_CAP} de ${hits.length}. Refine a busca.`));
          return rows;
        }, true));
      } else {
        frag.appendChild(this.section(title, icon, all.length, () => this.groups(kind, all), false));
      }
    }
    if (!frag.childNodes.length) frag.appendChild(this.note(q ? 'Nada com essa busca.' : 'Carregando a lista…'));
    this.root.replaceChildren(frag);
    this.setActive(this.active ? this.byId.get(this.active) ?? null : null);
  }

  /** sub-grupos de um tipo: props por pasta, o resto por letra inicial */
  private groups(kind: ItemKind, all: LibItem[]): HTMLElement[] {
    const map = new Map<string, LibItem[]>();
    for (const it of all) {
      const g = kind === 'prop' ? (it.key.includes('/') ? it.key.slice(0, it.key.lastIndexOf('/')) : 'Raiz') : (/^[a-z0-9]/i.test(it.label) ? it.label[0].toUpperCase() : '#');
      (map.get(g) ?? map.set(g, []).get(g)!).push(it);
    }
    const names = [...map.keys()].sort((a, b) => (a === 'Raiz' ? -1 : b === 'Raiz' ? 1 : a.localeCompare(b)));
    return names.map((g) => this.section(g, null, map.get(g)!.length, () => map.get(g)!.map((it) => this.row(it)), false, true));
  }

  /** <details> que só desenha o conteúdo na primeira abertura */
  private section(title: string, icon: string | null, count: number, body: () => HTMLElement[], open: boolean, sub = false): HTMLElement {
    const d = document.createElement('details');
    d.className = sub ? 'sec sub' : 'sec';
    const s = document.createElement('summary');
    s.innerHTML = `${svg('chev')}${icon ? svg(icon) : ''}<span class="t"></span><span class="n"></span>`;
    (s.querySelector('.t') as HTMLElement).textContent = title;
    (s.querySelector('.n') as HTMLElement).textContent = String(count);
    d.appendChild(s);
    const box = document.createElement('div');
    box.className = 'secbody';
    d.appendChild(box);
    let filled = false;
    const fill = () => { if (filled) return; filled = true; box.replaceChildren(...body()); this.setActive(this.active ? this.byId.get(this.active) ?? null : null); };
    d.addEventListener('toggle', () => { if (d.open) fill(); });
    if (open) { d.open = true; fill(); }
    return d;
  }

  private row(it: LibItem): HTMLElement {
    const r = document.createElement('div');
    r.className = 'row';
    r.dataset.id = idOf(it);
    const main = document.createElement('button');
    main.type = 'button';
    main.className = 'row-main';
    main.dataset.pick = idOf(it);
    main.title = it.kind === 'prop' ? it.key : it.label;
    const thumb = document.createElement('span');
    thumb.className = 'thumb';
    if (it.kind === 'prop') { thumb.dataset.file = it.key; thumb.innerHTML = svg('prop'); this.thumbObserver.observe(thumb); }
    else thumb.innerHTML = svg(it.kind === 'npc' ? 'user' : 'cube');
    const name = document.createElement('span');
    name.className = 'nm';
    name.textContent = it.label;
    main.append(thumb, name);
    const star = document.createElement('button');
    star.type = 'button';
    star.className = 'row-star' + (this.favs.has(idOf(it)) ? ' on' : '');
    star.dataset.fav = idOf(it);
    star.title = this.favs.has(idOf(it)) ? 'Tirar dos favoritos' : 'Adicionar aos favoritos';
    star.setAttribute('aria-label', star.title);
    star.setAttribute('aria-pressed', String(this.favs.has(idOf(it))));
    star.innerHTML = svg('star');
    r.append(main, star);
    return r;
  }

  private note(text: string): HTMLElement { const p = document.createElement('p'); p.className = 'empty'; p.textContent = text; return p; }

  private click(e: MouseEvent) {
    const t = e.target as HTMLElement;
    const star = t.closest<HTMLElement>('[data-fav]');
    if (star) {
      const id = star.dataset.fav!;
      if (!this.favs.delete(id)) this.favs.add(id);
      try { localStorage.setItem(FAV_STORE, JSON.stringify([...this.favs])); } catch { /* sem armazenamento */ }
      this.render();
      return;
    }
    const pick = t.closest<HTMLElement>('[data-pick]');
    if (!pick) return;
    const it = this.byId.get(pick.dataset.pick!);
    if (!it) return;
    // clicar de novo no item que já está na mão solta ele
    this.onPick(this.active === idOf(it) ? null : it);
  }
}
