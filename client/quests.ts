import { GameWindow } from './ui';

/**
 * Quests no cliente: a janela do diálogo (aberta pelo menu do NPC: fala, o que falta, recompensa, Aceitar / Entregar) e o
 * diário (tecla Q: quests em andamento e o progresso). Quem decide tudo é o servidor (servers/world/questflow.ts); aqui só se
 * mostra o que ele mandou.
 */
export interface QuestGoal { label: string; have: number; need: number }
export interface QuestDialog { id: string; key: string; name: string; st: 'offer' | 'active' | 'ready' | 'done'; text: string; goals: QuestGoal[]; reward: string[]; /** requisitos (party…) */ req?: string[]; /** motivo de não poder aceitar/entregar agora */ blocked?: string | null }
export interface QuestEntry { id: string; name: string; npc: string; goals: QuestGoal[]; ready: boolean }

const goalList = (goals: QuestGoal[]) => {
  const ul = document.createElement('ul');
  ul.className = 'quest-goals';
  for (const g of goals) {
    const li = document.createElement('li');
    li.textContent = `${g.label}: ${g.have}/${g.need}`;
    if (g.have >= g.need) li.className = 'ok';
    ul.append(li);
  }
  return ul;
};

/** diálogo com o NPC */
export class QuestDialogWindow extends GameWindow {
  onAccept: (d: QuestDialog) => void = () => {};
  onTurnIn: (d: QuestDialog) => void = () => {};

  constructor(parent: HTMLElement) {
    super(parent, { id: 'questDlg', title: 'Quest', store: 'flyff.wnd.questdlg', initial: { x: 260, y: 120, w: 420, h: 320 }, min: { w: 320, h: 220 } });
    this.body.classList.add('quest');
  }

  open(d: QuestDialog) {
    this.setTitle(d.name);
    const b = this.body;
    b.replaceChildren();
    const text = document.createElement('p');
    text.className = 'quest-text';
    text.textContent = d.text || (d.st === 'done' ? 'Quest concluída.' : '');
    b.append(text);
    if (d.goals.length) { const h = document.createElement('h4'); h.textContent = 'Objetivos'; b.append(h, goalList(d.goals)); }
    if (d.req?.length) { const h = document.createElement('h4'); h.textContent = 'Requisitos'; const p = document.createElement('p'); p.className = 'quest-reward'; p.textContent = d.req.join(' · '); b.append(h, p); }
    if (d.blocked) { const p = document.createElement('p'); p.className = 'quest-blocked'; p.textContent = d.blocked; b.append(p); }
    if (d.reward.length) {
      const h = document.createElement('h4');
      h.textContent = 'Recompensa';
      const p = document.createElement('p');
      p.className = 'quest-reward';
      p.textContent = d.reward.join(' · ');
      b.append(h, p);
    }
    const row = document.createElement('div');
    row.className = 'quest-actions';
    const btn = (label: string, run: () => void, off = false) => {
      const x = document.createElement('button');
      x.type = 'button';
      x.textContent = label;
      x.disabled = off;
      x.addEventListener('click', run);
      row.append(x);
    };
    if (d.st === 'offer') btn('Aceitar', () => this.onAccept(d), !!d.blocked);
    else if (d.st === 'active') btn('Entregar', () => {}, true);
    else if (d.st === 'ready') btn('Entregar', () => this.onTurnIn(d), !!d.blocked);
    btn('Fechar', () => this.hide());
    b.append(row);
    this.show();
  }
}

/** diário de quests (tecla Q) */
export class QuestLogWindow extends GameWindow {
  onAbandon: (id: string) => void = () => {};
  private list: QuestEntry[] = [];

  constructor(parent: HTMLElement) {
    super(parent, { id: 'questLog', title: 'Quests', store: 'flyff.wnd.questlog', initial: { x: 120, y: 90, w: 360, h: 380 }, min: { w: 280, h: 200 } });
    this.body.classList.add('quest');
    this.render();
  }

  set(list: QuestEntry[]) { this.list = list; this.render(); }

  private render() {
    const b = this.body;
    b.replaceChildren();
    if (!this.list.length) { const p = document.createElement('p'); p.className = 'quest-text'; p.textContent = 'Nenhuma quest em andamento. Fale com os NPCs com "❗" no menu.'; b.append(p); return; }
    for (const q of this.list) {
      const h = document.createElement('h4');
      h.textContent = `${q.ready ? '✔ ' : ''}${q.name}`;
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'quest-abandon';
      del.textContent = 'Abandonar';
      del.addEventListener('click', () => { if (confirm(`Abandonar "${q.name}"? O progresso se perde.`)) this.onAbandon(q.id); });
      const sub = document.createElement('div');
      sub.className = 'quest-sub';
      sub.textContent = q.ready ? `Pronta: volte ao NPC ${q.npc}.` : `NPC: ${q.npc}`;
      b.append(h, sub, goalList(q.goals), del);
    }
  }
}
