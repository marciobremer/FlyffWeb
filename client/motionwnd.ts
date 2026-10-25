import { fetchBuf } from '../shared/data';
import { decodeText, parseTxtTxt } from '../shared/formats/rgn';
import { skillIcon, themeDds } from '../shared/tga';
import { GameWindow } from './ui';

/**
 * Janela de movimentos (CWndMotion, tecla O) com as duas abas do original:
 * - Movimentos: a lista do propMotion.txt (ícone Data/Icon/mot_*.dds, nome e descrição do propMotion.txt.txt) — clicar
 *   toca o movimento no personagem e os outros jogadores veem; `dwPlay` 0 toca uma vez, 1 fica na pose final, 2 repete.
 *   MOT_BASE_BATTLE (modo de batalha) troca a postura de combate ↔ normal; as outras linhas sem movimento (ESCAPE, CHEER,
 *   AUTOATTACK, COUPLE) são funções do jogo e ficam de fora.
 * - Emoticons: as 69 carinhas do Theme/Default/texChatEmoticon.dds (grade de 32×32, 10 por linha); clicar mostra a carinha
 *   num balão acima da cabeça. Também vale digitar o comando no chat (`/laugh`, `/sad`… — textEmotion.txt).
 */
export interface MotionEntry { id: string; motion: string; play: number; icon: string; name: string; desc: string }

const EMO_COUNT = 69, EMO_COLS = 10, EMO_SIZE = 32;

export class MotionWindow extends GameWindow {
  onMotion: (m: MotionEntry) => void = () => {};
  onEmoticon: (index: number) => void = () => {};
  private tabs = document.createElement('div');
  private grid = document.createElement('div');
  private tab: 'motion' | 'emo' = 'motion';
  private motions: MotionEntry[] = [];
  /** comando de chat de cada emoticon (minúsculas, sem a barra) */
  private emoCmds: string[] = [];
  private sheet: string | null = null;
  private loading: Promise<void> | null = null;

  constructor(parent: HTMLElement) {
    super(parent, { id: 'motionWnd', title: 'Movimento', store: 'flyff.wnd.motion', initial: { x: 300, y: 120, w: 356, h: 300 }, min: { w: 300, h: 220 } });
    const b = this.body;
    b.classList.add('mot');
    this.tabs.className = 'mot-tabs';
    this.tabs.setAttribute('role', 'tablist');
    for (const [k, label] of [['motion', 'Movimentos'], ['emo', 'Emoticons']] as const) {
      const t = document.createElement('button');
      t.type = 'button';
      t.className = 'mot-tab';
      t.dataset.k = k;
      t.setAttribute('role', 'tab');
      t.textContent = label;
      t.addEventListener('click', () => { this.tab = k; this.render(); });
      this.tabs.append(t);
    }
    this.grid.className = 'mot-grid';
    this.grid.setAttribute('role', 'tabpanel');
    b.append(this.tabs, this.grid);
  }

  show() { super.show(); void this.loadTables().then(() => this.render()); }

  /** índice do emoticon do comando de chat (`/laugh`), ou -1 */
  emoticonOf(text: string): number {
    const m = /^\/([a-z]+)$/i.exec(text.trim());
    return m ? this.emoCmds.indexOf(m[1].toLowerCase()) : -1;
  }

  /** elemento de 32×32 com a carinha (para a lista e para o balão acima da cabeça) */
  emoticonEl(index: number): HTMLElement {
    const el = document.createElement('span');
    el.className = 'emo-icon';
    el.setAttribute('aria-label', this.emoCmds[index] ? `/${this.emoCmds[index]}` : `emoticon ${index + 1}`);
    if (this.sheet) el.style.backgroundImage = `url(${this.sheet})`;
    el.style.backgroundPosition = `-${(index % EMO_COLS) * EMO_SIZE}px -${Math.floor(index / EMO_COLS) * EMO_SIZE}px`;
    return el;
  }

  /** lê as tabelas uma vez (também ao entrar no jogo, para os comandos do chat valerem sem abrir a janela) */
  loadTables(): Promise<void> {
    this.loading ??= (async () => {
      const [mot, motTxt, emo, emoTxt, sheet] = await Promise.all([
        fetchBuf('/res/propMotion.txt'), fetchBuf('/res/propMotion.txt.txt'), fetchBuf('/res/textEmotion.txt'), fetchBuf('/res/textEmotion.txt.txt'),
        themeDds('texChatEmoticon.dds'),
      ]);
      this.sheet = sheet;
      const names = motTxt ? parseTxtTxt(decodeText(motTxt)) : new Map<string, string>();
      for (const line of mot ? decodeText(mot).split(/\r?\n/) : []) {
        if (/^\s*\/\//.test(line)) continue;
        const f = line.split('\t').map((x) => x.trim()).filter(Boolean);
        // versão, dwID, dwMotion, ícone, dwPlay, nome, descrição, item que libera, preço
        if (f.length < 7 || !/^MOT_/.test(f[1]) || (!/^MTI_/.test(f[2]) && f[1] !== 'MOT_BASE_BATTLE')) continue;
        // Sentar no original é um estado (OBJMSG_SITDOWN): aqui senta e fica sentado até andar
        this.motions.push({ id: f[1], motion: f[2], icon: f[3].replace(/"/g, ''), play: f[1] === 'MOT_BASE_SIT' ? 1 : Number(f[4]) || 0, name: names.get(f[5]) || (f[1] === 'MOT_BASE_BATTLE' ? 'Modo de batalha' : f[1]), desc: names.get(f[6]) || (f[1] === 'MOT_BASE_BATTLE' ? 'Troca entre a postura de combate e a normal.' : '') });
      }
      const ids = emoTxt ? parseTxtTxt(decodeText(emoTxt)) : new Map<string, string>();
      for (const line of emo ? decodeText(emo).split(/\r?\n/) : []) {
        const m = /^\s*(\d+)\s+(IDS_\S+)/.exec(line);
        if (m) this.emoCmds[Number(m[1])] = (ids.get(m[2]) ?? '').trim().toLowerCase();
      }
    })();
    return this.loading;
  }

  private render() {
    for (const t of this.tabs.children) { const on = (t as HTMLElement).dataset.k === this.tab; t.classList.toggle('on', on); t.setAttribute('aria-selected', String(on)); }
    this.grid.replaceChildren();
    if (this.tab === 'motion') {
      for (const m of this.motions) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'mot-btn';
        btn.title = m.desc ? `${m.name}\n${m.desc}` : m.name;
        btn.setAttribute('aria-label', m.name);
        const img = document.createElement('img');
        img.alt = '';
        void skillIcon(m.icon).then((u) => { if (u) img.src = u; else { img.remove(); btn.textContent = m.name.slice(0, 3); } });
        btn.append(img);
        btn.addEventListener('click', () => this.onMotion(m));
        this.grid.append(btn);
      }
    } else {
      for (let i = 0; i < EMO_COUNT; i++) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'mot-btn';
        if (this.emoCmds[i]) btn.title = `/${this.emoCmds[i]}`;
        btn.append(this.emoticonEl(i));
        btn.addEventListener('click', () => this.onEmoticon(i));
        this.grid.append(btn);
      }
    }
  }
}
