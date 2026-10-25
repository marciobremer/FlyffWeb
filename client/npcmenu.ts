/**
 * Menu do NPC (como no FlyFF Universe): ao chegar perto do NPC clicado, o servidor diz o que ele oferece e aparece uma
 * caixinha ao lado dele com as opções — "Comércio" (loja) e "Receber Buffs!" (Buff Pang). Fecha ao escolher, ao clicar
 * fora, com Esc ou ao se afastar.
 */
export interface NpcMenuOption { label: string; run: () => void }

export class NpcMenu {
  private el = document.createElement('div');
  private open = false;

  constructor(parent: HTMLElement) {
    this.el.className = 'npc-menu';
    this.el.hidden = true;
    this.el.setAttribute('role', 'menu');
    parent.appendChild(this.el);
    addEventListener('pointerdown', (e) => { if (this.open && !this.el.contains(e.target as Node)) this.hide(); }, true);
    addEventListener('keydown', (e) => { if (this.open && e.code === 'Escape') this.hide(); });
  }

  get visible() { return this.open; }

  /** mostra perto do ponto de tela (x, y) */
  show(title: string, options: NpcMenuOption[], x: number, y: number) {
    this.el.replaceChildren();
    this.el.setAttribute('aria-label', title);
    for (const o of options) {
      const b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('role', 'menuitem');
      b.textContent = o.label;
      b.addEventListener('click', () => { this.hide(); o.run(); });
      this.el.appendChild(b);
    }
    this.el.hidden = false;
    this.open = true;
    const w = this.el.offsetWidth, h = this.el.offsetHeight;
    this.el.style.left = `${Math.max(4, Math.min(innerWidth - w - 4, x))}px`;
    this.el.style.top = `${Math.max(4, Math.min(innerHeight - h - 4, y - h / 2))}px`;
    (this.el.querySelector('button') as HTMLButtonElement | null)?.focus();
  }

  hide() { this.el.hidden = true; this.open = false; }
}
