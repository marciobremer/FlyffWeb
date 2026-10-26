import { skillIcon } from '../shared/tga';

/**
 * Barra de buffs: um ícone por buff ativo (o da skill) com o tempo que falta, sob a janela de status. O servidor manda a lista
 * (`buffs`: id, nome, ícone, nível, ms restantes) a cada mudança; o relógio corre aqui no cliente. Botão direito no ícone tira o buff;
 * clique (sem arrastar) alterna a barra entre horizontal e vertical (lembrado neste navegador).
 */
export interface BuffView { id: number; name: string; icon: string; lv: number; left: number }

export class BuffBar {
  private el = document.createElement('div');
  private items: { b: BuffView; end: number; time: HTMLElement }[] = [];
  private timer = 0;

  constructor(parent: HTMLElement) {
    this.el.className = 'buff-bar';
    this.el.setAttribute('aria-label', 'Buffs ativos (arraste para mover)');
    parent.appendChild(this.el);
    this.restore();
    this.el.addEventListener('pointerdown', (e) => this.dragStart(e));
    // botão direito no ícone: tira o buff
    this.el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const id = Number((e.target as HTMLElement).closest<HTMLElement>('.buff')?.dataset.id);
      if (Number.isInteger(id)) this.onRemove(id);
    });
    addEventListener('resize', () => this.clamp());
  }

  /** pedido para tirar o buff (botão direito); quem trata manda ao servidor */
  onRemove: (id: number) => void = () => {};

  /** posição salva (o padrão é sob a janela de status) e a orientação */
  private restore() {
    try { this.el.classList.toggle('vertical', localStorage.getItem('flyff.wnd.buffs.vertical') === '1'); } catch { /* sem armazenamento */ }
    try {
      const v = JSON.parse(localStorage.getItem('flyff.wnd.buffs') ?? 'null') as { x: number; y: number } | null;
      if (v && Number.isFinite(v.x) && Number.isFinite(v.y)) { this.el.style.left = `${v.x}px`; this.el.style.top = `${v.y}px`; this.clamp(); }
    } catch { /* sem armazenamento: fica no padrão */ }
  }

  /** mantém a barra dentro da tela */
  private clamp() {
    const r = this.el.getBoundingClientRect();
    if (!r.width) return;
    const x = Math.min(Math.max(0, r.left), Math.max(0, innerWidth - r.width)), y = Math.min(Math.max(0, r.top), Math.max(0, innerHeight - r.height));
    this.el.style.left = `${x}px`; this.el.style.top = `${y}px`;
  }

  /** arrastar a barra de buffs com o mouse/dedo */
  private dragStart(e: PointerEvent) {
    if (e.button !== 0) return;
    const r = this.el.getBoundingClientRect(), dx = e.clientX - r.left, dy = e.clientY - r.top, x0 = e.clientX, y0 = e.clientY;
    let moved = false;
    this.el.setPointerCapture(e.pointerId);
    this.el.classList.add('dragging');
    const move = (ev: PointerEvent) => {
      if (!moved && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 4) return; // ainda é clique
      moved = true;
      this.el.style.left = `${Math.min(Math.max(0, ev.clientX - dx), Math.max(0, innerWidth - r.width))}px`;
      this.el.style.top = `${Math.min(Math.max(0, ev.clientY - dy), Math.max(0, innerHeight - r.height))}px`;
    };
    const up = () => {
      this.el.classList.remove('dragging');
      this.el.removeEventListener('pointermove', move);
      this.el.removeEventListener('pointerup', up);
      this.el.removeEventListener('pointercancel', up);
      // clique sem arrastar num ícone: vira vertical / horizontal
      if (!moved) { if ((e.target as HTMLElement).closest('.buff')) this.toggleVertical(); return; }
      const b = this.el.getBoundingClientRect();
      try { localStorage.setItem('flyff.wnd.buffs', JSON.stringify({ x: Math.round(b.left), y: Math.round(b.top) })); } catch { /* ignora */ }
    };
    this.el.addEventListener('pointermove', move);
    this.el.addEventListener('pointerup', up);
    this.el.addEventListener('pointercancel', up);
    e.preventDefault();
  }

  /** alterna horizontal ↔ vertical (fica no mesmo canto e dentro da tela) */
  private toggleVertical() {
    const on = this.el.classList.toggle('vertical');
    try { localStorage.setItem('flyff.wnd.buffs.vertical', on ? '1' : '0'); } catch { /* ignora */ }
    this.clamp();
  }

  set(list: BuffView[]) {
    const now = performance.now();
    this.el.replaceChildren();
    this.items = list.map((b) => {
      const d = document.createElement('div');
      d.className = 'buff';
      d.dataset.id = String(b.id);
      d.title = `${b.name} nv ${b.lv} — clique: vertical/horizontal · botão direito remove`;
      const img = document.createElement('img');
      img.alt = b.name;
      void skillIcon(b.icon).then((u) => { if (u) img.src = u; });
      const time = document.createElement('span');
      d.append(img, time);
      this.el.appendChild(d);
      return { b, end: now + b.left, time };
    });
    this.tick();
    this.clamp();
    if (this.items.length && !this.timer) this.timer = window.setInterval(() => this.tick(), 500);
    if (!this.items.length && this.timer) { clearInterval(this.timer); this.timer = 0; }
  }

  clear() { this.set([]); }

  private tick() {
    const now = performance.now();
    for (const it of this.items) {
      const s = Math.max(0, Math.round((it.end - now) / 1000));
      it.time.textContent = s >= 3600 ? `${Math.floor(s / 3600)}h` : s >= 60 ? `${Math.floor(s / 60)}m` : `${s}s`;
    }
  }
}
