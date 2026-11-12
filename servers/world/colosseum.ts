import fs from 'node:fs';
import path from 'node:path';

/**
 * Colosseum (CColosseumMng / CColosseumMatch, _Common/Colosseum.cpp + Colosseum.lua): o líder da party pede a partida ao
 * Colosseum Manager (Marcario, `mafl_colonpc`); a party entra numa cópia do mapa WdColosseum, espera até 3 min (StartWaitTime;
 * o líder pode começar antes) e enfrenta, um por vez, um monstro por estágio (LowStages / HardStages = 6). Cada estágio tem tempo
 * limite; matar o monstro leva ao próximo estágio depois de 5 s (WaitAfterStage); estourar o tempo perde a partida. Um dos
 * estágios, sorteado, é o do chefe (as linhas MONSTER_*_BOSS). Ao fim todos voltam a Flaris.
 * Dificuldade: 1 = nível baixo (só até o nível 90), 2 = nível alto. Menu: 1 = normal, 2 = só os da mesma guild.
 */
export interface ColoMonster { type: 1 | 2 | 3 | 4; symbol: string; ms: number; stage: number }
export interface ColoRules { startWait: number; stageWait: number; lowStages: number; hardStages: number; monsters: ColoMonster[] }

/** posições do mapa (Colosseum.cpp): entrada dos jogadores, onde nasce o monstro e a volta para Flaris */
export const COLO_ENTRY: [number, number, number] = [1286, 100, 1087];
export const COLO_SPAWN: [number, number, number] = [1296, 100, 1228];
export const COLO_EXIT: [number, number, number] = [6971.984, 99.8, 3336.884];

export function loadColoRules(resDir: string): ColoRules {
  const rules: ColoRules = { startWait: 180_000, stageWait: 5000, lowStages: 6, hardStages: 6, monsters: [] };
  let src = '';
  try { src = fs.readFileSync(path.join(resDir, 'Colosseum.lua'), 'latin1').replace(/--[^\n]*/g, ''); } catch { return rules; }
  const t = (s: string) => { const m = /(SEC|MIN)\(\s*(\d+)\s*\)/.exec(s); return m ? Number(m[2]) * (m[1] === 'MIN' ? 60_000 : 1000) : Number(s) || 0; };
  const v = (k: string) => new RegExp(`${k}\\s*=\\s*([^\\r\\n]+)`).exec(src)?.[1]?.trim();
  if (v('StartWaitTime')) rules.startWait = t(v('StartWaitTime')!);
  if (v('WaitAfterStage')) rules.stageWait = t(v('WaitAfterStage')!);
  if (v('LowStages')) rules.lowStages = Number(v('LowStages'));
  if (v('HardStages')) rules.hardStages = Number(v('HardStages'));
  const kind: Record<string, 1 | 2 | 3 | 4> = { MONSTER_LOW: 1, MONSTER_HARD: 2, MONSTER_LOW_BOSS: 3, MONSTER_HARD_BOSS: 4 };
  for (const m of src.matchAll(/AddMonster\(\s*(MONSTER_\w+)\s*,\s*"(\w+)"\s*,\s*((?:SEC|MIN)\(\s*\d+\s*\)|\d+)\s*,\s*(\d+)\s*\)/g)) {
    const type = kind[m[1]];
    if (type) rules.monsters.push({ type, symbol: m[2], ms: t(m[3]), stage: Number(m[4]) });
  }
  return rules;
}

export type ColoPhase = 'wait' | 'ready' | 'fight';
export class ColoMatch {
  stage = 0;
  phase: ColoPhase = 'wait';
  until: number;
  readonly max: number;
  /** estágio do chefe (sorteado) */
  readonly bossStage: number;
  /** monstro do estágio atual (símbolo MI_*) */
  current: ColoMonster | null = null;
  /** jogadores que entraram (id do personagem) */
  readonly players = new Set<number>();
  /** instância do monstro vivo no mundo (preenchida por quem cria o mob) */
  mob: { s: string } | null = null;
  startedAt: number;

  constructor(readonly party: number, readonly diff: 1 | 2, readonly menu: 1 | 2, readonly guild: number, private rules: ColoRules, now: number) {
    this.max = diff === 1 ? rules.lowStages : rules.hardStages;
    this.bossStage = 1 + Math.floor(Math.random() * this.max);
    this.until = now + rules.startWait;
    this.startedAt = now;
  }

  /** o líder quer começar já: pula o resto da espera (WaitAfterStage antes do 1º estágio) */
  startNow(now: number) { if (this.phase === 'wait') { this.phase = 'ready'; this.until = now + this.rules.stageWait; } }

  /** o monstro do estágio: o do chefe no estágio sorteado, senão o da linha do estágio (nível alto/baixo) */
  pick(stage: number): ColoMonster | null {
    const normal = this.diff === 1 ? 1 : 2, boss = this.diff === 1 ? 3 : 4;
    const list = this.rules.monsters;
    if (stage === this.bossStage) { const b = list.find((m) => m.type === boss); if (b) return b; }
    return list.find((m) => m.type === normal && m.stage === stage) ?? null;
  }

  /**
   * Um passo (chamado ~1×/s). Devolve o que aconteceu para quem cuida do mundo:
   *   'ready'  acabou a espera: aviso "estágio N em 5 s"; 'spawn' criar o monstro `current`; 'cleared' estágio vencido;
   *   'win' | 'lose' fim; null nada.
   */
  step(now: number): 'ready' | 'spawn' | 'cleared' | 'win' | 'lose' | null {
    if (this.phase === 'wait') {
      if (now < this.until) return null;
      this.phase = 'ready'; this.until = now + this.rules.stageWait;
      return 'ready';
    }
    if (this.phase === 'ready') {
      if (now < this.until) return null;
      this.stage++;
      if (this.stage > this.max) return 'win';
      this.current = this.pick(this.stage);
      if (!this.current) { return this.stage >= this.max ? 'win' : null; }
      this.phase = 'fight';
      this.until = now + this.current.ms;
      return 'spawn';
    }
    // fight
    if (this.mob && this.mob.s === 'dead') {
      this.mob = null;
      this.phase = 'ready'; this.until = now + this.rules.stageWait;
      return this.stage >= this.max ? 'win' : 'cleared';
    }
    if (now >= this.until) return 'lose';
    return null;
  }
}
