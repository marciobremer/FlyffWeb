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
  /** fonte da interface ('' = a do jogo), formato do dano (0 = junto, 1 = com espaços), pets (0 = todos, 1 = esconde os dos outros, 2 = esconde todos), tema do cursor (pasta de Data/Cursors) */
  font: string; dmgFormat: number; pets: number; cursor: string;
  hideChat: boolean; hideHeal: boolean; roundBuffs: boolean;
  /** Custom */ autoNext: boolean; hideNpcBubbles: boolean; msgTime: boolean;
  /** Game / Audio: o que aceita receber (true = aceita) */ trade: boolean; whisper: boolean; friend: boolean; guild: boolean; party: boolean;
  autoAttack: boolean; msgAlarm: boolean; translucency: boolean; muteMin: boolean;
  /** Custom */ winOpacity: number; showFps: boolean;
  /** Game / Audio */ volume: number; mute: boolean;
}

export const DEFAULT_OPTS: Opts = {
  field: 0, objRange: 0, objDetail: 0, shadow: 0, itemFx: 0.85, bgFx: 0.9, gamma: 0.5, brightness: 0.5, shade: 0.5,
  lowRender: false, expandCam: false, npcNames: true, damage: true, myName: true, otherNames: true, weather: true,
  windowMode: true, viewMask: true, camFix: true, reduceAA: true, aniso: true,
  quality: 'high', fps: 60, resScale: 1, winOpacity: 1, showFps: true, volume: 0.5, mute: false,
  font: '', dmgFormat: 0, pets: 0, cursor: 'CurDefault', hideChat: false, hideHeal: false, roundBuffs: false,
  autoNext: true, hideNpcBubbles: true, msgTime: false,
  trade: true, whisper: true, friend: true, guild: true, party: true, autoAttack: true, msgAlarm: true, translucency: false, muteMin: false,
};

const KEY = 'flyff.options.v1';
export const loadOpts = (): Opts => {
  try { return { ...DEFAULT_OPTS, ...(JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Opts>) }; } catch { return { ...DEFAULT_OPTS }; }
};

const FONTS: [string, string][] = [['Default (Tahoma)', ''], ['Arial', 'Arial'], ['Verdana', 'Verdana'], ['Segoe UI', 'Segoe UI'], ['Trebuchet MS', 'Trebuchet MS'], ['Georgia', 'Georgia'], ['Courier New', 'Courier New'], ['Comic Sans MS', 'Comic Sans MS']];
/** temas de cursor de Data/Cursors (o CurDefault6 só tem o martelo animado, fica de fora) */
const CURSORS: [string, string][] = [['Default Cursors', 'CurDefault'], ['Titanium Cursors', 'CurTitanium'], ['Custom Cursors #1', 'CurCustom1'], ['Custom Cursors #2', 'CurCustom2'], ['Cursors 1', 'CurDefault1'], ['Cursors 2', 'CurDefault2'], ['Cursors 3', 'CurDefault3'], ['Cursors 4', 'CurDefault4'], ['Cursors 5', 'CurDefault5']];
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
    super(parent, { id: 'optWnd', title: 'Option', store: 'flyff.wnd.options', initial: { x: 280, y: 60, w: 560, h: 560 }, min: { w: 540, h: 470 } });
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

  private check(col: HTMLElement, label: string, k: keyof Pick<Opts, 'lowRender' | 'expandCam' | 'npcNames' | 'damage' | 'myName' | 'otherNames' | 'weather' | 'windowMode' | 'viewMask' | 'camFix' | 'reduceAA' | 'aniso' | 'showFps' | 'mute' | 'hideChat' | 'hideHeal' | 'roundBuffs' | 'autoNext' | 'hideNpcBubbles' | 'msgTime' | 'msgAlarm' | 'translucency' | 'muteMin'> | 'night' | 'off', title = '') {
    const lab = document.createElement('label');
    lab.className = 'op-check';
    if (title) lab.title = title;
    const c = document.createElement('input'); c.type = 'checkbox';
    if (k === 'night' || k === 'off') { c.disabled = true; lab.classList.add('off'); lab.title = title || 'Em breve'; }
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

  /** lista suspensa (rótulo azul em cima, como na aba Rendering do cliente) */
  private select<K extends 'font' | 'dmgFormat' | 'pets'>(col: HTMLElement, label: string, k: K, options: [string, string | number][]) {
    const l = document.createElement('div'); l.className = 'op-sel-lbl'; l.textContent = label;
    const s = document.createElement('select'); s.className = 'op-sel';
    options.forEach(([name, v], i) => { const o = document.createElement('option'); o.value = String(i); o.textContent = name; s.append(o); });
    const show = () => { s.value = String(Math.max(0, options.findIndex(([, v]) => v === this.values[k]))); };
    show();
    s.addEventListener('change', () => this.set(k, options[Number(s.value)][1] as never));
    this.sync.push(show);
    col.append(l, s);
  }

  /** lista de temas de cursor, com a seta de cada um ao lado do nome; o escolhido fica em azul */
  private cursorList(col: HTMLElement) {
    const l = document.createElement('div'); l.className = 'op-sel-lbl'; l.textContent = 'Cursors'; col.append(l);
    const box = document.createElement('div'); box.className = 'op-curlist'; box.setAttribute('role', 'listbox'); col.append(box);
    const rows = CURSORS.map(([name, folder]) => {
      const r = document.createElement('button'); r.type = 'button'; r.className = 'op-cur'; r.setAttribute('role', 'option');
      const img = document.createElement('img'); img.alt = ''; img.width = img.height = 20; img.src = `/res/Data/Cursors/${folder}/curBase.cur`;
      r.append(img, document.createTextNode(name));
      r.addEventListener('click', () => { this.set('cursor', folder); show(); });
      box.append(r);
      return [r, folder] as const;
    });
    const show = () => rows.forEach(([r, f]) => { r.classList.toggle('on', this.values.cursor === f); r.setAttribute('aria-selected', String(this.values.cursor === f)); });
    show();
    this.sync.push(show);
  }

  private buildRendering(p: HTMLElement) {
    this.head(p, '~ Rendering Option ~');
    const cols = document.createElement('div'); cols.className = 'op-cols';
    const left = document.createElement('div'), right = document.createElement('div');
    cols.append(left, right); p.append(cols);
    this.select(left, 'Game Font', 'font', FONTS);
    this.select(left, 'Render Damage', 'dmgFormat', [['None', 0], ['Spaces', 1]]);
    this.select(left, 'Pet Options', 'pets', [['Show Pets', 0], ['Hide Others\' Pets', 1], ['Hide Pets', 2]]);
    this.cursorList(left);
    this.check(right, 'Hide Chatbox', 'hideChat');
    this.check(right, 'Hide Healing Numbers', 'hideHeal');
    this.check(right, 'Round Buff Icons', 'roundBuffs');
    const sub = document.createElement('div'); sub.className = 'op-sub'; right.append(sub);
    this.head(sub, 'Performance');
    this.choice(sub, 'Quality', 'quality', [['High', 'high'], ['Mid', 'medium'], ['Low', 'low']]);
    this.choice(sub, 'FPS limit', 'fps', [['30', 30], ['60', 60], ['Max', 0]]);
    this.slider(sub, 'Resolution', 'resScale', 0.5, 1, 0.05);
  }

  private buildCustom(p: HTMLElement) {
    this.head(p, '~ Custom Option ~');
    const col = document.createElement('div'); col.className = 'op-one'; p.append(col);
    this.check(col, 'Auto Attack Next Target', 'autoNext', 'Atacando um monstro, clique em outro: quando o atual morrer, o jogo ataca o próximo sozinho');
    this.check(col, 'Block EXP Gain', 'off');
    this.check(col, 'Hide Guildbuffs', 'off');
    this.check(col, 'Hide NPC Chat Bubbles', 'hideNpcBubbles', 'Esconde os balões de fala dos NPCs');
    this.check(col, 'Hide Trails', 'off');
    this.check(col, 'Message Time [H:M]', 'msgTime', 'Mostra a hora no começo de cada linha do chat');
    this.check(col, 'Monster <Lvl> Tag', 'off', 'O nível do monstro aparece só para GM/admin');
    this.check(col, 'Print monsterhunt progress', 'off');
    this.check(col, 'Skip Lootbox Confirm', 'off');
    const sub = document.createElement('div'); sub.className = 'op-sub'; col.append(sub);
    this.slider(sub, 'Window opacity', 'winOpacity', 0.4, 1, 0.02);
    this.check(sub, 'Show FPS / ping', 'showFps');
  }

  /** par de botões Allow/Refuse etc. ligado a uma opção verdadeiro/falso (ou desativado, `k` nulo) */
  private bool2(col: HTMLElement, label: string, k: 'trade' | 'whisper' | 'friend' | 'guild' | 'party' | 'autoAttack' | 'msgAlarm' | null, on: string, off: string, offByDefault = false) {
    const l = document.createElement('div'); l.className = 'op-sel-lbl'; l.textContent = label; col.append(l);
    const row = document.createElement('div'); row.className = 'op-pair'; col.append(row);
    const mk = (name: string, v: boolean) => {
      const lab = document.createElement('label'); lab.className = 'op-radio';
      const r = document.createElement('input'); r.type = 'radio'; r.name = `op-${label}`;
      if (k === null) { r.disabled = true; r.checked = v === !offByDefault; lab.classList.add('off'); lab.title = 'Em breve'; }
      else { r.checked = this.values[k] === v; r.addEventListener('change', () => { if (r.checked) this.set(k, v); }); this.sync.push(() => { r.checked = this.values[k] === v; }); }
      lab.append(r, document.createTextNode(name)); row.append(lab);
    };
    mk(on, true); mk(off, false);
  }

  private buildAudio(p: HTMLElement) {
    this.head(p, '~ Game Option ~');
    const cols = document.createElement('div'); cols.className = 'op-cols';
    const left = document.createElement('div'), right = document.createElement('div');
    cols.append(left, right); p.append(cols);
    this.bool2(left, 'Trading', 'trade', 'Allow', 'Refuse');
    this.bool2(left, 'Whispers & Messages', 'whisper', 'Allow', 'Disapprove');
    this.bool2(left, 'Friend Invites', 'friend', 'Approve', 'Disapprove');
    this.bool2(left, 'Duel Requests', null, 'ON', 'OFF');
    this.bool2(left, 'Guild Invites', 'guild', 'ON', 'OFF');
    this.bool2(left, 'Party Invites', 'party', 'Allow', 'Disapprove');
    this.bool2(left, 'Automatic Attack', 'autoAttack', 'ON', 'OFF');
    this.bool2(right, 'Allow Inventory View', null, 'Approve', 'Refuse', true);
    this.bool2(right, 'Message Alarm', 'msgAlarm', 'ON', 'OFF');
    const h = document.createElement('div'); h.className = 'op-sel-lbl'; h.textContent = 'Help Option'; right.append(h);
    this.check(right, 'Beginner Guide', 'off');
    this.check(right, 'Info Pang', 'off');
    const w = document.createElement('div'); w.className = 'op-sel-lbl'; w.textContent = 'Window Effects'; right.append(w);
    this.check(right, 'Translucency', 'translucency', 'As janelas ficam translúcidas enquanto você as arrasta');
    const s = document.createElement('div'); s.className = 'op-sel-lbl'; s.textContent = 'Sound Option'; right.append(s);
    this.slider(right, 'BGM', 'volume'); (right.lastElementChild as HTMLElement).classList.add('off'); (right.lastElementChild!.querySelector('input') as HTMLInputElement).disabled = true; right.lastElementChild!.setAttribute('title', 'Ainda não há música de fundo');
    this.slider(right, 'Sound Effect', 'volume');
    this.check(right, 'Battle Music', 'off');
    this.check(right, 'Mute Sound (Minimized)', 'muteMin', 'Silencia os sons quando a aba fica escondida');
    this.check(right, 'Mute Music (Minimized)', 'off');
  }

  private buildHotkeys(p: HTMLElement) {
    this.head(p, '~ Hotkeys ~');
    const t = document.createElement('div'); t.className = 'op-keys';
    for (const [k, d] of HOTKEYS) { const a = document.createElement('b'), b = document.createElement('span'); a.textContent = k; b.textContent = d; t.append(a, b); }
    const n = document.createElement('p'); n.className = 'op-note'; n.textContent = 'Trocar as teclas ainda não é possível (em breve).';
    p.append(t, n);
  }
}
