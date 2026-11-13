import { keyedImage, skillIcon, themeImage } from '../shared/tga';
import POS from '../shared/skillTreePos.json';
import { JOBS, TREE_BG } from './jobs';
import { GameWindow } from './ui';

/**
 * Janela de skills (tecla K ou menu → Habilidades): uma aba por classe (Vagrant, 1ª, 2ª) com a árvore do jogo original — fundo
 * Back_*.TGA (ícones cinza e setas) e o ícone colorido por cima de cada skill aprendida, nas posições de
 * CWndSkillTreeEx::GetSkillPoint (shared/skillTreePos.json). Clicar numa skill mostra nome, nível, pedidos e descrição; "+" (ou
 * duplo clique) sobe um nível (pendente; custo 1/2/3 pontos por nível conforme o tipo) e Aplicar manda ao servidor, que valida
 * como o original. Arraste o ícone de uma skill aprendida para a barra de atalhos para usar com as teclas 1…0.
 */
export interface SkillView {
  id: number; sym: string; name: string; desc: string; icon: string; job: number; jtype: string; req: number; pre: [number, number][]; max: number; cost: number; melee: boolean; kind?: 'melee' | 'magic' | 'buff' | 'other'; /** debuff em mob: precisa de alvo */ hostile?: boolean; mo?: string;
  levels: { mp: number; fp: number; cd: number; min: number; max: number; time?: number }[];
}

const TREE_W = 225, TREE_H = 135;
/** 1ª classe → a 2ª mostrada em preto e branco enquanto não chega (a 4ª aba é sempre "Locked") */
const NEXT_JOB: Record<number, number> = { 1: 7, 2: 9, 3: 11, 4: 13 };
const TREE_SCALE = 1.5;
const POSITIONS = POS as unknown as Record<string, [number, number]>;

export class SkillWindow extends GameWindow {
  onApply: (levels: Record<number, number>) => void = () => {};

  private list: SkillView[] = [];
  private levels = new Map<number, number>();
  private points = 0;
  private charLevel = 1;
  private pending = new Map<number, number>();
  private tabs = document.createElement('div');
  private tree = document.createElement('div');
  private info = document.createElement('div');
  private pointsEl = document.createElement('output');
  /** título azul com o nome da classe e a faixa azul do rodapé (modo automático) */
  private title = document.createElement('div');
  private banner = document.createElement('div');
  private treeBox = document.createElement('div');
  private auto = false;
  private tip = document.createElement('div');
  /** a linha "Pontos de skill" (some no modo automático: as skills abrem sozinhas) */
  private ptsEl = document.createElement('span');
  private applyBtn = document.createElement('button');
  private resetBtn = document.createElement('button');
  private plusUrl: string | null = null;
  private tab: number | null = null;
  private selected: number | null = null;
  private bg = new Map<number, string>();
  private portrait = new Map<number, string>();

  constructor(parent: HTMLElement) {
    super(parent, { id: 'skillWnd', title: 'Habilidades', store: 'flyff.wnd.skills2', initial: { x: 470, y: 100, w: 520, h: 440 }, min: { w: 440, h: 380 } });
    const b = this.body;
    b.classList.add('sk');
    this.tabs.className = 'sk-tabs';
    this.tree.className = 'sk-tree';
    this.tree.style.width = `${TREE_W}px`;
    this.tree.style.height = `${TREE_H}px`;
    this.info.className = 'sk-info';
    this.title.className = 'sk-title';
    this.banner.className = 'sk-banner';
    this.banner.textContent = 'As skills são ativadas automaticamente quando você alcança o nível certo.';
    this.treeBox.className = 'sk-treebox';
    // a árvore é ampliada com transform (o zoom do CSS desalinhava os ícones sobre o fundo)
    const scaled = document.createElement('div');
    scaled.className = 'sk-scaled';
    scaled.style.width = `${TREE_W * TREE_SCALE}px`;
    scaled.style.height = `${TREE_H * TREE_SCALE}px`;
    this.tree.style.transform = `scale(${TREE_SCALE})`;
    this.tree.style.transformOrigin = '0 0';
    scaled.append(this.tree);
    this.treeBox.append(scaled);
    this.tip.className = 'item-tip native-tip sk-tip';
    this.tip.hidden = true;
    document.body.appendChild(this.tip);
    const foot = document.createElement('div');
    foot.className = 'sk-foot';
    const pts = this.ptsEl;
    pts.append('Pontos de skill: ', this.pointsEl);
    for (const [btn, label] of [[this.resetBtn, 'Desfazer'], [this.applyBtn, 'Aplicar']] as const) { btn.type = 'button'; btn.className = 'gm-btn'; btn.textContent = label; }
    this.applyBtn.addEventListener('click', () => {
      if (!this.pending.size) return;
      const out: Record<number, number> = {};
      for (const [id, add] of this.pending) out[id] = (this.levels.get(id) ?? 0) + add;
      this.onApply(out);
      this.pending.clear();
      this.render();
    });
    this.resetBtn.addEventListener('click', () => { this.pending.clear(); this.render(); });
    foot.append(pts, this.resetBtn, this.applyBtn);
    b.append(this.tabs, this.title, this.treeBox, this.info, foot, this.banner);
    void keyedImage('ButtCharPlus.bmp').then((u) => { this.plusUrl = u; this.render(); });
  }

  /** dados vindos do servidor */
  set(points: number, levels: Record<string, number>, list: SkillView[], charLevel: number, auto = false) {
    this.points = points;
    this.ptsEl.hidden = auto;
    this.auto = auto;
    this.levels = new Map(Object.entries(levels).map(([k, v]) => [Number(k), v]));
    this.list = list;
    this.charLevel = charLevel;
    this.pending.clear();
    const jobs = this.jobs();
    if (this.tab === null || !jobs.includes(this.tab)) this.tab = jobs[jobs.length - 1] ?? null; // abre na classe atual
    // fundos e retratos (carregam uma vez)
    for (const j of [...jobs, ...(NEXT_JOB[jobs[jobs.length - 1]] !== undefined ? [NEXT_JOB[jobs[jobs.length - 1]]] : [])]) {
      if (!this.bg.has(j) && TREE_BG[j]) void themeImage(TREE_BG[j]).then((u) => { if (u) { this.bg.set(j, u); this.render(); } });
      if (!this.portrait.has(j) && JOBS[j]) void keyedImage(JOBS[j].file).then((u) => { if (u) { this.portrait.set(j, u); this.render(); } });
    }
    this.render();
  }

  setCharLevel(lv: number) { if (lv !== this.charLevel) { this.charLevel = lv; this.render(); } }

  get(id: number) { return this.list.find((s) => s.id === id); }
  levelOf(id: number) { return this.levels.get(id) ?? 0; }

  /** classes que têm skills na lista, da Vagrant até a atual */
  private jobs() { return [...new Set(this.list.map((s) => s.job))].sort((a, b) => a - b); }

  private pendingCost() { let c = 0; for (const [id, add] of this.pending) c += add * (this.get(id)?.cost ?? 1); return c; }
  private lv(id: number) { return (this.levels.get(id) ?? 0) + (this.pending.get(id) ?? 0); }

  /** pode subir mais um nível agora? (pontos, máximo, nível do personagem, pré-requisitos) */
  private canRaise(s: SkillView) {
    if (this.lv(s.id) >= s.max || this.charLevel < s.req) return false;
    if (this.points - this.pendingCost() < s.cost) return false;
    return s.pre.every(([pid, plv]) => this.lv(pid) >= plv);
  }

  private raise(s: SkillView) {
    if (!this.canRaise(s)) return;
    this.pending.set(s.id, (this.pending.get(s.id) ?? 0) + 1);
    this.render();
  }

  private render() {
    const free = this.points - this.pendingCost();
    this.pointsEl.value = String(free);
    this.pointsEl.classList.toggle('has', free > 0);
    this.applyBtn.disabled = this.resetBtn.disabled = !this.pending.size;
    // modo automático: sem pontos, sem Aplicar/Desfazer e sem painel de detalhes (a dica ao parar o mouse mostra tudo)
    this.applyBtn.hidden = this.resetBtn.hidden = this.auto;
    this.info.hidden = this.auto;
    this.banner.hidden = !this.auto;
    this.title.textContent = this.tab !== null ? (JOBS[this.tab]?.name ?? `Classe ${this.tab}`) : '';
    this.hideTip();
    this.renderTabs();
    this.renderTree();
    this.renderInfo();
  }

  private renderTabs() {
    const frag = document.createDocumentFragment();
    const jobs = this.jobs(), last = jobs[jobs.length - 1];
    const ghost = last !== undefined && NEXT_JOB[last] !== undefined ? NEXT_JOB[last] : null;
    for (const j of jobs) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `sk-tab${this.tab === j ? ' on' : ''}`;
      const nm = JOBS[j]?.name ?? `Classe ${j}`;
      b.setAttribute('aria-label', nm);
      b.setAttribute('aria-pressed', String(this.tab === j));
      const u = this.portrait.get(j);
      // retrato do tema (64×64 escalado para 40): quadro 0 colorido na aba ativa, 1 preto e branco nas outras
      if (u) { b.style.backgroundImage = `url(${u})`; b.style.backgroundPosition = `-${(this.tab === j ? 0 : 1) * 40}px 0`; }
      b.addEventListener('click', () => { this.tab = j; this.selected = null; this.render(); });
      const cell = document.createElement('div');
      cell.className = `sk-tabcell${this.tab === j ? ' on' : ''}`;
      const label = document.createElement('span');
      label.textContent = nm;
      cell.append(b, label);
      frag.appendChild(cell);
    }
    // classe que ainda não chegou (preto e branco, sem clique) e as vagas trancadas: sempre 4 posições, como no original
    let n = jobs.length;
    if (ghost !== null) {
      const b = document.createElement('button');
      b.type = 'button'; b.disabled = true; b.className = 'sk-tab ghost';
      const u = this.portrait.get(ghost);
      if (u) { b.style.backgroundImage = `url(${u})`; b.style.backgroundPosition = '-40px 0'; }
      const label = document.createElement('span');
      label.textContent = JOBS[ghost]?.name ?? '';
      const cell = document.createElement('div');
      cell.className = 'sk-tabcell ghost';
      cell.append(b, label);
      frag.appendChild(cell); n++;
    }
    for (; n < 4; n++) {
      const b = document.createElement('div');
      b.className = 'sk-tab lock';
      const label = document.createElement('span');
      label.textContent = 'Locked';
      const cell = document.createElement('div');
      cell.className = 'sk-tabcell ghost';
      cell.append(b, label);
      frag.appendChild(cell);
    }
    this.tabs.replaceChildren(frag);
  }

  /** árvore da classe: fundo do original e o ícone colorido por cima das skills aprendidas */
  private renderTree() {
    const j = this.tab;
    const bgUrl = j !== null ? this.bg.get(j) : undefined;
    this.tree.style.backgroundImage = bgUrl ? `url(${bgUrl})` : '';
    const frag = document.createDocumentFragment();
    for (const s of this.list) {
      if (s.job !== j) continue;
      const p = POSITIONS[s.sym];
      if (!p) continue;
      const lv = this.lv(s.id), learned = (this.levels.get(s.id) ?? 0) > 0;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `sk-node${lv > 0 ? ' on' : ''}${this.selected === s.id ? ' sel' : ''}${this.canRaise(s) ? ' can' : ''}${(this.pending.get(s.id) ?? 0) > 0 ? ' pending' : ''}`;
      btn.style.left = `${p[0] + 2}px`;
      btn.style.top = `${p[1] - 4}px`; // o ícone cinza do fundo começa 4 px acima do ponto de GetSkillPoint
      btn.setAttribute('aria-label', `${s.name} ${lv}/${s.max}`);
      btn.addEventListener('pointerenter', (e) => this.showTip(s, e));
      btn.addEventListener('pointermove', (e) => this.placeTip(e));
      btn.addEventListener('pointerleave', () => this.hideTip());
      const img = document.createElement('img');
      img.alt = '';
      img.draggable = false;
      void skillIcon(s.icon).then((u) => { if (u) img.src = u; });
      btn.appendChild(img);
      if (lv > 0) { const n = document.createElement('i'); n.textContent = lv >= s.max ? 'MAX' : String(lv); if (lv >= s.max) n.className = 'max'; btn.appendChild(n); }
      if (learned) {
        btn.draggable = true;
        btn.addEventListener('dragstart', (e) => {
          e.dataTransfer!.setData('application/x-flyff-item', JSON.stringify({ k: 'skill', id: s.id, icon: s.icon, name: s.name }));
          e.dataTransfer!.effectAllowed = 'copy';
        });
      }
      btn.addEventListener('click', () => { this.selected = s.id; this.render(); });
      btn.addEventListener('dblclick', () => this.raise(s));
      frag.appendChild(btn);
    }
    this.tree.replaceChildren(frag);
  }

  /** dica ao parar o mouse numa skill (a mesma caixa das dicas de item): nome e nível, custo, pedidos, nível do personagem, duração e descrição */
  private showTip(s: SkillView, e: { clientX: number; clientY: number }) {
    const lv = this.lv(s.id), L = s.levels[Math.max(0, Math.min(s.max, lv || 1) - 1)];
    const rows: [string, string?][] = [];
    const add = (text: string, cls?: string) => rows.push([text, cls]);
    add(`${s.name} - Lvl ${lv}/${s.max}`, 'tip-name skill-name');
    if (L && (L.mp || L.fp)) add([L.mp ? `MP: ${L.mp}` : '', L.fp ? `FP: ${L.fp}` : ''].filter(Boolean).join('  '));
    if (L?.cd) add(`Espera: ${(L.cd / 1000).toFixed(1)} s`);
    for (const [pid, plv] of s.pre) add(`${this.get(pid)?.name ?? 'Outra skill'} nível ${plv} é necessário.`, this.lv(pid) >= plv ? '' : 'bad');
    add(`Nível do personagem: ${s.req}`, this.charLevel >= s.req ? '' : 'bad');
    if (L?.time) {
      const t = Math.round(L.time / 1000), h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60);
      add(`Duração: ${h}h${m}m${t % 60}s`);
    }
    if (s.desc) add(s.desc);
    if (!this.auto) add(`${s.cost} ponto(s) por nível`, 'hint');
    this.tip.replaceChildren(...rows.map(([text, cls]) => { const d = document.createElement('div'); d.textContent = text; if (cls) d.className = cls; return d; }));
    this.tip.hidden = false;
    this.placeTip(e);
  }
  private placeTip(e: { clientX: number; clientY: number }) {
    if (this.tip.hidden) return;
    const w = this.tip.offsetWidth, h = this.tip.offsetHeight;
    this.tip.style.left = `${Math.max(4, Math.min(innerWidth - w - 4, e.clientX + 16))}px`;
    this.tip.style.top = `${Math.max(4, Math.min(innerHeight - h - 4, e.clientY + 18))}px`;
  }
  private hideTip() { this.tip.hidden = true; }

  /** painel da skill escolhida: ícone, nível, pedidos, custo, descrição e o "+" */
  private renderInfo() {
    const s = this.selected !== null ? this.get(this.selected) : undefined;
    if (!s) {
      const p = document.createElement('p');
      p.className = 'sk-hint';
      p.textContent = 'Clique em uma skill para ver os detalhes. Duplo clique sobe um nível. Arraste uma skill aprendida para a barra de atalhos.';
      this.info.replaceChildren(p);
      return;
    }
    const lv = this.lv(s.id);
    const L = s.levels[Math.max(0, Math.min(s.max, lv || 1) - 1)];
    const pre = s.pre.map(([pid, plv]) => `${this.get(pid)?.name ?? '?'} nv ${plv}`).join(', ');
    const head = document.createElement('div');
    head.className = 'sk-head';
    const icon = document.createElement('img');
    icon.alt = '';
    void skillIcon(s.icon).then((u) => { if (u) icon.src = u; });
    const t = document.createElement('div');
    const name = document.createElement('b');
    name.textContent = s.name;
    const lvl = document.createElement('span');
    lvl.className = (this.pending.get(s.id) ?? 0) > 0 ? 'pending' : '';
    lvl.textContent = ` ${lv}/${s.max}`;
    const sub = document.createElement('small');
    sub.textContent = `${this.charLevel < s.req ? `Nível ${s.req} · ` : ''}${pre ? `Pede ${pre} · ` : ''}${s.cost} ponto(s) por nível`;
    t.append(name, lvl, document.createElement('br'), sub);
    const plus = document.createElement('button');
    plus.type = 'button';
    plus.className = `cw-pm plus${this.plusUrl ? ' img' : ''}`;
    if (this.plusUrl) plus.style.backgroundImage = `url(${this.plusUrl})`;
    plus.innerHTML = '<span>+</span>';
    plus.setAttribute('aria-label', `Subir ${s.name}`);
    plus.disabled = !this.canRaise(s);
    plus.addEventListener('click', () => this.raise(s));
    head.append(icon, t, plus);
    const stats = document.createElement('div');
    stats.className = 'sk-stats';
    stats.textContent = `${L ? `MP ${L.mp} · FP ${L.fp}${L.cd ? ` · espera ${(L.cd / 1000).toFixed(1)} s` : ''}` : ''}${s.melee ? '' : ' · ainda não pode ser lançada'}${L?.time ? ` · dura ${Math.round(L.time / 1000)} s` : ''}`;
    const desc = document.createElement('p');
    desc.className = 'sk-desc';
    desc.textContent = s.desc;
    this.info.replaceChildren(head, stats, desc);
  }
}
