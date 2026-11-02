import { skillIcon, themeImage } from './tga';

/**
 * Janela do alvo selecionado (topo da tela), montada com as imagens do tema do cliente (Data/Theme/Default):
 * fundo `WndTargetInfornation02.tga` (272×72), nível com os dígitos `TargetNum0-9.tga` dentro do círculo e
 * HP na barra de cima com `Targetgauge01.tga` esticada em 3 partes (cantos arredondados preservados).
 */
export interface TargetInfo { name: string; level?: number; /** 0..1 */ hp: number; hostile: boolean }

/** debuff no alvo: nome, ícone da skill e o fim (performance.now, ms) */
export interface TargetDebuff { name: string; icon: string; end: number }

export class TargetWindow {
  private el: HTMLDivElement;
  private nameEl: HTMLDivElement;
  private levelEl: HTMLDivElement;
  private hpEl: HTMLDivElement;
  private digits: (string | null)[] = [];
  private debuffsEl: HTMLDivElement;
  private debuffKey = '';
  private debuffTimes: { end: number; el: HTMLElement }[] = [];

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.id = 'targetWnd';
    this.el.hidden = true;
    this.el.innerHTML = '<div class="tw-name"></div><div class="tw-level"></div><div class="tw-bar"><div class="tw-hp"></div></div><div class="tw-debuffs"></div>';
    parent.appendChild(this.el);
    this.nameEl = this.el.querySelector('.tw-name')!;
    this.levelEl = this.el.querySelector('.tw-level')!;
    this.hpEl = this.el.querySelector('.tw-hp')!;
    this.debuffsEl = this.el.querySelector('.tw-debuffs')!;
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

  hide() { this.el.hidden = true; this.setDebuffs([]); }

  /** debuffs do alvo (ícone com a contagem do tempo que falta); chamar de tempos em tempos — só refaz o que mudou */
  setDebuffs(list: TargetDebuff[]) {
    const now = performance.now(), live = list.filter((d) => d.end > now);
    const key = live.map((d) => `${d.name}|${d.icon}|${Math.round(d.end)}`).join(';');
    if (key !== this.debuffKey) {
      this.debuffKey = key;
      this.debuffsEl.replaceChildren();
      this.debuffTimes = live.map((d) => {
        const b = document.createElement('div');
        b.className = 'tw-debuff';
        b.title = d.name;
        const img = document.createElement('img');
        img.alt = d.name;
        void skillIcon(d.icon).then((u) => { if (u) img.src = u; });
        const t = document.createElement('span');
        b.append(img, t);
        this.debuffsEl.appendChild(b);
        return { end: d.end, el: t };
      });
    }
    for (const d of this.debuffTimes) { const s = Math.max(0, Math.ceil((d.end - now) / 1000)); d.el.textContent = s >= 60 ? `${Math.floor(s / 60)}m` : `${s}s`; }
  }

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
