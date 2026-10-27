import { AmbientLight, DirectionalLight, LinearSRGBColorSpace, Matrix4, PerspectiveCamera, Scene, WebGLRenderer } from 'three';
import { MoverInstance, preloadMotions } from '../shared/movers';
import { hairRgb, loadHumanTemplate } from '../shared/humans';
import { applyEnchantGlow } from '../shared/enchantGlow';
import { OT, type WorldObject } from '../shared/formats/types';
import { motionOf, motionsFor } from '../shared/motions';
import { lookSymbol } from '../shared/look';
import type { WorldView } from '../shared/world';

/** aparência de um personagem para os quadros da seleção e da criação */
export interface CharLook { sex: number; hair: number; head: number; /** m_dwHairColor (0 = padrão da malha) */ hairColor?: number; equip?: string[]; /** postura da arma */ mt?: number }

/**
 * Personagem 3D dentro de uma janela (os 3 quadros do CWndSelectChar e o boneco do CWndCreateChar): um canvas 2D por quadro,
 * desenhado por UM renderizador WebGL fora da tela compartilhado entre todos (sem um contexto por quadro). Arrastar gira o
 * boneco (__CHAR_CREATE_ROTATE); `animate` falso deixa parado na pose (a seleção só anima o escolhido).
 */
export class CharStage {
  private renderer: WebGLRenderer | null = null;
  private views = new Set<CharView>();
  private running = false;
  private last = 0;

  constructor(private world: WorldView) {}

  view(label: string): CharView {
    const v = new CharView(this.world, label);
    this.views.add(v);
    return v;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    const tick = (now: number) => {
      if (!this.running) return;
      const dt = Math.min(0.1, (now - this.last) / 1000);
      this.last = now;
      for (const v of this.views) if (v.canvas.isConnected && v.canvas.offsetParent) this.draw(v, dt);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }
  stop() { this.running = false; }

  private draw(v: CharView, dt: number) {
    const w = v.canvas.clientWidth, h = v.canvas.clientHeight;
    if (!w || !h) return;
    const pr = Math.min(devicePixelRatio, 2), pw = Math.round(w * pr), ph = Math.round(h * pr);
    if (v.canvas.width !== pw || v.canvas.height !== ph) { v.canvas.width = pw; v.canvas.height = ph; }
    if (!this.renderer) {
      try {
        this.renderer = new WebGLRenderer({ alpha: true, antialias: true });
        this.renderer.outputColorSpace = LinearSRGBColorSpace;
        this.renderer.setClearColor(0x000000, 0);
      } catch { this.running = false; return; }
    }
    const r = this.renderer, gl = r.domElement;
    // o canvas do WebGL cresce até o maior quadro; cada quadro usa o canto de baixo e é copiado logo depois de desenhar
    if (gl.width < pw || gl.height < ph) r.setSize(Math.max(gl.width, pw), Math.max(gl.height, ph), false);
    r.setViewport(0, 0, pw, ph);
    r.setScissor(0, 0, pw, ph);
    r.setScissorTest(true);
    r.clear();
    v.render(r, dt, pw / ph);
    const ctx = v.canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, pw, ph);
    ctx.drawImage(gl, 0, gl.height - ph, pw, ph, 0, 0, pw, ph);
  }
}

export class CharView {
  readonly canvas = document.createElement('canvas');
  private scene = new Scene();
  private camera = new PerspectiveCamera(24, 1, 0.1, 50);
  private inst: MoverInstance | null = null;
  private seq = 0;
  private look: CharLook | null = null;
  /** giro (graus) do arrasto */
  private rot = 0;
  /** anima o movimento (false = parado na pose) */
  animate = true;
  /**
   * Pose na seleção (CWndSelectChar::OnDraw): quem não está escolhido senta (MTI_SIT uma vez, depois MTI_SITSTAND em loop);
   * ao ser escolhido levanta (MTI_GETUP uma vez, depois MTI_STAND). `phase` é a transição em andamento.
   */
  private pose: 'stand' | 'sit' = 'stand';
  private phase: 'sitting' | 'getup' | null = null;

  constructor(private world: WorldView, label: string) {
    this.canvas.className = 'char-model';
    this.canvas.setAttribute('role', 'img');
    this.canvas.setAttribute('aria-label', label);
    this.scene.add(new AmbientLight(0xffffff, 1.6));
    const sun = new DirectionalLight(0xffffff, 1.6);
    sun.position.set(-2, 4, 5);
    this.scene.add(sun);
    let drag: { x: number; rot: number; id: number; moved: boolean } | null = null;
    this.canvas.style.touchAction = 'none';
    this.canvas.addEventListener('pointerdown', (e) => { if (e.button === 0) drag = { x: e.clientX, rot: this.rot, id: e.pointerId, moved: false }; });
    this.canvas.addEventListener('pointermove', (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      if (!drag.moved && Math.abs(e.clientX - drag.x) > 3) { drag.moved = true; this.canvas.setPointerCapture(e.pointerId); }
      if (drag.moved) { this.rot = drag.rot + (e.clientX - drag.x) * 1.2; this.place(); }
    });
    const end = (e: PointerEvent) => { if (drag?.id === e.pointerId) drag = null; };
    this.canvas.addEventListener('pointerup', end);
    this.canvas.addEventListener('pointercancel', end);
  }

  /** troca o boneco (null = quadro vazio); só o último pedido vale */
  async set(look: CharLook | null) {
    const seq = ++this.seq;
    const same = look && this.look && look.sex === this.look.sex && look.hair === this.look.hair && look.head === this.look.head && (look.mt ?? 0) === (this.look.mt ?? 0) && (look.equip ?? []).join() === (this.look.equip ?? []).join();
    this.look = look ? { ...look } : null;
    if (same && this.inst) { this.setHairColor(look!.hairColor ?? 0); return; }
    if (!look) { this.clear(); return; }
    const d = this.world.data;
    if (!d) return;
    const sex = look.sex === 1 ? 'female' : 'male';
    const miId = d.defines.get(sex === 'male' ? 'MI_MALE' : 'MI_FEMALE');
    const entry = miId === undefined ? undefined : d.dynaModels.get(`${OT.MOVER}:${miId}`);
    if (!entry || miId === undefined) return;
    // prancha/vassoura fica de fora: na seleção ele aparece em pé
    const equip = (look.equip ?? []).filter((s) => !/^II_RID_/.test(lookSymbol(s)));
    const tpl = await loadHumanTemplate(entry, { sex, hair: look.hair || 1, head: look.head || 1, equip }, d, this.world.lib);
    if (!tpl || seq !== this.seq) return;
    const mt = look.mt ?? 0;
    await preloadMotions(tpl, motionsFor(mt));
    if (seq !== this.seq) return;
    this.clear();
    const source: WorldObject = { type: OT.MOVER, modelId: miId, pos: [0, 0, 0], rot: [0, 0, 0], scale: [1, 1, 1], motion: 0, ai: 0, ai2: 0 };
    const inst = new MoverInstance(tpl, source, new Matrix4());
    inst.setHairColor(hairRgb(look.hairColor ?? 0, sex, look.hair || 1));
    applyEnchantGlow(inst, equip, sex, d, true);
    // boneco novo já começa na pose, sem a transição
    if (this.pose === 'sit') inst.play('MTI_SITSTAND', true); else inst.play(...motionOf('stand', mt));
    this.phase = null;
    inst.update(0);
    this.scene.add(inst.group);
    this.inst = inst;
    // corpo inteiro enquadrado pela altura do modelo
    const h = Math.max(1.2, tpl.height + (tpl.lift ?? 0));
    this.camera.position.set(0, h * 0.5, h * 2.75);
    this.camera.lookAt(0, h * 0.47, 0);
    this.place();
  }

  /** só a cor do cabelo (barras da criação), sem remontar o boneco */
  setHairColor(color: number) {
    if (!this.look || !this.inst) return;
    this.look.hairColor = color;
    this.inst.setHairColor(hairRgb(color, this.look.sex === 1 ? 'female' : 'male', this.look.hair || 1));
  }

  /** senta (não escolhido) ou levanta (escolhido), com a animação de transição do original */
  setPose(p: 'stand' | 'sit') {
    if (p === this.pose) return;
    this.pose = p;
    if (!this.inst) return;
    if (p === 'sit') { this.inst.play('MTI_SIT', false); this.phase = 'sitting'; } else { this.inst.play('MTI_GETUP', false); this.phase = 'getup'; }
  }

  resetRotation() { this.rot = 0; this.place(); }

  private clear() { this.inst?.dispose(); this.inst = null; }

  private place() {
    if (!this.inst) return;
    // como no mundo (grupo raiz espelhado em Z: o FlyFF é mão esquerda); o modelo olha para −Z local → de frente para a câmera
    this.inst.group.matrix.makeScale(1, 1, -1).multiply(new Matrix4().makeRotationY((this.rot * Math.PI) / 180));
  }

  render(r: WebGLRenderer, dt: number, aspect: number) {
    if (!this.inst) return;
    if (this.camera.aspect !== aspect) { this.camera.aspect = aspect; this.camera.updateProjectionMatrix(); }
    if (this.animate) this.inst.update(dt);
    // fim da transição: sentado em loop ou em pé (com a postura da arma)
    if (this.phase && this.inst.finished) {
      if (this.phase === 'sitting') this.inst.play('MTI_SITSTAND', true); else this.inst.play(...motionOf('stand', this.look?.mt ?? 0));
      this.phase = null;
    }
    this.scene.updateMatrixWorld();
    r.render(this.scene, this.camera);
  }
}
