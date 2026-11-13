import { itemIcon } from '../shared/tga';
import { gameConfirm } from './dialog';
import { GameWindow } from './ui';
import { WikiPanel } from './wiki';
import type { GmStats, ItemView } from './net';
import { acceptsElement, maxPiercing, maxUpgrade } from '../shared/upgrade';
import { GRADES, gradeOf } from '../shared/grade';
import { hideItemTip, moveItemTip, showItemTip } from './itemtip';

/**
 * Painel de GM (`//gm` no chat; só abre para contas GM/admin — quem decide é o servidor). Janela móvel/redimensionável com:
 * - Jogador: alvo por nick (vazio = você), ir até / trazer, teleporte por coordenada, nível, classe e penya;
 * - Itens: busca no catálogo (nome ou símbolo II_*, por categoria) com ícones, e criar o item na bolsa do alvo com
 *   quantidade, enchant (joias +0–20, o resto +0–10), elemento (+0–10) e furos de piercing (suit, 0–4);
 * - Jogador: também devolve os pontos de atributo do alvo (reset de status) e mata / revive o alvo (`//kill`, `//revive`);
 *   Invisible Mode (`//invis`) deixa você invisível para os jogadores (GMs/admins veem translúcido) e os mobs largam você.
 *   Imortal (`//god`, ligado ao entrar): os mobs batem e o dano aparece, mas o HP não cai.
 * - Monstros: lista dos monstros do jogo (nome, MI_*, nível; boss em vermelho) com busca — clicar escolhe e "Invocar"
 *   cria a quantidade pedida perto de você (`//mob`); os invocados não renascem.
 * Tudo vira comando `//…` mandado pelo chat (mesmas regras e log do servidor); as respostas aparecem na linha de status.
 */
const JOBS: [string, string][] = [
  ['vagrant', 'Vagrant'], ['mercenary', 'Mercenary'], ['acrobat', 'Acrobat'], ['assist', 'Assist'], ['magician', 'Magician'],
  ['knight', 'Knight'], ['blade', 'Blade'], ['jester', 'Jester'], ['ranger', 'Ranger'], ['ringmaster', 'Ringmaster'],
  ['billposter', 'Billposter'], ['psykeeper', 'Psykeeper'], ['elementor', 'Elementor'],
  ['knight_master', 'Knight (Master)'], ['blade_master', 'Blade (Master)'], ['knight_hero', 'Knight (Hero)'], ['blade_hero', 'Blade (Hero)'],
];
/** o servidor aceita os nomes em inglês (fire, water, electricity, wind, earth) */
const ELEMENT_KEYS = ['', 'fire', 'water', 'electricity', 'wind', 'earth'];
const ELEMENT_LABELS = ['None', 'Fire', 'Water', 'Electric', 'Wind', 'Earth'];
const GRADE_LABELS: Record<number, string> = { 100: 'Common', 200: 'Unique', 300: 'Ultimate', 400: 'Baruna' };
const gradeName = (gr: number | undefined) => GRADE_LABELS[gr ?? 100] ?? GRADE_LABELS[100];
const KINDS: [string, string][] = [['', 'All'], ['weapon', 'Weapons'], ['armor', 'Armor'], ['general', 'General (potions…)'], ['ride', 'Mounts'], ['charged', 'Cash'], ['system', 'System']];

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, unknown> = {}, ...kids: (Node | string)[]): HTMLElementTagNameMap[K] => {
  const e = Object.assign(document.createElement(tag), props) as HTMLElementTagNameMap[K];
  e.append(...kids);
  return e;
};
const field = (label: string, ...kids: Node[]) => el('label', { className: 'gm-field' }, el('span', {}, label), ...kids);
const btn = (text: string, onClick: () => void) => { const b = el('button', { type: 'button', className: 'gm-btn', textContent: text }); b.addEventListener('click', onClick); return b; };
const num = (min: number, max: number, value: number) => el('input', { type: 'number', min: String(min), max: String(max), value: String(value), className: 'gm-in num' });
const select = (opts: [string, string][]) => { const s = el('select', { className: 'gm-in' }); for (const [v, t] of opts) s.append(el('option', { value: v, textContent: t })); return s; };

export class GmPanel extends GameWindow {
  /** manda um comando `//…` (pelo chat); false se desconectado */
  run: (cmd: string) => boolean = () => false;
  /** pede a busca de itens ao servidor */
  search: (q: string, kind: string, grade: number) => void = () => {};
  /** pede os atributos de um jogador online (nome vazio = você); false se desconectado */
  getStats: (name: string) => boolean = () => false;
  /** troca os atributos (só para teste, não grava); `null` volta ao normal; false se desconectado */
  setStatsReq: (name: string, v: { str: number; sta: number; dex: number; int: number } | null) => boolean = () => false;

  /** mapas para onde o GM pode ir (o servidor manda ao abrir o painel); o valor é o número do mapa, que o //map aceita */
  private mapSelect = select([['', '…']]);
  setMaps(list: { name: string; id: number }[]) {
    const keep = this.mapSelect.value;
    this.mapSelect.replaceChildren(...list.map((m) => el('option', { value: String(m.id), textContent: `${m.name} (${m.id})` })));
    if (keep && list.some((m) => String(m.id) === keep)) this.mapSelect.value = keep;
  }

  private target = el('input', { className: 'gm-in', placeholder: 'nick (empty = you)', maxLength: 32 });
  /** atributos de teste do jogador escolhido (botão Select) */
  private statIn = { str: num(1, 1000, 15), sta: num(1, 1000, 15), dex: num(1, 1000, 15), int: num(1, 1000, 15) };
  private statWho = el('div', { className: 'gm-hint', textContent: 'Press Select to load a player.' });
  private statBox = el('div', { className: 'gm-stats' });
  private statusEl = el('p', { className: 'gm-status' });
  private tabs = new Map<string, { tab: HTMLButtonElement; page: HTMLElement }>();
  private results = el('ul', { className: 'gm-results' });
  private picked: ItemView | null = null;
  private pickBox = el('div', { className: 'gm-pick' });
  private qty = num(1, 9999, 1);
  private upgrade = select(Array.from({ length: 11 }, (_, i) => [String(i), `+${i}`] as [string, string]));
  /** furos de piercing (só suit) */
  private piercing = select(Array.from({ length: 5 }, (_, i) => [String(i), i ? `${i}` : 'None'] as [string, string]));
  private piercingField = field('Sockets', this.piercing);
  private element = select(ELEMENT_LABELS.map((_n, i) => [String(i), ELEMENT_LABELS[i]] as [string, string]));
  private elementLv = select(Array.from({ length: 21 }, (_, i) => [String(i), `+${i}`] as [string, string]));
  private q = el('input', { className: 'gm-in', type: 'search', placeholder: 'name or II_…', maxLength: 40 });
  private kind = select(KINDS);
  /** filtro de raridade (dwItemGrade) */
  private grade = select([['0', 'Rarity: all'], ...Object.keys(GRADES).map((g) => [g, gradeName(Number(g))] as [string, string])]);
  private timer = 0;
  /** monstros do jogo (vem dos dados do mundo carregado) */
  monsters: () => { id: number; name: string; symbol: string; level: number; boss: boolean }[] = () => [];
  /** escolher no chão onde invocar (círculo); null = cancelado */
  pickPoint: (done: (p: [number, number, number] | null) => void) => void = (done) => done(null);
  private mobQ = el('input', { className: 'gm-in', type: 'search', placeholder: 'name or MI_…', maxLength: 40 });
  private mobBoss = el('input', { type: 'checkbox' });
  private mobList = el('ul', { className: 'gm-results gm-mobs' });
  private mobPicked: { id: number; name: string; symbol: string; level: number; boss: boolean } | null = null;
  private mobPick = el('div', { className: 'gm-pick' });
  private mobQty = num(1, 30, 1);
  /** Invisible Mode: liga/desliga a invisibilidade de GM (//invis) */
  private invisBtn = btn('Invisible Mode', () => this.send('//invis'));
  /** imortal: os mobs batem e o dano aparece, mas o HP não cai (//god; ligado ao entrar) */
  private godBtn = btn('Immortal', () => this.send('//god'));
  /** voo livre: E sobe, Q desce, W A S D guiam (//fly) */
  private flyBtn = btn('Fly', () => this.send('//fly'));
  /** velocidade de corrida em % da normal (//speed): 100 = normal */
  private speedIn = num(10, 1000, 100);
  private speedBtn = btn('Speed', () => this.send(`//speed ${this.speedIn.value || 100}`));
  private speedReset = btn('Normal', () => { this.speedIn.value = '100'; this.send('//speed 100'); });
  setFly(on: boolean) {
    this.flyBtn.textContent = on ? 'Fly: on' : 'Fly';
    this.flyBtn.classList.toggle('on', on);
    this.flyBtn.setAttribute('aria-pressed', String(on));
  }

  /** estado do modo invisível (o servidor avisa ao ligar/desligar) */
  setInvis(on: boolean) {
    this.invisBtn.textContent = on ? 'Invisible Mode: on' : 'Invisible Mode';
    this.invisBtn.classList.toggle('on', on);
  }

  /** estado do modo imortal (o servidor avisa ao entrar e ao ligar/desligar) */
  setGod(on: boolean) {
    this.godBtn.textContent = on ? 'Immortal: on' : 'Immortal: off';
    this.godBtn.classList.toggle('on', on);
    this.godBtn.setAttribute('aria-pressed', String(on));
  }

  constructor(parent: HTMLElement) {
    super(parent, { id: 'gmWnd', title: 'GM Panel', store: 'flyff.wnd.gm', initial: { x: 260, y: 60, w: 520, h: 620 }, min: { w: 500, h: 360 } });
    const b = this.body;
    b.classList.add('gm');
    const bar = el('div', { className: 'gm-tabs' });
    bar.setAttribute('role', 'tablist');
    this.target.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') this.selectTarget(); });
    b.append(el('div', { className: 'gm-row' }, field('Target', this.target), btn('Select', () => this.selectTarget())), bar);
    for (const [key, label, page] of [['player', 'Player', this.playerPage()], ['items', 'Items', this.itemsPage()], ['mobs', 'Monsters', this.mobsPage()]] as const) {
      const tab = el('button', { type: 'button', className: 'gm-tab', textContent: label });
      tab.setAttribute('role', 'tab');
      tab.addEventListener('click', () => this.show(key));
      bar.append(tab);
      page.classList.add('gm-page');
      b.append(page);
      this.tabs.set(key, { tab, page });
    }
    b.append(this.statusEl);
    this.selectTab('player');
  }

  /** abre (mostrando a aba Itens já com uma busca, na primeira vez) */
  override show(tab?: string) {
    super.show();
    if (tab) this.selectTab(tab);
    else this.fit([...this.tabs].find(([, v]) => !v.page.hidden)?.[0] ?? 'player');
  }

  private selectTab(key: string) {
    for (const [k, { tab, page }] of this.tabs) {
      const on = k === key;
      tab.setAttribute('aria-selected', String(on));
      page.hidden = !on;
    }
    if (key === 'mobs' && !this.mobList.childElementCount) this.renderMobs();
    if (key === 'items') this.wiki.activate();
    if (this.visible) this.fit(key);
  }

  /** Jogador: a janela tem exatamente a altura do conteúdo (sem rolagem); Itens/Monstros: pelo menos o suficiente para a lista */
  private fit(key: string) {
    const page = this.tabs.get(key)?.page;
    if (!page) return;
    if (key === 'items') { this.resizeTo(Math.max(this.box.w, 740), Math.max(this.box.h, 800)); return; }
    if (key !== 'player') { this.resizeTo(this.box.w, Math.max(this.box.h, 600)); return; }
    const before = page.offsetHeight;
    page.style.flex = 'none'; page.style.overflow = 'visible';
    const content = page.offsetHeight;
    page.style.flex = ''; page.style.overflow = '';
    this.resizeTo(this.box.w, this.el.offsetHeight + content - before);
  }

  private mobsPage() {
    let t = 0;
    this.mobQ.addEventListener('input', () => { clearTimeout(t); t = window.setTimeout(() => this.renderMobs(), 200); });
    this.mobQ.addEventListener('keydown', (e) => e.stopPropagation());
    this.mobBoss.addEventListener('change', () => this.renderMobs());
    this.mobPick.textContent = 'Choose a monster from the list.';
    const go = btn('Summon', () => this.place());
    return el('div', {},
      el('div', { className: 'gm-row' }, field('Search', this.mobQ), el('label', { className: 'gm-check' }, this.mobBoss, ' bosses only')),
      this.mobList, this.mobPick,
      el('div', { className: 'gm-row' }, field('Quantity', this.mobQty), go, btn('Clear summoned', () => this.send('//mob-clear'))),
      el('p', { className: 'gm-hint', textContent: 'Bosses appear in red and attack anyone who comes close. Summoned monsters do not respawn.' }));
  }

  /** Invocar: escolhe o ponto no chão (cursor no centro, círculo da área) e manda `//mob símbolo quantidade x z` */
  private place() {
    const m = this.mobPicked;
    if (!m) { this.status('Choose a monster.', true); return; }
    const n = Math.min(30, Math.max(1, Number(this.mobQty.value) || 1));
    this.status(`Move the circle to the spot and click to summon ${n}× ${m.name}. Esc or right-click cancels.`);
    this.el.hidden = true; // a janela sai da frente enquanto escolhe o lugar
    this.pickPoint((p) => {
      this.el.hidden = false;
      if (!p) { this.status('Summoning cancelled.'); return; }
      this.send(`//mob ${m.symbol} ${n} ${p[0].toFixed(1)} ${p[2].toFixed(1)}`);
    });
  }

  private renderMobs() {
    const q = this.mobQ.value.trim().toLowerCase(), onlyBoss = this.mobBoss.checked;
    const all = this.monsters().filter((m) => (!onlyBoss || m.boss) && (!q || m.name.toLowerCase().includes(q) || m.symbol.toLowerCase().includes(q)))
      .sort((a, b) => a.level - b.level || a.name.localeCompare(b.name)).slice(0, 300);
    this.mobList.replaceChildren();
    for (const m of all) {
      const li = el('li', { className: m.boss ? 'boss' : '', tabIndex: 0 }, el('b', { textContent: m.name }), el('span', { textContent: ` Lv. ${m.level} · ${m.symbol}` }));
      li.setAttribute('role', 'option');
      const pick = () => {
        this.mobPicked = m;
        this.mobList.querySelectorAll('.on').forEach((x) => x.classList.remove('on'));
        li.classList.add('on');
        this.mobPick.textContent = `${m.name} (Lv. ${m.level}${m.boss ? ', boss' : ''})`;
      };
      li.addEventListener('click', pick);
      li.addEventListener('dblclick', () => { pick(); this.place(); });
      li.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') pick(); });
      this.mobList.append(li);
    }
    if (!all.length) this.mobList.append(el('li', { textContent: 'No monsters found.' }));
  }

  status(text: string, error = false) { this.statusEl.textContent = text; this.statusEl.classList.toggle('error', error); }

  private nick() { return this.target.value.trim().replace(/\s+/g, ''); }

  // ---------- atributos de teste (STR/STA/DEX/INT) ----------
  /** botão Select: lê os atributos do jogador do campo Target (vazio = você) */
  private selectTarget() { if (!this.getStats(this.nick())) this.status('No connection to the server.', true); else this.status('…'); }

  /** resposta do servidor: preenche a caixa (ou mostra o erro) */
  setStats(m: GmStats) {
    if (!m.ok) { this.status(m.error ?? 'Could not read the stats.', true); return; }
    this.statIn.str.value = String(m.str); this.statIn.sta.value = String(m.sta); this.statIn.dex.value = String(m.dex); this.statIn.int.value = String(m.int);
    this.statWho.textContent = `${m.name} (Lv ${m.level})${m.temp ? ` · test values on (real: ${m.real?.str}/${m.real?.sta}/${m.real?.dex}/${m.real?.int})` : ''}`;
    this.statBox.classList.toggle('temp', !!m.temp);
    this.status(`${m.name}: STR ${m.str} · STA ${m.sta} · DEX ${m.dex} · INT ${m.int}${m.temp ? ' (test values)' : ''}`);
  }

  private applyStats() {
    const v = (i: HTMLInputElement) => Math.max(1, Math.min(1000, Math.round(Number(i.value)) || 0));
    const vals = { str: v(this.statIn.str), sta: v(this.statIn.sta), dex: v(this.statIn.dex), int: v(this.statIn.int) };
    if (Object.values(vals).some((n) => n < 1)) { this.status('Stats go from 1 to 1000.', true); return; }
    if (!this.setStatsReq(this.nick(), vals)) this.status('No connection to the server.', true); else this.status('…');
  }

  private resetStats() { if (!this.setStatsReq(this.nick(), null)) this.status('No connection to the server.', true); else this.status('…'); }

  /** caixa de skills de teste: abre todas no máximo permitido pelo nível do alvo, ou zera */
  private skillsBox() {
    return el('div', { className: 'gm-stats gm-skills' },
      el('b', { textContent: 'Skills (test)' }),
      el('p', { className: 'gm-hint', textContent: 'Gives every skill of the class at max level, up to what the character level allows.' }),
      el('div', { className: 'gm-row' }, btn('Max all skills', () => this.send(this.withTarget('skills-max', '')))),
      el('div', { className: 'gm-row' }, btn('Zero skills', () => {
        const who = this.nick() || 'you';
        void gameConfirm(`Zero all skills of ${who}? The points go back to the pool.`, 'Zero').then((ok) => { if (ok) this.send(this.withTarget('skills-clear', '')); });
      })),
      el('p', { className: 'gm-hint', textContent: 'Saved. Does not change the level or class.' }));
  }

  private statsBox() {
    this.statBox.replaceChildren(
      el('b', { textContent: 'Stats (test)' }), this.statWho,
      field('STR', this.statIn.str), field('STA', this.statIn.sta), field('DEX', this.statIn.dex), field('INT', this.statIn.int),
      el('div', { className: 'gm-row' }, btn('Apply', () => this.applyStats()), btn('Reset', () => this.resetStats())),
      el('p', { className: 'gm-hint', textContent: 'Temporary: not saved. Back to normal on relog or server restart (1 to 1000).' }));
    return this.statBox;
  }
  private send(cmd: string) { if (!this.run(cmd)) this.status('No connection to the server.', true); else this.status('…'); }
  private withTarget(cmd: string, rest: string) { const n = this.nick(); return `//${cmd}${n ? ` ${n}` : ''} ${rest}`.trim(); }

  // ---------- aba Jogador ----------
  private playerPage() {
    const x = el('input', { type: 'number', className: 'gm-in num', placeholder: 'x' });
    const z = el('input', { type: 'number', className: 'gm-in num', placeholder: 'z' });
    const map = this.mapSelect;
    const level = num(1, 150, 1);
    const job = select(JOBS);
    const penya = num(1, 2_000_000_000, 1000);
    const bag = num(42, 168, 42);
    const needNick = (cmd: string) => () => { const n = this.nick(); if (!n) { this.status('Type the target nick.', true); return; } this.send(`//${cmd} ${n}`); };
    const sep = () => el('div', { className: 'gm-sep', role: 'separator' });
    return el('div', { className: 'gm-player' },
      el('div', { className: 'gm-split cols' },
        el('div', { className: 'gm-left' },
          el('h4', { textContent: 'Teleport' }),
          el('div', { className: 'gm-row' }, btn('Go to target', needNick('goto')), btn('Bring target', needNick('summon'))),
          el('div', { className: 'gm-row' }, x, z, btn('Go to x, z', () => {
            if (!x.value || !z.value) { this.status('Enter x and z.', true); return; }
            this.send(`//tp ${Number(x.value)} ${Number(z.value)}`);
          })),
          el('div', { className: 'gm-row' }, btn('Back to Flaris', () => this.send('//tp 6976 3327')))),
        el('div', { className: 'gm-left' },
          el('h4', { textContent: 'Maps' }),
          el('div', { className: 'gm-row' }, map, btn('Go', () => { if (!map.value) { this.status('Choose a map.', true); return; } this.send(`//map ${map.value}`); }), btn('List', () => this.send('//map'))),
          el('span', { className: 'gm-hint', textContent: 'pick a map and press Go (List shows them in the chat)' }))),
      sep(),
      el('div', { className: 'gm-split chars' }, el('div', { className: 'gm-left gm-box' },
      el('b', { className: 'gm-box-title', textContent: 'Character (target)' }),
      el('div', { className: 'gm-row' }, field('Level', level), btn('Apply', () => this.send(this.withTarget('set-level', level.value)))),
      el('div', { className: 'gm-row' }, field('Class', job), btn('Apply', () => this.send(this.withTarget('set-job', job.value)))),
      el('div', { className: 'gm-row' }, field('Penya', penya), btn('Give', () => this.send(this.withTarget('give-penya', penya.value)))),
      el('div', { className: 'gm-row' }, field('Bag', bag), btn('Unlock', () => {
        const n = Math.round(Number(bag.value));
        if (!(n >= 42 && n <= 168)) { this.status('The bag goes from 42 to 168 slots.', true); return; }
        this.send(this.withTarget('bag', String(n)));
      })),
      el('div', { className: 'gm-row' }, btn('Reset stat points', () => {
        const who = this.nick() || 'you';
        void gameConfirm(`Return the stat points of ${who}? STR, STA, DEX and INT go back to 15.`, 'Return').then((ok) => { if (ok) this.send(this.withTarget('reset-stats', '')); });
      })),
      el('div', { className: 'gm-row' },
        btn('Kill', () => this.send(this.withTarget('kill', ''))),
        btn('Revive', () => this.send(this.withTarget('revive', ''))))), this.statsBox(), this.skillsBox()),
      sep(),
      el('h4', { textContent: 'GM' }),
      el('div', { className: 'gm-row' }, this.invisBtn, el('span', { className: 'gm-hint', textContent: 'invisible to players; GMs and admins can see you' })),
      el('div', { className: 'gm-row' }, this.godBtn, el('span', { className: 'gm-hint', textContent: 'takes hits but HP does not drop (on at login)' })),
      el('div', { className: 'gm-row' }, this.flyBtn, el('span', { className: 'gm-hint', textContent: 'E up, Q down, W A S D steer' })),
      el('div', { className: 'gm-row' }, this.speedIn, this.speedBtn, this.speedReset, el('span', { className: 'gm-hint', textContent: '% of normal (100 to 1000)' })),
    );
  }

  // ---------- aba Itens ----------
  /** a Wikipedia de itens incorporada na aba: clicar escolhe o item, duplo clique cria */
  readonly wiki = new WikiPanel(el('div', { className: 'gm-wiki' }));

  private itemsPage() {
    this.wiki.onPick = (r) => this.pickRow(r);
    this.wiki.onActivate = (r) => this.createRow(r);
    this.element.addEventListener('change', () => { this.elementLv.disabled = this.element.value === '0' || this.upgrade.disabled; });
    this.pick(null);
    return el('div', { className: 'gm-items' },
      this.wiki.root,
      el('p', { className: 'gm-hint', textContent: 'Click picks the item; double-click creates it in the target\'s bag with the options below.' }),
      this.pickBox,
      el('div', { className: 'gm-row wrap' }, field('Qty.', this.qty), field('Enchant', this.upgrade), field('Element', this.element), field('Lv.', this.elementLv), this.piercingField),
      el('div', { className: 'gm-row' }, btn('Create item in the target\'s bag', () => this.create())),
    );
  }

  /** o catálogo escolheu um item (linha leve da Wikipedia) */
  pickRow(r: { id: number; sym: string; name: string; icon: string; lv: number; parts: number; pack: number; gr: number; k2?: number }) {
    this.pick({ id: r.id, sym: r.sym, name: r.name, icon: r.icon, lv: r.lv, parts: r.parts, pack: r.pack, gr: r.gr, k2: r.k2 } as unknown as ItemView);
  }

  /** duplo clique no catálogo: escolhe e cria */
  createRow(r: Parameters<GmPanel['pickRow']>[0]) { this.pickRow(r); this.create(); }

  private found = new Map<number, ItemView>();

  setResults(list: ItemView[]) {
    this.found = new Map(list.map((d) => [d.id, d]));
    const frag = document.createDocumentFragment();
    for (const d of list) {
      const img = el('img', { alt: '' });
      void itemIcon(d.icon).then((u) => { if (u) img.src = u; });
      const g = gradeOf(d.gr); // só a cor (cls); o nome da raridade vem de gradeName
      const li = el('li', {}, img, el('span', { textContent: d.name, className: g.cls }), el('small', { textContent: d.lv ? `Lv ${d.lv}` : '' }));
      li.dataset.id = String(d.id);
      li.setAttribute('role', 'option');
      if (this.picked?.id === d.id) li.setAttribute('aria-selected', 'true');
      frag.append(li);
    }
    this.results.replaceChildren(frag);
    if (!list.length) this.results.append(el('li', { className: 'empty', textContent: 'No items found.' }));
  }

  private pick(d: ItemView | null) {
    this.picked = d;
    for (const li of this.results.querySelectorAll('li[data-id]')) li.setAttribute('aria-selected', String(Number((li as HTMLElement).dataset.id) === d?.id));
    const equip = !!d && d.parts >= 0;
    // enchant até o limite do item (joias +20, o resto +10); furos só na suit
    const maxU = d ? maxUpgrade(d.parts, d.k2) : 10, keep = Math.min(Number(this.upgrade.value) || 0, maxU);
    this.upgrade.replaceChildren(...Array.from({ length: maxU + 1 }, (_, i) => el('option', { value: String(i), textContent: `+${i}` })));
    this.upgrade.value = String(keep);
    const maxP = d ? maxPiercing(d.parts, d.k2) : 0;
    this.piercingField.hidden = !maxP;
    if (!maxP) this.piercing.value = '0';
    const elem = !!d && acceptsElement(d.parts, d.k2), ench = equip && maxU > 0; // cash: nada de enchant, elemento nem piercing
    this.upgrade.disabled = !ench; this.element.disabled = !elem;
    this.elementLv.disabled = !elem || this.element.value === '0';
    if (!ench) this.upgrade.value = '0';
    if (!elem) { this.element.value = '0'; this.elementLv.value = '0'; }
    if (!equip) { this.upgrade.value = '0'; this.element.value = '0'; this.elementLv.value = '0'; }
    this.qty.disabled = !d || d.pack <= 1;
    if (this.qty.disabled) this.qty.value = '1';
    if (!d) { this.pickBox.replaceChildren(el('span', { className: 'dim', textContent: 'Choose an item from the list (double-click creates it right away).' })); return; }
    const img = el('img', { alt: '' });
    void itemIcon(d.icon).then((u) => { if (u) img.src = u; });
    this.pickBox.replaceChildren(img, el('div', {}, el('b', { textContent: d.name, className: gradeOf(d.gr).cls }), el('br'), el('small', { textContent: `${gradeName(d.gr)} · ${d.sym} · id ${d.id}${d.lv ? ` · level ${d.lv}` : ''}${d.pack > 1 ? ` · stacks ${d.pack}` : ''}` })));
  }

  private create() {
    const d = this.picked;
    if (!d) { this.status('Choose an item.', true); return; }
    const qty = Math.max(1, Math.min(9999, Number(this.qty.value) || 1));
    const up = Number(this.upgrade.value), e = Number(this.element.value), elv = Number(this.elementLv.value), p = Number(this.piercing.value);
    const extra = `${up ? ` +${up}` : ''}${e ? ` ${ELEMENT_KEYS[e]}+${elv}` : ''}${p ? ` piercing${p}` : ''}`;
    this.send(this.withTarget('give-item', `${d.sym} ${qty}${extra}`));
  }
}
