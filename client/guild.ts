import { JOBS } from './jobs';
import { gameConfirm } from './dialog';
import { GameWindow } from './ui';
import './guild.css';

/**
 * Janela da guild (tecla G), no visual escuro do cliente: abas Info, Membros, Títulos, Duelar, Configurações e Ship.
 * Sem guild: explica a regra do original (o líder de uma party cria e os membros online da party entram junto) e tem o campo do
 * nome + "Criar guild". Com guild: dados (nome, mestre, nível, membros, aviso), lista de membros ordenável (expulsar: mestre/kingpin),
 * cargos e poderes (fixos neste servidor), aviso editável (mestre/kingpin), sair/desfazer. Duelo, ship, logo, recrutamento e
 * salários ainda não existem no servidor: as abas mostram o desenho e avisam "em breve".
 */
export interface GuildMember { id: number; name: string; level: number; job: number; rank: number; rankName: string; on: boolean }
export interface GuildView { id: number; name: string; level: number; master: number; max: number; notice?: string; members: GuildMember[] }

type Tab = 'info' | 'members' | 'titles' | 'duel' | 'config' | 'ship';
const TABS: [Tab, string, string][] = [['info', 'Info', 'ⓘ'], ['members', 'Membros', '☺'], ['titles', 'Títulos', '⛨'], ['duel', 'Duelar', '⚔'], ['config', 'Configurações', '⚙'], ['ship', 'Ship', '⛵']];
const RANKS = ['Mestre', 'Kingpin', 'Captain', 'Supporter', 'Rookie'];
/** poderes por cargo: [nome, cargos que têm]. Só "Entrar" (convidar) é aplicado pelo servidor; o resto só o mestre tem */
const POWERS: [string, (r: number) => boolean][] = [
  ['Título', (r) => r === 0], ['Adjust Rank', (r) => r === 0], ['Entrar', (r) => r <= 1], ['Take Penya', (r) => r === 0], ['Take Items', (r) => r === 0],
  ['Administração da Casa da Guilda', (r) => r === 0], ['Spectate', (r) => r === 0],
];

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, unknown> = {}, ...kids: (Node | string)[]): HTMLElementTagNameMap[K] => {
  const e = Object.assign(document.createElement(tag), props) as HTMLElementTagNameMap[K];
  e.append(...kids);
  return e;
};

export class GuildWindow extends GameWindow {
  onCreate: (name: string) => void = () => {};
  onLeave: () => void = () => {};
  onKick: (id: number) => void = () => {};
  onDisband: () => void = () => {};
  onOpen: () => void = () => {};
  /** novo aviso da guild (mestre/kingpin) */
  onNotice: (text: string) => void = () => {};
  private guild: GuildView | null = null;
  private myId = 0;
  private tab: Tab = 'info';
  private sort: 'rank' | 'job' | 'level' | 'name' = 'rank';
  private rankSel = 0;
  private editing = false;

  constructor(parent: HTMLElement) {
    super(parent, { id: 'guildWnd', title: 'Guilda', store: 'flyff.wnd.guild', initial: { x: 60, y: 90, w: 830, h: 430 }, min: { w: 700, h: 360 } });
    this.body.classList.add('gw');
    this.render();
  }

  set(g: GuildView | null, myId: number) { this.guild = g; this.myId = myId; if (this.visible) this.render(); }
  show() { super.show(); this.render(); this.onOpen(); }

  private myRank() { return this.guild?.members.find((m) => m.id === this.myId)?.rank ?? 4; }

  private render() {
    const b = this.body, g = this.guild;
    b.replaceChildren();
    if (!g) { b.append(this.createPage()); return; }
    const nav = el('nav', { className: 'gw-tabs' });
    nav.setAttribute('role', 'tablist');
    for (const [id, label, icon] of TABS) {
      const t = el('button', { type: 'button', className: `gw-tab${id === this.tab ? ' on' : ''}` }, el('i', { textContent: icon }), el('span', { textContent: label }));
      t.setAttribute('role', 'tab');
      t.setAttribute('aria-selected', String(id === this.tab));
      t.addEventListener('click', () => { this.tab = id; this.editing = false; this.render(); });
      nav.append(t);
    }
    const page = this.tab === 'info' ? this.infoPage(g) : this.tab === 'members' ? this.membersPage(g) : this.tab === 'titles' ? this.titlesPage(g)
      : this.tab === 'duel' ? this.duelPage() : this.tab === 'config' ? this.configPage(g) : this.soon('Ship', 'O navio da guild ainda não existe neste servidor.');
    b.append(nav, el('div', { className: 'gw-page' }, page));
  }

  /** sem guild */
  private createPage() {
    const input = el('input', { className: 'gw-in', maxLength: 16, placeholder: 'Nome da guild (3 a 16 letras)' });
    input.setAttribute('aria-label', 'Nome da guild');
    const go = () => { const n = input.value.trim(); if (n) this.onCreate(n); };
    input.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') go(); });
    const btn = el('button', { type: 'button', className: 'gw-btn', textContent: 'Criar guild' });
    btn.addEventListener('click', go);
    return el('div', { className: 'gw-empty' },
      el('p', { textContent: 'Você não está em uma guild. Para criar, seja o líder de uma party: todos os membros online da party entram na guild com você, e você vira o mestre.' }),
      input, btn);
  }

  private info(label: string, value: string) { return el('div', { className: 'gw-kv' }, el('b', { textContent: `${label}:` }), el('span', { textContent: ` ${value}` })); }

  private infoPage(g: GuildView) {
    const master = g.members.find((m) => m.id === g.master)?.name ?? '—';
    const box = el('div', { className: 'gw-box', textContent: g.notice ? g.notice : 'A guild ainda não tem aviso.' });
    return el('div', { className: 'gw-info' },
      el('div', { className: 'gw-grid' },
        el('div', {}, this.info('Nome', g.name), this.info('Mestre', master), this.info('EXP', '—'), this.info('PENYA', '—')),
        el('div', {}, this.info('Nível', String(g.level)), this.info('Membros', `${g.members.length}/${g.max}`), this.info('Logo', '—'))),
      box,
      el('div', { className: 'gw-foot' }, this.btn('Procurar', () => {}, true, 'Busca de guilds: em breve')));
  }

  private btn(label: string, run: () => void, disabled = false, title = '') {
    const b = el('button', { type: 'button', className: 'gw-btn', textContent: label, disabled, title });
    b.addEventListener('click', run);
    return b;
  }

  private membersPage(g: GuildView) {
    const myRank = this.myRank();
    const cols: ['rank' | 'job' | 'level' | 'name' | 'nick', string][] = [['rank', 'Título'], ['job', 'Class'], ['level', 'Nível'], ['name', 'Nome'], ['nick', 'Apelido']];
    const head = el('div', { className: 'gw-row head' });
    for (const [k, label] of cols) {
      const b = el('button', { type: 'button', className: `gw-sort${k === this.sort ? ' on' : ''}`, textContent: label });
      if (k !== 'nick') b.addEventListener('click', () => { this.sort = k; this.render(); });
      head.append(b);
    }
    head.append(el('span', {}));
    const list = [...g.members].sort((a, c) => {
      if (this.sort === 'rank') return a.rank - c.rank || a.name.localeCompare(c.name);
      if (this.sort === 'job') return (JOBS[a.job]?.name ?? '').localeCompare(JOBS[c.job]?.name ?? '') || a.name.localeCompare(c.name);
      if (this.sort === 'level') return c.level - a.level || a.name.localeCompare(c.name);
      return a.name.localeCompare(c.name);
    });
    const rows = el('div', { className: 'gw-rows' });
    for (const m of list) {
      const row = el('div', { className: `gw-row${m.on ? '' : ' off'}` },
        el('span', { textContent: `${m.rank === 0 ? '♛ ' : ''}${m.rankName}` }), el('span', { textContent: JOBS[m.job]?.name ?? '' }),
        el('span', { textContent: String(m.level) }), el('span', { className: 'nm', textContent: m.name }), el('span', { className: 'nick', textContent: '' }));
      const act = el('span', {});
      if (myRank <= 1 && m.id !== this.myId && m.rank > myRank) {
        const kick = el('button', { type: 'button', className: 'gw-mini', textContent: 'Expulsar' });
        kick.addEventListener('click', () => { void gameConfirm(`Expulsar ${m.name} da guild?`, 'Expulsar').then((ok) => { if (ok) this.onKick(m.id); }); });
        act.append(kick);
      }
      row.append(act);
      rows.append(row);
    }
    return el('div', { className: 'gw-members' }, head, rows,
      el('p', { className: 'gw-hint', textContent: myRank <= 1 ? 'Para convidar: clique num jogador e escolha "Convidar para guild".' : '' }));
  }

  private titlesPage(g: GuildView) {
    const sel = el('select', { className: 'gw-select' });
    RANKS.forEach((r, i) => sel.append(el('option', { value: String(i), textContent: r, selected: i === this.rankSel })));
    sel.addEventListener('change', () => { this.rankSel = Number(sel.value); this.render(); });
    const r = this.rankSel, n = g.members.filter((m) => m.rank === r).length;
    const powers = el('ul', { className: 'gw-powers' }, ...POWERS.map(([name, has]) => el('li', {}, el('input', { type: 'checkbox', checked: has(r), disabled: true }), ` ${name}`)));
    return el('div', { className: 'gw-titles' },
      el('div', { className: 'gw-pick' }, el('i', { textContent: '★' }), sel),
      el('div', { className: 'gw-cols' },
        el('div', { className: 'gw-col' }, el('h4', { textContent: 'Membros' }), el('div', { className: 'big', textContent: `${n} / ${g.members.length}` })),
        el('div', { className: 'gw-col wide' }, el('h4', { textContent: 'Poderes' }), powers,
          el('p', { className: 'gw-hint', textContent: 'Os poderes dos cargos são fixos neste servidor.' })),
        el('div', { className: 'gw-col' }, el('h4', { textContent: 'Salário' }), el('div', { className: 'big', textContent: '0' }), this.btn('Configurar', () => {}, true, 'Salários: em breve'))));
  }

  private duelPage() {
    return el('div', { className: 'gw-duel' },
      this.info('Nome da Guilda', '—'), this.info('Logo da Guilda', '—'), this.info('Venceu', '0'), this.info('Perdeu', '0'), this.info('Desistiu', '0'), this.info('Tempo Restante', '—'),
      el('div', { className: 'gw-foot spread' }, this.btn('Desafiar', () => {}, true, 'Duelo de guilds: em breve'), this.btn('Paz', () => {}, true, 'Em breve'), this.btn('Desistir', () => {}, true, 'Em breve')),
      el('p', { className: 'gw-hint', textContent: 'O duelo entre guilds ainda não existe neste servidor.' }));
  }

  private soon(title: string, text: string) { return el('div', { className: 'gw-soon' }, el('h3', { textContent: title }), el('p', { textContent: text })); }

  private configPage(g: GuildView) {
    const myRank = this.myRank();
    const search = el('select', { className: 'gw-select', disabled: true }, el('option', { textContent: 'Não localizável' }));
    const color = el('input', { type: 'checkbox', checked: true, disabled: true });
    const notice = this.btn('Aviso', () => { this.editing = !this.editing; this.render(); }, myRank > 1, myRank > 1 ? 'Só o mestre e o kingpin mudam o aviso' : '');
    const leave = myRank === 0
      ? this.btn('Desfazer', () => { void gameConfirm(`Desfazer a guild ${g.name}? Todos os membros saem.`, 'Desfazer').then((ok) => { if (ok) this.onDisband(); }); })
      : this.btn('Sair da guild', () => { void gameConfirm('Sair da guild?', 'Sair').then((ok) => { if (ok) this.onLeave(); }); });
    const kids: (Node | string)[] = [
      el('div', { className: 'gw-line' }, el('b', { textContent: 'Modo de Busca' }), search),
      el('label', { className: 'gw-check' }, color, ' Cor do Nome da Guilda'),
      this.btn('Recrutamento', () => {}, true, 'Em breve'), notice, this.btn('Nome', () => {}, true, 'Em breve'), this.btn('Logotipo', () => {}, true, 'Em breve'), leave,
    ];
    if (this.editing) {
      const input = el('input', { className: 'gw-in', maxLength: 200, value: g.notice ?? '', placeholder: 'Aviso da guild (até 200 letras)' });
      input.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') save(); });
      const save = () => { this.editing = false; this.onNotice(input.value.trim()); };
      kids.splice(4, 0, el('div', { className: 'gw-edit' }, input, this.btn('Salvar', save)));
      setTimeout(() => input.focus());
    }
    return el('div', { className: 'gw-config' }, ...kids);
  }
}
