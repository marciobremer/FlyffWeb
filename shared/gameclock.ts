/**
 * Relógio do jogo. A base é o CGameTimer com __NEW_NIGHT (Titanium, TIMESPEED 20): 1 dia do jogo = 28,8 min reais. Aqui o dia
 * dura mais que a noite: das 6h às 19h (13 horas do jogo) vão 3/4 do ciclo (21,6 min reais, ~1 min 40 s por hora) e das 19h
 * às 6h (11 horas) o 1/4 restante (7,2 min, ~39 s por hora).
 * Todos veem a mesma hora: ela sai do relógio do servidor (Date.now() dele), que o cliente acerta pela diferença.
 * A hora segue o m_nHour do original (1 a 24; 24,x é meia-noite e pouco).
 */
export const TIMESPEED = 20;
/** um ciclo de dia e noite em ms reais (86400 segundos do jogo × TIMESPEED) */
export const DAY_MS = 86400 * TIMESPEED;
/** começo do dia e da noite (horas do jogo) e a fração do ciclo que o dia ocupa */
export const DAWN = 6, DUSK = 19, DAY_SHARE = 0.75;

/** hora do jogo (decimal, 1 ≤ h < 25) no instante `ms` (relógio do servidor) */
export function gameHour(ms: number): number {
  const p = (((ms % DAY_MS) + DAY_MS) % DAY_MS) / DAY_MS; // posição no ciclo (0 = 6h)
  const dayLen = DUSK - DAWN, nightLen = 24 - dayLen;
  const h = p < DAY_SHARE ? DAWN + dayLen * (p / DAY_SHARE) : DUSK + nightLen * ((p - DAY_SHARE) / (1 - DAY_SHARE));
  const clock = h % 24;
  return clock < 1 ? clock + 24 : clock;
}

/** "07:30" a partir da hora decimal */
export const fmtGameHour = (h: number) => {
  const hh = Math.floor(h) % 24, mm = Math.floor((h % 1) * 60);
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
};
