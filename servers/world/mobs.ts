import { TICKS_PER_SEC } from '../../shared/math';
import type { MoverProp, ServerWorld } from './world';
import { OT } from '../../shared/formats/types';

/**
 * Mobs controlados pelo servidor: todos os jogadores veem o mesmo mob no mesmo lugar.
 * Cada respawn do .rgn (tipo mover) gera `count` mobs espalhados no retângulo; os `attackCount` primeiros são agressivos
 * (atacam quem chega perto), os outros só revidam. Patrulha ociosa: parado 2–8 s, sorteia um ponto andável no retângulo
 * (ou ±10 da origem), anda até lá a ½·fSpeed·60 u/s. Em combate persegue o alvo correndo (fSpeed·60 u/s), ataca quando
 * está perto e desiste se o alvo se afastar demais da área (volta e recupera o HP). Morto: some depois de 3 s e renasce
 * na área depois do tempo de respawn do .rgn.
 * Posição em x/z (FlyFF); a altura é do terreno, calculada no cliente — só voadores levam y fixo (o do spawn).
 * Grade espacial (células de CELL unidades) para achar rápido os mobs perto de cada jogador.
 */
export type MobState = 'stand' | 'walk' | 'run' | 'dead';

export interface Mob {
  id: number; modelId: number; x: number; z: number; y: number; h: number; s: MobState;
  area: { xMin: number; zMin: number; xMax: number; zMax: number } | null; origin: [number, number];
  target: [number, number] | null; wait: number; speed: number; flying: boolean;
  /** combate */
  prop: MoverProp | null; hp: number; maxHp: number; aggressive: boolean;
  /** jogador que está atacando (id do personagem) e quando pode golpear de novo (ms) */
  foe: number; nextAtk: number; nextScan: number;
  /** dano recebido por jogador (para a exp) e o momento da morte / do renascimento (ms) */
  dmgBy: Map<number, number>; diedAt: number; respawnAt: number; respawnMs: number;
  /** mudou desde o último envio */
  dirty: boolean; cell: number;
}

/** o que o mundo dos mobs precisa saber dos jogadores (fornecido por server/realtime.ts) */
export interface MobHooks {
  /** posição (x, z) de um jogador vivo, ou null (saiu, morreu) */
  player(id: number): [number, number] | null;
  /** jogadores vivos perto de (x, z) */
  playersNear(x: number, z: number, r: number): { id: number; x: number; z: number }[];
  /** o mob golpeou o jogador (o realtime calcula o dano e avisa todos) */
  attack(mob: Mob, playerId: number): void;
}

/** boss (dwClass RANK_BOSS/RANK_MIDBOSS/RANK_SUPER): sempre agressivo — ataca quem passa perto */
export const isBoss = (p: MoverProp | null | undefined) => !!p && (p.rank === 'RANK_BOSS' || p.rank === 'RANK_MIDBOSS' || p.rank === 'RANK_SUPER');

const CELL = 64;
const cellOf = (x: number, z: number) => Math.floor(x / CELL) * 65536 + Math.floor(z / CELL);
/** alcance do golpe do mob, raio em que o agressivo enxerga, distância máxima da área antes de desistir */
export const MOB_ATTACK_RANGE = 2.6;
const AGGRO_RADIUS = 9, LEASH = 30;
/** quanto tempo o corpo fica visível depois de morrer (ms) */
export const CORPSE_MS = 3000;

/** gerador pseudoaleatório determinístico (as posições iniciais são as mesmas a cada boot) */
function rng(seed: number) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 4294967296; }; }

export class MobWorld {
  readonly mobs: Mob[] = [];
  readonly byId = new Map<number, Mob>();
  private grid = new Map<number, Set<Mob>>();
  hooks: MobHooks | null = null;

  /** terreno do mundo (atributos do .lnd), para quem precisa conferir um ponto (ex.: destino do teleporte) */
  get terrain() { return this.world; }

  constructor(private world: ServerWorld) {
    const rand = rng(12345);
    for (const r of world.respawns) {
      if (r.type !== OT.MOVER) continue;
      const area = r.rect.xMax > r.rect.xMin && r.rect.zMax > r.rect.zMin ? { ...r.rect } : null;
      const prop = world.moverProps.get(r.modelId) ?? null;
      const count = Math.max(1, r.count);
      for (let k = 0; k < count; k++) {
        const x = area ? area.xMin + rand() * (area.xMax - area.xMin) : r.pos[0];
        const z = area ? area.zMin + rand() * (area.zMax - area.zMin) : r.pos[2];
        const hp = prop?.hp ?? 1;
        const m: Mob = {
          id: this.mobs.length + 1, modelId: r.modelId, x, z, y: r.pos[1], h: rand() * 360, s: 'stand', area, origin: [r.pos[0], r.pos[2]],
          target: null, wait: 1 + rand() * 7, speed: world.moverSpeed.get(r.modelId) ?? 0, flying: world.flyingMovers.has(r.modelId),
          prop, hp, maxHp: hp, aggressive: k < (r.attackCount || 0) || isBoss(prop), foe: 0, nextAtk: 0, nextScan: 0,
          dmgBy: new Map(), diedAt: 0, respawnAt: 0, respawnMs: Math.max(5, r.time || 30) * 1000,
          dirty: false, cell: cellOf(x, z),
        };
        this.mobs.push(m);
        this.byId.set(m.id, m);
        this.cellSet(m.cell).add(m);
      }
    }
    this.seq = this.mobs.length;
  }

  private cellSet(c: number) { let s = this.grid.get(c); if (!s) this.grid.set(c, (s = new Set())); return s; }

  private place(m: Mob, x: number, z: number) {
    m.x = x; m.z = z;
    const c = cellOf(x, z);
    if (c !== m.cell) { this.grid.get(m.cell)?.delete(m); m.cell = c; this.cellSet(c).add(m); }
  }

  private randomPoint(m: Mob): [number, number] | null {
    for (let k = 0; k < 6; k++) {
      const a = m.area;
      const x = a ? a.xMin + Math.random() * (a.xMax - a.xMin) : m.origin[0] + (Math.random() * 2 - 1) * 10;
      const z = a ? a.zMin + Math.random() * (a.zMax - a.zMin) : m.origin[1] + (Math.random() * 2 - 1) * 10;
      if (m.flying || this.world.walkable(x, z)) return [x, z];
    }
    return null;
  }

  /** longe demais da área de origem? (desiste da perseguição) */
  private outOfLeash(m: Mob) {
    const a = m.area;
    if (!a) return Math.hypot(m.x - m.origin[0], m.z - m.origin[1]) > LEASH;
    return m.x < a.xMin - LEASH || m.x > a.xMax + LEASH || m.z < a.zMin - LEASH || m.z > a.zMax + LEASH;
  }

  /** anda até (tx, tz) a `speed` u/s; devolve true ao chegar */
  private stepTo(m: Mob, tx: number, tz: number, speed: number, dt: number, stopAt = 0) {
    const dx = tx - m.x, dz = tz - m.z, dist = Math.hypot(dx, dz);
    if (dist > 1e-3) m.h = (Math.atan2(dx, -dz) * 180) / Math.PI;
    const step = speed * dt;
    if (dist - stopAt <= step) {
      if (dist > stopAt) this.place(m, m.x + (dx / dist) * (dist - stopAt), m.z + (dz / dist) * (dist - stopAt));
      m.dirty = true;
      return true;
    }
    this.place(m, m.x + (dx / dist) * step, m.z + (dz / dist) * step);
    m.dirty = true;
    return false;
  }

  private setState(m: Mob, s: MobState) { if (m.s !== s) { m.s = s; m.dirty = true; } }

  /** desiste do alvo: volta para a área e recupera o HP */
  private reset(m: Mob) {
    m.foe = 0;
    m.dmgBy.clear();
    if (m.hp !== m.maxHp) { m.hp = m.maxHp; m.dirty = true; }
    m.target = this.randomPoint(m) ?? [m.origin[0], m.origin[1]];
    this.setState(m, 'walk');
  }

  /** avança patrulha, perseguição, ataques e renascimentos */
  tick(dt: number, now = Date.now()) {
    const hooks = this.hooks;
    for (const m of this.mobs) {
      if (m.s === 'dead') {
        if (m.respawnMs < 0) { if (now - m.diedAt > CORPSE_MS + 500) this.remove(m); continue; } // invocado: some de vez
        if (now >= m.respawnAt) this.respawn(m);
        continue;
      }
      const walkSpeed = Math.max(0.6, (m.speed || 0.05) * TICKS_PER_SEC * 0.5), runSpeed = walkSpeed * 2;

      // agressivo sem alvo: procura alguém por perto (2× por segundo)
      if (m.aggressive && !m.foe && hooks && now >= m.nextScan) {
        m.nextScan = now + 500;
        const near = hooks.playersNear(m.x, m.z, AGGRO_RADIUS);
        if (near.length) { near.sort((a, b) => Math.hypot(a.x - m.x, a.z - m.z) - Math.hypot(b.x - m.x, b.z - m.z)); m.foe = near[0].id; }
      }

      if (m.foe && hooks) {
        const p = hooks.player(m.foe);
        if (!p || this.outOfLeash(m)) { this.reset(m); continue; }
        const dist = Math.hypot(p[0] - m.x, p[1] - m.z);
        if (dist > MOB_ATTACK_RANGE) { this.setState(m, 'run'); this.stepTo(m, p[0], p[1], runSpeed, dt, MOB_ATTACK_RANGE * 0.8); continue; }
        // perto: vira para o alvo e golpeia no ritmo do mob
        const h = (Math.atan2(p[0] - m.x, -(p[1] - m.z)) * 180) / Math.PI;
        if (Math.abs(h - m.h) > 1) { m.h = h; m.dirty = true; }
        this.setState(m, 'stand');
        if (now >= m.nextAtk) {
          m.nextAtk = now + Math.max(1500, Math.min(4000, (m.prop?.attackSpeed ?? 1000) * 2));
          hooks.attack(m, m.foe);
        }
        continue;
      }

      // patrulha
      if (!m.target) {
        m.wait -= dt;
        if (m.wait > 0) continue;
        const t = this.randomPoint(m);
        if (!t || Math.hypot(t[0] - m.x, t[1] - m.z) < 1) { m.wait = 2; continue; }
        m.target = t;
        this.setState(m, 'walk');
      }
      if (this.stepTo(m, m.target[0], m.target[1], walkSpeed, dt)) { m.target = null; m.wait = 2 + Math.random() * 6; this.setState(m, 'stand'); }
    }
  }

  /**
   * Jogador golpeou o mob: tira HP, guarda o dano (exp) e o mob passa a atacá-lo (se não for pacífico).
   * Devolve true se morreu agora.
   */
  damage(m: Mob, playerId: number, dmg: number, peaceful: boolean, now = Date.now()) {
    if (m.s === 'dead') return false;
    m.hp = Math.max(0, m.hp - dmg);
    m.dmgBy.set(playerId, (m.dmgBy.get(playerId) ?? 0) + dmg);
    m.dirty = true;
    if (!m.foe && !peaceful) { m.foe = playerId; m.nextAtk = Math.max(m.nextAtk, now + 600); }
    if (m.hp > 0) return false;
    m.s = 'dead'; m.foe = 0; m.target = null; m.diedAt = now; m.respawnAt = now + Math.max(m.respawnMs, CORPSE_MS + 2000);
    return true;
  }

  /**
   * Monstros invocados (painel de GM): `n` do modelo em volta de (x, z), patrulhando ali perto; boss já vem agressivo.
   * Morrem de vez (não renascem). Devolve quantos criou (0 = modelo sem propMover).
   */
  summon(modelId: number, x: number, z: number, y: number, n: number): number {
    const prop = this.world.moverProps.get(modelId);
    if (!prop) return 0;
    let made = 0;
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI * 2, d = n > 1 ? 1.5 + Math.random() * 3 : 0;
      const mx = x + Math.cos(a) * d, mz = z + Math.sin(a) * d;
      const m: Mob = {
        id: ++this.seq, modelId, x: mx, z: mz, y, h: Math.random() * 360, s: 'stand', area: { xMin: x - 8, zMin: z - 8, xMax: x + 8, zMax: z + 8 }, origin: [x, z],
        target: null, wait: 2, speed: this.world.moverSpeed.get(modelId) ?? 0, flying: this.world.flyingMovers.has(modelId),
        prop, hp: prop.hp, maxHp: prop.hp, aggressive: isBoss(prop), foe: 0, nextAtk: 0, nextScan: 0,
        dmgBy: new Map(), diedAt: 0, respawnAt: 0, respawnMs: -1, dirty: true, cell: cellOf(mx, mz),
      };
      this.mobs.push(m);
      this.byId.set(m.id, m);
      this.cellSet(m.cell).add(m);
      made++;
    }
    return made;
  }
  /** apaga os invocados (perto de (x, z) até `r`, ou todos); devolve quantos */
  clearSummons(x?: number, z?: number, r = Infinity): number {
    const gone = this.mobs.filter((m) => m.respawnMs < 0 && (x === undefined || Math.hypot(m.x - x, m.z - (z ?? 0)) <= r));
    for (const m of gone) this.remove(m);
    return gone.length;
  }
  /** próximo id livre (os invocados vêm depois dos do .rgn) */
  private seq = 0;

  /** o jogador saiu/morreu: mobs que o atacavam desistem */
  forget(playerId: number) { for (const m of this.mobs) if (m.foe === playerId) this.reset(m); }

  private remove(m: Mob) {
    const i = this.mobs.indexOf(m);
    if (i >= 0) this.mobs.splice(i, 1);
    this.byId.delete(m.id);
    this.grid.get(m.cell)?.delete(m);
  }

  private respawn(m: Mob) {
    const t = this.randomPoint(m) ?? [m.origin[0], m.origin[1]];
    this.place(m, t[0], t[1]);
    m.hp = m.maxHp; m.dmgBy.clear(); m.foe = 0; m.target = null; m.wait = 2 + Math.random() * 4;
    m.s = 'stand'; m.dirty = true;
  }

  /** mobs a até `r` unidades de (x, z), os mais perto primeiro, no máximo `max`; corpos somem depois de CORPSE_MS */
  near(x: number, z: number, r: number, max: number, now = Date.now()): Mob[] {
    const out: { m: Mob; d: number }[] = [];
    const c0x = Math.floor((x - r) / CELL), c1x = Math.floor((x + r) / CELL), c0z = Math.floor((z - r) / CELL), c1z = Math.floor((z + r) / CELL);
    for (let cx = c0x; cx <= c1x; cx++) for (let cz = c0z; cz <= c1z; cz++) {
      const set = this.grid.get(cx * 65536 + cz);
      if (!set) continue;
      for (const m of set) {
        if (m.s === 'dead' && now - m.diedAt > CORPSE_MS) continue;
        const d = Math.hypot(m.x - x, m.z - z);
        if (d <= r) out.push({ m, d });
      }
    }
    out.sort((a, b) => a.d - b.d);
    return out.slice(0, max).map((o) => o.m);
  }

  clearDirty() { for (const m of this.mobs) m.dirty = false; }
}
