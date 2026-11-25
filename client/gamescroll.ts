import { keyedImage, themeImage } from '../shared/tga';

/**
 * Barra de rolagem do jogo (classe .game-scroll em style.css) com as texturas do tema: ButtVScrUp/Down.tga (setas, 4 estados
 * de 16×16), ButtVScrBar.bmp (trilho) e ButtVScrPUp/PBar/PDown.bmp (ponta de cima, meio e ponta de baixo do cursor).
 */
export function loadGameScroll() {
  const set = (name: string, image: Promise<string | null>) => void image.then((u) => { if (u) document.documentElement.style.setProperty(name, `url(${u})`); });
  set('--sb-up', themeImage('ButtVScrUp.tga'));
  set('--sb-down', themeImage('ButtVScrDown.tga'));
  set('--sb-track', keyedImage('ButtVScrBar.bmp'));
  set('--sb-top', keyedImage('ButtVScrPUp.bmp'));
  set('--sb-mid', keyedImage('ButtVScrPBar.bmp'));
  set('--sb-bottom', keyedImage('ButtVScrPDown.bmp'));
}
