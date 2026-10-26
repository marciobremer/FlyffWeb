import { keyedImage, skillIcon, themeImage } from '../shared/tga';
import { GameWindow } from './ui';
import type { PlayerStats } from './net';
import { fxText } from './itemtip';
import { TICKS_PER_SEC } from '../shared/math';

/** "Ataque +7%" → ["Ataque", "+7%"] (último pedaço é o valor) */
const splitFx = (s: string): [string, string] => { const i = s.lastIndexOf(' '); return i > 0 ? [s.slice(0, i), s.slice(i + 1)] : [s, '']; };

/**
 * Janela de personagem (tecla H ou menu → Personagem), no layout do CWndCharInfo das versões 15+: aba "Personagem" com
 * Básico (nome, classe + selo Master/Hero, nível, servidor, canal), Detalhe em duas colunas (ataque, crítico, defesa,
 * velocidade de ataque e de movimento, precisão, dano crítico, bloqueios, conjuração, PvM/PvP), STR/STA/DEX/INT com
 * "+"/"−" ou a caixa de número para distribuir os pontos livres (só vale ao clicar Aplicar; Desfazer limpa) e PVP/PK; aba
 * "Fama/Master" com fama, nível de master/hero, HP/MP/FP, exp e todos os bônus somados. Botões do tema: ButtCharPlus/
 * Minus.bmp (4 quadros 14×14, magenta transparente) e ButtCharApply/Reset.tga (4 quadros 50×20).
 */
const JOB_NAMES = ['Vagrant', 'Mercenary', 'Acrobat', 'Assist', 'Magician', 'Puppeteer', 'Knight', 'Blade', 'Jester', 'Ranger', 'Ringmaster', 'Billposter',
  'Psykeeper', 'Elementor', 'Gatekeeper', 'Doppler', 'Knight (Master)', 'Blade (Master)', 'Jester (Master)', 'Ranger (Master)', 'Ringmaster (Master)',
  'Billposter (Master)', 'Psykeeper (Master)', 'Elementor (Master)', 'Knight (Hero)', 'Blade (Hero)', 'Jester (Hero)', 'Ranger (Hero)', 'Ringmaster (Hero)',
  'Billposter (Hero)', 'Psykeeper (Hero)', 'Elementor (Hero)', 'Lord Templer', 'Storm Blade', 'Wind Lurker', 'Crackshooter', 'Florist', 'Force Master',
  'Mentalist', 'Elementor Lord'];
/** nome do servidor e canal mostrados no Básico (o jogo web tem um servidor e um canal) */
const SERVER_NAME = 'ReactioN MMO', CHANNEL_NAME = 'Canal 1';

/** classe de master (16–23), hero (24–31) ou legend (32+): o selo ao lado do nível, como Icon_MasterMark1–6 / HeroMark / LegendMark */
function classMark(job: number, level: number): { file: string; label: string } | null {
  if (job >= 32) return { file: 'Icon_LegendMark.dds', label: 'Legend' };
  if (job >= 24) return { file: 'Icon_HeroMark.dds', label: 'Hero' };
  if (job >= 16) return { file: `Icon_MasterMark${Math.max(1, Math.min(6, Math.floor((level - 60) / 10) + 1))}.dds`, label: 'Master' };
  return null;
}

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

/** título de seção centralizado entre linhas ("Básico", "Detalhe", "PVP/PK") */
const section = (title: string) => { const h = document.createElement('h3'); h.className = 'cw-sec'; h.textContent = title; return h; };

/** grade rótulo/valor; `set` troca os valores pela ordem das linhas */
function table(cls: string, labels: string[]) {
  const el = document.createElement('dl');
  el.className = cls;
  const values = labels.map((l) => {
    const dt = document.createElement('dt'); dt.textContent = l;
    const dd = document.createElement('dd');
    el.append(dt, dd);
    return dd;
  });
  return { el, values };
}

export class CharacterWindow extends GameWindow {
  /** manda os pontos distribuídos ao servidor */
  onApply: (add: Record<Stat, number>) => void = () => {};

  private s: PlayerStats | null = null;
  private name = '';
  private pending: Record<Stat, number> = { str: 0, sta: 0, dex: 0, int: 0 };
  private rows = new Map<Stat, { value: HTMLElement; input: HTMLInputElement; plus: HTMLButtonElement; minus: HTMLButtonElement }>();
  private pointsEl = document.createElement('output');
  private applyBtn = imgBtn('cw-btn', 'Aplicar');
  private resetBtn = imgBtn('cw-btn', 'Desfazer');
  private base = table('cw-base', ['Nome', 'Classe', 'Nível', 'Servidor', 'Canal']);
  // duas colunas, como a imagem: Ataque|Crítico, Defesa|Vel. ataque, Velocidade|Precisão, Dano crít.|Bloq. corpo, Conjuração|Bloq. dist., PvM|PvP
  private detail = table('cw-detail', ['Ataque', 'Crítico', 'Defesa', 'Vel. atq.', 'Velocid.', 'Precisão', 'Dano crít.', 'Bloq. corpo', 'Conjuração', 'Bloq. dist.', 'PvM', 'PvP']);
  private pk = table('cw-base', ['Fama PVP', 'PVP', 'PK', 'Disposição']);
  private fame = table('cw-base', ['Fama', 'Classe', 'Exp', 'HP', 'MP', 'FP']);
  private bonus = document.createElement('dl');
  private mark = document.createElement('img');
  private pages: HTMLElement[] = [];
  private tabs: HTMLButtonElement[] = [];

  constructor(parent: HTMLElement) {
    super(parent, { id: 'charWnd', title: 'Personagem', store: 'flyff.wnd.character2', initial: { x: 210, y: 120, w: 254, h: 560 }, min: { w: 246, h: 520 } });
    const b = this.body;
    b.classList.add('cw');

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
      row.append(name, value, input, plus, minus);
      stats.appendChild(row);
      this.rows.set(k, { value, input, plus, minus });
    }
    const pts = document.createElement('div');
    pts.className = 'cw-points';
    pts.append('Pontos livres ', this.pointsEl);
    stats.appendChild(pts);

    const btns = document.createElement('div');
    btns.className = 'cw-btns';
    this.applyBtn.addEventListener('click', () => {
      if (!this.pendingTotal()) return;
      this.onApply({ ...this.pending });
      this.pending = { str: 0, sta: 0, dex: 0, int: 0 };
      this.render();
    });
    this.resetBtn.addEventListener('click', () => { this.pending = { str: 0, sta: 0, dex: 0, int: 0 }; this.render(); });
    btns.append(this.applyBtn, this.resetBtn);

    // selo Master/Hero ao lado do nível
    this.mark.className = 'cw-mark';
    this.mark.alt = '';
    this.mark.hidden = true;

    const page1 = document.createElement('div');
    page1.className = 'cw-page';
    page1.append(section('Básico'), this.base.el, section('Detalhe'), this.detail.el, stats, section('PVP/PK'), this.pk.el, btns);
    const page2 = document.createElement('div');
    page2.className = 'cw-page';
    this.bonus.className = 'cw-derived';
    page2.append(section('Fama/Master'), this.fame.el, section('Bônus somados'), this.bonus);
    this.pages = [page1, page2];

    // abas embaixo, como "Character | Fame/Master"
    const tabs = document.createElement('div');
    tabs.className = 'cw-tabs';
    tabs.setAttribute('role', 'tablist');
    ['Personagem', 'Fama/Master'].forEach((label, i) => {
      const t = document.createElement('button');
      t.type = 'button';
      t.className = 'cw-tab';
      t.setAttribute('role', 'tab');
      t.textContent = label;
      t.addEventListener('click', () => this.showPage(i));
      tabs.appendChild(t);
      this.tabs.push(t);
    });
    b.append(page1, page2, tabs);
    this.showPage(0);

    void themeImage('ButtCharApply.tga').then((u) => { if (u) { this.applyBtn.style.backgroundImage = `url(${u})`; this.applyBtn.classList.add('img'); } });
    void themeImage('ButtCharReset.tga').then((u) => { if (u) { this.resetBtn.style.backgroundImage = `url(${u})`; this.resetBtn.classList.add('img'); } });
    void keyedImage('ButtCharPlus.bmp').then((u) => { if (u) for (const r of this.rows.values()) { r.plus.style.backgroundImage = `url(${u})`; r.plus.classList.add('img'); } });
    void keyedImage('ButtCharMinus.bmp').then((u) => { if (u) for (const r of this.rows.values()) { r.minus.style.backgroundImage = `url(${u})`; r.minus.classList.add('img'); } });
    this.render();
  }

  private showPage(i: number) {
    this.pages.forEach((p, k) => { p.hidden = k !== i; });
    this.tabs.forEach((t, k) => { t.setAttribute('aria-selected', String(k === i)); t.classList.toggle('on', k === i); });
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
    const pct = (v: number | undefined) => `${v ?? 0}%`;
    // Básico: classe sem o "(Master)/(Hero)" — o selo ao lado do nível já diz
    const jobName = s ? (JOB_NAMES[s.job] ?? `#${s.job}`).replace(/ \((Master|Hero)\)$/, '') : '—';
    const mark = s ? classMark(s.job, s.level) : null;
    const [nameV, jobV, levelV, serverV, channelV] = this.base.values;
    nameV.textContent = this.name || '—';
    jobV.textContent = jobName;
    levelV.textContent = s ? String(s.level) : '—';
    if (mark) {
      if (this.mark.dataset.file !== mark.file) { this.mark.dataset.file = mark.file; void skillIcon(mark.file).then((u) => { if (u && this.mark.dataset.file === mark.file) { this.mark.src = u; this.mark.hidden = false; } }); }
      this.mark.title = this.mark.alt = mark.label;
      levelV.appendChild(this.mark);
    } else { this.mark.hidden = true; delete this.mark.dataset.file; }
    serverV.textContent = SERVER_NAME;
    channelV.textContent = CHANNEL_NAME;

    // Detalhe: ataque = média do mínimo e máximo, como o RenderATK do original
    const d = s ? [
      String(s.atkShow ?? Math.floor((s.atk[0] + s.atk[1]) / 2)), pct(s.crit),
      String(s.def), pct(s.spd),
      // corrida em relação à base (fSpeed 0,1 × 62,5 tiques/s = 6,25 u/s)
      s.mv ? `${Math.round((s.mv / (0.1 * TICKS_PER_SEC)) * 100)}%` : '100%', pct(s.acc),
      pct(s.cdmg), pct(s.mBlock),
      pct(s.dct), pct(s.rBlock),
      pct(s.pvm), pct(s.pvp),
    ] : [];
    this.detail.values.forEach((v, i) => { v.textContent = d[i] ?? '—'; });
    this.detail.values[0].title = s ? `${s.atk[0]} ~ ${s.atk[1]}` : '';

    const free = this.free();
    for (const [k, r] of this.rows) {
      const base = s ? s[k] : 0, add = this.pending[k];
      const extra = s?.bonus[k] ?? 0;
      // total com os bônus (como o original); a dica separa o que é ponto e o que vem dos itens
      r.value.textContent = `${base + add + extra}`;
      r.value.title = `${base + add} de pontos${extra ? ` ${extra > 0 ? '+' : ''}${extra} de itens e buffs` : ''}`;
      r.value.classList.toggle('bonus', extra > 0);
      r.value.classList.toggle('pending', add > 0);
      // não reescreve a caixa enquanto digita (só corrige se passou do que dá)
      if (document.activeElement !== r.input || Number(r.input.value || 0) !== add) r.input.value = add ? String(add) : '';
      r.input.max = String(add + free);
      r.input.disabled = !s || add + free <= 0;
      r.plus.disabled = free <= 0;
      r.minus.disabled = add <= 0;
    }
    this.pointsEl.value = String(free);
    this.pointsEl.classList.toggle('has', free > 0);
    this.applyBtn.disabled = this.resetBtn.disabled = this.pendingTotal() === 0;

    // PVP/PK: o jogo web ainda não tem PK nem fama de PVP
    this.pk.values.forEach((v, i) => { v.textContent = i === 0 ? '-' : '0'; });

    // Fama/Master
    const expPct = s && s.expMax > 0 ? ((s.exp / s.expMax) * 100).toFixed(2) : '0.00';
    const fame = [s ? '0' : '—', mark?.label ?? (s ? 'Normal' : '—'), `${expPct}%`, s ? `${s.hp} / ${s.maxHp}` : '—', s ? `${s.mp} / ${s.maxMp}` : '—', s ? `${s.fp} / ${s.maxFp}` : '—'];
    this.fame.values.forEach((v, i) => { v.textContent = fame[i]; });
    // bônus somados de equipamento, joias, cartas espetadas, sets e buffs (já aplicados nos valores da 1ª aba)
    this.bonus.innerHTML = '';
    for (const [k, v] of s?.fx ?? []) {
      const [name, val] = splitFx(fxText(k, v));
      const t = document.createElement('dt'); t.textContent = name; t.className = 'bonus';
      const dd = document.createElement('dd'); dd.textContent = val; dd.className = 'bonus';
      this.bonus.append(t, dd);
    }
    if (!this.bonus.childElementCount) { const t = document.createElement('dt'); t.textContent = 'Nenhum'; this.bonus.appendChild(t); }
  }
}
