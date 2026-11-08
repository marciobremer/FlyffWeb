import { itemIcon } from '../shared/tga';
import { ELEMENT_NAMES, GameWindow, STAGE_MAX, type InventoryWindow } from './ui';
import { hideItemTip, moveItemTip, showItemTip } from './itemtip';
import './delbox.css';

/**
 * Caixa de apagar: Ctrl + botão direito num item da bolsa (ou arrastar o item até aqui) separa ele nesta janela; junte quantos quiser
 * e aperte "Apagar tudo". Dois cliques num item (ou arrastá-lo de volta para o inventário) devolve ele à bolsa. Se algum item for
 * raro/especial (unique, +N, elemento, carta…), o jogo pergunta antes de apagar.
 */
export class DeleteBox extends GameWindow {
  /** apagar estes espaços/quantidades da bolsa (a pergunta já foi feita) */
  onDelete: (list: { s: number; n: number }[]) => void = () => {};
  /** pergunta antes de apagar quando há item especial (true = apagar) */
  confirm: (text: string) => Promise<boolean> = () => Promise.resolve(true);
  private grid = document.createElement('div');
  private count = document.createElement('span');
  private go = document.createElement('button');
  private clear = document.createElement('button');
  private note = document.createElement('p');

  constructor(parent: HTMLElement, private inv: InventoryWindow) {
    super(parent, { id: 'delBox', title: 'Apagar itens', store: 'flyff.wnd.delbox', initial: { x: 520, y: 120, w: 252, h: 480 }, min: { w: 252, h: 480 } });
    const b = this.body;
    b.classList.add('db');
    this.note.className = 'db-note';
    this.note.textContent = 'Ctrl + botão direito num item, ou arraste até aqui. Dois cliques devolve à bolsa.';
    this.grid.className = 'inv-grid db-grid';
    this.count.className = 'db-count';
    this.go.type = 'button'; this.go.className = 'gm-btn danger'; this.go.textContent = 'Apagar tudo';
    this.clear.type = 'button'; this.clear.className = 'gm-btn'; this.clear.textContent = 'Devolver tudo';
    const row = document.createElement('div');
    row.className = 'db-row';
    row.append(this.count, this.go, this.clear);
    b.append(this.note, this.grid, row);
    this.go.addEventListener('click', () => void this.run());
    this.clear.addEventListener('click', () => inv.unstage());
    this.el.addEventListener('dragover', (e) => { if (e.dataTransfer?.types.includes('application/x-flyff-item')) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; } });
    this.el.addEventListener('drop', (e) => {
      const raw = e.dataTransfer?.getData('application/x-flyff-item');
      if (!raw) return;
      e.preventDefault();
      try { const m = JSON.parse(raw) as { c?: number; s?: number }; if (m.c === 0 && Number.isInteger(m.s)) inv.stage(m.s as number); } catch { /* ignora */ }
    });
    inv.onStage = () => this.paint();
    this.paint();
  }

  private async run() {
    const rows = [...this.inv.staged.keys()].map((s) => ({ s, it: this.inv.all.get(`0:${s}`) })).filter((r) => r.it);
    if (!rows.length) return;
    const specials = rows.filter((r) => this.inv.special(r.it!)).map((r) => `${this.inv.def(r.it!.id)?.name ?? r.it!.id}${r.it!.u ? ` +${r.it!.u}` : ''}`);
    if (specials.length && !(await this.confirm(`Há itens raros/especiais para apagar: ${specials.slice(0, 5).join(', ')}${specials.length > 5 ? '…' : ''}. Apagar tudo? Não volta.`))) return;
    this.onDelete(rows.map((r) => ({ s: r.s, n: r.it!.n })));
    this.inv.staged.clear();
    this.inv.unstage(); // repinta e avisa
  }

  private paint() {
    hideItemTip();
    const rows = [...this.inv.staged.keys()];
    this.go.disabled = this.clear.disabled = !rows.length;
    if (rows.length && !this.visible) { this.show(); this.place(); }
    this.count.textContent = `${rows.length} / ${STAGE_MAX}`;
    this.grid.replaceChildren(...Array.from({ length: STAGE_MAX }, (_, k) => {
      const s = rows[k], it = s === undefined ? undefined : this.inv.all.get(`0:${s}`), d = it && this.inv.def(it.id);
      const cell = document.createElement('div');
      cell.className = 'inv-slot';
      if (!it) return cell;
      cell.classList.add('has');
      if (this.inv.special(it)) cell.classList.add('special');
      cell.draggable = true;
      const img = document.createElement('img');
      img.alt = ''; img.draggable = false;
      if (d?.icon) void itemIcon(d.icon).then((u) => { if (u) img.src = u; });
      cell.append(img);
      if (it.n > 1) { const n = document.createElement('b'); n.textContent = String(it.n); cell.append(n); }
      if (it.u) { const u = document.createElement('i'); u.className = 'up'; u.textContent = `+${it.u}`; cell.append(u); }
      cell.setAttribute('aria-label', `${d?.name ?? it.id}${it.u ? ` +${it.u}` : ''}${it.n > 1 ? ` ×${it.n}` : ''}`);
      if (d) {
        cell.addEventListener('mouseenter', (ev) => showItemTip(ev, d, it, ELEMENT_NAMES));
        cell.addEventListener('mousemove', moveItemTip);
        cell.addEventListener('mouseleave', hideItemTip);
      }
      cell.addEventListener('dblclick', () => this.inv.unstage(s));
      cell.addEventListener('dragstart', (e) => { hideItemTip(); e.dataTransfer?.setData('application/x-flyff-staged', String(s)); });
      return cell;
    }));
  }

  /** abre ao lado do inventário (à esquerda; se não couber, à direita) */
  private place() {
    const r = this.inv.el.getBoundingClientRect(), w = this.box.w;
    const x = r.left - w - 6 >= 0 ? r.left - w - 6 : Math.min(innerWidth - w, r.right + 6);
    this.placeAt(x, r.top);
  }
}
