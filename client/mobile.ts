import type { WorldView } from '../shared/world';
import './mobile.css';

/**
 * Modo celular: ao abrir num aparelho de toque (ou com `?mobile` no endereço) liga `body.mobile` e desenha os controles na tela —
 * joystick no canto inferior esquerdo (arrastar o dedo anda; a direção é relativa à câmera), botões de ataque e pulo à direita e
 * atalhos (bolsa, personagem, skills, chat). Tocar no chão anda até lá e tocar num monstro seleciona (já era assim); um dedo
 * arrastando na cena gira a câmera e dois dedos dão zoom (OrbitControls). Os botões reaproveitam os atalhos de teclado do jogo.
 */
export const isMobile = () => new URLSearchParams(location.search).has('mobile') || (matchMedia('(pointer: coarse)').matches && /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent));

/** aperta e solta uma tecla do jogo (os atalhos I, H, K, Enter… escutam o window) */
const tap = (code: string) => { dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true })); dispatchEvent(new KeyboardEvent('keyup', { code, bubbles: true })); };

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text = ''): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  e.className = cls;
  if (text) e.textContent = text;
  return e;
};

export interface MobileActions {
  /** botão de ataque: ataca o monstro selecionado (ou avisa para selecionar um) */
  attack(): void;
}

export function setupMobile(view: WorldView, actions: MobileActions) {
  if (!isMobile()) return;
  document.body.classList.add('mobile');
  const root = el('div', 'mb');
  // ---- joystick invisível: a metade de baixo à esquerda da tela é a área de andar; o círculo só aparece enquanto o dedo está nela
  // (surge onde o dedo encostou e some ao soltar) ----
  const zone = el('div', 'mb-zone');
  const base = el('div', 'mb-stick'), knob = el('div', 'mb-knob');
  base.append(knob);
  const R = 46;
  let pid = -1, cx = 0, cy = 0;
  const set = (x: number, y: number) => {
    const d = Math.hypot(x, y), k = d > R ? R / d : 1;
    x *= k; y *= k;
    knob.style.transform = `translate(${x}px, ${y}px)`;
    view.touchMove = [x / R, -y / R]; // para cima = frente
  };
  zone.addEventListener('pointerdown', (e) => {
    if (pid >= 0) return;
    pid = e.pointerId;
    zone.setPointerCapture(pid);
    cx = e.clientX; cy = e.clientY;
    base.style.left = `${cx - 65}px`; base.style.top = `${cy - 65}px`;
    base.classList.add('on');
    set(0, 0);
    e.preventDefault();
  });
  zone.addEventListener('pointermove', (e) => { if (e.pointerId === pid) set(e.clientX - cx, e.clientY - cy); });
  const end = (e: PointerEvent) => { if (e.pointerId !== pid) return; pid = -1; base.classList.remove('on'); set(0, 0); view.touchMove = [0, 0]; };
  zone.addEventListener('pointerup', end);
  zone.addEventListener('pointercancel', end);
  // ---- botões ----
  const btn = (cls: string, label: string, onTap: () => void, title: string) => {
    const b = el('button', `mb-btn ${cls}`, label);
    b.type = 'button';
    b.title = title;
    b.setAttribute('aria-label', title);
    b.addEventListener('pointerdown', (e) => { e.preventDefault(); onTap(); });
    return b;
  };
  const atk = btn('mb-attack', '⚔', actions.attack, 'Atacar');
  const jump = btn('mb-jump', '⤒', () => view.pressKey('Space'), 'Pular');
  // um ícone só ao lado do mapa; ao tocar abre bolsa, personagem, skills e chat
  const menu = el('div', 'mb-menu');
  const items = el('div', 'mb-items');
  const toggle = btn('mb-small mb-burger', '☰', () => menu.classList.toggle('open'), 'Menu');
  const item = (label: string, title: string, f: () => void) => btn('mb-small', label, () => { menu.classList.remove('open'); f(); }, title);
  items.append(
    item('🎒', 'Bolsa', () => tap('KeyI')),
    item('👤', 'Personagem', () => tap('KeyH')),
    item('✦', 'Skills', () => tap('KeyK')),
    item('💬', 'Chat', () => { const open = document.body.classList.toggle('chat-open'); if (open) tap('Enter'); }),
  );
  menu.append(items, toggle);
  root.append(zone, base, atk, jump, menu);
  document.body.append(root);
  // impede o navegador de dar zoom/rolar a página com gestos na cena
  document.addEventListener('gesturestart', (e) => e.preventDefault());
}
