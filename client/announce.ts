/**
 * Letreiro de anúncio (painel admin → todos os jogadores): faixa no meio da tela, com as pontas sumindo em degradê, e o texto
 * correndo da direita para a esquerda `loops` vezes. Anúncios que chegam enquanto um passa entram numa fila.
 */
/** velocidade do texto (px/s) */
const SPEED = 150;

export class Announcer {
  private el = document.createElement('div');
  private text = document.createElement('span');
  private queue: { text: string; loops: number }[] = [];
  private busy = false;

  constructor(parent: HTMLElement) {
    this.el.className = 'announce';
    this.el.setAttribute('role', 'status');
    this.el.setAttribute('aria-live', 'polite');
    this.el.hidden = true;
    this.el.append(this.text);
    parent.append(this.el);
  }

  show(text: string, loops: number) {
    this.queue.push({ text, loops: Math.max(1, loops) });
    if (!this.busy) void this.next();
  }

  private async next() {
    const item = this.queue.shift();
    if (!item) { this.busy = false; return; }
    this.busy = true;
    const { el, text } = this;
    text.textContent = item.text;
    el.hidden = false;
    el.classList.remove('out');
    void el.offsetWidth; // reinicia a animação de entrada
    el.classList.add('in');
    // corre sempre (mesmo com "reduzir movimento" no sistema): parado, um texto mais largo que a faixa ficaria cortado
    const dist = el.clientWidth + text.offsetWidth;
    const anim = text.animate(
      [{ transform: `translate(${el.clientWidth}px, -50%)` }, { transform: `translate(${-text.offsetWidth}px, -50%)` }],
      { duration: (dist / SPEED) * 1000, iterations: item.loops, easing: 'linear' },
    );
    await anim.finished.catch(() => {});
    el.classList.replace('in', 'out');
    await wait(400);
    el.hidden = true;
    void this.next();
  }
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
