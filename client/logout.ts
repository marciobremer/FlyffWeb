import { GameWindow } from './ui';
import { t } from './lang';

/**
 * Contagem para sair do jogo (como o "Logout" do cliente oficial): ao escolher Desconectar abre uma janelinha "Saindo em N seg(s)."
 * e, depois de 4 segundos, desconecta. Fechar a janela (X) ou apertar Esc cancela. Escolher Desconectar de novo durante a
 * contagem não reinicia.
 */
export const LOGOUT_SECONDS = 4;

export class LogoutCountdown extends GameWindow {
  private text = document.createElement('p');
  private timer = 0;
  private left = 0;

  constructor(parent: HTMLElement, private onDone: () => void) {
    super(parent, { id: 'logoutWnd', title: 'Desconectar', store: 'flyff.wnd.logout', initial: { x: Math.max(0, Math.round((innerWidth - 250) / 2)), y: 60, w: 250, h: 84 }, min: { w: 200, h: 70 }, resizable: false });
    this.text.className = 'logout-text';
    this.text.setAttribute('role', 'status');
    this.body.appendChild(this.text);
    this.onClose = () => this.cancel();
    addEventListener('keydown', (e) => { if (e.code === 'Escape' && this.counting) this.cancel(); });
  }

  get counting() { return this.timer !== 0; }

  start() {
    if (this.counting) return;
    this.left = LOGOUT_SECONDS;
    this.paintText();
    this.show();
    this.timer = window.setInterval(() => {
      if (--this.left <= 0) { this.stop(); this.onDone(); return; }
      this.paintText();
    }, 1000);
  }

  cancel() { this.stop(); }

  private stop() { clearInterval(this.timer); this.timer = 0; this.hide(); }
  private paintText() { this.text.textContent = t('Saindo em {n} seg(s).', { n: this.left }); }
}
