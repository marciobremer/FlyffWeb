import { itemIcon } from '../shared/tga';
import { ELEMENT_NAMES, GameWindow } from './ui';
import type { ItemView } from './net';
import { maxPiercing, maxUpgrade } from '../shared/upgrade';
import { GRADES, gradeOf } from '../shared/grade';
import { hideItemTip, moveItemTip, showItemTip } from './itemtip';

/**
 * Painel de GM (`//gm` no chat; só abre para contas GM/admin — quem decide é o servidor). Janela móvel/redimensionável com:
 * - Jogador: alvo por nick (vazio = você), ir até / trazer, teleporte por coordenada, nível, classe e penya;
 * - Itens: busca no catálogo (nome ou símbolo II_*, por categoria) com ícones, e criar o item na bolsa do alvo com
 *   quantidade, enchant (joias +0–20, o resto +0–10), elemento (+0–10) e furos de piercing (suit, 0–4);
 * - Jogador: também devolve os pontos de atributo do alvo (reset de status) e mata / revive o alvo (`//kill`, `//revive`);
 *   Dark Illusion (`//invis`) deixa você invisível para os jogadores (GMs/admins veem translúcido) e os mobs largam você.
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
const ELEMENT_KEYS = ['', 'fogo', 'agua', 'eletrico', 'vento', 'terra'];
const KINDS: [string, string][] = [['', 'Todas'], ['weapon', 'Armas'], ['armor', 'Armaduras'], ['general', 'Gerais (poções…)'], ['ride', 'Montarias'], ['charged', 'Cash'], ['system', 'Sistema']];

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

  private target = el('input', { className: 'gm-in', placeholder: 'nick (vazio = você)', maxLength: 32 });
  private statusEl = el('p', { className: 'gm-status' });
  private tabs = new Map<string, { tab: HTMLButtonElement; page: HTMLElement }>();
  private results = el('ul', { className: 'gm-results' });
  private picked: ItemView | null = null;
  private pickBox = el('div', { className: 'gm-pick' });
  private qty = num(1, 9999, 1);
  private upgrade = select(Array.from({ length: 11 }, (_, i) => [String(i), `+${i}`] as [string, string]));
  /** furos de piercing (só suit) */
  private piercing = select(Array.from({ length: 5 }, (_, i) => [String(i), i ? `${i}` : 'Nenhum'] as [string, string]));
  private piercingField = field('Furos', this.piercing);
  private element = select(ELEMENT_NAMES.map((n, i) => [String(i), n || 'Nenhum'] as [string, string]));
  private elementLv = select(Array.from({ length: 11 }, (_, i) => [String(i), `+${i}`] as [string, string]));
  private q = el('input', { className: 'gm-in', type: 'search', placeholder: 'nome ou II_…', maxLength: 40 });
  private kind = select(KINDS);
  /** filtro de raridade (dwItemGrade) */
  private grade = select([['0', 'Raridade: todas'], ...Object.entries(GRADES).map(([g, v]) => [g, v.name] as [string, string])]);
  private timer = 0;
  /** monstros do jogo (vem dos dados do mundo carregado) */
  monsters: () => { id: number; name: string; symbol: string; level: number; boss: boolean }[] = () => [];
  /** escolher no chão onde invocar (círculo); null = cancelado */
  pickPoint: (done: (p: [number, number, number] | null) => void) => void = (done) => done(null);
  private mobQ = el('input', { className: 'gm-in', type: 'search', placeholder: 'nome ou MI_…', maxLength: 40 });
  private mobBoss = el('input', { type: 'checkbox' });
  private mobList = el('ul', { className: 'gm-results gm-mobs' });
  private mobPicked: { id: number; name: string; symbol: string; level: number; boss: boolean } | null = null;
  private mobPick = el('div', { className: 'gm-pick' });
  private mobQty = num(1, 30, 1);
  /** Dark Illusion: liga/desliga a invisibilidade de GM (//invis) */
  private invisBtn = btn('Dark Illusion', () => this.send('//invis'));
  /** imortal: os mobs batem e o dano aparece, mas o HP não cai (//god; ligado ao entrar) */
  private godBtn = btn('Imortal', () => this.send('//god'));

  /** estado da Dark Illusion (o servidor avisa ao ligar/desligar) */
  setInvis(on: boolean) {
    this.invisBtn.textContent = on ? 'Dark Illusion: ligada' : 'Dark Illusion';
    this.invisBtn.classList.toggle('on', on);
  }

  /** estado do modo imortal (o servidor avisa ao entrar e ao ligar/desligar) */
  setGod(on: boolean) {
    this.godBtn.textContent = on ? 'Imortal: ligado' : 'Imortal: desligado';
    this.godBtn.classList.toggle('on', on);
    this.godBtn.setAttribute('aria-pressed', String(on));
  }

  constructor(parent: HTMLElement) {
    super(parent, { id: 'gmWnd', title: 'Painel de GM', store: 'flyff.wnd.gm', initial: { x: 260, y: 90, w: 380, h: 520 }, min: { w: 320, h: 360 } });
    const b = this.body;
    b.classList.add('gm');
    const bar = el('div', { className: 'gm-tabs' });
    bar.setAttribute('role', 'tablist');
    b.append(field('Alvo', this.target), bar);
    for (const [key, label, page] of [['player', 'Jogador', this.playerPage()], ['items', 'Itens', this.itemsPage()], ['mobs', 'Monstros', this.mobsPage()]] as const) {
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
  }

  private selectTab(key: string) {
    for (const [k, { tab, page }] of this.tabs) {
      const on = k === key;
      tab.setAttribute('aria-selected', String(on));
      page.hidden = !on;
    }
    if (key === 'items' && !this.results.childElementCount) this.search(this.q.value, this.kind.value, Number(this.grade.value));
    if (key === 'mobs' && !this.mobList.childElementCount) this.renderMobs();
  }

  private mobsPage() {
    let t = 0;
    this.mobQ.addEventListener('input', () => { clearTimeout(t); t = window.setTimeout(() => this.renderMobs(), 200); });
    this.mobQ.addEventListener('keydown', (e) => e.stopPropagation());
    this.mobBoss.addEventListener('change', () => this.renderMobs());
    this.mobPick.textContent = 'Escolha um monstro na lista.';
    const go = btn('Invocar', () => this.place());
    return el('div', {},
      el('div', { className: 'gm-row' }, field('Buscar', this.mobQ), el('label', { className: 'gm-check' }, this.mobBoss, ' só boss')),
      this.mobList, this.mobPick,
      el('div', { className: 'gm-row' }, field('Quantidade', this.mobQty), go, btn('Apagar invocados', () => this.send('//mob-clear'))),
      el('p', { className: 'gm-hint', textContent: 'Boss aparecem em vermelho e já atacam quem chega perto. Os invocados não renascem.' }));
  }

  /** Invocar: escolhe o ponto no chão (cursor no centro, círculo da área) e manda `//mob símbolo quantidade x z` */
  private place() {
    const m = this.mobPicked;
    if (!m) { this.status('Escolha um monstro.', true); return; }
    const n = Math.min(30, Math.max(1, Number(this.mobQty.value) || 1));
    this.status(`Mova o círculo até o lugar e clique para invocar ${n}× ${m.name}. Esc ou botão direito cancela.`);
    this.el.hidden = true; // a janela sai da frente enquanto escolhe o lugar
    this.pickPoint((p) => {
      this.el.hidden = false;
      if (!p) { this.status('Invocação cancelada.'); return; }
      this.send(`//mob ${m.symbol} ${n} ${p[0].toFixed(1)} ${p[2].toFixed(1)}`);
    });
  }

  private renderMobs() {
    const q = this.mobQ.value.trim().toLowerCase(), onlyBoss = this.mobBoss.checked;
    const all = this.monsters().filter((m) => (!onlyBoss || m.boss) && (!q || m.name.toLowerCase().includes(q) || m.symbol.toLowerCase().includes(q)))
      .sort((a, b) => a.level - b.level || a.name.localeCompare(b.name)).slice(0, 300);
    this.mobList.replaceChildren();
    for (const m of all) {
      const li = el('li', { className: m.boss ? 'boss' : '', tabIndex: 0 }, el('b', { textContent: m.name }), el('span', { textContent: ` Nv. ${m.level} · ${m.symbol}` }));
      li.setAttribute('role', 'option');
      const pick = () => {
        this.mobPicked = m;
        this.mobList.querySelectorAll('.on').forEach((x) => x.classList.remove('on'));
        li.classList.add('on');
        this.mobPick.textContent = `${m.name} (Nv. ${m.level}${m.boss ? ', boss' : ''})`;
      };
      li.addEventListener('click', pick);
      li.addEventListener('dblclick', () => { pick(); this.place(); });
      li.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') pick(); });
      this.mobList.append(li);
    }
    if (!all.length) this.mobList.append(el('li', { textContent: 'Nenhum monstro encontrado.' }));
  }

  status(text: string, error = false) { this.statusEl.textContent = text; this.statusEl.classList.toggle('error', error); }

  private nick() { return this.target.value.trim().replace(/\s+/g, ''); }
  private send(cmd: string) { if (!this.run(cmd)) this.status('Sem conexão com o servidor.', true); else this.status('…'); }
  private withTarget(cmd: string, rest: string) { const n = this.nick(); return `//${cmd}${n ? ` ${n}` : ''} ${rest}`.trim(); }

  // ---------- aba Jogador ----------
  private playerPage() {
    const x = el('input', { type: 'number', className: 'gm-in num', placeholder: 'x' });
    const z = el('input', { type: 'number', className: 'gm-in num', placeholder: 'z' });
    const level = num(1, 150, 1);
    const job = select(JOBS);
    const penya = num(1, 2_000_000_000, 1000);
    const needNick = (cmd: string) => () => { const n = this.nick(); if (!n) { this.status('Digite o nick do alvo.', true); return; } this.send(`//${cmd} ${n}`); };
    return el('div', {},
      el('h4', { textContent: 'Teleporte' }),
      el('div', { className: 'gm-row' }, btn('Ir até o alvo', needNick('goto')), btn('Trazer o alvo', needNick('summon'))),
      el('div', { className: 'gm-row' }, x, z, btn('Ir para x, z', () => {
        if (!x.value || !z.value) { this.status('Informe x e z.', true); return; }
        this.send(`//tp ${Number(x.value)} ${Number(z.value)}`);
      })),
      el('div', { className: 'gm-row' }, btn('Voltar para Flaris', () => this.send('//tp 6976 3327'))),
      el('h4', { textContent: 'Personagem (alvo)' }),
      el('div', { className: 'gm-row' }, field('Nível', level), btn('Aplicar', () => this.send(this.withTarget('set-level', level.value)))),
      el('div', { className: 'gm-row' }, field('Classe', job), btn('Aplicar', () => this.send(this.withTarget('set-job', job.value)))),
      el('div', { className: 'gm-row' }, field('Penya', penya), btn('Dar', () => this.send(this.withTarget('give-penya', penya.value)))),
      el('div', { className: 'gm-row' }, btn('Resetar pontos de status', () => {
        const who = this.nick() || 'você';
        if (confirm(`Devolver os pontos de atributo de ${who}? STR, STA, DEX e INT voltam a 15.`)) this.send(this.withTarget('reset-stats', ''));
      })),
      el('h4', { textContent: 'GM' }),
      el('div', { className: 'gm-row' }, this.invisBtn, el('span', { className: 'gm-hint', textContent: 'invisível para os jogadores; GMs e admins veem' })),
      el('div', { className: 'gm-row' }, this.godBtn, el('span', { className: 'gm-hint', textContent: 'leva os golpes, mas o HP não cai (liga ao entrar)' })),
      el('h4', { textContent: 'Vida' }),
      el('div', { className: 'gm-row' },
        btn('Matar', () => this.send(this.withTarget('kill', ''))),
        btn('Reviver', () => this.send(this.withTarget('revive', '')))),
    );
  }

  // ---------- aba Itens ----------
  private itemsPage() {
    const go = () => this.search(this.q.value, this.kind.value, Number(this.grade.value));
    this.grade.addEventListener('change', go);
    this.q.addEventListener('input', () => { clearTimeout(this.timer); this.timer = window.setTimeout(go, 300); });
    this.q.addEventListener('keydown', (e) => { if (e.key === 'Enter') { clearTimeout(this.timer); go(); } });
    this.kind.addEventListener('change', go);
    this.element.addEventListener('change', () => { this.elementLv.disabled = this.element.value === '0' || this.upgrade.disabled; });
    this.results.setAttribute('role', 'listbox');
    this.results.setAttribute('aria-label', 'Itens encontrados');
    this.results.addEventListener('click', (e) => {
      const li = (e.target as HTMLElement).closest<HTMLLIElement>('li[data-id]');
      if (li) this.pick(this.found.get(Number(li.dataset.id)) ?? null);
    });
    this.results.addEventListener('dblclick', (e) => { if ((e.target as HTMLElement).closest('li[data-id]')) this.create(); });
    // dica completa do item ao passar o mouse (a mesma do inventário: ataque/defesa, velocidade, bônus, classe, conjunto…),
    // com o enchant/elemento escolhidos no painel quando é o item selecionado
    let tipId = -1;
    this.results.addEventListener('mousemove', (e) => {
      const li = (e.target as HTMLElement).closest<HTMLLIElement>('li[data-id]');
      const d = li ? this.found.get(Number(li.dataset.id)) : undefined;
      if (!d) { if (tipId >= 0) { hideItemTip(); tipId = -1; } return; }
      if (d.id === tipId) { moveItemTip(e); return; }
      tipId = d.id;
      const sel = this.picked?.id === d.id;
      const it = { id: d.id, n: 1, u: sel ? Number(this.upgrade.value) : 0, e: sel ? Number(this.element.value) : 0, el: sel ? Number(this.elementLv.value) : 0,
        ...(sel && Number(this.piercing.value) ? { p: new Array<number>(Number(this.piercing.value)).fill(0) } : {}) };
      showItemTip(e, d, it, ELEMENT_NAMES);
    });
    this.results.addEventListener('mouseleave', () => { hideItemTip(); tipId = -1; });
    this.pick(null);
    return el('div', { className: 'gm-items' },
      el('div', { className: 'gm-row' }, this.q, this.kind, this.grade),
      this.results,
      this.pickBox,
      el('div', { className: 'gm-row wrap' }, field('Qtd.', this.qty), field('Enchant', this.upgrade), field('Elemento', this.element), field('Nv.', this.elementLv), this.piercingField),
      el('div', { className: 'gm-row' }, btn('Criar item na bolsa do alvo', () => this.create())),
    );
  }

  private found = new Map<number, ItemView>();

  setResults(list: ItemView[]) {
    this.found = new Map(list.map((d) => [d.id, d]));
    const frag = document.createDocumentFragment();
    for (const d of list) {
      const img = el('img', { alt: '' });
      void itemIcon(d.icon).then((u) => { if (u) img.src = u; });
      const g = gradeOf(d.gr);
      const li = el('li', {}, img, el('span', { textContent: d.name, className: g.cls }), el('small', { textContent: d.lv ? `Nv ${d.lv}` : '' }));
      li.dataset.id = String(d.id);
      li.setAttribute('role', 'option');
      if (this.picked?.id === d.id) li.setAttribute('aria-selected', 'true');
      frag.append(li);
    }
    this.results.replaceChildren(frag);
    if (!list.length) this.results.append(el('li', { className: 'empty', textContent: 'Nenhum item encontrado.' }));
  }

  private pick(d: ItemView | null) {
    this.picked = d;
    for (const li of this.results.querySelectorAll('li[data-id]')) li.setAttribute('aria-selected', String(Number((li as HTMLElement).dataset.id) === d?.id));
    const equip = !!d && d.parts >= 0;
    // enchant até o limite do item (joias +20, o resto +10); furos só na suit
    const maxU = d ? maxUpgrade(d.parts) : 10, keep = Math.min(Number(this.upgrade.value) || 0, maxU);
    this.upgrade.replaceChildren(...Array.from({ length: maxU + 1 }, (_, i) => el('option', { value: String(i), textContent: `+${i}` })));
    this.upgrade.value = String(keep);
    const maxP = d ? maxPiercing(d.parts) : 0;
    this.piercingField.hidden = !maxP;
    if (!maxP) this.piercing.value = '0';
    this.upgrade.disabled = this.element.disabled = !equip;
    this.elementLv.disabled = !equip || this.element.value === '0';
    if (!equip) { this.upgrade.value = '0'; this.element.value = '0'; this.elementLv.value = '0'; }
    this.qty.disabled = !d || d.pack <= 1;
    if (this.qty.disabled) this.qty.value = '1';
    if (!d) { this.pickBox.replaceChildren(el('span', { className: 'dim', textContent: 'Escolha um item na lista (duplo clique cria direto).' })); return; }
    const img = el('img', { alt: '' });
    void itemIcon(d.icon).then((u) => { if (u) img.src = u; });
    this.pickBox.replaceChildren(img, el('div', {}, el('b', { textContent: d.name, className: gradeOf(d.gr).cls }), el('br'), el('small', { textContent: `${gradeOf(d.gr).name} · ${d.sym} · id ${d.id}${d.lv ? ` · nível ${d.lv}` : ''}${d.pack > 1 ? ` · empilha ${d.pack}` : ''}` })));
  }

  private create() {
    const d = this.picked;
    if (!d) { this.status('Escolha um item.', true); return; }
    const qty = Math.max(1, Math.min(9999, Number(this.qty.value) || 1));
    const up = Number(this.upgrade.value), e = Number(this.element.value), elv = Number(this.elementLv.value), p = Number(this.piercing.value);
    const extra = `${up ? ` +${up}` : ''}${e ? ` ${ELEMENT_KEYS[e]}+${elv}` : ''}${p ? ` furos${p}` : ''}`;
    this.send(this.withTarget('give-item', `${d.sym} ${qty}${extra}`));
  }
}
