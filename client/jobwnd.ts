import { keyedImage, themeImage } from '../shared/tga';
import { GameWindow } from './ui';

/**
 * Janela de mudança de classe: abre sozinha quando o servidor diz que há classes disponíveis (nível 15 → 1ª classe,
 * nível 60 → 2ª classe da sua linha); a tecla J reabre. Cada classe é um retrato do tema (Slot*.bmp, 4 quadros de 64×64:
 * colorido, preto e branco, selecionado e trancado): em preto e branco até clicar; ao clicar fica colorido com a moldura azul e
 * aparece a descrição. "Aplicar" manda a escolha ao servidor, que confere nível e linha de classe (OnSendJobChange).
 */
import { JOBS } from './jobs';


const SLOT = 64;

export class JobWindow extends GameWindow {
  onChoose: (job: number) => void = () => {};
  private slots = document.createElement('div');
  private nameEl = document.createElement('div');
  private descEl = document.createElement('p');
  private applyBtn = document.createElement('button');
  private opts: number[] = [];
  private chosen: number | null = null;
  private art = new Map<number, string>();
  private shown = '';

  constructor(parent: HTMLElement) {
    super(parent, { id: 'jobWnd', title: 'Mudança de classe', store: 'flyff.wnd.job', initial: { x: 320, y: 140, w: 340, h: 330 }, min: { w: 300, h: 300 } });
    const b = this.body;
    b.classList.add('jw');
    const intro = document.createElement('p');
    intro.className = 'jw-intro';
    intro.textContent = 'Você alcançou o nível necessário. Escolha sua nova classe — não dá para trocar depois.';
    this.slots.className = 'jw-slots';
    this.nameEl.className = 'jw-name';
    this.descEl.className = 'jw-desc';
    this.applyBtn.type = 'button';
    this.applyBtn.className = 'cw-btn jw-apply';
    this.applyBtn.innerHTML = '<span>Aplicar</span>';
    this.applyBtn.disabled = true;
    this.applyBtn.addEventListener('click', () => { if (this.chosen !== null) this.onChoose(this.chosen); });
    void themeImage('ButtCharApply.tga').then((u) => { if (u) { this.applyBtn.style.backgroundImage = `url(${u})`; this.applyBtn.classList.add('img'); } });
    b.append(intro, this.slots, this.nameEl, this.descEl, this.applyBtn);
  }

  /** opções vindas do servidor (lista vazia = nada a escolher) */
  setOptions(opts: number[]) {
    const key = opts.join(',');
    if (key === this.shown) return;
    this.shown = key;
    this.opts = opts;
    this.chosen = null;
    if (!opts.length) { this.hide(); return; }
    // retratos (magenta vira transparente)
    void Promise.all(opts.map(async (id) => { const u = await keyedImage(JOBS[id]?.file ?? ''); if (u) this.art.set(id, u); })).then(() => this.render());
    this.render();
    this.show();
  }

  private render() {
    this.slots.replaceChildren();
    for (const id of this.opts) {
      const s = document.createElement('button');
      s.type = 'button';
      s.className = 'jw-slot';
      s.setAttribute('aria-label', JOBS[id]?.name ?? `Classe ${id}`);
      s.setAttribute('aria-pressed', String(this.chosen === id));
      const u = this.art.get(id);
      // quadro 0 = colorido, 1 = preto e branco, 2 = selecionado (moldura azul)
      if (u) { s.style.backgroundImage = `url(${u})`; s.style.backgroundPosition = `-${(this.chosen === id ? 2 : 1) * SLOT}px 0`; }
      s.title = JOBS[id]?.name ?? '';
      s.addEventListener('click', () => { this.chosen = id; this.render(); });
      this.slots.appendChild(s);
    }
    const j = this.chosen !== null ? JOBS[this.chosen] : null;
    this.nameEl.textContent = j ? j.name : 'Selecione uma classe';
    this.descEl.textContent = j ? j.desc : 'Clique em um retrato para ver a descrição.';
    this.applyBtn.disabled = this.chosen === null;
  }
}
