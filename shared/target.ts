import { themeImage } from './tga';

/**
 * Janela do alvo selecionado (topo da tela), montada com as imagens do tema do cliente (Data/Theme/Default):
 * fundo `WndTargetInfornation02.tga` (272×72), nível com os dígitos `TargetNum0-9.tga` dentro do círculo e
 * HP na barra de cima com `Targetgauge01.tga` esticada em 3 partes (cantos arredondados preservados).
 */
export interface TargetInfo { name: string; level?: number; /** 0..1 */ hp: number; hostile: boolean }

export class TargetWindow {
  private el: HTMLDivElement;
  private nameEl: HTMLDivElement;
  private levelEl: HTMLDivElement;
  private hpEl: HTMLDivElement;
  private digits: (string | null)[] = [];

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.id = 'targetWnd';
    this.el.hidden = true;
    this.el.innerHTML = '<div class="tw-name"></div><div class="tw-level"></div><div class="tw-bar"><div class="tw-hp"></div></div>';
    parent.appendChild(this.el);
    this.nameEl = this.el.querySelector('.tw-name')!;
    this.levelEl = this.el.querySelector('.tw-level')!;
    this.hpEl = this.el.querySelector('.tw-hp')!;
    void themeImage('WndTargetInfornation02.tga').then((u) => { if (u) this.el.style.backgroundImage = `url(${u})`; });
    void themeImage('Targetgauge01.tga').then((u) => { if (u) this.hpEl.style.borderImageSource = `url(${u})`; });
    void Promise.all(Array.from({ length: 10 }, (_, i) => themeImage(`TargetNum${i}.tga`))).then((d) => { this.digits = d; if (!this.el.hidden) this.renderLevel(); });
  }

  private level: number | undefined;

  show(t: TargetInfo) {
    this.el.hidden = false;
    this.el.classList.toggle('hostile', t.hostile);
    this.nameEl.textContent = t.name;
    this.hpEl.style.width = `${Math.max(0, Math.min(1, t.hp)) * 100}%`;
    this.level = t.level;
    this.renderLevel();
  }

  hide() { this.el.hidden = true; }

  setHp(frac: number) { this.hpEl.style.width = `${Math.max(0, Math.min(1, frac)) * 100}%`; }

  private renderLevel() {
    this.levelEl.replaceChildren();
    if (this.level === undefined) return;
    for (const ch of String(this.level)) {
      const u = this.digits[Number(ch)];
      if (!u) { this.levelEl.textContent = String(this.level); return; }
      const img = document.createElement('img');
      img.src = u; img.alt = ch;
      this.levelEl.appendChild(img);
    }
  }
}
