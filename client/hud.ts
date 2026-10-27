import { iconImage, themeImage } from '../shared/tga';

/**
 * Interface do jogo (HTML sobre o canvas, imagens do cliente):
 * - botão "menu" (ButtMainMenu.tga) no canto inferior esquerdo → menu WndTaskMenu.tga com os itens do cliente e ícones
 *   de Data/Icon; por enquanto só "Inventário" e "Desconectar" funcionam, os demais aparecem desabilitados ("em breve");
 * - janela de status do personagem (WndStatus1.tga: retrato, nome/nível, HP/MP/FP/Exp), arrastável e com posição lembrada.
 * Só mexe no DOM quando algo muda (nada por quadro), para não pesar no FPS.
 */
interface MenuItem { label: string; key?: string; icon: string; sub?: string[]; action?: () => void }

export interface StatusInfo { name: string; level: number; hp: number; maxHp: number; mp: number; maxMp: number; fp: number; maxFp: number; expPct: number; portrait?: string | null }

export class GameHud {
  private menuBtn = document.createElement('button');
  private menu = document.createElement('div');
  private status = document.createElement('div');
  private open = false;
  /** abre a janela de movimentos (tecla O) */
  onMotion: () => void = () => {};
  /** abre o Mensageiro (amigos, tecla E) */
  onMessenger: () => void = () => {};
  /** party (P) e lista de partys (L) */
  onParty: () => void = () => {};
  /** guild (G) */
  onGuild: () => void = () => {};
  onPartyList: () => void = () => {};

  constructor(private parent: HTMLElement, private onDisconnect: () => void, private onInventory: () => void = () => {}, private onCharacter: () => void = () => {}, private onSkills: () => void = () => {}) {
    this.buildMenu();
    this.buildStatus();
    addEventListener('keydown', (e) => { if (e.code === 'Escape' && this.open) this.toggle(false); });
    addEventListener('pointerdown', (e) => { if (this.open && !this.menu.contains(e.target as Node) && e.target !== this.menuBtn) this.toggle(false); });
    this.hide();
  }

  show() { this.menuBtn.hidden = false; this.status.hidden = false; }
  hide() { this.toggle(false); this.menuBtn.hidden = true; this.status.hidden = true; }

  // ---------- menu ----------
  private items(): MenuItem[] {
    return [
      { label: 'Status', key: 'T', icon: 'icon_MenuStatus.dds' },
      { label: 'Navegador', key: 'N', icon: 'Icon_MenuNavigator.dds' },
      { label: 'Personagem', key: 'H', icon: 'icon_MenuCharacter.dds', action: () => this.onCharacter() },
      { label: 'Inventário', key: 'I', icon: 'icon_MenuInventory.dds', action: () => this.onInventory() },
      { label: 'Party', key: 'P', icon: 'icon_MenuParty.dds', action: () => this.onParty() },
      { label: 'Partys', key: 'L', icon: 'icon_MenuParty.dds', action: () => this.onPartyList() },
      { label: 'Life Skills', icon: 'icon_MenuFarmCounter.dds' },
      { label: 'Conquistas', key: 'R', icon: 'icon_MenuAchievement.png' },
      { label: 'Passe de Batalha', key: 'V', icon: 'icon_MenuSP.png' },
      { label: 'Switch Equip', icon: 'icon_MenuGlowchange.dds' },
      { label: 'Search Shop', icon: 'icon_MenuPrivateShop.dds' },
      { label: 'Loja pessoal', icon: 'icon_MenuPrivateShop.dds' },
      { label: 'Quests', key: 'Q', icon: 'icon_MenuQuest.dds' },
      { label: 'Habilidades', key: 'K', icon: 'icon_MenuSkill.dds', action: () => this.onSkills() },
      { label: 'Movimento', key: 'O', icon: 'icon_MenuMotion.dds', action: () => this.onMotion() },
      { label: 'Mapa do Mundo', key: 'M', icon: 'icon_MenuWorldmap.dds' },
      { label: 'Itens especiais', icon: 'Icon_Folder.dds', sub: ['Loja de itens', 'Itens com tempo', 'Lootbox'] },
      { label: 'Mensageiro', key: 'E', icon: 'icon_MenuMessenger.dds', action: () => this.onMessenger() },
      { label: 'Comunicação', icon: 'icon_MenuMessenger.dds', sub: ['Chat', 'Correio'] },
      { label: 'Guilda', key: 'G', icon: 'icon_MenuGuild.dds', action: () => this.onGuild() },
      { label: 'Comunidade', icon: 'icon_MenuGuild.dds', sub: ['Casal', 'Ranking PvP'] },
      { label: 'Eventos', key: 'U', icon: 'icon_MenuNotice.dds' },
      { label: 'Ajuda', icon: 'icon_MenuHelp.dds', sub: ['Ajuda', 'Dicas', 'FAQ'] },
      { label: 'Opções', icon: 'icon_MenuOption.dds' },
      { label: 'Desconectar', icon: 'icon_MenuLogout.dds', action: () => this.onDisconnect() },
      { label: 'Sair', icon: 'icon_MenuQuit.dds' },
    ];
  }

  private buildMenu() {
    const b = this.menuBtn;
    b.id = 'menuBtn';
    b.type = 'button';
    b.setAttribute('aria-label', 'Menu');
    b.setAttribute('aria-expanded', 'false');
    b.innerHTML = '<span>menu</span>';
    void themeImage('ButtMainMenu.tga').then((u) => { if (u) b.style.backgroundImage = `url(${u})`; });
    b.addEventListener('click', () => this.toggle(!this.open));

    const m = this.menu;
    m.id = 'taskMenu';
    m.hidden = true;
    m.setAttribute('role', 'menu');
    void themeImage('WndTaskMenu.tga').then((u) => { if (u) m.style.borderImageSource = `url(${u})`; });
    const list = document.createElement('ul');
    for (const it of this.items()) {
      const li = document.createElement('li');
      li.setAttribute('role', 'menuitem');
      li.setAttribute('aria-label', it.label + (it.action || it.sub ? '' : ' (em breve)'));
      const enabled = !!it.action;
      if (!enabled && !it.sub) { li.setAttribute('aria-disabled', 'true'); li.title = 'Em breve'; }
      const img = document.createElement('img');
      img.alt = '';
      void iconImage(it.icon).then((u) => { if (u) img.src = u; else img.remove(); });
      const label = document.createElement('span');
      label.textContent = it.label;
      const key = document.createElement('kbd');
      key.textContent = it.sub ? '▸' : it.key ?? '';
      li.append(img, label, key);
      if (it.sub) {
        li.classList.add('has-sub');
        li.setAttribute('aria-haspopup', 'true');
        const sub = document.createElement('ul');
        sub.className = 'submenu';
        for (const s of it.sub) {
          const si = document.createElement('li');
          si.textContent = s;
          si.setAttribute('role', 'menuitem');
          si.setAttribute('aria-label', `${s} (em breve)`);
          si.setAttribute('aria-disabled', 'true');
          si.title = 'Em breve';
          sub.appendChild(si);
        }
        li.appendChild(sub);
      }
      if (enabled) li.addEventListener('click', () => { this.toggle(false); it.action!(); });
      list.appendChild(li);
    }
    m.appendChild(list);
    this.parent.append(m, b);
  }

  private toggle(open: boolean) {
    this.open = open;
    this.menu.hidden = !open;
    this.menuBtn.setAttribute('aria-expanded', String(open));
    this.menuBtn.classList.toggle('on', open);
  }

  // ---------- janela de status ----------
  private bars: Record<'hp' | 'mp' | 'fp' | 'exp', { fill: HTMLElement; text: HTMLElement }> = {} as never;
  private title = document.createElement('div');
  private face = document.createElement('img');

  private buildStatus() {
    const w = this.status;
    w.id = 'statusWnd';
    void themeImage('WndStatus1.tga').then((u) => { if (u) w.style.backgroundImage = `url(${u})`; });
    this.title.className = 'st-title';
    this.face.className = 'st-face';
    this.face.alt = '';
    w.append(this.title, this.face);
    for (const k of ['hp', 'mp', 'fp', 'exp'] as const) {
      const bar = document.createElement('div');
      bar.className = `st-bar st-${k}`;
      const fill = document.createElement('i');
      const text = document.createElement('b');
      bar.append(fill, text);
      w.appendChild(bar);
      this.bars[k] = { fill, text };
    }
    this.parent.appendChild(w);
    this.makeDraggable(w, 'flyff.statusPos');
  }

  /** só o retrato (renderizado depois do spawn), sem mexer nos valores */
  setPortrait(url: string | null) { if (url) this.face.src = url; else this.face.removeAttribute('src'); }

  /** Atualiza a janela; só escreve no DOM o que mudou. */
  setStatus(s: StatusInfo) {
    const title = `${s.name} - Nv. ${s.level}`;
    if (this.title.textContent !== title) this.title.textContent = title;
    if (s.portrait !== undefined) { if (s.portrait) this.face.src = s.portrait; else this.face.removeAttribute('src'); }
    const set = (k: keyof GameHud['bars'], pct: number, label: string) => {
      const b = this.bars[k];
      const w = `${Math.max(0, Math.min(100, pct)).toFixed(2)}%`;
      if (b.fill.style.width !== w) b.fill.style.width = w;
      if (b.text.textContent !== label) b.text.textContent = label;
    };
    set('hp', (s.hp / s.maxHp) * 100, `${s.hp} / ${s.maxHp}`);
    set('mp', (s.mp / s.maxMp) * 100, `${s.mp} / ${s.maxMp}`);
    set('fp', (s.fp / s.maxFp) * 100, `${s.fp} / ${s.maxFp}`);
    set('exp', s.expPct, `${s.expPct.toFixed(4)}%`);
  }

  /** Arrastar a janela pela tela (mouse e toque), sem sair da área visível; posição salva no navegador. */
  private makeDraggable(el: HTMLElement, storeKey: string) {
    const clamp = (x: number, y: number) => [Math.max(0, Math.min(innerWidth - el.offsetWidth, x)), Math.max(0, Math.min(innerHeight - el.offsetHeight, y))];
    const place = (x: number, y: number) => { const [cx, cy] = clamp(x, y); el.style.left = `${cx}px`; el.style.top = `${cy}px`; };
    try { const p = JSON.parse(localStorage.getItem(storeKey) ?? 'null') as [number, number] | null; if (p) requestAnimationFrame(() => place(p[0], p[1])); } catch { /* sem armazenamento */ }
    let drag: { dx: number; dy: number; id: number } | null = null;
    el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      drag = { dx: e.clientX - el.offsetLeft, dy: e.clientY - el.offsetTop, id: e.pointerId };
      el.setPointerCapture(e.pointerId);
      el.classList.add('dragging');
      e.preventDefault();
    });
    el.addEventListener('pointermove', (e) => { if (drag && e.pointerId === drag.id) place(e.clientX - drag.dx, e.clientY - drag.dy); });
    const end = (e: PointerEvent) => {
      if (!drag || e.pointerId !== drag.id) return;
      drag = null;
      el.classList.remove('dragging');
      try { localStorage.setItem(storeKey, JSON.stringify([el.offsetLeft, el.offsetTop])); } catch { /* sem armazenamento */ }
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    addEventListener('resize', () => place(el.offsetLeft, el.offsetTop));
  }
}

/**
 * Máximos de HP/MP/FP — PROVISÓRIO: fórmula simples por nível e atributos até portarmos as do servidor (propJob/CMover).
 * Personagem novo (valores salvos = 0) aparece cheio.
 */
export function provisionalMax(level: number, sta = 15, int = 15, dex = 15) {
  return { maxHp: Math.round(80 + level * 18 + sta * 6), maxMp: Math.round(20 + level * 6 + int * 2), maxFp: Math.round(10 + level * 4 + dex * 2) };
}
