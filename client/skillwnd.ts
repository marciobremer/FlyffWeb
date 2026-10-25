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
  id: number; sym: string; name: string; desc: string; icon: string; job: number; jtype: string; req: number; pre: [number, number][]; max: number; cost: number; melee: boolean; kind?: 'melee' | 'magic' | 'buff' | 'other'; mo?: string;
  levels: { mp: number; fp: number; cd: number; min: number; max: number; time?: number }[];
}

const TREE_W = 225, TREE_H = 135;
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
  private applyBtn = document.createElement('button');
  private resetBtn = document.createElement('button');
  private plusUrl: string | null = null;
  private tab: number | null = null;
  private selected: number | null = null;
  private bg = new Map<number, string>();
  private portrait = new Map<number, string>();

  constructor(parent: HTMLElement) {
    super(parent, { id: 'skillWnd', title: 'Habilidades', store: 'flyff.wnd.skills', initial: { x: 470, y: 100, w: 270, h: 470 }, min: { w: 260, h: 400 } });
    const b = this.body;
    b.classList.add('sk');
    this.tabs.className = 'sk-tabs';
    this.tree.className = 'sk-tree';
    this.tree.style.width = `${TREE_W}px`;
    this.tree.style.height = `${TREE_H}px`;
    this.info.className = 'sk-info';
    const foot = document.createElement('div');
    foot.className = 'sk-foot';
    const pts = document.createElement('span');
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
    b.append(this.tabs, this.tree, this.info, foot);
    void keyedImage('ButtCharPlus.bmp').then((u) => { this.plusUrl = u; this.render(); });
  }

  /** dados vindos do servidor */
  set(points: number, levels: Record<string, number>, list: SkillView[], charLevel: number) {
    this.points = points;
    this.levels = new Map(Object.entries(levels).map(([k, v]) => [Number(k), v]));
    this.list = list;
    this.charLevel = charLevel;
    this.pending.clear();
    const jobs = this.jobs();
    if (this.tab === null || !jobs.includes(this.tab)) this.tab = jobs[jobs.length - 1] ?? null; // abre na classe atual
    // fundos e retratos (carregam uma vez)
    for (const j of jobs) {
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
    this.renderTabs();
    this.renderTree();
    this.renderInfo();
  }

  private renderTabs() {
    const frag = document.createDocumentFragment();
    for (const j of this.jobs()) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `sk-tab${this.tab === j ? ' on' : ''}`;
      b.title = JOBS[j]?.name ?? `Classe ${j}`;
      b.setAttribute('aria-label', b.title);
      b.setAttribute('aria-pressed', String(this.tab === j));
      const u = this.portrait.get(j);
      // retrato do tema (64×64 escalado para 40): quadro 0 colorido na aba ativa, 1 preto e branco nas outras
      if (u) { b.style.backgroundImage = `url(${u})`; b.style.backgroundPosition = `-${(this.tab === j ? 0 : 1) * 40}px 0`; }
      b.addEventListener('click', () => { this.tab = j; this.selected = null; this.render(); });
      frag.appendChild(b);
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
      btn.style.left = `${p[0]}px`;
      btn.style.top = `${p[1]}px`;
      btn.setAttribute('aria-label', `${s.name} ${lv}/${s.max}`);
      btn.title = `${s.name} (${lv}/${s.max})`;
      const img = document.createElement('img');
      img.alt = '';
      img.draggable = false;
      void skillIcon(s.icon).then((u) => { if (u) img.src = u; });
      btn.appendChild(img);
      if (lv > 0) { const n = document.createElement('i'); n.textContent = String(lv); btn.appendChild(n); }
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
