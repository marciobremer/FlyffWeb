import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import type { WorldView } from '../shared/world';
import type { MoverInstance } from '../shared/movers';

/**
 * Combate no cliente (quem decide tudo é o servidor — server/combat.ts e server/realtime.ts):
 * - clicar num mob só seleciona; clicar de novo no mob já selecionado (ou usar uma skill) ataca: o personagem anda até
 *   ficar ao alcance da arma (arco/ioiô de longe), vira para ele e golpeia no ritmo da arma (o servidor confere alcance e
 *   ritmo); andar com o teclado, clicar no chão, Esc ou o mob morrer param o ataque;
 * - golpes chegam do servidor (`hit`): o atacante toca o golpe, o mob atingido toca MTI_DMG1, número de dano sobe
 *   da cabeça (branco no mob, vermelho em você, amarelo e maior no crítico, "MISS" quando erra);
 * - HP do alvo na janela de alvo.
 */
/** alcance corpo a corpo; armas de longe usam o alcance que vem do servidor, um pouco por dentro para não errar pela latência */
const ATTACK_RANGE = 2.4;

/** skill a lançar: id, movimento do personagem e se é buff (vale em quem lança) */
export interface QueuedSkill { id: number; motion: string; buff?: boolean }

export class Combat {
  /** mob (id do servidor) sendo atacado */
  private targetId: number | null = null;
  private nextAtk = 0;
  private nextMove = 0;
  /** intervalo entre golpes (ms), vem do servidor com os atributos */
  interval = 1000;
  /** alcance do golpe da arma (vem do servidor com os atributos) */
  range = 2;
  /** manda o golpe / a skill ao servidor */
  sendAttack: (mobId: number) => void = () => {};
  sendSkill: (skillId: number, mobId: number) => void = () => {};
  /** skill esperando chegar ao alcance (lança no lugar do próximo golpe) */
  private queued: QueuedSkill | null = null;
  /** Action Slot em andamento: as próximas skills da sequência e quantas já saíram */
  private chain: QueuedSkill[] = [];
  private chainStep = -1;
  /** realce da skill da Action Slot sendo lançada (-1 = acabou) */
  onChainStep: (i: number) => void = () => {};

  /** lança a skill no alvo atual assim que estiver ao alcance */
  queueSkill(id: number, motion: string, buff = false) { this.queued = { id, motion, buff }; this.nextAtk = Math.min(this.nextAtk, performance.now()); }
  /** Action Slot (UseSkillQueue): lança as skills uma depois da outra no alvo; depois volta ao golpe normal */
  queueChain(list: QueuedSkill[]) { this.chain = [...list]; this.chainStep = -1; this.queued = null; this.nextAtk = Math.min(this.nextAtk, performance.now()); }
  private endChain() { if (this.chainStep >= 0 || this.chain.length) { this.chain = []; this.chainStep = -1; this.onChainStep(-1); } }

  constructor(private view: WorldView) {}

  get attacking() { return this.targetId !== null; }

  /** começa a atacar o mob desta instância (se for um mob do servidor vivo) */
  start(inst: MoverInstance) {
    const id = this.view.moverMgr.externalIdOf(inst);
    const info = id === null ? null : this.view.moverMgr.externalInfo(id);
    if (id === null || !info || info.s === 'dead' || this.view.player?.dead) { this.stop(); return; }
    this.targetId = id;
  }

  /** é o mob que está sendo atacado? */
  isTarget(inst: MoverInstance) { return this.targetId !== null && this.view.moverMgr.externalIdOf(inst) === this.targetId; }

  stop() { this.queued = null; this.endChain(); if (this.targetId !== null) { this.targetId = null; this.view.player?.stop(); } }

  /** a cada quadro: aproxima, vira e golpeia */
  frame(now: number) {
    const id = this.targetId, p = this.view.player;
    if (id === null || !p?.active) return;
    const info = this.view.moverMgr.externalInfo(id);
    if (!info || info.s === 'dead' || p.dead || p.flying || this.view.moveKeysDown()) { this.stop(); return; }
    const [mx, , mz] = info.pos;
    const dist = Math.hypot(mx - p.pos[0], mz - p.pos[2]);
    if (dist > Math.max(ATTACK_RANGE, this.range - 0.8)) {
      if (now >= this.nextMove) { p.moveTo(mx, mz); this.nextMove = now + 200; }
      return;
    }
    p.stop();
    p.face(mx, mz);
    if (now >= this.nextAtk) {
      let q = this.queued;
      if (q) this.queued = null;
      else if (this.chain.length) { q = this.chain.shift()!; this.onChainStep(++this.chainStep); }
      else this.endChain();
      if (q) {
        this.nextAtk = now + Math.max(this.interval, 1200);
        if (q.buff) this.sendSkill(q.id, 0); // buff da sequência vale em quem lança (o movimento toca quando o servidor aceita)
        else { p.cast(q.motion); this.sendSkill(q.id, id); }
      } else {
        this.nextAtk = now + this.interval;
        p.attack();
        this.sendAttack(id);
      }
    }
  }

  /** número de dano subindo de um ponto (FlyFF x, y, z) */
  popup(pos: [number, number, number], text: string, kind: 'mob' | 'me' | 'crit' | 'miss' | 'other' | 'heal' | 'healmp' | 'healfp') {
    const el = document.createElement('div');
    el.className = `dmg ${kind}`;
    el.textContent = text;
    const obj = new CSS2DObject(el);
    obj.position.set(pos[0] + (Math.random() - 0.5) * 0.6, pos[1], pos[2]);
    this.view.playerGroup.add(obj);
    const t0 = performance.now(), y0 = pos[1];
    const tick = () => {
      const t = (performance.now() - t0) / 1000;
      if (t >= 1.1) { obj.removeFromParent(); el.remove(); return; }
      obj.position.y = y0 + t * 1.6;
      el.style.opacity = String(t < 0.7 ? 1 : 1 - (t - 0.7) / 0.4);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }
}
