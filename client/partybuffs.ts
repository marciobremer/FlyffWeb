import { skillIcon } from '../shared/tga';
import { SKILLS, partyTime, type PartyView } from './party';

/**
 * Habilidades de party ligadas, no alto da tela (à esquerda da janela do alvo): um ícone por habilidade com o tempo que
 * falta ('45s', '12m', '3h', '1d'). O servidor manda o tempo a cada mudança da party; o relógio corre aqui e o ícone some
 * quando chega a zero.
 */
export class PartyBuffs {
  private el = document.createElement('div');
  private items: { end: number; time: HTMLElement; box: HTMLElement }[] = [];
  private timer = 0;

  constructor(parent: HTMLElement) {
    this.el.className = 'party-buffs';
    this.el.setAttribute('aria-label', 'Habilidades de party ligadas');
    parent.appendChild(this.el);
  }

  set(p: PartyView | null) {
    const now = performance.now();
    this.el.replaceChildren();
    this.items = (p?.skills ?? []).filter((x) => SKILLS[x.k] && x.left > 0).map((x) => {
      const s = SKILLS[x.k];
      const box = document.createElement('div');
      box.className = 'buff';
      box.title = `${s.name} (party) — ${s.desc}`;
      const img = document.createElement('img');
      img.alt = s.name;
      void skillIcon(s.icon).then((u) => { if (u) img.src = u; });
      const time = document.createElement('span');
      box.append(img, time);
      this.el.appendChild(box);
      return { end: now + x.left * 1000, time, box };
    });
    this.tick();
    if (this.items.length && !this.timer) this.timer = window.setInterval(() => this.tick(), 500);
  }

  private tick() {
    const now = performance.now();
    this.items = this.items.filter((it) => {
      const s = Math.round((it.end - now) / 1000);
      if (s <= 0) { it.box.remove(); return false; }
      it.time.textContent = partyTime(s);
      return true;
    });
    if (!this.items.length && this.timer) { clearInterval(this.timer); this.timer = 0; }
  }
}
