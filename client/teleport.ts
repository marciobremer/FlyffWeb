import { itemIcon } from '../shared/tga';
import type { ItemView } from './net';
import { hideItemTip, moveItemTip, showItemTip } from './itemtip';
import { ELEMENT_NAMES, GameWindow } from './ui';

/**
 * Janela Teleporter (tecla V), como a do Titanium (AegonTeleporter.inc): à esquerda a lista "[Tipo] Nome" com filtro; no
 * meio o nome, a imagem do destino (Theme/Default/Teleporter/*.png), a descrição com o nível aconselhado e "Teletransportar";
 * à direita o que dropa ali (ícone e nome, com a dica do item ao passar o mouse). A lista vem pronta do servidor ('teleports')
 * e o pedido manda só o índice; quem confere tudo (morto, combate, parado…) é o servidor (realtime.ts zckTeleport).
 */
export interface TeleportView { k: number; name: string; header: string; image: string; type: 'city' | 'collect' | 'dungeon' | 'zone'; desc: string; items: ItemView[] }

const TYPE_NAME: Record<TeleportView['type'], string> = { city: 'Cidade', collect: 'Coleta', dungeon: 'Dungeon', zone: 'Zona' };

export class TeleportWindow extends GameWindow {
  onTeleport: (key: number) => void = () => {};
  /** pede a lista ao servidor (a primeira vez que abre) */
  onLoad: () => void = () => {};
  private dests: TeleportView[] = [];
  private filter = document.createElement('select');
  private list = document.createElement('div');
  private img = document.createElement('img');
  private nameEl = document.createElement('div');
  private descEl = document.createElement('p');
  private goBtn = document.createElement('button');
  private drops = document.createElement('ul');
  private selected: TeleportView | null = null;
  private requested = false;
  private loaded = false;

  constructor(parent: HTMLElement) {
    super(parent, { id: 'tpWnd', title: 'Teleporter', store: 'flyff.wnd.teleport2', initial: { x: 200, y: 90, w: 720, h: 400 }, min: { w: 640, h: 360 } });
    const b = this.body;
    b.classList.add('tp');
    const col = (cls: string, title: string) => {
      const c = document.createElement('section');
      c.className = `tp-col ${cls}`;
      const h = document.createElement('h3');
      h.className = 'tp-head';
      h.textContent = title;
      c.append(h);
      return { c, h };
    };
    const left = col('tp-left', 'Destinos');
    this.filter.className = 'tp-filter';
    this.filter.setAttribute('aria-label', 'Filtrar destinos');
    for (const [v, t] of [['', 'Todos'], ['city', 'Cidade'], ['collect', 'Coleta'], ['dungeon', 'Dungeon']]) { const o = document.createElement('option'); o.value = v; o.textContent = t; this.filter.append(o); }
    this.filter.addEventListener('change', () => this.render());
    this.list.className = 'tp-list';
    this.list.setAttribute('role', 'listbox');
    this.list.setAttribute('aria-label', 'Destinos');
    left.c.append(this.filter, this.list);

    const mid = col('tp-mid', '');
    this.nameEl = mid.h;
    this.img.className = 'tp-img';
    this.img.alt = '';
    this.descEl.className = 'tp-desc';
    this.goBtn.type = 'button';
    this.goBtn.className = 'cw-btn tp-go';
    this.goBtn.textContent = 'Teletransportar';
    this.goBtn.disabled = true;
    this.goBtn.addEventListener('click', () => { if (this.selected) { this.onTeleport(this.selected.k); this.hide(); } });
    mid.c.append(this.img, this.descEl, this.goBtn);

    const right = col('tp-right', 'Drops possíveis');
    this.drops.className = 'tp-drops';
    this.drops.setAttribute('aria-label', 'Drops possíveis');
    let tip = -1;
    this.drops.addEventListener('mousemove', (e) => {
      const li = (e.target as HTMLElement).closest<HTMLLIElement>('li[data-i]');
      const d = li ? this.selected?.items[Number(li.dataset.i)] : undefined;
      if (!d) { if (tip >= 0) { hideItemTip(); tip = -1; } return; }
      if (d.id === tip) { moveItemTip(e); return; }
      tip = d.id;
      showItemTip(e, d, { id: d.id, n: 1, u: 0, e: 0, el: 0 }, ELEMENT_NAMES);
    });
    this.drops.addEventListener('mouseleave', () => { hideItemTip(); tip = -1; });
    right.c.append(this.drops);
    b.append(left.c, mid.c, right.c);
  }

  show() {
    super.show();
    if (!this.requested) { this.requested = true; this.onLoad(); }
    this.render();
  }

  /** lista vinda do servidor */
  set(list: TeleportView[]) { this.dests = list; this.loaded = true; this.render(); }

  private label = (d: TeleportView) => `[${TYPE_NAME[d.type]}] ${d.name}`;

  private render() {
    const f = this.filter.value;
    const shown = this.dests.filter((d) => !f || d.type === f);
    this.list.replaceChildren();
    for (const d of shown) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'tp-row';
      row.setAttribute('role', 'option');
      row.dataset.k = String(d.k);
      row.textContent = this.label(d);
      row.addEventListener('click', () => this.select(d));
      row.addEventListener('dblclick', () => { this.select(d); this.goBtn.click(); });
      this.list.append(row);
    }
    if (!shown.length) this.list.textContent = this.loaded ? 'Nenhum destino.' : 'Carregando…';
    this.select(this.selected && shown.includes(this.selected) ? this.selected : shown[0] ?? null);
  }

  private select(d: TeleportView | null) {
    this.selected = d;
    for (const el of this.list.querySelectorAll<HTMLElement>('.tp-row')) { const on = !!d && el.dataset.k === String(d.k); el.classList.toggle('on', on); el.setAttribute('aria-selected', String(on)); }
    this.nameEl.textContent = d?.header ?? '';
    this.descEl.textContent = d?.desc ?? '';
    this.img.hidden = !d?.image;
    if (d?.image) this.img.src = '/res/Data/Theme/Default/' + d.image.split('/').map(encodeURIComponent).join('/');
    this.goBtn.disabled = !d;
    this.drops.replaceChildren();
    (d?.items ?? []).forEach((it, i) => {
      const li = document.createElement('li');
      li.dataset.i = String(i);
      const img = document.createElement('img');
      img.alt = '';
      img.width = img.height = 32;
      void itemIcon(it.icon).then((u) => { if (u) img.src = u; });
      const name = document.createElement('span');
      name.textContent = it.name;
      li.append(img, name);
      this.drops.append(li);
    });
    if (d && !d.items.length) { const li = document.createElement('li'); li.className = 'tp-none'; li.textContent = 'Nenhum drop listado.'; this.drops.append(li); }
  }
}
