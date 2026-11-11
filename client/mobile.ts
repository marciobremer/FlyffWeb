import type { WorldView } from '../shared/world';
import './mobile.css';

/**
 * Modo celular: ao abrir num aparelho de toque (ou com `?mobile` no endereço) liga `body.mobile` e desenha os controles na tela,
 * no arranjo dos MMOs de celular:
 *   - alto à direita: fileira de atalhos (bolsa, personagem, skills, quests, chat) e, abaixo, o mini mapa menor;
 *   - alto no centro: o penya;
 *   - esquerda embaixo: joystick invisível — o círculo só aparece onde o dedo encosta (direção relativa à câmera);
 *   - direita embaixo: o botão grande de ataque com 3 skills em arco (as casas 1, 2 e 3 da barra) e o pulo;
 *   - direita no meio: AUTO (ataca o monstro mais perto sozinho, em sequência) e "alvo" (seleciona e ataca o mais perto).
 * Um dedo arrastando na cena gira a câmera e dois dedos dão zoom (OrbitControls). Os botões reaproveitam os atalhos do jogo.
 */
export const isMobile = () => new URLSearchParams(location.search).has('mobile') || (matchMedia('(pointer: coarse)').matches && /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent));

/** aperta e solta uma tecla do jogo (os atalhos I, H, K, Q, 1…3, Enter… escutam o window) */
const tap = (code: string) => { dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true })); dispatchEvent(new KeyboardEvent('keyup', { code, bubbles: true })); };

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text = ''): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  e.className = cls;
  if (text) e.textContent = text;
  return e;
};

export interface MobileActions {
  /** botão de ataque: ataca o monstro selecionado, ou o mais perto se não há alvo */
  attack(): void;
  /** AUTO: chamado a cada ~0,7 s enquanto ligado e parado: começa a atacar o próximo monstro se não está atacando */
  autoStep(): void;
}

export function setupMobile(view: WorldView, actions: MobileActions): { setGold(n: number): void } | null {
  if (!isMobile()) return null;
  document.body.classList.add('mobile');
  const root = el('div', 'mb');

  // ---- joystick invisível: o canto de baixo à esquerda é a área de andar; o círculo só aparece enquanto o dedo está nela ----
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

  // alto à direita: atalhos
  const top = el('div', 'mb-top');
  top.append(
    btn('mb-small', '🎒', () => tap('KeyI'), 'Bolsa'),
    btn('mb-small', '👤', () => tap('KeyH'), 'Personagem'),
    btn('mb-small', '✦', () => tap('KeyK'), 'Skills'),
    btn('mb-small', '📜', () => tap('KeyQ'), 'Quests'),
    btn('mb-small', '💬', () => { const open = document.body.classList.toggle('chat-open'); if (open) tap('Enter'); }, 'Chat'),
  );

  // alto no centro: penya
  const gold = el('div', 'mb-gold', '🪙 0');

  // direita embaixo: ataque + 3 skills em arco + pulo
  const atk = btn('mb-attack', '⚔', actions.attack, 'Atacar');
  const s1 = btn('mb-skill mb-s1', '1', () => tap('Digit1'), 'Skill 1');
  const s2 = btn('mb-skill mb-s2', '2', () => tap('Digit2'), 'Skill 2');
  const s3 = btn('mb-skill mb-s3', '3', () => tap('Digit3'), 'Skill 3');
  const jump = btn('mb-jump', '⤒', () => view.pressKey('Space'), 'Pular');

  // direita no meio: AUTO e alvo
  let auto = false;
  const autoBtn = btn('mb-auto', 'AUTO', () => { auto = !auto; autoBtn.classList.toggle('on', auto); }, 'Ataque automático');
  const near = btn('mb-near', '⌖', actions.attack, 'Atacar o mais perto');
  setInterval(() => { if (auto && !view.moveKeysDown()) actions.autoStep(); }, 700);

  root.append(zone, base, top, gold, atk, s1, s2, s3, jump, autoBtn, near);
  document.body.append(root);
  // impede o navegador de dar zoom/rolar a página com gestos na cena
  document.addEventListener('gesturestart', (e) => e.preventDefault());
  return { setGold: (n) => { gold.textContent = `🪙 ${n.toLocaleString('pt-BR')}`; } };
}
