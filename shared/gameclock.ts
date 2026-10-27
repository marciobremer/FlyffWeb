/**
 * Relógio do jogo (CGameTimer, timer.cpp). Com __NEW_NIGHT (Titanium) TIMESPEED = 20: cada 20 ms reais = 1 segundo do jogo,
 * então 1 dia do jogo = 28,8 min reais (1 hora do jogo = 72 s). A hora vai de 1 a 24 (m_nHour é "1 based").
 * Todos veem a mesma hora: ela sai do relógio do servidor (Date.now() dele), que o cliente acerta pela diferença.
 */
export const TIMESPEED = 20;

/** hora do jogo (decimal, 1 ≤ h < 25 — 24,x é meia-noite e pouco) no instante `ms` (relógio do servidor) */
export function gameHour(ms: number): number {
  const sec = Math.floor(ms / TIMESPEED);
  const min = Math.floor(sec / 60);
  const hours = Math.floor(min / 60);
  return (hours % 24) + 1 + (min % 60) / 60;
}

/** "07:30" a partir da hora decimal */
export const fmtGameHour = (h: number) => {
  const hh = Math.floor(h) % 24, mm = Math.floor((h % 1) * 60);
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
};
