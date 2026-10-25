import { skillIcon } from '../shared/tga';
import { JOBS } from './jobs';
import { GameWindow } from './ui';

/**
 * Party (servers/world/party.ts): a janela da sua party (tecla P) — nível, exp e pontos da party, membros com HP, líder
 * (coroa) e as habilidades de party que o líder liga — e a lista de todas as partys do servidor (tecla L), com nível,
 * tamanho e os buffs ligados.
 */
export interface PartyMember { id: number; name: string; level: number; job: number; hp: number; on: boolean }
export interface PartyView {
  id: number; name: string; leader: number; level: number; exp: number; expNext: number; points: number;
  members: PartyMember[]; skills: { k: string; left: number }[];
}
export interface PartyListRow { id: number; name: string; leader: string; level: number; size: number; max: number; skills: string[] }

/** buffs de party (mesma lista do servidor) */
export const SKILLS: Record<string, { name: string; desc: string; icon: string; reqLv: number; cost: number }> = {
  ST_SPHERECIRCLE: { name: 'Precision', desc: 'Ataques com chance quase certa de crítico.', icon: 'skill_TroSpherecircle.dds', reqLv: 17, cost: 1 },
  ST_LINKATTACK: { name: 'Link Attack', desc: 'Dano dos membros aumenta ao atacar.', icon: 'skill_TroLinkattack.dds', reqLv: 20, cost: 1 },
  ST_FORTUNECIRCLE: { name: 'Lucky Drop', desc: 'Mais chance de itens raros.', icon: 'skill_TroFortunecircle.dds', reqLv: 25, cost: 5 },
  ST_STRETCHING: { name: 'Resting', desc: 'Recupera HP/MP/FP 1,5× mais rápido.', icon: 'skill_TroStretching.dds', reqLv: 30, cost: 2 },
  ST_GIFTBOX: { name: 'Treasure Hunter', desc: 'Mais itens caem dos monstros.', icon: 'skill_TroGiftbox.dds', reqLv: 40, cost: 8 },
};

/** tempo que falta em segundos → '45s', '12m', '3h', '1d' */
export const partyTime = (s: number) => s >= 86400 ? `${Math.floor(s / 86400)}d` : s >= 3600 ? `${Math.floor(s / 3600)}h` : s >= 60 ? `${Math.floor(s / 60)}m` : `${Math.max(0, s)}s`;

const icon = (file: string, title: string) => {
  const img = document.createElement('img');
  img.className = 'pt-icon';
  img.alt = title;
  img.title = title;
  void skillIcon(file).then((u) => { if (u) img.src = u; });
  return img;
};

export class PartyWindow extends GameWindow {
  onLeave: () => void = () => {};
  onKick: (id: number) => void = () => {};
  onLead: (id: number) => void = () => {};
  onSkill: (key: string) => void = () => {};
  private party: PartyView | null = null;
  private myId = 0;

  constructor(parent: HTMLElement) {
    super(parent, { id: 'partyWnd', title: 'Party', store: 'flyff.wnd.party', initial: { x: 40, y: 120, w: 260, h: 380 }, min: { w: 230, h: 260 } });
    this.body.classList.add('pt');
    this.render();
  }

  set(p: PartyView | null, myId: number) { this.party = p; this.myId = myId; if (this.visible) this.render(); }
  get current() { return this.party; }
  show() { super.show(); this.render(); }

  private render() {
    const b = this.body, p = this.party;
    b.replaceChildren();
    if (!p) {
      const t = document.createElement('p');
      t.className = 'pt-empty';
      t.textContent = 'Você não está em uma party. Clique num jogador e escolha "Convidar para grupo".';
      b.append(t);
      return;
    }
    const leader = p.leader === this.myId;
    const head = document.createElement('div');
    head.className = 'pt-head';
    head.innerHTML = '';
    const nm = document.createElement('b'); nm.textContent = p.name;
    const lv = document.createElement('span'); lv.textContent = `Nível ${p.level}${p.level >= 10 ? ' (avançada)' : ''} · ${p.points} ponto(s)`;
    const bar = document.createElement('div'); bar.className = 'pt-exp'; bar.title = `Exp da party: ${p.exp} / ${p.expNext}`;
    const fill = document.createElement('i'); fill.style.width = `${Math.min(100, (p.exp / Math.max(1, p.expNext)) * 100)}%`;
    bar.append(fill);
    head.append(nm, lv, bar);
    b.append(head);

    const ul = document.createElement('ul');
    ul.className = 'pt-members';
    for (const m of p.members) {
      const li = document.createElement('li');
      li.className = m.on ? '' : 'off';
      const name = document.createElement('span');
      name.className = 'pt-name';
      name.textContent = `${m.id === p.leader ? '♛ ' : ''}${m.name}`;
      const info = document.createElement('span');
      info.className = 'pt-info';
      info.textContent = m.on ? `Nv. ${m.level} ${JOBS[m.job]?.name ?? ''}` : 'offline';
      const hp = document.createElement('div');
      hp.className = 'pt-hp';
      hp.title = `HP ${m.hp}%`;
      const hf = document.createElement('i'); hf.style.width = `${m.hp}%`;
      hp.append(hf);
      li.append(name, info, hp);
      if (leader && m.id !== this.myId) {
        const row = document.createElement('div');
        row.className = 'pt-actions';
        const lead = document.createElement('button'); lead.type = 'button'; lead.textContent = 'Líder'; lead.title = `Passar a liderança para ${m.name}`;
        lead.addEventListener('click', () => this.onLead(m.id));
        const kick = document.createElement('button'); kick.type = 'button'; kick.textContent = 'Expulsar'; kick.title = `Tirar ${m.name} da party`;
        kick.addEventListener('click', () => { if (confirm(`Tirar ${m.name} da party?`)) this.onKick(m.id); });
        row.append(lead, kick);
        li.append(row);
      }
      ul.append(li);
    }
    b.append(ul);

    // habilidades de party: ligadas (com tempo) e, para o líder, as que dá para ligar
    const sk = document.createElement('div');
    sk.className = 'pt-skills';
    const title = document.createElement('div'); title.className = 'pt-sub'; title.textContent = 'Habilidades de party';
    sk.append(title);
    const grid = document.createElement('div'); grid.className = 'pt-grid';
    for (const [k, s] of Object.entries(SKILLS)) {
      const on = p.skills.find((x) => x.k === k);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'pt-skill' + (on ? ' on' : '') + (p.level < s.reqLv ? ' locked' : '');
      const tip = `${s.name} — ${s.desc}\nParty nível ${s.reqLv} · ${s.cost} ponto(s) · 1 min (clicar de novo soma 1 min)${on ? `\nLigada: ${partyTime(on.left)}` : ''}`;
      btn.title = tip;
      btn.setAttribute('aria-label', tip);
      btn.append(icon(s.icon, s.name));
      if (on) { const t = document.createElement('span'); t.textContent = partyTime(on.left); btn.append(t); }
      btn.disabled = !leader || p.level < s.reqLv || p.points < s.cost;
      btn.addEventListener('click', () => this.onSkill(k));
      grid.append(btn);
    }
    sk.append(grid);
    b.append(sk);

    const leave = document.createElement('button');
    leave.type = 'button';
    leave.className = 'cw-btn pt-leave';
    leave.textContent = 'Sair da party';
    leave.addEventListener('click', () => { if (confirm('Sair da party?')) this.onLeave(); });
    b.append(leave);
  }
}

/** lista de todas as partys (tecla L) */
export class PartyListWindow extends GameWindow {
  onRefresh: () => void = () => {};
  private table = document.createElement('div');
  private timer = 0;

  constructor(parent: HTMLElement) {
    super(parent, { id: 'partyListWnd', title: 'Partys', store: 'flyff.wnd.partylist', initial: { x: 320, y: 120, w: 420, h: 300 }, min: { w: 340, h: 200 } });
    this.body.classList.add('pl');
    this.table.className = 'pl-table';
    this.table.setAttribute('role', 'table');
    const refresh = document.createElement('button');
    refresh.type = 'button';
    refresh.className = 'cw-btn';
    refresh.textContent = 'Atualizar';
    refresh.addEventListener('click', () => this.onRefresh());
    this.body.append(this.table, refresh);
    this.onClose = () => clearInterval(this.timer);
  }

  show() { super.show(); this.onRefresh(); clearInterval(this.timer); this.timer = window.setInterval(() => { if (this.visible) this.onRefresh(); else clearInterval(this.timer); }, 5000); }
  hide() { super.hide(); clearInterval(this.timer); }

  set(list: PartyListRow[]) {
    this.table.replaceChildren();
    const head = document.createElement('div');
    head.className = 'pl-row pl-headrow';
    head.setAttribute('role', 'row');
    for (const t of ['Party', 'Líder', 'Nível', 'Membros', 'Buffs']) { const c = document.createElement('span'); c.setAttribute('role', 'columnheader'); c.textContent = t; head.append(c); }
    this.table.append(head);
    if (!list.length) { const e = document.createElement('p'); e.className = 'pt-empty'; e.textContent = 'Nenhuma party criada agora.'; this.table.append(e); return; }
    for (const p of list.sort((a, b) => b.level - a.level || b.size - a.size)) {
      const row = document.createElement('div');
      row.className = 'pl-row';
      row.setAttribute('role', 'row');
      const cells = [p.name, p.leader, String(p.level), `${p.size}/${p.max}`];
      for (const t of cells) { const c = document.createElement('span'); c.setAttribute('role', 'cell'); c.textContent = t; row.append(c); }
      const buffs = document.createElement('span');
      buffs.setAttribute('role', 'cell');
      if (!p.skills.length) buffs.textContent = '—';
      for (const k of p.skills) { const s = SKILLS[k]; if (s) buffs.append(icon(s.icon, s.name)); }
      row.append(buffs);
      this.table.append(row);
    }
  }
}
