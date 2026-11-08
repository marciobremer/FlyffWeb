import { itemIcon } from '../shared/tga';
import { GameWindow } from './ui';
import './itemtime.css';

/**
 * Janela "Duração do Item" (tecla J): aba Tempo Restante lista os itens de tempo já ativados (tickets, anéis, colares…) com quanto
 * falta; aba Masmorra lista a espera para entrar de novo em cada dungeon. A lista de itens vem do inventário (o cliente já
 * sabe o fim de cada um); as masmorras vêm do servidor.
 */
export interface TimedItem { name: string; icon: string; /** ms restantes (≤ 0 = expirado) */ left: number; where: string }
export interface DungeonWait { name: string; left: number }

const fmt = (ms: number) => {
  if (ms <= 0) return 'Expirado';
  const m = Math.ceil(ms / 60000);
  const d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), mi = m % 60;
  return d ? `${d}d ${h}h` : h ? `${h}h ${mi}min` : `${Math.max(1, mi)}min`;
};

export class ItemTimeWindow extends GameWindow {
  /** itens de tempo da bolsa e do equipamento (o cliente monta do inventário) */
  items: () => TimedItem[] = () => [];
  /** pede ao servidor a espera das masmorras */
  askDungeons: () => void = () => {};
  private tab: 'items' | 'dungeons' = 'items';
  private dungeons: DungeonWait[] = [];
  private got = 0;
  private list = document.createElement('div');
  private tabs = new Map<string, HTMLButtonElement>();
  private timer = 0;

  constructor(parent: HTMLElement) {
    super(parent, { id: 'itemTimeWnd', title: 'Duração do Item', store: 'flyff.wnd.itemtime', initial: { x: 300, y: 160, w: 345, h: 280 }, min: { w: 300, h: 200 } });
    const b = this.body;
    b.classList.add('it');
    this.list.className = 'it-list';
    const bar = document.createElement('div');
    bar.className = 'it-tabs';
    for (const [id, label] of [['items', 'Tempo Restante'], ['dungeons', 'Masmorra']] as const) {
      const t = document.createElement('button');
      t.type = 'button';
      t.textContent = label;
      t.addEventListener('click', () => { this.tab = id; if (id === 'dungeons') this.askDungeons(); this.paint(); });
      this.tabs.set(id, t);
      bar.append(t);
    }
    b.append(this.list, bar);
  }

  override show() {
    super.show();
    if (this.tab === 'dungeons') this.askDungeons();
    this.paint();
    clearInterval(this.timer);
    this.timer = window.setInterval(() => { if (this.visible) this.paint(); else clearInterval(this.timer); }, 15_000);
  }

  setDungeons(list: DungeonWait[]) { this.dungeons = list; this.got = Date.now(); if (this.visible) this.paint(); }

  /** repinta (o cliente chama quando o inventário muda) */
  refresh() { if (this.visible) this.paint(); }

  private paint() {
    for (const [id, t] of this.tabs) t.classList.toggle('on', id === this.tab);
    const rows: HTMLElement[] = [];
    if (this.tab === 'items') {
      for (const it of [...this.items()].sort((a, c) => a.left - c.left)) {
        const img = document.createElement('img');
        img.alt = ''; img.draggable = false;
        void itemIcon(it.icon).then((u) => { if (u) img.src = u; });
        const row = document.createElement('div');
        row.className = `it-row${it.left <= 0 ? ' dead' : ''}`;
        row.title = it.where;
        row.append(img, Object.assign(document.createElement('b'), { textContent: it.name }), Object.assign(document.createElement('span'), { textContent: fmt(it.left) }));
        rows.push(row);
      }
      if (!rows.length) rows.push(Object.assign(document.createElement('p'), { className: 'it-none', textContent: 'Nenhum item de tempo ativado.' }));
    } else {
      const age = Date.now() - this.got;
      for (const d of this.dungeons) {
        const left = d.left - age;
        if (left <= 0) continue;
        const row = Object.assign(document.createElement('div'), { className: 'it-row' });
        rows.push(row);
        row.append(Object.assign(document.createElement('b'), { textContent: d.name }), Object.assign(document.createElement('span'), { textContent: fmt(left) }));
      }
      if (!rows.length) rows.push(Object.assign(document.createElement('p'), { className: 'it-none', textContent: 'Nenhuma espera de masmorra.' }));
    }
    this.list.replaceChildren(...rows);
  }
}
