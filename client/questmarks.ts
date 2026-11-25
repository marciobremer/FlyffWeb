/**
 * "!" e "?" sobre os NPCs: a textura original (Data/Icon/icon_QuestEmoticon.dds, 16 bits A1R5G5B5, quadros de 32×32 — a 1ª
 * fileira, amarela, é a que o jogo usa) vira o fundo dos marcadores (classe .quest-mark em style.css).
 * Quadros: 1 "!" amarelo (quest disponível), 2 "?" cinza (em andamento), 3 "?" amarelo (pronta), 4 "!" cinza (em até 5 níveis).
 */
const URL_DDS = '/res/Data/Icon/icon_QuestEmoticon.dds';
let started = false;

export async function loadQuestMarks() {
  if (started) return;
  started = true;
  try {
    const r = await fetch(URL_DDS);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const buf = await r.arrayBuffer(), head = new DataView(buf);
    const height = head.getUint32(12, true), width = head.getUint32(16, true);
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = 32;
    const img = new ImageData(width, 32);
    for (let i = 0; i < width * Math.min(32, height); i++) {
      const v = head.getUint16(128 + i * 2, true);
      const red = (v >> 10) & 31, green = (v >> 5) & 31, blue = v & 31;
      if (!(v & 0x8000) || (red === 31 && !green && blue === 31)) continue; // transparente (ou a chave magenta)
      img.data.set([(red * 255) / 31, (green * 255) / 31, (blue * 255) / 31, 255], i * 4);
    }
    canvas.getContext('2d')!.putImageData(img, 0, 0);
    document.documentElement.style.setProperty('--quest-marks', `url(${canvas.toDataURL()})`);
  } catch (e) {
    started = false;
    console.warn('quests: não li os marcadores', e);
  }
}

/** o marcador a pôr acima do nome do NPC */
export function questMarkElement(kind: number): HTMLElement {
  const el = document.createElement('div');
  el.className = 'quest-mark';
  el.style.backgroundPositionX = `${-32 * kind}px`;
  el.setAttribute('aria-hidden', 'true');
  return el;
}
