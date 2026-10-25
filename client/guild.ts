import { JOBS } from './jobs';
import { GameWindow } from './ui';

/**
 * Janela da guild (tecla G). Sem guild: explica a regra do original (o líder de uma party cria e os membros online da
 * party entram junto) e tem o campo do nome + "Criar guild". Com guild: nome, nível, membros (online primeiro, cargo,
 * nível e classe), expulsar (mestre/kingpin), sair, desfazer (mestre). Convidar é pelo menu do jogador.
 */
export interface GuildMember { id: number; name: string; level: number; job: number; rank: number; rankName: string; on: boolean }
export interface GuildView { id: number; name: string; level: number; master: number; max: number; members: GuildMember[] }

export class GuildWindow extends GameWindow {
  onCreate: (name: string) => void = () => {};
  onLeave: () => void = () => {};
  onKick: (id: number) => void = () => {};
  onDisband: () => void = () => {};
  onOpen: () => void = () => {};
  private guild: GuildView | null = null;
  private myId = 0;

  constructor(parent: HTMLElement) {
    super(parent, { id: 'guildWnd', title: 'Guilda', store: 'flyff.wnd.guild', initial: { x: 60, y: 110, w: 300, h: 380 }, min: { w: 260, h: 240 } });
    this.body.classList.add('gd');
    this.render();
  }

  set(g: GuildView | null, myId: number) { this.guild = g; this.myId = myId; if (this.visible) this.render(); }
  show() { super.show(); this.render(); this.onOpen(); }

  private render() {
    const b = this.body, g = this.guild;
    b.replaceChildren();
    if (!g) {
      const t = document.createElement('p');
      t.className = 'pt-empty';
      t.textContent = 'Você não está em uma guild. Para criar, seja o líder de uma party: todos os membros online da party entram na guild com você, e você vira o mestre.';
      const input = document.createElement('input');
      input.className = 'pm-input';
      input.maxLength = 16;
      input.placeholder = 'Nome da guild (3 a 16 letras)';
      input.setAttribute('aria-label', 'Nome da guild');
      input.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') go(); });
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'cw-btn';
      btn.textContent = 'Criar guild';
      const go = () => { const n = input.value.trim(); if (n) this.onCreate(n); };
      btn.addEventListener('click', go);
      b.append(t, input, btn);
      return;
    }
    const me = g.members.find((m) => m.id === this.myId);
    const myRank = me?.rank ?? 4;
    const head = document.createElement('div');
    head.className = 'pt-head';
    const nm = document.createElement('b'); nm.textContent = g.name;
    const info = document.createElement('span');
    const online = g.members.filter((m) => m.on).length;
    info.textContent = `Nível ${g.level} · ${g.members.length}/${g.max} membros · ${online} online`;
    head.append(nm, info);
    b.append(head);

    const ul = document.createElement('ul');
    ul.className = 'pt-members';
    for (const m of [...g.members].sort((a, c) => Number(c.on) - Number(a.on) || a.rank - c.rank || a.name.localeCompare(c.name))) {
      const li = document.createElement('li');
      li.className = m.on ? '' : 'off';
      const name = document.createElement('span');
      name.className = 'pt-name gd-name';
      name.textContent = `${m.rank === 0 ? '♛ ' : ''}${m.name}`;
      const right = document.createElement('span');
      right.className = 'pt-info';
      right.textContent = `${m.rankName} · Nv. ${m.level} ${JOBS[m.job]?.name ?? ''}${m.on ? '' : ' · offline'}`;
      li.append(name, right);
      if (myRank <= 1 && m.id !== this.myId && m.rank > myRank) {
        const row = document.createElement('div');
        row.className = 'pt-actions';
        const kick = document.createElement('button'); kick.type = 'button'; kick.textContent = 'Expulsar';
        kick.addEventListener('click', () => { if (confirm(`Expulsar ${m.name} da guild?`)) this.onKick(m.id); });
        row.append(kick);
        li.append(row);
      }
      ul.append(li);
    }
    b.append(ul);
    const hint = document.createElement('p');
    hint.className = 'fr-hint';
    hint.textContent = myRank <= 1 ? 'Para convidar: clique num jogador e escolha "Convidar para guild".' : '';
    b.append(hint);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'cw-btn pt-leave';
    if (myRank === 0) {
      btn.textContent = 'Desfazer guild';
      btn.addEventListener('click', () => { if (confirm(`Desfazer a guild ${g.name}? Todos os membros saem.`)) this.onDisband(); });
    } else {
      btn.textContent = 'Sair da guild';
      btn.addEventListener('click', () => { if (confirm('Sair da guild?')) this.onLeave(); });
    }
    b.append(btn);
  }
}
