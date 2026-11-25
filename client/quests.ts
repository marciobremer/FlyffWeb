import { fetchBuf } from '../shared/data';
import { decodeTga } from '../shared/tga';
import { gameConfirm } from './dialog';
import { GameWindow } from './ui';

/**
 * Quests no cliente, como no original: a janela de conversa com o NPC (retrato, falas em páginas, Sim/Não e os atalhos
 * embaixo), o diário (tecla Q: abas, lista por região, detalhes/condição/recompensas) e os objetivos marcados na tela.
 * Quem decide tudo é o servidor (servers/world/questflow.ts); aqui só se mostra o que ele mandou.
 */
export interface QuestGoal { label: string; have: number; need: number }
export type QuestStatus = 'offer' | 'active' | 'ready';
export interface NpcQuest { id: string; name: string; st: QuestStatus }
/** o que a janela de conversa sabe do NPC */
interface Npc { key: string; name: string; portrait: string | null; intro: string | null; bye: string | null; quests: NpcQuest[] }
export interface NpcTalk extends Npc { text: string }
export interface QuestDialog extends Omit<Npc, 'name'> {
  id: string; name: string; npc: string; st: QuestStatus | 'done'; /** resposta ao aceitar: sem botões */ accepted: boolean;
  pages: string[]; /** fala do "Não" */ no: string | null; req?: string[]; /** motivo de não poder aceitar/entregar agora */ blocked?: string | null;
}
export type QuestTab = 'scenario' | 'general' | 'office' | 'event' | 'server';
export interface QuestDone { id: string; name: string; tab: QuestTab; category: string; desc: string }
export interface QuestEntry extends QuestDone { npc: string; goals: QuestGoal[]; ready: boolean; reward: string[]; canAbandon: boolean }

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = '') => {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text) e.textContent = text;
  return e;
};
const button = (className: string, label: string, run: () => void, off = false) => {
  const b = el('button', className, label);
  b.type = 'button';
  b.disabled = off;
  b.addEventListener('click', run);
  return b;
};

const portraits = new Map<string, Promise<string | null>>();
/** retrato do NPC (Data/Char/char_*.tga) como data URL */
function portrait(file: string) {
  let p = portraits.get(file);
  if (!p) {
    p = fetchBuf('/res/Data/Char/' + encodeURIComponent(file)).then((buf) => {
      if (!buf) return null;
      try {
        const img = decodeTga(buf), c = document.createElement('canvas');
        c.width = img.width; c.height = img.height;
        c.getContext('2d')!.putImageData(img, 0, 0);
        return c.toDataURL();
      } catch { return null; }
    });
    portraits.set(file, p);
  }
  return p;
}

/** janela de conversa com o NPC */
export class NpcTalkWindow extends GameWindow {
  onOpen: (id: string, key: string) => void = () => {};
  onAccept: (d: QuestDialog) => void = () => {};
  onTurnIn: (d: QuestDialog) => void = () => {};
  onBye: (key: string, text: string | null) => void = () => {};
  private npc: Npc | null = null;
  private pages: string[] = [];
  private page = 0;
  private heading = 'Diálogo';
  private dlg: QuestDialog | null = null;

  constructor(parent: HTMLElement) {
    super(parent, { id: 'questDlg', title: 'Conversação', store: 'flyff.wnd.npctalk', initial: { x: 80, y: 180, w: 520, h: 380 }, min: { w: 440, h: 340 } });
    this.body.classList.add('talk');
  }

  /** NPC da conversa aberta */
  get key() { return this.visible ? this.npc?.key ?? null : null; }

  /** saudação */
  talk(m: NpcTalk) {
    this.npc = m;
    this.say('Diálogo', [m.text || '…'], null);
  }

  /** uma quest (fala em páginas e, na última, os botões) */
  quest(d: QuestDialog) {
    this.npc = { key: d.key, name: d.npc, portrait: d.portrait, intro: d.intro, bye: d.bye, quests: d.quests };
    this.say(d.name, d.pages, d);
  }

  private say(heading: string, pages: string[], dlg: QuestDialog | null) {
    this.heading = heading;
    this.pages = pages;
    this.page = 0;
    this.dlg = dlg;
    this.render();
    this.show();
  }

  private render() {
    const npc = this.npc;
    if (!npc) return;
    const face = el('div', 'talk-face');
    face.setAttribute('role', 'img');
    face.setAttribute('aria-label', npc.name);
    if (npc.portrait) void portrait(npc.portrait).then((u) => { if (u) face.style.backgroundImage = `url(${u})`; });
    else face.append(el('span', '', npc.name));

    const text = el('div', 'talk-text game-scroll');
    text.append(el('p', '', this.pages[this.page] ?? ''));
    const d = this.dlg, last = this.page >= this.pages.length - 1;
    const row = el('div', 'talk-actions');
    if (!last) row.append(button('gm-btn talk-next', 'Próximo ▶', () => { this.page++; this.render(); }));
    else if (d && !d.accepted && (d.st === 'offer' || d.st === 'ready')) {
      for (const line of [...(d.req ?? []), ...(d.blocked ? [d.blocked] : [])]) text.append(el('p', 'quest-blocked', line));
      if (d.st === 'offer') {
        row.append(button('gm-btn', 'Sim', () => this.onAccept(d), !!d.blocked));
        row.append(button('gm-btn', 'Não', () => { if (d.no) this.say(d.name, [d.no], null); else this.hide(); }));
      } else row.append(button('gm-btn', 'Concluir', () => this.onTurnIn(d), !!d.blocked));
    }

    const links = el('div', 'talk-links');
    if (npc.intro) links.append(button('talk-link', 'Quem é você?', () => this.say('Diálogo', [npc.intro!], null)));
    links.append(button('talk-link', 'Até mais!', () => { this.hide(); this.onBye(npc.key, npc.bye); }));
    const quests = el('div', 'talk-quests game-scroll');
    for (const [st, title] of [['ready', 'Pronta para entregar'], ['offer', 'Nova quest'], ['active', 'Quest em progresso']] as const) {
      const list = npc.quests.filter((q) => q.st === st);
      if (!list.length) continue;
      quests.append(el('div', 'talk-group', title));
      for (const q of list) quests.append(button(`talk-quest ${st}`, q.name, () => this.onOpen(q.id, npc.key)));
    }

    const right = el('div', 'talk-right');
    right.append(el('div', 'quest-head', this.heading), text, row, links, quests);
    this.body.replaceChildren(face, right);
  }
}

const TABS: [QuestTab, string][] = [['scenario', 'Cenário'], ['general', 'Geral'], ['office', 'Escritório'], ['event', 'Evento'], ['server', 'Servidor']];
/** MAX_CHECKED_QUEST do original: quantas quests aparecem na tela */
const MAX_TRACKED = 5;
const OFF_KEY = 'flyff.quest.untracked';

/** diário de quests (tecla Q); a caixinha marca quais mostram o objetivo na tela */
export class QuestLogWindow extends GameWindow {
  onAbandon: (id: string) => void = () => {};
  private list: QuestEntry[] = [];
  private done: QuestDone[] = [];
  private tab: QuestTab = 'general';
  private filter: 'active' | 'done' = 'active';
  private selected = '';
  /** desmarcadas pelo jogador (as outras, até 5, aparecem na tela) */
  private off = new Set<string>();
  private tracker = el('div', 'quest-tracker');

  constructor(parent: HTMLElement) {
    super(parent, { id: 'questLog', title: 'Quests', store: 'flyff.wnd.questbook', initial: { x: 120, y: 90, w: 640, h: 420 }, min: { w: 520, h: 320 } });
    this.body.classList.add('qbook');
    try { this.off = new Set(JSON.parse(localStorage.getItem(OFF_KEY) ?? '[]') as string[]); } catch { /* sem armazenamento */ }
    this.tracker.setAttribute('aria-label', 'Objetivos das quests');
    parent.appendChild(this.tracker);
    this.render();
  }

  set(list: QuestEntry[], done: QuestDone[] = []) {
    this.list = list;
    this.done = done;
    this.render();
    this.renderTracker();
  }

  private tracked() { return this.list.filter((q) => !this.off.has(q.id)).slice(0, MAX_TRACKED); }

  private track(id: string, on: boolean) {
    if (on) {
      this.off.delete(id);
      // já há 5 na tela: a que acabou de ser marcada toma o lugar da última
      const shown = this.list.filter((q) => !this.off.has(q.id) && q.id !== id);
      for (const q of shown.slice(MAX_TRACKED - 1)) this.off.add(q.id);
    } else this.off.add(id);
    try { localStorage.setItem(OFF_KEY, JSON.stringify([...this.off].slice(-300))); } catch { /* sem armazenamento */ }
    this.render();
    this.renderTracker();
  }

  private renderTracker() {
    this.tracker.replaceChildren(...this.tracked().map((q) => {
      const box = el('div', `qt-quest${q.ready ? ' ready' : ''}`);
      box.append(el('div', 'qt-name', q.name));
      for (const line of conditions(q)) box.append(el('div', line.ok ? 'qt-goal ok' : 'qt-goal', line.text));
      return box;
    }));
  }

  private render() {
    const entries: QuestDone[] = this.filter === 'active' ? this.list : this.done;
    if (!entries.some((q) => q.tab === this.tab)) this.tab = TABS.find(([t]) => entries.some((q) => q.tab === t))?.[0] ?? this.tab;
    const inTab = entries.filter((q) => q.tab === this.tab).sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
    if (!inTab.some((q) => q.id === this.selected)) this.selected = inTab[0]?.id ?? '';
    const scroll = this.body.querySelector('.qb-list')?.scrollTop ?? 0;

    const tabs = el('div', 'qb-tabs');
    tabs.setAttribute('role', 'tablist');
    for (const [t, label] of TABS) {
      const n = entries.filter((q) => q.tab === t).length;
      const b = button(t === this.tab && n ? 'qb-tab on' : 'qb-tab', label, () => { this.tab = t; this.render(); }, !n);
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', String(t === this.tab));
      tabs.append(b);
    }

    const list = el('div', 'qb-list game-scroll');
    const tracked = new Set(this.tracked().map((q) => q.id));
    let category: string | null = null;
    for (const q of inTab) {
      if (q.category !== category) {
        category = q.category;
        if (category) list.append(el('div', 'qb-category', category));
      }
      const row = el('div', q.id === this.selected ? 'qb-row on' : 'qb-row');
      const active = this.list.find((a) => a.id === q.id);
      if (this.filter === 'active') {
        const check = el('input');
        check.type = 'checkbox';
        check.checked = tracked.has(q.id);
        check.setAttribute('aria-label', `Mostrar "${q.name}" na tela`);
        check.addEventListener('change', () => this.track(q.id, check.checked));
        row.append(check);
      }
      row.append(button(active?.ready ? 'qb-name ready' : 'qb-name', q.name, () => { this.selected = q.id; this.render(); }));
      list.append(row);
    }
    if (!inTab.length) list.append(el('p', 'qb-empty', this.filter === 'active' ? 'Nenhuma quest em andamento. Fale com os NPCs que têm "!" sobre a cabeça.' : 'Nenhuma quest concluída.'));

    const sel = inTab.find((q) => q.id === this.selected);
    const entry = this.filter === 'active' ? this.list.find((q) => q.id === this.selected) : undefined;
    const side = el('div', 'qb-side');
    const panel = (title: string, lines: { text: string; ok?: boolean }[]) => {
      const box = el('div', 'qb-box game-scroll');
      for (const l of lines) box.append(el('div', l.ok ? 'ok' : '', l.text));
      side.append(el('div', 'quest-head', title), box);
    };
    panel('Detalhes sobre a Quest', sel ? [{ text: sel.desc }] : []);
    panel('Condição da Quest', entry ? conditions(entry) : sel ? [{ text: 'Concluída', ok: true }] : []);
    panel('Lista de Recompensas', (entry?.reward ?? []).map((text) => ({ text })));

    const main = el('div', 'qb-main');
    const left = el('div', 'qb-left');
    const mid = el('div', 'qb-mid');
    mid.append(tabs, list);
    left.append(el('div', 'quest-head', 'Lista de Quests'), mid);
    main.append(left, side);

    const foot = el('div', 'qb-foot');
    const filter = el('select', 'gm-in');
    filter.setAttribute('aria-label', 'Quais quests mostrar');
    for (const [value, label] of [['active', 'Em andamento'], ['done', 'Concluídas']]) filter.append(new Option(label, value, false, value === this.filter));
    filter.addEventListener('change', () => { this.filter = filter.value as 'active' | 'done'; this.render(); });
    foot.append(filter, button('gm-btn', 'Remover quest', () => {
      if (!entry) return;
      void gameConfirm(`Abandonar "${entry.name}"? O progresso se perde.`, 'Abandonar').then((ok) => { if (ok) this.onAbandon(entry.id); });
    }, !entry?.canAbandon));

    this.body.replaceChildren(main, foot);
    list.scrollTop = scroll;
  }
}

/** condição da quest: os objetivos com o progresso; sem objetivos, ou pronta, a quem procurar */
function conditions(q: QuestEntry): { text: string; ok?: boolean }[] {
  const out: { text: string; ok?: boolean }[] = q.goals.map((g) => ({ text: `${g.label}: ${g.have}/${g.need}`, ok: g.have >= g.need }));
  if (!out.length) out.push({ text: `Encontre ${q.npc}` });
  else if (q.ready) out.push({ text: `Volte para ${q.npc}`, ok: true });
  return out;
}
