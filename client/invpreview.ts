import { AdditiveBlending, AmbientLight, DirectionalLight, Group, LinearSRGBColorSpace, Matrix4, Mesh, NormalBlending, PerspectiveCamera, Scene, WebGLRenderer, type Material } from 'three';
import { MoverInstance, type MoverTemplate } from '../shared/movers';
import { motionOf } from '../shared/motions';
import { applyEnchantGlow } from '../shared/enchantGlow';
import type { WorldData } from '../shared/data';
import type { Sex } from '../shared/humans';
import type { WorldObject } from '../shared/formats/types';
import { SfxManager, type SfxLibrary } from '../shared/sfxRuntime';
import { attachSetSfx } from '../shared/setSfx';

/** efeitos .sfx do mundo (biblioteca já carregada e o arquivo de cada id XI_*) */
export interface PreviewSfx { lib: SfxLibrary; fileOf: (id: number) => string }

/**
 * Personagem 3D no centro do inventário (como o CWndInventory original, que desenha o m_pModel do jogador e gira arrastando):
 * um renderizador pequeno próprio que usa o MESMO modelo já montado do jogador (template compartilhado — malhas e texturas
 * não são baixadas de novo), parado em MTI_STAND, com o brilho do enchant e o efeito do conjunto (os mesmos sfx_level03…10
 * do mundo, shared/setSfx.ts). Só desenha com a janela aberta.
 */
export class InventoryPreview {
  readonly canvas = document.createElement('canvas');
  private renderer: WebGLRenderer | null = null;
  private scene = new Scene();
  private camera = new PerspectiveCamera(24, 1, 0.1, 50);
  private inst: MoverInstance | null = null;
  private tpl: MoverTemplate | null = null;
  private equipKey = '';
  /** giro (graus) do arrasto */
  private rot = 0;
  private running = false;
  private last = 0;
  /** efeitos do conjunto: grupo espelhado em Z como a raiz do mundo (as posições dos .sfx são FlyFF) */
  private sfxGroup = new Group();
  private sfxMgr: SfxManager | null = null;

  constructor() {
    this.canvas.className = 'inv-model';
    this.canvas.setAttribute('aria-label', 'Seu personagem (arraste para girar)');
    this.canvas.setAttribute('role', 'img');
    this.scene.add(new AmbientLight(0xffffff, 1.6));
    const sun = new DirectionalLight(0xffffff, 1.6);
    sun.position.set(-2, 4, 5);
    this.scene.add(sun);
    this.sfxGroup.matrixAutoUpdate = false;
    this.sfxGroup.matrix.makeScale(1, 1, -1);
    this.scene.add(this.sfxGroup);
    let drag: { x: number; rot: number; id: number } | null = null;
    this.canvas.style.touchAction = 'none';
    this.canvas.addEventListener('pointerdown', (e) => { if (e.button !== 0) return; drag = { x: e.clientX, rot: this.rot, id: e.pointerId }; this.canvas.setPointerCapture(e.pointerId); });
    this.canvas.addEventListener('pointermove', (e) => { if (drag && e.pointerId === drag.id) { this.rot = drag.rot + (e.clientX - drag.x) * 1.2; this.place(); } });
    const end = (e: PointerEvent) => { if (drag?.id === e.pointerId) drag = null; };
    this.canvas.addEventListener('pointerup', end);
    this.canvas.addEventListener('pointercancel', end);
  }

  /** troca o boneco (template do jogador já montado, lista do visual com enchant) */
  setModel(tpl: MoverTemplate | null, equip: string[], sex: Sex, combat: number, data: WorldData | null, sfx: PreviewSfx | null = null) {
    const key = equip.join() + ':' + combat;
    if (tpl === this.tpl && key === this.equipKey) return;
    this.tpl = tpl; this.equipKey = key;
    this.inst?.dispose();
    this.inst = null;
    if (!tpl) return;
    const source: WorldObject = { type: 5, modelId: 0, pos: [0, 0, 0], rot: [0, 0, 0], scale: [1, 1, 1], motion: 0, ai: 0, ai2: 0 };
    const inst = new MoverInstance(tpl, source, new Matrix4());
    inst.play(...motionOf('stand', combat));
    if (data) applyEnchantGlow(inst, equip, sex, data, !sfx);
    this.scene.add(inst.group);
    this.inst = inst;
    if (sfx) {
      this.sfxMgr ??= new SfxManager(this.sfxGroup, sfx.lib);
      attachSetSfx(this.sfxMgr, sfx.fileOf, inst, equip);
    }
    // enquadra pela altura do modelo
    const h = Math.max(1.2, tpl.height + (tpl.lift ?? 0));
    this.camera.position.set(0, h * 0.52, h * 2.55);
    this.camera.lookAt(0, h * 0.5, 0);
    this.place();
  }

  private place() {
    if (!this.inst) return;
    // como no mundo (grupo raiz espelhado em Z: o FlyFF é mão esquerda) — sem o espelho o escudo troca de braço. O modelo
    // olha para −Z local; espelhado, fica de frente para a câmera. Mais o giro do arrasto.
    this.inst.group.matrix.makeScale(1, 1, -1).multiply(new Matrix4().makeRotationY((this.rot * Math.PI) / 180));
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    const tick = (now: number) => {
      if (!this.running) return;
      const dt = Math.min(0.1, (now - this.last) / 1000);
      this.last = now;
      this.draw(dt);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }
  stop() { this.running = false; }

  private draw(dt: number) {
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    if (!w || !h) return;
    if (!this.renderer) {
      try {
        this.renderer = new WebGLRenderer({ canvas: this.canvas, alpha: true, antialias: true });
        this.renderer.outputColorSpace = LinearSRGBColorSpace;
        this.renderer.setClearColor(0x000000, 0);
      } catch { this.running = false; return; }
    }
    const r = this.renderer, pr = Math.min(devicePixelRatio, 2);
    if (r.getPixelRatio() !== pr) r.setPixelRatio(pr);
    if (this.canvas.width !== Math.round(w * pr) || this.canvas.height !== Math.round(h * pr)) { r.setSize(w, h, false); this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); }
    this.inst?.update(dt);
    this.scene.updateMatrixWorld();
    this.sfxMgr?.update(dt, this.camera);
    // canvas transparente: o brilho aditivo não aparece sobre o fundo claro da janela e o quad inteiro (fundo preto da
    // textura) viraria um quadrado escuro. Na prévia, o claro da textura vira opacidade: preto some, brilho fica com a cor
    // do efeito por cima (no mundo o fundo é opaco e o aditivo normal funciona).
    this.sfxGroup.traverse((o) => {
      if (!(o instanceof Mesh)) return;
      for (const m of (Array.isArray(o.material) ? o.material : [o.material]) as Material[]) {
        if (m.blending !== AdditiveBlending) continue;
        m.blending = NormalBlending;
        m.premultipliedAlpha = false;
        m.onBeforeCompile = (sh) => {
          sh.fragmentShader = sh.fragmentShader.replace('#include <premultiplied_alpha_fragment>',
            'gl_FragColor.a *= min(1.0, 1.4 * max(gl_FragColor.r, max(gl_FragColor.g, gl_FragColor.b)));\n#include <premultiplied_alpha_fragment>');
        };
        m.customProgramCacheKey = () => 'preview-glow';
        m.needsUpdate = true;
      }
    });
    r.render(this.scene, this.camera);
  }
}
