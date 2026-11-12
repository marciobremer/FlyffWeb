import { GameWindow } from './ui';
import './options.css';

/**
 * Janela de opções (menu "Opções"), no arranjo da "Option" do cliente: abas Video / Rendering / Custom / Game-Audio / Hotkeys.
 * Guarda tudo em `localStorage` (flyff.options.v1) e avisa `onChange(valores, chave)` a cada mudança — quem aplica é o main.ts.
 * A caixa "Night Mode" aparece, mas fica desligada: a função ainda não existe.
 */
export interface Opts {
  /** 0 = High, 1 = Middle, 2 = Low */
  field: number; objRange: number; objDetail: number; shadow: number;
  itemFx: number; bgFx: number; gamma: number; brightness: number; shade: number;
  lowRender: boolean; expandCam: boolean; npcNames: boolean; damage: boolean; myName: boolean; otherNames: boolean; weather: boolean;
  windowMode: boolean; viewMask: boolean; camFix: boolean; reduceAA: boolean; aniso: boolean;
  /** Rendering */ quality: 'high' | 'medium' | 'low'; fps: number; resScale: number;
  /** Custom */ winOpacity: number; showFps: boolean;
  /** Game / Audio */ volume: number; mute: boolean;
}

export const DEFAULT_OPTS: Opts = {
  field: 0, objRange: 0, objDetail: 0, shadow: 0, itemFx: 0.85, bgFx: 0.9, gamma: 0.5, brightness: 0.5, shade: 0.5,
  lowRender: false, expandCam: false, npcNames: true, damage: true, myName: true, otherNames: true, weather: true,
  windowMode: true, viewMask: true, camFix: true, reduceAA: true, aniso: true,
  quality: 'high', fps: 60, resScale: 1, winOpacity: 1, showFps: true, volume: 0.5, mute: false,
};

const KEY = 'flyff.options.v1';
export const loadOpts = (): Opts => {
  try { return { ...DEFAULT_OPTS, ...(JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Opts>) }; } catch { return { ...DEFAULT_OPTS }; }
};

const TABS = ['Video', 'Rendering', 'Custom', 'Game / Audio', 'Hotkeys'];
const HOTKEYS: [string, string][] = [
  ['W A S D / setas', 'Andar'], ['Espaço', 'Pular'], ['X', 'Andar / correr'], ['Clique no chão', 'Andar até lá'], ['Clique no monstro (duas vezes)', 'Selecionar / atacar'],
  ['Esc', 'Desmarcar alvo'], ['1 … 9, 0', 'Atalhos da barra'], ['Enter', 'Chat'], ['I', 'Inventário'], ['H', 'Personagem'], ['K', 'Habilidades'],
  ['J', 'Duração do item'], ['Q', 'Quests'], ['B', 'Craft'], ['L', 'Lista de partys'], ['P', 'Party'], ['G', 'Guilda'], ['E', 'Mensageiro'],
  ['O', 'Movimentos'], ['M', 'Mapa do mundo'], ['V', 'Teleporter'], ['Botão direito (segurar)', 'Girar a câmera'], ['Roda do mouse', 'Zoom'],
];

export class OptionsWindow extends GameWindow {
  readonly values: Opts = loadOpts();
  /** mudou a opção `key` (ou `null` = aplicar todas, ao iniciar) */
  onChange: (o: Opts, key: keyof Opts | null) => void = () => {};
  private pages: HTMLElement[] = [];
  private tabBtns: HTMLButtonElement[] = [];
  private sync: (() => void)[] = [];

  constructor(parent: HTMLElement) {
    super(parent, { id: 'optWnd', title: 'Option', store: 'flyff.wnd.options', initial: { x: 280, y: 90, w: 540, h: 470 }, min: { w: 540, h: 470 } });
    const b = this.body;
    b.classList.add('op');
    const pages = document.createElement('div');
    pages.className = 'op-pages';
    this.pages = TABS.map(() => { const p = document.createElement('div'); p.className = 'op-page'; pages.append(p); return p; });
    const tabs = document.createElement('div');
    tabs.className = 'op-tabs';
    TABS.forEach((name, i) => {
      const t = document.createElement('button');
      t.type = 'button';
      t.textContent = name;
      t.addEventListener('click', () => this.tab(i));
      this.tabBtns.push(t);
      tabs.append(t);
    });
    b.append(pages, tabs);
    this.buildVideo(this.pages[0]);
    this.buildRendering(this.pages[1]);
    this.buildCustom(this.pages[2]);
    this.buildAudio(this.pages[3]);
    this.buildHotkeys(this.pages[4]);
    this.tab(0);
  }

  override show() { super.show(); this.sync.forEach((f) => f()); }

  /** aplica tudo de uma vez (ao iniciar o jogo) */
  applyAll() { this.onChange(this.values, null); }

  private tab(i: number) {
    this.pages.forEach((p, k) => { p.hidden = k !== i; });
    this.tabBtns.forEach((t, k) => t.classList.toggle('on', k === i));
  }

  private set<K extends keyof Opts>(k: K, v: Opts[K]) {
    this.values[k] = v;
    try { localStorage.setItem(KEY, JSON.stringify(this.values)); } catch { /* sem armazenamento */ }
    this.onChange(this.values, k);
  }

  // ---------- peças ----------
  private head(page: HTMLElement, text: string) { const h = document.createElement('div'); h.className = 'op-head'; h.textContent = text; page.append(h); }

  /** High / Middle / Low */
  private radio3(col: HTMLElement, label: string, k: 'field' | 'objRange' | 'objDetail' | 'shadow') {
    const row = document.createElement('div');
    row.className = 'op-row';
    const l = document.createElement('span'); l.className = 'op-lbl'; l.textContent = label; row.append(l);
    const inputs = ['High', 'Middle', 'Low'].map((name, i) => {
      const lab = document.createElement('label'); lab.className = 'op-radio';
      const r = document.createElement('input'); r.type = 'radio'; r.name = `op-${k}`; r.checked = this.values[k] === i;
      r.addEventListener('change', () => { if (r.checked) this.set(k, i); });
      lab.append(r, document.createTextNode(name)); row.append(lab);
      return r;
    });
    this.sync.push(() => inputs.forEach((r, i) => { r.checked = this.values[k] === i; }));
    col.append(row);
  }

  private slider(col: HTMLElement, label: string, k: 'itemFx' | 'bgFx' | 'gamma' | 'brightness' | 'shade' | 'volume' | 'winOpacity' | 'resScale', min = 0, max = 1, step = 0.01) {
    const row = document.createElement('div');
    row.className = 'op-row';
    const l = document.createElement('span'); l.className = 'op-lbl'; l.textContent = label;
    const s = document.createElement('input'); s.type = 'range'; s.min = String(min); s.max = String(max); s.step = String(step); s.value = String(this.values[k]);
    s.addEventListener('input', () => this.set(k, Number(s.value)));
    row.append(l, s);
    this.sync.push(() => { s.value = String(this.values[k]); });
    col.append(row);
  }

  private check(col: HTMLElement, label: string, k: keyof Pick<Opts, 'lowRender' | 'expandCam' | 'npcNames' | 'damage' | 'myName' | 'otherNames' | 'weather' | 'windowMode' | 'viewMask' | 'camFix' | 'reduceAA' | 'aniso' | 'showFps' | 'mute'> | 'night', title = '') {
    const lab = document.createElement('label');
    lab.className = 'op-check';
    if (title) lab.title = title;
    const c = document.createElement('input'); c.type = 'checkbox';
    if (k === 'night') { c.disabled = true; lab.classList.add('off'); lab.title = 'Em breve'; }
    else {
      c.checked = this.values[k];
      c.addEventListener('change', () => this.set(k, c.checked));
      this.sync.push(() => { c.checked = this.values[k]; });
    }
    lab.append(c, document.createTextNode(label));
    col.append(lab);
  }

  private choice(col: HTMLElement, label: string, k: 'quality' | 'fps', options: [string, string | number][]) {
    const row = document.createElement('div');
    row.className = 'op-row';
    const l = document.createElement('span'); l.className = 'op-lbl'; l.textContent = label; row.append(l);
    const inputs = options.map(([name, v]) => {
      const lab = document.createElement('label'); lab.className = 'op-radio';
      const r = document.createElement('input'); r.type = 'radio'; r.name = `op-${k}`; r.checked = this.values[k] === v;
      r.addEventListener('change', () => { if (r.checked) this.set(k, v as never); });
      lab.append(r, document.createTextNode(name)); row.append(lab);
      return [r, v] as const;
    });
    this.sync.push(() => inputs.forEach(([r, v]) => { r.checked = this.values[k] === v; }));
    col.append(row);
  }

  // ---------- abas ----------
  private buildVideo(p: HTMLElement) {
    this.head(p, '~ Video Option ~');
    const cols = document.createElement('div'); cols.className = 'op-cols';
    const left = document.createElement('div'), right = document.createElement('div');
    cols.append(left, right); p.append(cols);
    this.radio3(left, 'Field Detail', 'field');
    this.radio3(left, 'Object Range', 'objRange');
    this.radio3(left, 'Object Detail', 'objDetail');
    this.radio3(left, 'Shadow Detail', 'shadow');
    this.slider(left, 'Item effect', 'itemFx');
    this.slider(left, 'BG effect', 'bgFx');
    this.slider(left, 'Gamma', 'gamma');
    this.slider(left, 'Brightness', 'brightness');
    this.slider(left, 'Shade', 'shade');
    this.check(left, 'Low Render (Minimized)', 'lowRender', 'Com a aba escondida o jogo desenha bem menos quadros');
    this.check(right, 'Expand Camera', 'expandCam', 'Deixa a câmera afastar mais');
    this.check(right, 'Show NPC Name', 'npcNames');
    this.check(right, 'Display Damage', 'damage');
    this.check(right, 'Show My Name', 'myName');
    this.check(right, 'Show Others Name', 'otherNames');
    this.check(right, 'Weather', 'weather');
    this.check(right, 'Window Mode', 'windowMode', 'Desmarcado = tela cheia');
    this.check(right, 'View Mask', 'viewMask');
    this.check(right, 'Camera Fix', 'camFix', 'A câmera não atravessa paredes e chão');
    this.check(right, 'Reduce Aliasing', 'reduceAA', 'Serrilhado menor (resolução cheia da tela)');
    this.check(right, 'Anisotropic Filtering', 'aniso');
    this.check(right, 'Night Mode', 'night');
  }

  private buildRendering(p: HTMLElement) {
    this.head(p, '~ Rendering ~');
    const col = document.createElement('div'); col.className = 'op-one'; p.append(col);
    this.choice(col, 'Quality', 'quality', [['High', 'high'], ['Middle', 'medium'], ['Low', 'low']]);
    this.choice(col, 'FPS limit', 'fps', [['30', 30], ['60', 60], ['Max', 0]]);
    this.slider(col, 'Resolution', 'resScale', 0.5, 1, 0.05);
    const n = document.createElement('p'); n.className = 'op-note'; n.textContent = 'Quality liga/desliga sombra e reduz o alcance do cenário; Resolution reduz a imagem para ganhar quadros.'; col.append(n);
  }

  private buildCustom(p: HTMLElement) {
    this.head(p, '~ Custom ~');
    const col = document.createElement('div'); col.className = 'op-one'; p.append(col);
    this.slider(col, 'Window opacity', 'winOpacity', 0.4, 1, 0.02);
    this.check(col, 'Show FPS / ping', 'showFps');
  }

  private buildAudio(p: HTMLElement) {
    this.head(p, '~ Game / Audio ~');
    const col = document.createElement('div'); col.className = 'op-one'; p.append(col);
    this.slider(col, 'Volume', 'volume');
    this.check(col, 'Mute', 'mute');
  }

  private buildHotkeys(p: HTMLElement) {
    this.head(p, '~ Hotkeys ~');
    const t = document.createElement('div'); t.className = 'op-keys';
    for (const [k, d] of HOTKEYS) { const a = document.createElement('b'), b = document.createElement('span'); a.textContent = k; b.textContent = d; t.append(a, b); }
    const n = document.createElement('p'); n.className = 'op-note'; n.textContent = 'Trocar as teclas ainda não é possível (em breve).';
    p.append(t, n);
  }
}
