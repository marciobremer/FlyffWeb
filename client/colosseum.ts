import { keyedImage, themeImage } from '../shared/tga';
import { gameConfirm } from './dialog';
import './colosseum.css';

/**
 * Colosseum (servers/world/colosseum.ts): a janela "Colosseum Entry Request" do Marcario (WndNewColosseum: APP_NEWCOLOENTER.tga) com os
 * dois cartões de dificuldade (nível baixo / nível alto — só escolhe uma vez e liberam os botões de baixo) e os botões Normal Mode e
 * Guild Mode; o convite para o resto da party; e o letreiro de estágio/tempo no alto da tela durante a partida.
 */
export interface ColoMessage { op: string; phase?: 'wait' | 'ready' | 'fight'; stage?: number; max?: number; until?: number; from?: string; diff?: number; menu?: number; win?: boolean; secs?: number }

const fmt = (ms: number) => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

export class ColosseumUi {
  /** pedir a partida (dificuldade 1 = nível baixo, 2 = alto; menu 1 = normal, 2 = guild) / aceitar o convite / começar já */
  onStart: (diff: number, menu: number) => void = () => {};
  onJoin: () => void = () => {};
  onGo: () => void = () => {};
  private win = document.createElement('div');
  private hud = document.createElement('div');
  private hudText = document.createElement('span');
  private goBtn = document.createElement('button');
  private diff = 0;
  private cards: HTMLButtonElement[] = [];
  private modes: HTMLButtonElement[] = [];
  private until = 0;
  private timer = 0;
  private phase = '';
  private label = '';

  constructor(parent: HTMLElement) {
    // ---- janela de entrada ----
    const w = this.win;
    w.className = 'colo-win';
    w.hidden = true;
    w.setAttribute('role', 'dialog');
    w.setAttribute('aria-label', 'Colosseum Entry Request');
    void themeImage('APP_NEWCOLOENTER.tga').then((u) => { if (u) w.style.backgroundImage = `url(${u})`; });
    const title = document.createElement('div');
    title.className = 'colo-title';
    title.textContent = 'Colosseum Entry Request';
    w.append(title);
    const sheet = ['WndColoNomal01.bmp', 'WndColoHigh01.bmp'];
    sheet.forEach((file, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'colo-card';
      b.setAttribute('aria-label', i === 0 ? 'Nível baixo (até o nível 90)' : 'Nível alto');
      b.title = i === 0 ? 'Nível baixo (até o nível 90)' : 'Nível alto';
      b.style.left = `${14 + i * 230}px`;
      void keyedImage(file).then((u) => { if (u) b.style.backgroundImage = `url(${u})`; });
      b.addEventListener('click', () => this.pick(i + 1));
      this.cards.push(b);
      w.append(b);
    });
    ['Normal Mode', 'Guild Mode'].forEach((label, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'colo-mode';
      b.textContent = label;
      b.disabled = true;
      b.style.left = `${44 + i * 194}px`;
      b.addEventListener('click', () => { if (this.diff) { this.hide(); this.onStart(this.diff, i + 1); } });
      this.modes.push(b);
      w.append(b);
    });
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'colo-close';
    close.textContent = '×';
    close.setAttribute('aria-label', 'Fechar');
    close.addEventListener('click', () => this.hide());
    w.append(close);
    parent.append(w);
    addEventListener('keydown', (e) => { if (e.key === 'Escape' && !w.hidden) this.hide(); });

    // ---- letreiro da partida ----
    const h = this.hud;
    h.className = 'colo-hud';
    h.hidden = true;
    this.goBtn.type = 'button';
    this.goBtn.className = 'colo-go';
    this.goBtn.textContent = 'Começar agora';
    this.goBtn.addEventListener('click', () => { this.onGo(); this.goBtn.hidden = true; });
    h.append(this.hudText, this.goBtn);
    parent.append(h);
  }

  /** abre a janela de entrada (nível baixo só até o 90: acima disso o cartão baixo fica apagado) */
  open(level: number) {
    this.diff = 0;
    this.cards.forEach((c) => c.classList.remove('on'));
    this.modes.forEach((m) => { m.disabled = true; });
    this.cards[0].disabled = level > 90;
    this.win.hidden = false;
  }
  hide() { this.win.hidden = true; }

  private pick(d: number) {
    this.diff = d;
    this.cards.forEach((c, i) => c.classList.toggle('on', i + 1 === d));
    this.modes.forEach((m) => { m.disabled = false; });
  }

  /** mensagens do servidor (net.onColo) */
  handle(m: ColoMessage) {
    if (m.op === 'invite') {
      void gameConfirm(`${m.from ?? 'O líder'} chamou você para o Colosseum (${m.diff === 2 ? 'nível alto' : 'nível baixo'}, ${m.menu === 2 ? 'Guild Mode' : 'Normal Mode'}). Entrar agora?`, 'Entrar', false).then((ok) => { if (ok) this.onJoin(); });
    } else if (m.op === 'state') {
      this.phase = m.phase ?? '';
      this.until = m.until ?? 0;
      this.label = this.phase === 'wait' ? 'Colosseum — esperando a party' : this.phase === 'ready' ? `Colosseum — próximo estágio ${Math.min((m.stage ?? 0) + 1, m.max ?? 6)}/${m.max ?? 6}` : `Colosseum — estágio ${m.stage}/${m.max}`;
      this.goBtn.hidden = this.phase !== 'wait';
      this.hud.hidden = false;
      this.tick();
      clearInterval(this.timer);
      this.timer = window.setInterval(() => this.tick(), 500);
    } else if (m.op === 'end') {
      this.stop();
      this.hudText.textContent = '';
    }
  }

  private tick() {
    this.hudText.textContent = `${this.label} · ${fmt(this.until - Date.now())}`;
  }

  /** saiu do jogo / voltou ao login */
  stop() { clearInterval(this.timer); this.hud.hidden = true; this.win.hidden = true; }
}
