import { fetchBuf } from '../shared/data';
import { decodeText } from '../shared/formats/rgn';
import { parseTeleports, type TeleportDest, type TeleportType } from '../shared/formats/teleport';
import { GameWindow } from './ui';

/**
 * Janela Teleporter (CWndZckTeleporteur, tecla V): filtro (Todos / Cidade / Zona / Dungeon), lista "[Tipo] Nome", a imagem
 * do destino (Theme/Default/teleport*.png, 238×228) com nome e descrição, e "Teletransportar". Os destinos vêm do mesmo
 * `ZckTeleporteur.inc` que o servidor lê — o pedido manda só o índice; quem confere tudo (morto, combate, parado…) é o
 * servidor (servers/world/realtime.ts zckTeleport).
 */
const TYPE_NAME: Record<TeleportType, string> = { city: 'Cidade', zone: 'Zona', dungeon: 'Dungeon' };

export class TeleportWindow extends GameWindow {
  onTeleport: (key: number) => void = () => {};
  private dests: TeleportDest[] = [];
  private filter = document.createElement('select');
  private list = document.createElement('div');
  private img = document.createElement('img');
  private nameEl = document.createElement('div');
  private descEl = document.createElement('p');
  private goBtn = document.createElement('button');
  private selected: TeleportDest | null = null;
  private loaded = false;

  constructor(parent: HTMLElement) {
    super(parent, { id: 'tpWnd', title: 'Teleporter', store: 'flyff.wnd.teleport', initial: { x: 260, y: 90, w: 470, h: 360 }, min: { w: 440, h: 330 } });
    const b = this.body;
    b.classList.add('tp');
    const left = document.createElement('div');
    left.className = 'tp-left';
    this.filter.className = 'tp-filter';
    this.filter.setAttribute('aria-label', 'Filtrar destinos');
    for (const [v, t] of [['', 'Todos'], ['city', 'Cidade'], ['zone', 'Zona'], ['dungeon', 'Dungeon']]) { const o = document.createElement('option'); o.value = v; o.textContent = t; this.filter.append(o); }
    this.filter.addEventListener('change', () => this.render());
    this.list.className = 'tp-list';
    this.list.setAttribute('role', 'listbox');
    this.list.setAttribute('aria-label', 'Destinos');
    left.append(this.filter, this.list);

    const right = document.createElement('div');
    right.className = 'tp-right';
    this.img.className = 'tp-img';
    this.img.alt = '';
    this.nameEl.className = 'tp-name';
    this.descEl.className = 'tp-desc';
    this.goBtn.type = 'button';
    this.goBtn.className = 'cw-btn tp-go';
    this.goBtn.textContent = 'Teletransportar';
    this.goBtn.disabled = true;
    this.goBtn.addEventListener('click', () => { if (this.selected) { this.onTeleport(this.selected.key); this.hide(); } });
    right.append(this.img, this.nameEl, this.descEl, this.goBtn);
    b.append(left, right);
  }

  /** lê os destinos na primeira vez que abre */
  private async loadDests() {
    if (this.loaded) return;
    this.loaded = true;
    const buf = await fetchBuf('/res/ZckTeleporteur.inc');
    this.dests = buf ? parseTeleports(decodeText(buf, 'windows-1252')) : [];
    this.render();
  }

  show() { super.show(); void this.loadDests(); }

  private render() {
    const f = this.filter.value;
    const shown = this.dests.filter((d) => !f || d.type === f);
    this.list.replaceChildren();
    for (const d of shown) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'tp-row';
      row.setAttribute('role', 'option');
      row.textContent = `[${TYPE_NAME[d.type]}] ${d.name}`;
      row.addEventListener('click', () => this.select(d));
      row.addEventListener('dblclick', () => { this.select(d); this.goBtn.click(); });
      this.list.append(row);
    }
    if (!shown.length) this.list.textContent = this.loaded ? 'Nenhum destino.' : 'Carregando…';
    this.select(shown.includes(this.selected!) ? this.selected : shown[0] ?? null);
  }

  private select(d: TeleportDest | null) {
    this.selected = d;
    [...this.list.children].forEach((el) => { const on = el.textContent === (d ? `[${TYPE_NAME[d.type]}] ${d.name}` : ''); el.classList.toggle('on', on); el.setAttribute('aria-selected', String(on)); });
    this.nameEl.textContent = d?.name ?? '';
    this.descEl.textContent = d?.desc ?? '';
    this.img.hidden = !d?.image;
    if (d?.image) this.img.src = '/res/Data/Theme/Default/' + encodeURIComponent(d.image);
    this.goBtn.disabled = !d;
  }
}
