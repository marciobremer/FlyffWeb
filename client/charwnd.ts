import { keyedImage, skillIcon, themeImage } from '../shared/tga';
import { GameWindow } from './ui';
import type { PlayerStats } from './net';
import { BADGES } from './badges';
import { t, tr, trAttr } from './lang';

/**
 * Janela de personagem (tecla H ou menu → Personagem), no layout do cliente original:
 * aba "Character": faixas cinza "Character Information | Other Information" (nome, classe + selo Master/Hero, nível, servidor,
 * canal | premium, local, ping, FPS), "Character Stats | Other Stats" (ATK, Critical, DEF, A.Speed, STR/STA/DEX/INT com a caixa de
 * número e as setas para distribuir os pontos livres — só vale ao clicar Apply —, "Auto stats" com distribuições prontas |
 * velocidade, dano crítico, conjuração, dano refletido, precisão, bloqueios e esquiva) e "PVP Stats | PK Stats";
 * aba "Honor & Badge": títulos de honra e lista de insígnias (só a tela: o jogo ainda não tem fama nem insígnias).
 * Botões do tema: ButtCharPlus/Minus.bmp (4 quadros 14×14, magenta transparente) e ButtCharApply.tga (4 quadros 50×20).
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
/** distribuições prontas do "Auto stats": reparte os pontos livres nesses atributos (em partes iguais) */
const AUTO: [string, Stat[]][] = [
  ['STR', ['str']], ['STA', ['sta']], ['DEX', ['dex']], ['INT', ['int']],
  ['STR + STA', ['str', 'sta']], ['STR + DEX', ['str', 'dex']], ['DEX + STA', ['dex', 'sta']], ['INT + STA', ['int', 'sta']],
];

const imgBtn = (cls: string, label: string) => {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = cls;
  b.setAttribute('aria-label', label);
  b.innerHTML = `<span>${label}</span>`;
  return b;
};

/** faixa cinza de título com um texto em cada coluna ("Character Information | Other Information") */
const bar = (left: string, right: string) => {
  const d = document.createElement('div');
  d.className = 'cw-bar';
  const a = document.createElement('span'), b = document.createElement('span');
  tr(a, left); tr(b, right);
  d.append(a, b);
  return d;
};

/** grade rótulo/valor (os rótulos são traduzidos); os valores são trocados pela ordem */
function table(cls: string, labels: string[]) {
  const el = document.createElement('dl');
  el.className = cls;
  const values = labels.map((l) => {
    const dt = document.createElement('dt'); tr(dt, l);
    const dd = document.createElement('dd');
    el.append(dt, dd);
    return dd;
  });
  return { el, values };
}

export class CharacterWindow extends GameWindow {
  /** manda os pontos distribuídos ao servidor */
  onApply: (add: Record<Stat, number>) => void = () => {};
  /** pede ao servidor como ficariam os atributos com os pontos pendentes (setPreview responde) */
  onPreview: (add: Record<Stat, number>) => void = () => {};
  /** atributos com os pontos pendentes (do servidor); null = sem pendente */
  private preview: PlayerStats | null = null;
  private previewKey = '';
  private previewTimer = 0;

  private s: PlayerStats | null = null;
  private name = '';
  private pending: Record<Stat, number> = { str: 0, sta: 0, dex: 0, int: 0 };
  private rows = new Map<Stat, { value: HTMLElement; input: HTMLInputElement; plus: HTMLButtonElement; minus: HTMLButtonElement }>();
  private pointsEl = document.createElement('output');
  private applyBtn = imgBtn('cw-btn', 'Apply');
  private auto = document.createElement('select');
  private base = table('cw-kv', ['Nome', 'Classe', 'Nível', 'Servidor', 'Canal']);
  private other = table('cw-kv', ['Premium', 'Localização', 'Ping', 'FPS']);
  // ATK|Critical e DEF|A.Speed em quatro colunas
  private pair = table('cw-pair', ['ATQ', 'Crítico', 'DEF', 'Vel. Atq.']);
  private extra = table('cw-kv cw-extra', ['Velocidade', 'Dano Crít.', 'Vel. Conjuração', 'Dano Refletido', 'Precisão', 'Bloq. Corpo', 'Bloq. Dist.', 'Esquiva']);
  private pvp = table('cw-kv', ['Fama PVP', 'PVP']);
  private pk = table('cw-kv', ['Pontos PK', 'Disposição']);
  private mark = document.createElement('img');
  private pages: HTMLElement[] = [];
  private tabs: HTMLButtonElement[] = [];

  constructor(parent: HTMLElement) {
    super(parent, { id: 'charWnd', title: 'Personagem', store: 'flyff.wnd.character3', initial: { x: 210, y: 120, w: 440, h: 548 }, min: { w: 420, h: 520 } });
    const b = this.body;
    b.classList.add('cw');

    // ---- STR/STA/DEX/INT: valor total, caixa de pontos e setas ----
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
    const ptsLabel = document.createElement('span');
    tr(ptsLabel, 'Pontos Livres');
    pts.append(ptsLabel, this.pointsEl);
    stats.appendChild(pts);

    // Apply + "Auto stats" (distribuições prontas: escolher uma reparte os pontos livres; o Apply confirma)
    const actions = document.createElement('div');
    actions.className = 'cw-actions';
    this.applyBtn.addEventListener('click', () => {
      if (!this.pendingTotal()) return;
      this.onApply({ ...this.pending });
      this.pending = { str: 0, sta: 0, dex: 0, int: 0 };
      this.render();
    });
    this.auto.className = 'cw-auto';
    const fillAuto = () => {
      const o = document.createElement('option'); o.value = ''; tr(o, 'Auto atributos'); this.auto.replaceChildren(o);
      for (const [label] of AUTO) { const p = document.createElement('option'); p.value = label; p.textContent = label; this.auto.appendChild(p); }
      const clear = document.createElement('option'); clear.value = '!'; tr(clear, 'Limpar pontos'); this.auto.appendChild(clear);
    };
    fillAuto();
    trAttr(this.auto, 'aria-label', 'Auto atributos');
    this.auto.addEventListener('change', () => {
      const v = this.auto.value;
      this.auto.value = '';
      if (v === '!') { this.pending = { str: 0, sta: 0, dex: 0, int: 0 }; this.render(); return; }
      const plan = AUTO.find(([l]) => l === v)?.[1];
      if (!plan || !this.s) return;
      const total = (this.s.points ?? 0);
      const next: Record<Stat, number> = { str: 0, sta: 0, dex: 0, int: 0 };
      plan.forEach((k, i) => { next[k] = Math.floor(total / plan.length) + (i < total % plan.length ? 1 : 0); });
      this.pending = next;
      this.render();
    });
    actions.append(this.applyBtn, this.auto);

    // selo Master/Hero ao lado do nível
    this.mark.className = 'cw-mark';
    this.mark.alt = '';
    this.mark.hidden = true;

    // ---- aba Character ----
    const page1 = document.createElement('div');
    page1.className = 'cw-page';
    const cols = (l: HTMLElement[], r: HTMLElement[]) => {
      const g = document.createElement('div');
      g.className = 'cw-cols';
      const a = document.createElement('div'), c = document.createElement('div');
      a.className = c.className = 'cw-col';
      a.append(...l); c.append(...r);
      g.append(a, c);
      return g;
    };
    page1.append(
      bar('Informações do Personagem', 'Outras Informações'), cols([this.base.el], [this.other.el]),
      bar('Estatísticas do Personagem', 'Outras Estatísticas'), cols([this.pair.el, stats, actions], [this.extra.el]),
      bar('Estatísticas PVP', 'Estatísticas PK'), cols([this.pvp.el], [this.pk.el]));

    // ---- aba Honor & Badge ----
    const page2 = this.honorPage();
    this.pages = [page1, page2];

    // abas embaixo, como "Character | Honor & Badge"
    const tabs = document.createElement('div');
    tabs.className = 'cw-tabs';
    tabs.setAttribute('role', 'tablist');
    ['Personagem', 'Honra e Insígnias'].forEach((label, i) => {
      const tab = document.createElement('button');
      tab.type = 'button';
      tab.className = 'cw-tab';
      tab.setAttribute('role', 'tab');
      tr(tab, label);
      tab.addEventListener('click', () => this.showPage(i));
      tabs.appendChild(tab);
      this.tabs.push(tab);
    });
    b.append(page1, page2, tabs);
    this.showPage(0);

    void themeImage('ButtCharApply.tga').then((u) => { if (u) { this.applyBtn.style.backgroundImage = `url(${u})`; this.applyBtn.classList.add('img'); } });
    void keyedImage('ButtCharPlus.bmp').then((u) => { if (u) for (const r of this.rows.values()) { r.plus.style.backgroundImage = `url(${u})`; r.plus.classList.add('img'); } });
    void keyedImage('ButtCharMinus.bmp').then((u) => { if (u) for (const r of this.rows.values()) { r.minus.style.backgroundImage = `url(${u})`; r.minus.classList.add('img'); } });
    this.render();
  }

  /** aba Honor & Badge: títulos de honra (vazio) e a lista de insígnias (todas bloqueadas, a padrão da classe marcada) */
  private honorPage() {
    const page = document.createElement('div');
    page.className = 'cw-page cw-honor';
    const arrows = (list: HTMLElement) => {
      const col = document.createElement('div');
      col.className = 'wk-bar cw-arrows';
      for (const [dir, file] of [['up', 'ButtUp.tga'], ['down', 'ButtDown.tga']] as const) {
        const a = document.createElement('button');
        a.type = 'button';
        a.className = `wk-arrow ${dir}`;
        a.setAttribute('aria-label', dir === 'up' ? 'Rolar para cima' : 'Rolar para baixo');
        void themeImage(file).then((u) => { if (u) a.style.backgroundImage = `url(${u})`; });
        a.addEventListener('click', () => list.scrollBy({ top: dir === 'up' ? -105 : 105, behavior: 'smooth' }));
        col.appendChild(a);
      }
      return col;
    };
    const ok = () => { const o = document.createElement('button'); o.type = 'button'; o.className = 'cw-ok'; o.textContent = 'OK'; o.disabled = true; return o; };
    const title = (key: string) => { const h = document.createElement('h4'); h.className = 'cw-ptitle'; tr(h, key); return h; };

    // títulos de honra
    const fame = document.createElement('div');
    fame.className = 'cw-fame';
    const fameText = document.createElement('p');
    tr(fameText, 'Nenhuma fama obtida.');
    fame.appendChild(fameText);
    const left = document.createElement('div');
    left.className = 'cw-side';
    const lbox = document.createElement('div');
    lbox.className = 'cw-box';
    lbox.append(fame, arrows(fame));
    left.append(title('Títulos de Honra'), lbox, ok());

    // insígnias: padrão da classe (marcada), desativar (X vermelho) e as do jogo (bloqueadas: ícone apagado com X vermelho)
    const list = document.createElement('ul');
    list.className = 'cw-badges';
    list.setAttribute('role', 'listbox');
    const row = (name: string, text: string | null, icon: string | null, locked: boolean, kind: 'default' | 'none' | 'badge') => {
      const li = document.createElement('li');
      li.setAttribute('role', 'option');
      li.className = `cw-badge ${kind}${locked ? ' locked' : ''}`;
      const nm = document.createElement('span');
      if (text) tr(nm, text); else nm.textContent = name;
      const ic = document.createElement('i');
      if (kind === 'default') ic.className = 'check';
      else if (icon) void skillIcon(icon).then((u) => { if (u) ic.style.setProperty('--ic', `url(${u})`); });
      li.append(nm, ic);
      li.addEventListener('click', () => { list.querySelectorAll('.on').forEach((e) => e.classList.remove('on')); li.classList.add('on'); li.setAttribute('aria-selected', 'true'); });
      return li;
    };
    const first = row('', 'Insígnia padrão da classe', null, false, 'default');
    first.classList.add('on');
    list.append(first, row('', 'Desativar insígnia', 'icon_BadgeNoIcon.png', false, 'none'));
    for (const [n, icon] of BADGES) list.appendChild(row(n, null, icon, true, 'badge'));
    const right = document.createElement('div');
    right.className = 'cw-side';
    const rbox = document.createElement('div');
    rbox.className = 'cw-box';
    rbox.append(list, arrows(list));
    right.append(title('Insígnias'), rbox, ok());
    page.append(left, right);
    return page;
  }

  private showPage(i: number) {
    this.pages.forEach((p, k) => { p.hidden = k !== i; });
    this.tabs.forEach((tab, k) => { tab.setAttribute('aria-selected', String(k === i)); tab.classList.toggle('on', k === i); });
  }

  private pendingTotal() { return this.pending.str + this.pending.sta + this.pending.dex + this.pending.int; }
  private free() { return (this.s?.points ?? 0) - this.pendingTotal(); }

  setName(name: string) { this.name = name; this.render(); }

  /** ping, FPS e mapa atuais (main.ts atualiza algumas vezes por segundo enquanto a janela está aberta) */
  setLive(ping: number | null, fps: number, location: string) {
    const [premium, loc, pingV, fpsV] = this.other.values;
    premium.textContent = this.inactive();
    loc.textContent = location;
    pingV.textContent = ping === null ? '—' : `${Math.round(ping)}ms`;
    pingV.className = ping !== null && ping > 150 ? 'cw-bad' : 'cw-good';
    fpsV.textContent = fps.toFixed(2);
  }
  private inactive() { return t('Inativo...'); }

  /** atributos novos do servidor (descarta o pendente que não cabe mais) */
  setStats(s: PlayerStats) {
    this.s = s;
    if (this.pendingTotal() > s.points) this.pending = { str: 0, sta: 0, dex: 0, int: 0 };
    this.previewKey = ''; // atributos mudaram: a prévia é refeita
    this.render();
  }

  /** prévia do servidor (só vale se ainda é a do pendente atual) */
  setPreview(s: PlayerStats) {
    if (!this.pendingTotal()) return;
    this.preview = s;
    this.render();
  }

  /** pede a prévia quando o pendente muda (um pedido por vez, depois de 120 ms parado) */
  private askPreview() {
    const key = `${this.pending.str},${this.pending.sta},${this.pending.dex},${this.pending.int}`;
    if (key === this.previewKey) return;
    this.previewKey = key;
    clearTimeout(this.previewTimer);
    if (!this.pendingTotal()) { this.preview = null; return; }
    this.previewTimer = window.setTimeout(() => this.onPreview({ ...this.pending }), 120);
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
    const [premium] = this.other.values;
    if (!premium.textContent) { premium.textContent = this.inactive(); }
    premium.classList.add('cw-bad');

    // ataque = média do mínimo e máximo, como o RenderATK do original; Speed e Hit Rate como o oficial (DST_SPEED / DST_ADJ_HITRATE)
    const leftOf = (s: PlayerStats) => [String(s.atkShow ?? Math.floor((s.atk[0] + s.atk[1]) / 2)), pct(s.crit), String(s.def), pct(s.spd)];
    const rightOf = (s: PlayerStats) => [pct(s.mvPct), pct(s.cdmg), pct(s.dct), '0%', pct(s.hit ?? s.acc), pct(s.mBlock), pct(s.rBlock), pct(s.dodgeRate)];
    // pontos ainda não aplicados: mostra como vai ficar e pisca em vermelho o que muda
    this.askPreview();
    const pv = this.pendingTotal() ? this.preview : null;
    const l0 = s ? leftOf(s) : [], r0 = s ? rightOf(s) : [];
    const l1 = pv ? leftOf(pv) : l0, r1 = pv ? rightOf(pv) : r0;
    // o par ATK|Critical|DEF|A.Speed fica nas posições 1 e 3 (valores) da grade
    const pairVals = this.pair.values;
    pairVals.forEach((v, i) => { v.textContent = l1[i] ?? '—'; v.classList.toggle('cw-up', !!pv && l1[i] !== l0[i]); });
    pairVals[0].title = s ? `${(pv ?? s).atk[0]} ~ ${(pv ?? s).atk[1]}` : '';
    this.extra.values.forEach((v, i) => { v.textContent = r1[i] ?? '—'; v.classList.toggle('cw-up', !!pv && r1[i] !== r0[i]); });

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
    this.applyBtn.disabled = this.pendingTotal() === 0;
    this.auto.disabled = !s || (s.points ?? 0) <= 0;

    // PVP/PK: o jogo web ainda não tem PK nem fama de PVP
    this.pvp.values[0].textContent = '-'; this.pvp.values[1].textContent = '0';
    this.pk.values.forEach((v) => { v.textContent = '0'; });
  }
}
