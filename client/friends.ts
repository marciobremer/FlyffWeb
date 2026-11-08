import { JOBS } from './jobs';
import { gameConfirm } from './dialog';
import { GameWindow } from './ui';
import { keyedImage, skillIcon, themeImage, themeTiles } from '../shared/tga';

/**
 * Mensageiro (CWndMessenger, tecla E), no desenho do cliente original: o seu personagem e o servidor em cima, as colunas
 * Channel/State/Level/Job/Character (botões ButtMessenger*.bmp), a lista com as setas de rolagem, as abas Friend/Party/
 * Guild/Ignore (WndTabTile) e os botões de baixo (adicionar amigo e correio). A aba Friend é a lista de amigos — online
 * primeiro — e as conversas privadas; Party e Guild mostram os membros que o servidor manda; Ignore ainda não existe.
 * Dois cliques no nome abrem a conversa; mensagem que chega abre a janela sozinha. A amizade é pedida pelo menu do jogador
 * ("Adicionar como amigo") e o outro aceita ou recusa num aviso (servers/world/realtime.ts).
 */
export interface FriendView { id: number; name: string; level: number; job: number; on: boolean }

/** linha das abas Party e Guild */
export interface RosterRow { id: number; name: string; level: number; job: number; on: boolean }

type Tab = 'friend' | 'party' | 'guild' | 'ignore';
const TABS: [Tab, string][] = [['friend', 'Friend'], ['party', 'Party'], ['guild', 'Guild'], ['ignore', 'Ignore']];
/** colunas: arquivo do botão (4 quadros: 0 destaque, 1 normal, 2 apertado, 3 desligado) e a largura de um quadro */
const COLS: [string, string, number][] = [['Channel', 'ButtMessengerChannel.bmp', 58], ['State', 'ButtMessengerState.bmp', 54], ['Level', 'ButtMessengerLevel.bmp', 50], ['Job', 'ButtMessengerJob.bmp', 58], ['Character', 'ButtMessengerChar.bmp', 88]];

/** ícones pequenos de classe e de canal na folha icon_IconMessenger.dds (icon_IconMessenger.inc): [x, y] de cada um */
function jobIcon(job: number, on: boolean): [number, number] {
  let j = job;
  if (j >= 16 && j <= 31) j = 6 + ((j - 16) % 8); // master e hero usam o ícone da classe de origem
  if (j >= 6 && j <= 13) return [1 + 16 * (j - 6), on ? 221 : 237];
  return [1 + 16 * Math.min(5, Math.max(0, j)), on ? 65 : 81];
}
const CHANNEL_ICON: [number, number] = [1, 125];

export class FriendsWindow extends GameWindow {
  onRemove: (id: number) => void = () => {};
  onSend: (id: number, text: string) => void = () => {};
  /** aviso no chat (ex.: amigo offline) */
  onNotice: (text: string) => void = () => {};
  /** pedido de amizade pelo nome (janela Add Friend) */
  onAddByName: (name: string) => void = () => {};
  private addDlg: AddFriendWindow | null = null;
  private list = document.createElement('ul');
  private empty = document.createElement('p');
  private friends = new Map<number, FriendView>();
  private party: RosterRow[] = [];
  private guild: RosterRow[] = [];
  private chats = new Map<number, ChatWindow>();
  private tab: Tab = 'friend';
  private tabBtns = new Map<Tab, HTMLButtonElement>();
  private me = { name: '', job: 0, world: 'Madrigal' };
  private nameEl = document.createElement('b');
  private srvEl = document.createElement('div');

  constructor(private parent: HTMLElement) {
    super(parent, { id: 'friendsWnd', title: 'Messenger', store: 'flyff.wnd.friends2', initial: { x: 40, y: 140, w: 372, h: 420 }, min: { w: 340, h: 300 } });
    this.body.classList.add('fr');

    // topo: você (rosto, nome, estado) e o servidor
    const head = document.createElement('div');
    head.className = 'fr-head';
    const face = document.createElement('div');
    face.className = 'fr-face';
    face.setAttribute('aria-hidden', 'true');
    face.innerHTML = '<i></i><i></i><u></u>';
    const who = document.createElement('div');
    who.className = 'fr-who';
    const state = document.createElement('span');
    state.className = 'fr-state';
    state.textContent = '(Online)';
    who.append(this.nameEl, state);
    const status = document.createElement('button');
    status.type = 'button';
    status.className = 'fr-status';
    status.title = 'Estado';
    status.setAttribute('aria-label', 'Estado');
    status.textContent = '▸';
    status.addEventListener('click', () => this.onNotice('Mudar o estado (ocupado, ausente…) ainda não existe.'));
    this.srvEl.className = 'fr-srv';
    head.append(face, who, status, this.srvEl);
    this.setSelf('', 0);

    // colunas
    const cols = document.createElement('div');
    cols.className = 'fr-cols';
    for (const [label, file, w] of COLS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'fr-col';
      b.style.width = `${w}px`;
      b.style.setProperty('--w', `${w}px`);
      b.setAttribute('aria-label', label);
      b.title = label;
      b.disabled = label === 'Channel';
      void keyedImage(file).then((u) => { if (u) b.style.backgroundImage = `url(${u})`; });
      cols.append(b);
    }

    // lista + setas de rolagem
    const main = document.createElement('div');
    main.className = 'fr-main';
    this.list.className = 'fr-list';
    this.list.setAttribute('role', 'listbox');
    this.list.setAttribute('aria-label', 'Lista');
    const bar = document.createElement('div');
    bar.className = 'fr-bar';
    for (const [dir, file] of [['up', 'ButtUp.tga'], ['down', 'ButtDown.tga']] as const) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `fr-arrow ${dir}`;
      b.setAttribute('aria-label', dir === 'up' ? 'Rolar para cima' : 'Rolar para baixo');
      void themeImage(file).then((u) => { if (u) b.style.backgroundImage = `url(${u})`; });
      b.addEventListener('click', () => this.list.scrollBy({ top: dir === 'up' ? -60 : 60, behavior: 'smooth' }));
      bar.append(b);
    }
    this.empty.className = 'fr-empty';
    main.append(this.list, bar, this.empty);

    // abas
    const tabs = document.createElement('div');
    tabs.className = 'fr-tabs';
    tabs.setAttribute('role', 'tablist');
    for (const [id, label] of TABS) {
      const t = document.createElement('button');
      t.type = 'button';
      t.className = 'fr-tab';
      t.setAttribute('role', 'tab');
      t.textContent = label;
      t.addEventListener('click', () => { this.tab = id; this.render(); });
      this.tabBtns.set(id, t);
      tabs.append(t);
    }
    void themeTiles(['WndTabTile10.tga', 'WndTabTile11.tga', 'WndTabTile12.tga'], 3, 1).then((t) => { if (t) this.body.style.setProperty('--tab-on', `url(${t.url})`); });
    void themeTiles(['WndTabTile00.tga', 'WndTabTile01.tga', 'WndTabTile02.tga'], 3, 1).then((t) => { if (t) this.body.style.setProperty('--tab-off', `url(${t.url})`); });
    void skillIcon('icon_IconMessenger.dds').then((u) => { if (u) this.body.style.setProperty('--msg-sheet', `url(${u})`); });

    // embaixo: adicionar amigo e correio
    const foot = document.createElement('div');
    foot.className = 'fr-foot';
    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'fr-tool';
    add.title = 'Adicionar amigo';
    add.setAttribute('aria-label', add.title);
    add.textContent = '+';
    add.addEventListener('click', () => this.addFriendDialog());
    const mail = document.createElement('button');
    mail.type = 'button';
    mail.className = 'fr-tool mail';
    mail.title = 'Correio';
    mail.setAttribute('aria-label', 'Correio');
    mail.addEventListener('click', () => this.onNotice('O correio ainda não existe.'));
    foot.append(add, mail);

    this.body.append(head, cols, main, tabs, foot);
    this.render();
  }

  /** janela "Add Friend": digita o nick (o jogador precisa estar online) */
  addFriendDialog() {
    this.addDlg ??= new AddFriendWindow(this.parent, (name) => this.onAddByName(name));
    this.addDlg.open();
  }

  /** o seu personagem no topo: nome, classe e mapa (o servidor é o nome do jogo) */
  setSelf(name: string, job: number, world = this.me.world) {
    this.me = { name, job, world };
    this.nameEl.textContent = name || '—';
    this.srvEl.replaceChildren();
    const a = document.createElement('span'), b = document.createElement('span');
    a.textContent = 'ReactioN MMO';
    b.textContent = `${world}-1`;
    this.srvEl.append(a, b);
  }

  set(list: FriendView[]) { this.friends = new Map(list.map((f) => [f.id, f])); this.render(); }
  add(f: FriendView) { this.friends.set(f.id, f); this.render(); }
  remove(id: number) { this.friends.delete(id); this.chats.get(id)?.hide(); this.render(); }
  online(id: number, on: boolean) {
    const f = this.friends.get(id);
    if (!f) return;
    f.on = on;
    this.render();
    this.chats.get(id)?.system(on ? `${f.name} entrou no jogo.` : `${f.name} saiu do jogo.`);
  }
  clear() { this.friends.clear(); this.party = []; this.guild = []; for (const c of this.chats.values()) c.hide(); this.render(); }
  /** membros da sua party e da sua guild (as abas Party e Guild) */
  setParty(rows: RosterRow[]) { this.party = rows; if (this.tab === 'party') this.render(); }
  setGuild(rows: RosterRow[]) { this.guild = rows; if (this.tab === 'guild') this.render(); }

  /** mensagem privada: `withId`/`withName` = com quem é a conversa (amigo ou não, /say); `from` 0 = aviso do servidor */
  message(withId: number, withName: string, from: number, name: string, text: string, mine: boolean) {
    const w = this.chat(withId, withName);
    if (!w) return;
    if (from === 0) w.system(text); else w.line(name, text, mine);
    if (!w.visible) w.show();
  }

  /** abre (ou traz para frente) a conversa com o amigo — offline não abre, só avisa */
  open(id: number) {
    const f = this.friends.get(id);
    if (f && !f.on) { this.onNotice(`${f.name} não está online.`); return; }
    const w = this.chat(id);
    if (w) { w.show(); w.focus(); }
  }

  private chat(id: number, name = '') {
    const f = this.friends.get(id) ?? (name ? { id, name, level: 0, job: 0, on: true } : null);
    if (!f) return null;
    let w = this.chats.get(id);
    if (!w) {
      w = new ChatWindow(this.parent, f, this.chats.size);
      w.onSend = (text) => this.onSend(id, text);
      this.chats.set(id, w);
    }
    return w;
  }

  /** um ícone da folha do Mensageiro (16×16) */
  private icon(at: [number, number]) {
    const i = document.createElement('i');
    i.className = 'fr-ico';
    i.style.backgroundPosition = `-${at[0]}px -${at[1]}px`;
    return i;
  }

  private render() {
    for (const [id, b] of this.tabBtns) { b.classList.toggle('on', id === this.tab); b.setAttribute('aria-selected', String(id === this.tab)); }
    const rows: (RosterRow & { friend: boolean })[] = this.tab === 'friend' ? [...this.friends.values()].map((f) => ({ ...f, friend: true }))
      : this.tab === 'party' ? this.party.map((r) => ({ ...r, friend: false })) : this.tab === 'guild' ? this.guild.map((r) => ({ ...r, friend: false })) : [];
    rows.sort((a, b) => Number(b.on) - Number(a.on) || a.name.localeCompare(b.name));
    this.list.replaceChildren();
    this.empty.hidden = rows.length > 0;
    this.empty.textContent = this.tab === 'friend' ? 'Nenhum amigo ainda. Clique num jogador e escolha "Adicionar como amigo".'
      : this.tab === 'party' ? 'Você não está numa party.' : this.tab === 'guild' ? 'Você não está numa guild.' : 'Ninguém na lista de ignorados.';
    for (const f of rows) {
      const li = document.createElement('li');
      li.className = `fr-row ${f.on ? 'on' : 'off'}`;
      li.tabIndex = 0;
      li.setAttribute('role', 'option');
      li.title = f.on ? 'Online' + (f.friend ? ' — dois cliques para conversar' : '') : 'Offline';
      const ch = document.createElement('span');
      ch.className = 'c-ch';
      if (f.on) ch.append(this.icon(CHANNEL_ICON));
      const st = document.createElement('span');
      st.className = 'c-st';
      const dot = document.createElement('span');
      dot.className = 'fr-dot';
      dot.setAttribute('aria-label', f.on ? 'online' : 'offline');
      st.append(dot);
      const lv = document.createElement('span');
      lv.className = 'c-lv';
      lv.textContent = f.level ? String(f.level) : '';
      const jb = document.createElement('span');
      jb.className = 'c-jb';
      jb.title = JOBS[f.job]?.name ?? '';
      jb.append(this.icon(jobIcon(f.job, f.on)));
      const nm = document.createElement('span');
      nm.className = 'c-nm';
      nm.textContent = f.name;
      li.append(ch, st, lv, jb, nm);
      if (f.friend) {
        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'fr-del';
        del.textContent = '×';
        del.title = `Remover ${f.name} dos amigos`;
        del.setAttribute('aria-label', del.title);
        del.addEventListener('click', (e) => { e.stopPropagation(); void gameConfirm(`Remover ${f.name} da sua lista de amigos?`, 'Remover').then((ok) => { if (ok) this.onRemove(f.id); }); });
        li.append(del);
        li.addEventListener('dblclick', () => this.open(f.id));
        li.addEventListener('keydown', (e) => { if (e.key === 'Enter') this.open(f.id); });
      }
      this.list.append(li);
    }
  }
}

/** janela "Add Friend": "Enter Name", campo de texto, OK e Cancel */
class AddFriendWindow extends GameWindow {
  private input = document.createElement('input');

  constructor(parent: HTMLElement, private submit: (name: string) => void) {
    super(parent, { id: 'addFriendWnd', title: 'Add Friend', store: 'flyff.wnd.addfriend', initial: { x: 90, y: 250, w: 250, h: 150 }, min: { w: 220, h: 130 }, resizable: false });
    this.body.classList.add('af');
    const label = document.createElement('p');
    label.textContent = 'Enter Name';
    this.input.className = 'af-in';
    this.input.maxLength = 32;
    this.input.setAttribute('aria-label', 'Nome do jogador');
    this.input.addEventListener('keydown', (e) => {
      e.stopPropagation(); // teclas do jogo não valem enquanto digita
      if (e.key === 'Enter') this.ok();
      if (e.key === 'Escape') this.hide();
    });
    const ok = document.createElement('button'), cancel = document.createElement('button');
    ok.type = cancel.type = 'button';
    ok.className = cancel.className = 'af-btn';
    ok.textContent = 'OK'; cancel.textContent = 'Cancel';
    ok.addEventListener('click', () => this.ok());
    cancel.addEventListener('click', () => this.hide());
    const row = document.createElement('div');
    row.className = 'af-row';
    row.append(ok, cancel);
    this.body.append(label, this.input, row);
    void themeImage('ButtOk.tga'); // pré-carrega
  }

  open() { this.input.value = ''; this.show(); this.input.focus(); }

  private ok() {
    const name = this.input.value.trim();
    if (!name) { this.input.focus(); return; }
    this.hide();
    this.submit(name);
  }
}

/** conversa privada com um amigo */
class ChatWindow extends GameWindow {
  onSend: (text: string) => void = () => {};
  private log = document.createElement('div');
  private input = document.createElement('input');

  constructor(parent: HTMLElement, private f: FriendView, n: number) {
    super(parent, { id: `pmWnd-${f.id}`, title: `Conversa — ${f.name}`, store: 'flyff.wnd.pm', initial: { x: 300 + (n % 5) * 24, y: 160 + (n % 5) * 24, w: 300, h: 240 }, min: { w: 240, h: 180 } });
    this.body.classList.add('pm');
    this.log.className = 'pm-log';
    this.log.setAttribute('role', 'log');
    this.log.setAttribute('aria-live', 'polite');
    this.input.className = 'pm-input';
    this.input.maxLength = 200;
    this.input.placeholder = `Mensagem para ${f.name}`;
    this.input.setAttribute('aria-label', `Mensagem para ${f.name}`);
    this.input.addEventListener('keydown', (e) => {
      e.stopPropagation(); // teclas do jogo (andar, atalhos) não valem enquanto digita
      if (e.key === 'Enter') { const t = this.input.value.trim(); if (t) this.onSend(t); this.input.value = ''; }
      if (e.key === 'Escape') this.input.blur();
    });
    this.body.append(this.log, this.input);
  }

  focus() { this.input.focus(); }

  line(name: string, text: string, mine: boolean) {
    const p = document.createElement('p');
    p.className = mine ? 'me' : 'them';
    const who = document.createElement('b');
    who.textContent = `${name}: `;
    p.append(who, document.createTextNode(text));
    this.add(p);
  }

  system(text: string) {
    const p = document.createElement('p');
    p.className = 'sys';
    p.textContent = text;
    this.add(p);
  }

  private add(p: HTMLElement) {
    this.log.append(p);
    while (this.log.children.length > 200) this.log.firstChild?.remove();
    this.log.scrollTop = this.log.scrollHeight;
  }
}

/** aviso de pedido (amizade, convite de party) com Aceitar / Recusar (some sozinho em 60 s = recusado) */
export function friendRequestPrompt(parent: HTMLElement, name: string, answer: (ok: boolean) => void, text = `${name} quer ser seu amigo.`) {
  const box = document.createElement('div');
  box.className = 'fr-req';
  box.setAttribute('role', 'alertdialog');
  box.setAttribute('aria-label', 'Pedido de amizade');
  const msg = document.createElement('p');
  msg.textContent = text;
  const yes = document.createElement('button'), no = document.createElement('button');
  yes.type = no.type = 'button';
  yes.className = 'cw-btn'; no.className = 'cw-btn';
  yes.textContent = 'Aceitar'; no.textContent = 'Recusar';
  let done = false;
  const finish = (ok: boolean) => { if (done) return; done = true; box.remove(); answer(ok); };
  yes.addEventListener('click', () => finish(true));
  no.addEventListener('click', () => finish(false));
  setTimeout(() => finish(false), 60_000);
  const row = document.createElement('div');
  row.append(yes, no);
  box.append(msg, row);
  parent.append(box);
  yes.focus();
}
