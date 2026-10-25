import { Matrix4, Vector3, type Camera, type Group } from 'three';
import type { WorldData } from './data';
import type { ModelLibrary } from './models';
import { MoverInstance, preloadMotions } from './movers';
import { loadHumanTemplate, type Sex } from './humans';
import { motionOf, motionsFor } from './motions';
import { objectMatrix } from './math';
import { OT, type WorldObject } from './formats/types';
import { applyEnchantGlow } from './enchantGlow';
import { attachRide, flyMotion, rideOf, type RideInfo } from './ride';

/**
 * Personagem jogável: humano montado com Part_*.o3d (corpo padrão, cabeça/cabelo 01), anda sobre a altura do terreno e é
 * bloqueado por atributos do .lnd (NoWalk=1, NoMove=3, Die=4). Todas as posições em coordenadas FlyFF (D3D).
 */
export interface PlayerInput { forward: number; right: number; walk: boolean; jump: boolean; /** botão direito do mouse segurado (voo: segue a câmera) */ steer?: boolean }

export interface PlayerWorld {
  heightAt(x: number, z: number): number | null;
  /** atributo do terreno no ponto (0 normal, 1 NoWalk, 2 NoFly, 3 NoMove, 4 Die) */
  attrAt(x: number, z: number): number;
  /** chão de objeto (malha de colisão) mais alto em (x, z) que não passe de yTop */
  objectGround?(x: number, z: number, yTop: number): number | null;
  /** parede entre (x0,z0) e (x1,z1) (+ raio) nas alturas `heights` acima de y */
  blocked?(x0: number, z0: number, x1: number, z1: number, y: number, radius: number, heights: number[]): boolean;
  /** efeito do conjunto +3…+10 (WorldView.attachSetSfx) */
  attachSetSfx?(inst: MoverInstance, equip: string[]): void;
}

/** altura do pulo = JUMP_V² / (2·GRAVITY): 9 dava ~1,45; ×√3 triplica a altura (~4,3) mantendo a gravidade */
const RUN = 9, WALK = 4.5, GRAVITY = 28, JUMP_V = 9 * Math.sqrt(3);
/** maior degrau que se sobe andando; raio do corpo e alturas dos raios de parede (joelho e peito) */
const STEP = 0.7, RADIUS = 0.35, WALL_RAYS = [0.75, 1.5];

export class Player {
  inst: MoverInstance | null = null;
  pos: [number, number, number] = [0, 0, 0];
  /** graus; usado como `rot.y` do objeto */
  heading = 0;
  sex: Sex = 'male';
  private vy = 0;
  private spawnSeq = 0;
  /** destino do clique no mapa (x, z FlyFF); teclado cancela */
  target: [number, number] | null = null;
  /** menor distância já alcançada até o destino e há quanto tempo não melhora (preso em parede → desiste) */
  private bestDist = Infinity;
  private stuckT = 0;

  /** Anda até (x, z) FlyFF (clique no mapa). */
  moveTo(x: number, z: number) { this.target = [x, z]; this.bestDist = Infinity; this.stuckT = 0; }
  private grounded = true;
  private source: WorldObject | null = null;
  /**
   * Estado de animação. O pulo segue as 4 fases do mdlDyna.inc (GenJump1–4): JUMP1 = impulso no chão (toca uma vez e só então sai do
   * chão), JUMP2 = subida, JUMP3 = queda (vy < 0, ou ao sair de uma borda), JUMP4 = aterrissagem (toca uma vez; andar interrompe).
   */
  private state: 'stand' | 'walk' | 'run' | 'jump1' | 'jump2' | 'jump3' | 'jump4' | 'atk' | 'dead' | 'emote' | 'fly' | 'flyrun' = 'stand';

  // ---------- voo (CActionMover::ProcessFlyMove, controles de CWndWorld::ControlFlying) ----------
  /** prancha/vassoura equipada (null = no chão) */
  private ride: RideInfo | null = null;
  /** velocidade (unidades FlyFF por tique de 1/60 s), inclinação (graus; + = bico para baixo), aceleração e turbo ligados */
  private fv: [number, number, number] = [0, 0, 0];
  private pitch = 0;
  private acc = false;
  private turbo = false;
  private prevSpace = false;
  private prevTurbo = false;
  /** fFlightSpeed, fFlightLRAngle, fFlightTBAngle do item (Spec_Item) — chegam com o inventário */
  private flyParams: [number, number, number] = [0.003, 0.7, 1.4];
  setFlyParams(p: [number, number, number] | null) { if (p && p[0] > 0) this.flyParams = p; }
  get flying() { return !!this.ride; }
  /** velocidade atual (unidades por segundo), para o painel de voo */
  get flySpeed() { return Math.hypot(...this.fv) * 60; }
  get flyAcc() { return this.acc; }
  get flyTurbo() { return this.turbo; }
  /** emote em andamento (propMotion dwPlay): 0 toca uma vez e volta, 1 fica na pose final, 2 repete — andar/pular interrompe */
  private emoteMode = 0;

  /**
   * Movimento da janela de movimentos (tecla O, CWndMotion → OBJMSG_MOTION): MTI_SIT, MTI_YES, danças… Só parado no chão.
   * Devolve false se não deu para tocar agora.
   */
  emote(motion: string, mode: number) {
    const inst = this.inst;
    if (!inst || this.ride || !this.grounded || this.state === 'dead' || this.state.startsWith('jump')) return false;
    this.target = null;
    this.state = 'emote';
    this.emoteMode = mode;
    inst.restart(motion, mode === 2);
    return true;
  }
  /** próximo golpe da sequência (MTI_ATK1…4) */
  private hit = 0;

  /** golpe corpo a corpo: toca MTI_ATK1…4 (alternando) uma vez; andar interrompe */
  attack() {
    const inst = this.inst;
    if (!inst || this.ride || !this.grounded || this.state === 'dead' || this.state.startsWith('jump')) return;
    this.target = null;
    this.hit = (this.hit % 2) + 1;
    this.state = 'atk';
    inst.play(motionOf('atk', this.combat, this.hit)[0], false, this.attackRate);
  }
  /** velocidade de ataque (do servidor): o golpe toca nessa velocidade, no mesmo ritmo que o servidor aceita os golpes */
  attackRate = 1;

  /** movimento de skill (ex.: MTI_VAG_ONE_CLEANHIT) uma vez, como um golpe; sem o arquivo, usa o golpe normal */
  cast(motion: string) {
    const inst = this.inst;
    if (!inst || !this.grounded || this.state === 'dead' || this.state.startsWith('jump')) return;
    this.target = null;
    this.state = 'atk';
    inst.play(motion, false);
    // dwUseMotion "…CASTING01" liga na 02 (a liberação da magia); sem o arquivo a 02 é ignorada
    this.castNext = /01$/.test(motion) ? motion.replace(/01$/, '02') : null;
  }
  private castNext: string | null = null;

  /** morreu: toca MTI_DIE1 e fica no chão até `revive` */
  die() {
    if (!this.inst || this.state === 'dead') return;
    this.target = null;
    this.state = 'dead';
    this.inst.play(...motionOf('dead', this.combat));
  }

  revive() { if (this.inst && this.state === 'dead') { this.state = 'stand'; this.inst.play(...motionOf('stand', this.combat)); } }

  get dead() { return this.state === 'dead'; }

  /** para de andar até o destino do clique */
  stop() { this.target = null; }

  /** vira para o ponto (x, z) FlyFF */
  face(x: number, z: number) {
    const dx = x - this.pos[0], dz = z - this.pos[2];
    if (Math.hypot(dx, dz) < 1e-3) return;
    this.heading = (Math.atan2(dx, -dz) * 180) / Math.PI;
    this.apply();
  }

  constructor(private group: Group, private data: WorldData, private lib: ModelLibrary, private world: PlayerWorld) {}

  /** postura de combate (1–15, MTI_STAND_NN; 0 = normal): muda parado/andando/correndo — ver shared/motions.ts */
  private combat = 0;
  get stance() { return this.combat; }

  /** troca a postura de combate (arma equipada); baixa os movimentos antes para trocar sem atraso */
  async setCombat(combat: number) {
    if (combat === this.combat) return;
    this.combat = combat;
    const inst = this.inst;
    if (!inst) return;
    await preloadMotions(inst.tpl, motionsFor(combat));
    if (this.inst === inst && this.combat === combat && !this.state.startsWith('jump')) inst.play(...motionOf(this.state, combat));
  }

  /** estado de animação atual (enviado aos outros jogadores no multiplayer) */
  get animState() { return this.state; }

  get active() { return !!this.inst; }

  /** `look`: malhas de cabelo/cabeça (`Part_<sexo>Hair0N`/`Head0N`, como `m_dwHairMesh`/`m_dwHeadMesh` do banco) */
  /** aparência atual (malhas e símbolos II_* equipados) — usada por `restyle` */
  private look: { hair?: number; head?: number; equip?: string[] } = {};
  /** visual atual (para montar de novo ao trocar de mundo) */
  get currentLook() { return { ...this.look, equip: [...(this.look.equip ?? [])] }; }

  async spawn(sex: Sex, x: number, y: number, z: number, look: { hair?: number; head?: number; equip?: string[] } = {}) {
    // só o último pedido vale: dois spawns cruzados (ex.: Entrar clicado com a prévia ainda carregando) deixavam o 1º boneco
    // órfão na cena, parado e sem nome
    const seq = ++this.spawnSeq;
    const miId = this.data.defines.get(sex === 'male' ? 'MI_MALE' : 'MI_FEMALE');
    const entry = miId === undefined ? undefined : this.data.dynaModels.get(`${OT.MOVER}:${miId}`);
    if (!entry) throw new Error(`MI_${sex.toUpperCase()} não encontrado em mdlDyna.inc/defineObj.h`);
    const tpl = await loadHumanTemplate(entry, { sex, hair: look.hair || 1, head: look.head || 1, equip: look.equip ?? [] }, this.data, this.lib);
    if (!tpl) throw new Error('não foi possível montar o personagem (Part_*.o3d / .chr ausentes)');
    // movimentos do controle já em memória: a corrida começa no mesmo quadro em que a tecla/clique chega
    await preloadMotions(tpl, motionsFor(this.combat));
    if (seq !== this.spawnSeq) return; // outro spawn começou depois deste
    this.remove();
    this.sex = sex;
    this.look = { ...look };
    // no spawn aceita chão de objeto até 20 unidades acima do terreno (ex.: praça de Flaris acima do chão)
    const terrain = this.world.heightAt(x, z) ?? y;
    this.pos = [x, this.groundAt(x, z, terrain + 20), z];
    this.source = { type: OT.MOVER, modelId: miId!, rot: [0, this.heading, 0], pos: this.pos, scale: [1, 1, 1], motion: 0, ai: 0, ai2: 0, name: 'Jogador' };
    this.inst = new MoverInstance(tpl, this.source, new Matrix4());
    this.inst.blendTime = 0.08; // resposta rápida ao comando (mobs/NPCs mantêm 0,15 s)
    applyEnchantGlow(this.inst, look.equip ?? [], sex, this.data, !this.world.attachSetSfx);
    this.group.add(this.inst.group);
    this.world.attachSetSfx?.(this.inst, look.equip ?? []);
    this.ride = null;
    this.setRide(look.equip ?? []);
    this.vy = 0; this.grounded = true; this.state = 'stand';
    this.apply();
  }

  /**
   * Troca o equipamento visível sem mexer em posição, rumo ou animação (remonta as malhas e substitui o boneco).
   * Devolve a instância nova (para recolocar o nome) ou null se nada mudou / outro pedido passou na frente.
   */
  async restyle(equip: string[]): Promise<MoverInstance | null> {
    if (!this.inst || !this.source || (this.look.equip ?? []).join() === equip.join()) return null;
    const seq = ++this.spawnSeq;
    const entry = this.data.dynaModels.get(`${OT.MOVER}:${this.source.modelId}`);
    if (!entry) return null;
    const tpl = await loadHumanTemplate(entry, { sex: this.sex, hair: this.look.hair || 1, head: this.look.head || 1, equip }, this.data, this.lib);
    if (!tpl) return null;
    await preloadMotions(tpl, motionsFor(this.combat));
    if (seq !== this.spawnSeq || !this.inst) return null;
    this.look.equip = [...equip];
    this.inst.dispose();
    this.inst = new MoverInstance(tpl, this.source, new Matrix4());
    this.inst.blendTime = 0.08;
    applyEnchantGlow(this.inst, equip, this.sex, this.data, !this.world.attachSetSfx);
    this.group.add(this.inst.group);
    this.world.attachSetSfx?.(this.inst, equip);
    this.setRide(equip);
    const st = this.state;
    this.inst.play(...motionOf(st, this.combat));
    this.apply();
    return this.inst;
  }

  /** Teleporte (GM): põe o personagem em (x, z), em pé no chão (aceita chão de objeto até 20 acima do terreno). */
  teleport(x: number, z: number, y: number) {
    if (!this.inst) return;
    const terrain = this.world.heightAt(x, z) ?? y;
    this.pos = [x, this.groundAt(x, z, Math.max(terrain, y) + 20), z];
    this.target = null; this.vy = 0; this.grounded = true;
    if (this.state !== 'stand') { this.state = 'stand'; this.inst.play(...motionOf('stand', this.combat)); }
    this.apply();
  }

  remove() {
    this.spawnSeq++; // cancela um spawn ainda carregando
    this.inst?.dispose();
    this.inst = null;
  }

  /** `camera` define a direção "para frente" (projetada no plano). Retorna o deslocamento (D3D) aplicado neste quadro. */
  /**
   * Monta / desmonta pela lista do visual: com prancha ou vassoura equipada sai do chão e voa; sem ela, cai e volta a andar.
   * (Pedir/guardar a prancha é equipar/desequipar no inventário; o servidor confere o nível.)
   */
  private setRide(equip: string[]) {
    const inst = this.inst;
    if (!inst) return;
    const ride = rideOf(this.data, equip);
    void attachRide(inst, ride, this.lib);
    if (ride && !this.ride) {
      this.ride = ride;
      this.target = null;
      this.fv = [0, 0, 0]; this.pitch = 0; this.acc = false; this.turbo = false;
      this.pos[1] += 1.2; // decola
      this.grounded = false; this.vy = 0;
      this.state = 'fly';
      inst.play(flyMotion(ride.set, 'idle'));
    } else if (ride) {
      this.ride = ride;
      inst.play(flyMotion(ride.set, this.acc ? 'run' : 'idle'));
    } else if (this.ride) {
      this.ride = null;
      this.pitch = 0; this.fv = [0, 0, 0]; this.acc = false;
      this.grounded = false; this.vy = 0; // cai até o chão (a gravidade do andar cuida)
      this.state = 'jump3';
      inst.play(...motionOf('jump3', this.combat));
    }
    this.apply();
  }

  /**
   * Voo, como no cliente: Espaço liga/desliga a aceleração, W inclina o bico para baixo e S para cima (até 45°), A/D viram;
   * segurando o botão direito do mouse a prancha vira e inclina para onde a câmera aponta. Alt liga/desliga o turbo (+20 %
   * de força, máximo 1,1×). Sem aceleração o ar freia aos poucos. Não passa do chão nem entra em área sem voo (NoFly).
   */
  private updateFly(dt: number, input: PlayerInput, inst: MoverInstance, camera: Camera) {
    const ride = this.ride!;
    const [spd, lr, tb] = this.flyParams;
    const k = Math.min(dt, 0.1) * 60; // tiques de 1/60 s
    if (input.jump && !this.prevSpace) this.acc = !this.acc;
    this.prevSpace = input.jump;
    if (input.walk && !this.prevTurbo) this.turbo = !this.turbo;
    this.prevTurbo = input.walk;
    // A/D: gira (D para a direita = rumo diminui, por causa do espelho em Z); W/S: inclina
    let turn = input.right;
    this.heading = (this.heading - input.right * lr * k + 360) % 360;
    this.pitch = Math.max(-45, Math.min(45, this.pitch + input.forward * tb * k));
    if (input.steer) {
      // para onde a câmera olha (Three → FlyFF: z invertido): rumo e inclinação alvo, alcançados a até 180°/s e 120°/s
      const d = camera.getWorldDirection(new Vector3());
      const wantH = (Math.atan2(d.x, d.z) * 180) / Math.PI;
      const wantP = Math.max(-45, Math.min(45, (Math.asin(Math.max(-1, Math.min(1, -d.y))) * 180) / Math.PI));
      const dh = ((wantH - this.heading + 540) % 360) - 180;
      const stepH = Math.max(-3 * k, Math.min(3 * k, dh));
      this.heading = (this.heading + stepH + 360) % 360;
      this.pitch += Math.max(-2 * k, Math.min(2 * k, wantP - this.pitch));
      if (Math.abs(dh) > 2) turn = dh < 0 ? 1 : -1; // animação de virar (rumo diminuindo = direita)
    }
    const pwr = this.acc ? spd * 0.75 * (this.turbo ? 1.2 : 1) : 0;
    const fv = this.fv;
    if (pwr > 0) {
      const ax = (this.pitch * Math.PI) / 180, ay = (this.heading * Math.PI) / 180;
      const horiz = Math.cos(ax) * pwr;
      const max = 0.3 * (this.turbo ? 1.1 : 1);
      if (fv[0] ** 2 + fv[1] ** 2 + fv[2] ** 2 < max * max) {
        fv[0] += Math.sin(ay) * horiz * k; fv[2] += -Math.cos(ay) * horiz * k; fv[1] += -Math.sin(ax) * pwr * k;
      }
    }
    const drag = Math.pow(1 - 0.006, k); // FRIC_AIR
    fv[0] *= drag; fv[1] *= drag; fv[2] *= drag;
    if (!this.acc && fv[0] ** 2 + fv[1] ** 2 + fv[2] ** 2 < 1e-7) fv[0] = fv[1] = fv[2] = 0;
    const nx = this.pos[0] + fv[0] * k, nz = this.pos[2] + fv[2] * k;
    if (this.world.attrAt(nx, nz) === 2) { fv[0] = fv[2] = 0; } // NoFly: não entra
    else { this.pos[0] = nx; this.pos[2] = nz; }
    this.pos[1] += fv[1] * k;
    const ground = this.groundAt(this.pos[0], this.pos[2], this.pos[1] + 2) + 0.3;
    if (this.pos[1] < ground) { this.pos[1] = ground; if (fv[1] < 0) fv[1] = 0; }
    if (this.pos[1] > 2900) { this.pos[1] = 2900; if (fv[1] > 0) fv[1] = 0; }
    this.state = this.acc ? 'flyrun' : 'fly';
    inst.play(flyMotion(ride.set, turn < 0 ? 'left' : turn > 0 ? 'right' : this.acc ? 'run' : 'idle'));
    inst.update(dt);
    this.apply();
  }

  update(dt: number, input: PlayerInput, camera: Camera): [number, number, number] {
    const inst = this.inst;
    if (!inst) return [0, 0, 0];
    const before: [number, number, number] = [...this.pos];
    if (this.state === 'dead') { inst.update(dt); this.apply(); return [0, 0, 0]; }
    if (this.ride) {
      this.updateFly(dt, input, inst, camera);
      return [this.pos[0] - before[0], this.pos[1] - before[1], this.pos[2] - before[2]];
    }

    // direção da câmera no plano XZ do Three → espaço FlyFF (z invertido)
    const f = camera.getWorldDirection(new Vector3());
    f.y = 0;
    if (f.lengthSq() < 1e-6) f.set(0, 0, -1);
    f.normalize();
    const r = new Vector3(-f.z, 0, f.x); // à direita da câmera
    // direção desejada em FlyFF (x, z): teclado relativo à câmera, senão o destino do clique
    let ux = f.x * input.forward + r.x * input.right;
    let uz = -(f.z * input.forward + r.z * input.right); // Three z → FlyFF z
    let len = Math.hypot(ux, uz);
    const speed = input.walk ? WALK : RUN;
    let maxStep = Infinity;
    if (len > 1e-4) this.target = null;
    else if (this.target) {
      ux = this.target[0] - this.pos[0]; uz = this.target[1] - this.pos[2];
      maxStep = Math.hypot(ux, uz);
      if (maxStep < this.bestDist - 0.02) { this.bestDist = maxStep; this.stuckT = 0; } else this.stuckT += dt;
      if (maxStep < 0.15 || this.stuckT > 0.4) { this.target = null; ux = uz = 0; }
      len = Math.hypot(ux, uz);
    }
    if (len > 1e-4) {
      const step = Math.min(speed * dt, maxStep);
      const dx = (ux / len) * step, dz = (uz / len) * step;
      // desliza por eixo para não "grudar" em obstáculos; preso de vez → desiste do destino
      if (this.canMove(dx, dz)) { this.pos[0] += dx; this.pos[2] += dz; }
      else if (this.canMove(dx, 0)) this.pos[0] += dx;
      else if (this.canMove(0, dz)) this.pos[2] += dz;
      else this.target = null;
      // CMover: anda com Δ = (sin a, −cos a) e gira com RotationY(−a) ⇒ o modelo olha para −Z local e a = atan2(dx, −dz)
      this.heading = (Math.atan2(dx, -dz) * 180) / Math.PI;
    }

    // vertical: gravidade + pulo sobre o terreno ou o chão de objetos (degrau até STEP acima dos pés)
    const ground = this.groundAt(this.pos[0], this.pos[2], this.pos[1] + STEP);
    const moving = len > 1e-4;
    const set = (st: Player['state']) => {
      if (st === this.state) return;
      this.state = st;
      inst.play(...motionOf(st, this.combat));
    };
    if (input.jump && this.grounded && this.state !== 'jump1') set('jump1');
    if (this.state === 'jump1' && inst.finished) { this.vy = JUMP_V; this.grounded = false; set('jump2'); }
    if (!this.grounded) {
      this.vy -= GRAVITY * dt;
      this.pos[1] += this.vy * dt;
      if (this.vy < 0 && this.state !== 'jump3') set('jump3');
      if (this.pos[1] <= ground) { this.pos[1] = ground; this.vy = 0; this.grounded = true; set('jump4'); }
    } else {
      // acompanha o chão (sobe/desce suavemente)
      this.pos[1] += (ground - this.pos[1]) * Math.min(1, dt * 18);
      if (this.pos[1] - ground > 0.6) { this.grounded = false; this.vy = 0; } // saiu de uma borda
    }

    if (this.state === 'atk' && !moving && inst.finished && this.castNext) { const n = this.castNext; this.castNext = null; inst.play(n, false); }
    const striking = this.state === 'atk' && !moving && !inst.finished;
    const emoting = this.state === 'emote' && !moving && (this.emoteMode !== 0 || !inst.finished);
    if (this.grounded && !striking && !emoting && this.state !== 'jump1' && (this.state !== 'jump4' || inst.finished || moving)) {
      set(moving ? (input.walk ? 'walk' : 'run') : 'stand');
    }
    inst.update(dt);
    this.apply();
    return [this.pos[0] - before[0], this.pos[1] - before[1], this.pos[2] - before[2]];
  }

  /** Terreno ou chão de objeto mais alto até `yTop` (o terreno vale mesmo acima de yTop: não se atravessa o chão). */
  private groundAt(x: number, z: number, yTop: number) {
    const t = this.world.heightAt(x, z) ?? this.pos[1];
    const o = this.world.objectGround?.(x, z, yTop) ?? null;
    return o !== null && o > t ? o : t;
  }

  /** Prévia (criação/seleção de personagem): anima parado e gira `turn` graus/s, sem andar nem cair. */
  preview(dt: number, turn = 0) {
    if (!this.inst) return;
    this.heading = (this.heading + turn * dt) % 360;
    this.inst.update(dt);
    this.apply();
  }

  private canMove(dx: number, dz: number) {
    const [x, y, z] = this.pos;
    const nx = x + dx, nz = z + dz;
    if (this.world.blocked?.(x, z, nx, nz, y, RADIUS, WALL_RAYS)) return false;
    // atributos do terreno (NoWalk/NoMove/Die) só valem pisando no terreno, não sobre pontes/pisos de objetos
    const t = this.world.heightAt(nx, nz) ?? y;
    const o = this.world.objectGround?.(nx, nz, y + STEP) ?? null;
    if (o !== null && o > t + 0.05) return true;
    const a = this.world.attrAt(nx, nz);
    return a !== 1 && a !== 3 && a !== 4;
  }

  private apply() {
    if (!this.inst || !this.source) return;
    this.source.pos = this.pos;
    // voando, o corpo inteiro inclina junto com a prancha (GetAngleX)
    const rot: [number, number, number] = [this.ride ? this.pitch : 0, this.heading, 0];
    this.source.rot = rot;
    this.inst.group.matrix.copy(objectMatrix({ pos: this.pos, rot, scale: [1, 1, 1] }, new Matrix4()));
  }
}
