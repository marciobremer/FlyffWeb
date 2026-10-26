import { keyedImage, themeImage } from '../shared/tga';
import { GameWindow } from './ui';
import type { PlayerStats } from './net';
import { fxText } from './itemtip';

/** "Ataque +7%" → ["Ataque", "+7%"] (último pedaço é o valor) */
const splitFx = (s: string): [string, string] => { const i = s.lastIndexOf(' '); return i > 0 ? [s.slice(0, i), s.slice(i + 1)] : [s, '']; };

/**
 * Janela de personagem (tecla H ou menu → Personagem): nome, classe, nível, exp; STR/STA/DEX/INT com "+"/"−" para
 * distribuir os pontos livres — ou a caixa de número, para digitar quantos de uma vez (Enter aplica) — (só vale ao clicar
 * Apply; Reset desfaz o que ainda não foi aplicado) e os valores
 * calculados pelo servidor (ataque, defesa, crítico, velocidade, HP/MP/FP). Botões do tema: ButtCharPlus/Minus.bmp
 * (4 quadros 14×14, magenta transparente) e ButtCharApply/Reset.tga (4 quadros 50×20).
 */
const JOB_NAMES = ['Vagrant', 'Mercenary', 'Acrobat', 'Assist', 'Magician', 'Puppeteer', 'Knight', 'Blade', 'Jester', 'Ranger', 'Ringmaster', 'Billposter',
  'Psykeeper', 'Elementor', 'Gatekeeper', 'Doppler', 'Knight (Master)', 'Blade (Master)', 'Jester (Master)', 'Ranger (Master)', 'Ringmaster (Master)',
  'Billposter (Master)', 'Psykeeper (Master)', 'Elementor (Master)', 'Knight (Hero)', 'Blade (Hero)', 'Jester (Hero)', 'Ranger (Hero)', 'Ringmaster (Hero)',
  'Billposter (Hero)', 'Psykeeper (Hero)', 'Elementor (Hero)', 'Lord Templer', 'Storm Blade', 'Wind Lurker', 'Crackshooter', 'Florist', 'Force Master',
  'Mentalist', 'Elementor Lord'];

type Stat = 'str' | 'sta' | 'dex' | 'int';
const STATS: [Stat, string, string][] = [
  ['str', 'STR', 'Força: aumenta o ataque das armas corpo a corpo'],
  ['sta', 'STA', 'Vigor: aumenta HP, FP e defesa'],
  ['dex', 'DEX', 'Destreza: aumenta acerto, esquiva e chance de crítico'],
  ['int', 'INT', 'Inteligência: aumenta MP e o ataque de magia'],
];

const imgBtn = (cls: string, label: string) => {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = cls;
  b.setAttribute('aria-label', label);
  b.innerHTML = `<span>${label}</span>`;
  return b;
};

export class CharacterWindow extends GameWindow {
  /** manda os pontos distribuídos ao servidor */
  onApply: (add: Record<Stat, number>) => void = () => {};

  private s: PlayerStats | null = null;
  private name = '';
  private pending: Record<Stat, number> = { str: 0, sta: 0, dex: 0, int: 0 };
  private head = document.createElement('div');
  private rows = new Map<Stat, { value: HTMLElement; input: HTMLInputElement; plus: HTMLButtonElement; minus: HTMLButtonElement }>();
  private pointsEl = document.createElement('output');
  private derived = document.createElement('dl');
  private applyBtn = imgBtn('cw-btn', 'Aplicar');
  private resetBtn = imgBtn('cw-btn', 'Desfazer');

  constructor(parent: HTMLElement) {
    super(parent, { id: 'charWnd', title: 'Personagem', store: 'flyff.wnd.character', initial: { x: 210, y: 120, w: 240, h: 430 }, min: { w: 230, h: 400 } });
    const b = this.body;
    b.classList.add('cw');
    this.head.className = 'cw-head';

    const stats = document.createElement('div');
    stats.className = 'cw-stats';
    for (const [k, label, tip] of STATS) {
      const row = document.createElement('div');
      row.className = 'cw-row';
      row.title = tip;
      const name = document.createElement('b');
      name.textContent = label;
      const value = document.createElement('span');
      value.className = 'cw-val';
      const minus = imgBtn('cw-pm minus', `Tirar ponto de ${label}`);
      const plus = imgBtn('cw-pm plus', `Pôr ponto em ${label}`);
      // quantos pontos pôr neste atributo, digitado (servidor de exp alta: muitos pontos de uma vez)
      const input = document.createElement('input');
      input.type = 'number';
      input.min = '0';
      input.className = 'cw-in';
      input.placeholder = '0';
      input.setAttribute('aria-label', `Pontos para ${label}`);
      input.addEventListener('input', () => {
        const n = Math.floor(Number(input.value) || 0);
        this.pending[k] = Math.max(0, Math.min(n, this.pending[k] + this.free()));
        this.render();
      });
      input.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') this.applyBtn.click(); });
      input.addEventListener('blur', () => this.render());
      minus.addEventListener('click', () => { if (this.pending[k] > 0) { this.pending[k]--; this.render(); } });
      plus.addEventListener('click', () => { if (this.free() > 0) { this.pending[k]++; this.render(); } });
      row.append(name, value, input, minus, plus);
      stats.appendChild(row);
      this.rows.set(k, { value, input, plus, minus });
    }
    const pts = document.createElement('div');
    pts.className = 'cw-points';
    pts.append('Pontos livres: ', this.pointsEl);

    const btns = document.createElement('div');
    btns.className = 'cw-btns';
    this.applyBtn.addEventListener('click', () => {
      if (!this.pendingTotal()) return;
      this.onApply({ ...this.pending });
      this.pending = { str: 0, sta: 0, dex: 0, int: 0 };
      this.render();
    });
    this.resetBtn.addEventListener('click', () => { this.pending = { str: 0, sta: 0, dex: 0, int: 0 }; this.render(); });
    btns.append(this.resetBtn, this.applyBtn);

    this.derived.className = 'cw-derived';
    b.append(this.head, stats, pts, btns, this.derived);

    void themeImage('ButtCharApply.tga').then((u) => { if (u) { this.applyBtn.style.backgroundImage = `url(${u})`; this.applyBtn.classList.add('img'); } });
    void themeImage('ButtCharReset.tga').then((u) => { if (u) { this.resetBtn.style.backgroundImage = `url(${u})`; this.resetBtn.classList.add('img'); } });
    void keyedImage('ButtCharPlus.bmp').then((u) => { if (u) for (const r of this.rows.values()) { r.plus.style.backgroundImage = `url(${u})`; r.plus.classList.add('img'); } });
    void keyedImage('ButtCharMinus.bmp').then((u) => { if (u) for (const r of this.rows.values()) { r.minus.style.backgroundImage = `url(${u})`; r.minus.classList.add('img'); } });
    this.render();
  }

  private pendingTotal() { return this.pending.str + this.pending.sta + this.pending.dex + this.pending.int; }
  private free() { return (this.s?.points ?? 0) - this.pendingTotal(); }

  setName(name: string) { this.name = name; this.render(); }

  /** atributos novos do servidor (descarta o pendente que não cabe mais) */
  setStats(s: PlayerStats) {
    this.s = s;
    if (this.pendingTotal() > s.points) this.pending = { str: 0, sta: 0, dex: 0, int: 0 };
    this.render();
  }

  private render() {
    const s = this.s;
    const expPct = s && s.expMax > 0 ? ((s.exp / s.expMax) * 100).toFixed(2) : '0.00';
    this.head.innerHTML = '';
    const line = (label: string, value: string) => { const d = document.createElement('div'); const l = document.createElement('span'); l.textContent = label; const v = document.createElement('b'); v.textContent = value; d.append(l, v); this.head.appendChild(d); };
    line('Nome', this.name || '—');
    line('Classe', s ? JOB_NAMES[s.job] ?? `#${s.job}` : '—');
    line('Nível', s ? String(s.level) : '—');
    line('Exp', `${expPct}%`);
    const free = this.free();
    for (const [k, r] of this.rows) {
      const base = s ? s[k] : 0, add = this.pending[k];
      const extra = s?.bonus[k] ?? 0;
      r.value.textContent = `${base}${add ? ` + ${add}` : ''}${extra ? ` (${extra > 0 ? '+' : ''}${extra})` : ''}`;
      r.value.classList.toggle('pending', add > 0);
      // não reescreve a caixa enquanto digita (só corrige se passou do que dá)
      if (document.activeElement !== r.input || Number(r.input.value || 0) !== add) r.input.value = add ? String(add) : '';
      r.input.max = String(add + free);
      r.input.disabled = !s || add + free <= 0;
      r.plus.disabled = free <= 0;
      r.minus.disabled = add <= 0;
      r.minus.hidden = !this.pendingTotal();
    }
    this.pointsEl.value = String(free);
    this.pointsEl.classList.toggle('has', free > 0);
    this.applyBtn.disabled = this.resetBtn.disabled = this.pendingTotal() === 0;
    this.derived.innerHTML = '';
    if (!s) return;
    const add = (dt: string, dd: string) => { const t = document.createElement('dt'); t.textContent = dt; const d = document.createElement('dd'); d.textContent = dd; this.derived.append(t, d); };
    add('Ataque', `${s.atk[0]} ~ ${s.atk[1]}`);
    add('Defesa', String(s.def));
    add('Chance de crítico', `${s.crit}%`);
    add('Dano crítico', `+${s.cdmg ?? 0}%`);
    add('Vel. de ataque', `${s.spd}%`);
    add('Precisão extra', `${s.acc}%`);
    add('Esquiva', String(s.dodge));
    add('HP', `${s.hp} / ${s.maxHp}`);
    add('MP', `${s.mp} / ${s.maxMp}`);
    add('FP', `${s.fp} / ${s.maxFp}`);
    // corrida em relação à base (fSpeed 0,1 × 60 = 6 u/s)
    if (s.mv) add('Velocidade', `${Math.round((s.mv / 6) * 100)}%`);
    // bônus somados de equipamento, joias, cartas espetadas, sets e buffs (já aplicados nos valores acima)
    for (const [k, v] of s.fx ?? []) {
      const [name, val] = splitFx(fxText(k, v));
      const t = document.createElement('dt'); t.textContent = name; t.className = 'bonus';
      const d = document.createElement('dd'); d.textContent = val; d.className = 'bonus';
      this.derived.append(t, d);
    }
  }
}
