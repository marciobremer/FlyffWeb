import { JOBS } from './jobs';
import { GameWindow } from './ui';

/**
 * Mensageiro (CWndMessenger, tecla E): a lista de amigos — online primeiro, com nível e classe — e as conversas privadas.
 * Dois cliques no nome abrem a janela de conversa com aquele amigo; mensagem que chega abre a janela sozinha. A amizade
 * é pedida pelo menu do jogador ("Adicionar como amigo") e o outro aceita ou recusa num aviso (servers/world/realtime.ts).
 */
export interface FriendView { id: number; name: string; level: number; job: number; on: boolean }

export class FriendsWindow extends GameWindow {
  onRemove: (id: number) => void = () => {};
  onSend: (id: number, text: string) => void = () => {};
  /** aviso no chat (ex.: amigo offline) */
  onNotice: (text: string) => void = () => {};
  private list = document.createElement('ul');
  private empty = document.createElement('p');
  private friends = new Map<number, FriendView>();
  private chats = new Map<number, ChatWindow>();

  constructor(private parent: HTMLElement) {
    super(parent, { id: 'friendsWnd', title: 'Mensageiro', store: 'flyff.wnd.friends', initial: { x: 40, y: 140, w: 240, h: 320 }, min: { w: 200, h: 200 } });
    this.body.classList.add('fr');
    this.list.className = 'fr-list';
    this.list.setAttribute('role', 'listbox');
    this.list.setAttribute('aria-label', 'Amigos');
    this.empty.className = 'fr-empty';
    this.empty.textContent = 'Nenhum amigo ainda. Clique num jogador e escolha "Adicionar como amigo".';
    const hint = document.createElement('p');
    hint.className = 'fr-hint';
    hint.textContent = 'Dois cliques no nome para conversar.';
    this.body.append(this.list, this.empty, hint);
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
  clear() { this.friends.clear(); for (const c of this.chats.values()) c.hide(); this.render(); }

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

  private render() {
    const all = [...this.friends.values()].sort((a, b) => Number(b.on) - Number(a.on) || a.name.localeCompare(b.name));
    this.list.replaceChildren();
    this.empty.hidden = all.length > 0;
    for (const f of all) {
      const li = document.createElement('li');
      li.className = f.on ? 'on' : 'off';
      li.tabIndex = 0;
      li.setAttribute('role', 'option');
      li.title = f.on ? 'Online — dois cliques para conversar' : 'Offline';
      const dot = document.createElement('span');
      dot.className = 'fr-dot';
      dot.setAttribute('aria-label', f.on ? 'online' : 'offline');
      const name = document.createElement('span');
      name.className = 'fr-name';
      name.textContent = f.name;
      const info = document.createElement('span');
      info.className = 'fr-info';
      info.textContent = `Nv. ${f.level} ${JOBS[f.job]?.name ?? ''}`;
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'fr-del';
      del.textContent = '×';
      del.title = `Remover ${f.name} dos amigos`;
      del.setAttribute('aria-label', del.title);
      del.addEventListener('click', (e) => { e.stopPropagation(); if (confirm(`Remover ${f.name} da sua lista de amigos?`)) this.onRemove(f.id); });
      li.append(dot, name, info, del);
      li.addEventListener('dblclick', () => this.open(f.id));
      li.addEventListener('keydown', (e) => { if (e.key === 'Enter') this.open(f.id); });
      this.list.append(li);
    }
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
