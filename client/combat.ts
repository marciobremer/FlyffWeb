import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import type { WorldView } from '../shared/world';
import type { MoverInstance } from '../shared/movers';
import { resImage } from '../shared/tga';

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
export interface QueuedSkill { id: number; motion: string; buff?: boolean; /** lança uma vez e para de atacar (debuff como o Sneaker não vira golpe automático) */ once?: boolean; /** alcance da skill (magia/debuff lançam de longe); sem isso vale o da arma */ range?: number }

/** a imagem dos números (DmgEffect.dds), decodificada uma vez */
let atlasP: Promise<string | null> | null = null;
const atlas = () => (atlasP ??= resImage('Data/SFX/DmgEffect.dds'));

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
  /** motivo de não dar para lançar a skill agora (MP/FP insuficiente…), ou null — conferido antes da animação */
  skillBlock: (skillId: number) => string | null = () => null;
  onBlocked: (why: string) => void = () => {};
  /** skill esperando chegar ao alcance (lança no lugar do próximo golpe) */
  private queued: QueuedSkill | null = null;
  /** Action Slot em andamento: as próximas skills da sequência e quantas já saíram */
  private chain: QueuedSkill[] = [];
  private chainStep = -1;
  /** realce da skill da Action Slot sendo lançada (-1 = acabou) */
  onChainStep: (i: number) => void = () => {};

  /** lança a skill no alvo atual assim que estiver ao alcance */
  queueSkill(id: number, motion: string, buff = false, range?: number, once = false) { this.queued = { id, motion, buff, range, once }; this.nextAtk = Math.min(this.nextAtk, performance.now()); }
  /** Action Slot (UseSkillQueue): lança as skills uma depois da outra no alvo; depois volta ao golpe normal */
  queueChain(list: QueuedSkill[]) { this.chain = [...list]; this.chainStep = -1; this.queued = null; this.nextAtk = Math.min(this.nextAtk, performance.now()); }
  private endChain() { if (this.chainStep >= 0 || this.chain.length) { this.chain = []; this.chainStep = -1; this.onChainStep(-1); } }

  constructor(private view: WorldView) {}

  get attacking() { return this.targetId !== null; }
  /** o monstro que está sendo atacado (ou a caminho de atacar), ou null */
  get targetInst() { return this.targetId === null ? null : this.view.moverMgr.externalInfo(this.targetId)?.inst ?? null; }

  /** opção "Auto Attack Next Target": clicar em outro monstro enquanto ataca deixa ele de próximo alvo, atacado sozinho quando o atual morre */
  private nextInst: MoverInstance | null = null;
  queueNext(inst: MoverInstance) { this.nextInst = inst; }
  /** opção "Automatic Attack" desligada: um golpe por clique, não contínuo */
  autoAttack = true;
  private stopAt = 0;

  /** começa a atacar o mob desta instância (se for um mob do servidor vivo) */
  start(inst: MoverInstance) {
    const id = this.view.moverMgr.externalIdOf(inst);
    const info = id === null ? null : this.view.moverMgr.externalInfo(id);
    if (id === null || !info || info.s === 'dead' || this.view.player?.dead) { this.stop(); return; }
    this.targetId = id;
  }

  /** é o mob que está sendo atacado? */
  isTarget(inst: MoverInstance) { return this.targetId !== null && this.view.moverMgr.externalIdOf(inst) === this.targetId; }

  stop() { this.nextInst = null; this.stopAt = 0; this.queued = null; this.endChain(); if (this.targetId !== null) { this.targetId = null; this.view.player?.stop(); } }

  /** a cada quadro: aproxima, vira e golpeia */
  frame(now: number) {
    const id = this.targetId, p = this.view.player;
    if (id === null || !p?.active) return;
    if (this.stopAt && now >= this.stopAt) { this.stop(); return; }
    const info = this.view.moverMgr.externalInfo(id);
    if (info?.s === 'dead' || (!info && this.nextInst)) {
      // o alvo morreu: segue para o próximo escolhido (Auto Attack Next Target), se ainda está vivo e na cena
      const nx = this.nextInst;
      this.stop();
      const nid = nx ? this.view.moverMgr.externalIdOf(nx) : null;
      if (nx && nid !== null && this.view.moverMgr.externalInfo(nid)?.s !== 'dead') this.start(nx);
      return;
    }
    if (!info || p.dead || p.flying || this.view.moveKeysDown()) { this.stop(); return; }
    const [mx, , mz] = info.pos;
    const dist = Math.hypot(mx - p.pos[0], mz - p.pos[2]);
    const next = this.queued ?? this.chain[0], reach = next?.range ?? this.range; // magia: de longe, como o arco e a varinha
    if (dist > Math.max(ATTACK_RANGE, reach - 0.8)) {
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
        const why = q.buff ? null : this.skillBlock(q.id);
        if (why) { this.onBlocked(why); this.stop(); return; } // como o DoUseSkill do original: avisa e não faz nada
        else if (q.buff) this.sendSkill(q.id, 0); // buff da sequência vale em quem lança (o movimento toca quando o servidor aceita)
        else { p.cast(q.motion); this.sendSkill(q.id, id); if (q.once) { this.endChain(); this.targetId = null; } }
      } else {
        this.nextAtk = now + this.interval;
        p.attack();
        this.sendAttack(id);
        if (!this.autoAttack) this.stopAt = now + 450; // Automatic Attack desligado: só este golpe
      }
    }
  }

  /**
   * Número de dano com as imagens do cliente (DmgEffect.dds: dígitos vermelhos = quem apanhou é você, azuis = o resto), animado como
   * o CDamageNum do original: sobe rápido, treme, espera e some crescendo. `big` = crítico.
   */
  damage(pos: [number, number, number], n: number, mine: boolean, big = false, small = false) {
    if (!this.showDamage) return;
    void atlas();
    const cell = (big ? 40 : small ? 24 : 32), k = cell / 50, adv = cell * 0.72, row = mine ? 0 : 128;
    const el = document.createElement('div');
    el.className = 'dmgnum';
    const inner = document.createElement('div');
    inner.className = 'dmgnum-in';
    inner.style.height = `${cell}px`;
    const text = String(Math.max(0, Math.round(n))), gap = this.spaces ? cell * 0.4 : 0;
    let extra = 0;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i], more = this.spaces && i < text.length - 1 && (text.length - i - 1) % 3 === 0 ? gap : 0;
      extra += more;
      const d = document.createElement('i');
      d.style.cssText = `width:${cell}px;height:${cell}px;margin-right:${adv - cell + more}px;background-size:${1024 * k}px ${256 * k}px;background-position:${-Number(ch) * 50 * k}px ${-row * k}px`;
      inner.append(d);
    }
    inner.style.width = `${adv * (text.length - 1) + cell + extra}px`;
    el.append(inner);
    void atlas().then((u) => { if (u) inner.style.setProperty('--atlas', `url(${u})`); });
    const obj = new CSS2DObject(el);
    obj.position.set(pos[0] + (Math.random() - 0.5) * 0.4, pos[1], pos[2]);
    this.view.playerGroup.add(obj);
    const t0 = performance.now();
    const tick = () => {
      const t = (performance.now() - t0) / 1000;
      if (t >= 1.2) { obj.removeFromParent(); el.remove(); return; }
      let y: number, jx = 0, s = 1, a = 1;
      if (t < 0.13) y = (t / 0.13) * 80; // sobe depressa
      else if (t < 0.3) { y = 80; jx = Math.floor(t * 60) & 1 ? 3 : -3; } // treme
      else if (t < 0.55) y = 80; // espera
      else { y = 80 + (t - 0.55) * 120; s = 1.5 + (t - 0.55) * 0.6; a = Math.max(0, 0.3 - (t - 0.55) * 0.5); } // some crescendo
      inner.style.transform = `translate(${jx}px, ${-y}px) scale(${s})`;
      inner.style.opacity = String(a);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  /** número de dano subindo de um ponto (FlyFF x, y, z) */
  /** opção "Display Damage": desligada, os números de dano e o MISS não aparecem (cura e avisos continuam) */
  showDamage = true;
  /** opção "Hide Healing Numbers" e formato do dano com espaços ("Render Damage") */
  showHeal = true;
  spaces = false;
  popup(pos: [number, number, number], text: string, kind: 'mob' | 'me' | 'crit' | 'miss' | 'other' | 'heal' | 'healmp' | 'healfp' | 'notice') {
    if (!this.showDamage && (kind === 'mob' || kind === 'me' || kind === 'crit' || kind === 'miss' || kind === 'other')) return;
    if (!this.showHeal && (kind === 'heal' || kind === 'healmp' || kind === 'healfp')) return;
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
