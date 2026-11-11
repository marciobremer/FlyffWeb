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
  // ---- joystick ----
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
  base.addEventListener('pointerdown', (e) => {
    pid = e.pointerId;
    base.setPointerCapture(pid);
    const r = base.getBoundingClientRect();
    cx = r.left + r.width / 2; cy = r.top + r.height / 2;
    set(e.clientX - cx, e.clientY - cy);
    e.preventDefault();
  });
  base.addEventListener('pointermove', (e) => { if (e.pointerId === pid) set(e.clientX - cx, e.clientY - cy); });
  const end = (e: PointerEvent) => { if (e.pointerId !== pid) return; pid = -1; set(0, 0); view.touchMove = [0, 0]; };
  base.addEventListener('pointerup', end);
  base.addEventListener('pointercancel', end);
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
  const side = el('div', 'mb-side');
  side.append(
    btn('mb-small', '🎒', () => tap('KeyI'), 'Bolsa'),
    btn('mb-small', '👤', () => tap('KeyH'), 'Personagem'),
    btn('mb-small', '✦', () => tap('KeyK'), 'Skills'),
    btn('mb-small', '💬', () => tap('Enter'), 'Chat'),
  );
  root.append(base, atk, jump, side);
  document.body.append(root);
  // impede o navegador de dar zoom/rolar a página com gestos na cena
  document.addEventListener('gesturestart', (e) => e.preventDefault());
}
