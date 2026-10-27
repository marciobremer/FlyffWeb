/**
 * Faixa de aviso no alto da tela (g_Caption1 do Titanium com __AEGON_ADVANCED_ANNOUNCEMENT): a imagem do tema
 * (Theme/Default/Announcement/*.png, 600×140) com o texto no meio, aparece, fica alguns segundos e some. Hoje: "Level Up!"
 * (TID_GAME_LEVELUP_CAPTION com a imagem 6, levelup.png). Avisos que chegam juntos entram numa fila.
 */
export class CaptionBanner {
  private el = document.createElement('div');
  private text = document.createElement('span');
  private queue: { text: string; image: string }[] = [];
  private busy = false;

  constructor(parent: HTMLElement) {
    this.el.className = 'caption-banner';
    this.el.setAttribute('role', 'status');
    this.el.setAttribute('aria-live', 'polite');
    this.el.hidden = true;
    this.el.append(this.text);
    parent.append(this.el);
  }

  /** `image`: arquivo de Theme/Default/Announcement */
  show(text: string, image = 'levelup.png') {
    this.queue.push({ text, image });
    if (!this.busy) void this.next();
  }

  private async next() {
    const item = this.queue.shift();
    if (!item) { this.busy = false; return; }
    this.busy = true;
    this.text.textContent = item.text;
    this.el.style.backgroundImage = `url("/res/Data/Theme/Default/Announcement/${encodeURIComponent(item.image)}")`;
    this.el.hidden = false;
    // aparece (0,3 s), fica (2,5 s) e some (0,8 s)
    const a = this.el.animate([{ opacity: 0, transform: 'translateX(-50%) scale(.9)' }, { opacity: 1, transform: 'translateX(-50%) scale(1)', offset: 0.08 }, { opacity: 1, transform: 'translateX(-50%) scale(1)', offset: 0.78 }, { opacity: 0, transform: 'translateX(-50%) scale(1)' }], { duration: 3600, easing: 'ease-out' });
    await a.finished.catch(() => {});
    this.el.hidden = true;
    void this.next();
  }

  clear() { this.queue.length = 0; }
}
