/**
 * Movimentos do personagem por estado. Parado/andando/correndo têm uma versão de combate por tipo de arma
 * (mdlDyna.inc, seção "male"/"female": MTI_STAND_01…15, MTI_WALK_NN, MTI_RUN_NN → AtkStand-NN / AtkWalk-NN / AtkRun-NN).
 * O número da postura (`combat`, 1–15; 0 = fora de combate) vem do servidor (server/inventory.ts combatMotion).
 * Golpe: MTI_ATK1…4 (sem arma) ou MTI_ATK1…4_NN (com arma); morte: MTI_DIE1 / MTI_DIE1_NN. Pulo não tem versão de combate.
 * Exceções do mdlDyna: 11 (Psykeeper), 12 (Elementor) e 13 (arco) têm um golpe só, MTI_ATK_NN (o arco usa
 * MTI_ATK_13 — CMover::DoAttackRange); 14 (ioiô) e 15 (besta) só têm os golpes 1 e 2.
 */
export type MotionState = 'stand' | 'walk' | 'run' | 'jump1' | 'jump2' | 'jump3' | 'jump4' | 'atk' | 'dead';

const BASE: Record<MotionState, string> = {
  stand: 'MTI_STAND', walk: 'MTI_WALK', run: 'MTI_RUN', jump1: 'MTI_JUMP1', jump2: 'MTI_JUMP2', jump3: 'MTI_JUMP3', jump4: 'MTI_JUMP4',
  atk: 'MTI_ATK1', dead: 'MTI_DIE1',
};

const nn = (combat: number) => String(combat).padStart(2, '0');

/** símbolo do movimento e se repete; `hit` escolhe o golpe 1–4 da sequência */
export function motionOf(state: string, combat = 0, hit = 1): [symbol: string, loop: boolean] {
  const st = (state in BASE ? state : 'stand') as MotionState;
  const armed = combat >= 1 && combat <= 15;
  if (st === 'atk') {
    if (combat >= 11 && combat <= 13) return [`MTI_ATK_${nn(combat)}`, false];
    if (combat >= 14) hit = ((hit - 1) % 2) + 1;
    return [`MTI_ATK${hit}${armed ? `_${nn(combat)}` : ''}`, false];
  }
  if (st === 'dead') return [armed ? `MTI_DIE1_${nn(combat)}` : 'MTI_DIE1', false];
  const loop = !st.startsWith('jump');
  if (armed && (st === 'stand' || st === 'walk' || st === 'run')) return [`${BASE[st]}_${nn(combat)}`, loop];
  return [BASE[st], loop];
}

/** todos os movimentos que o personagem pode usar com a postura `combat` (para baixar antes e trocar sem atraso) */
export function motionsFor(combat = 0) {
  const out = new Set<string>(Object.values(BASE));
  for (const s of Object.keys(BASE) as MotionState[]) out.add(motionOf(s, combat)[0]);
  for (let k = 1; k <= 4; k++) out.add(motionOf('atk', combat, k)[0]);
  return [...out];
}
