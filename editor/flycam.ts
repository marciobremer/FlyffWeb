import { Vector3, type PerspectiveCamera } from 'three';
import type { WorldView } from '../shared/world';

/**
 * Câmera do editor no estilo da viewport do Unreal Engine 5 (substitui OrbitControls + WASD no editor; o jogo continua como era).
 *   botão direito (segurar) ... olhar em volta; com W A S D anda, Q desce, E sobe, Shift acelera; a roda muda o nível de velocidade (1–8)
 *   botão do meio (arrastar) ... pan
 *   roda ........................ aproxima/afasta na direção da câmera
 *   Alt + botão esquerdo ........ orbita em volta do objeto selecionado (ou do ponto que a câmera está olhando)
 *   Alt + botão direito ......... dolly (aproxima/afasta arrastando)
 *   F ........................... foca o objeto selecionado
 * Todos os números de "sensibilidade" estão em FLY; ajuste ali.
 */
export const FLY = {
  lookDegPerPx: 0.1,
  orbitDegPerPx: 0.2,
  /** unidades/s em cada nível de velocidade (1–8) */
  speeds: [4, 10, 25, 60, 120, 250, 500, 1000],
  defaultLevel: 4,
  shift: 3,
  /** suavização da aceleração (maior = mais seco) */
  ease: 12,
  /** cada passo da roda anda esta fração da distância até o ponto olhado (limites em unidades) */
  wheelFraction: 0.15, wheelMin: 0.5, wheelMax: 300,
  altDollyPerPx: 0.005,
  focusDistance: 30,
  pitchLimitDeg: 89,
};
const STORE = 'editor.camSpeed';

export class EditorCamera {
  /** o botão direito está segurado (modo voo): W/E/R não trocam de ferramenta enquanto isso */
  looking = false;
  level: number;
  private mode: 'look' | 'dolly' | 'pan' | 'orbit' | null = null;
  private keys = new Set<string>();
  private vel = new Vector3();
  private yaw = 0;
  private pitch = 0;
  /** distância da câmera até o ponto olhado (o chão à frente, ou o último valor) */
  private dist = 120;
  private moved = true;
  private f = new Vector3();
  private r = new Vector3();
  private tmp = new Vector3();

  constructor(private view: WorldView, private focusPoint: () => Vector3 | null) {
    let lv = FLY.defaultLevel;
    try { lv = Number(localStorage.getItem(STORE)) || lv; } catch { /* sem armazenamento */ }
    this.level = Math.min(FLY.speeds.length, Math.max(1, Math.round(lv)));
    this.dist = Math.max(10, this.cam.position.distanceTo(view.controls.target));
    this.readOrientation();
    const c = view.canvas;
    addEventListener('pointerdown', (e) => this.down(e), true);
    addEventListener('mousemove', (e) => this.move(e));
    addEventListener('pointerup', () => this.up());
    addEventListener('blur', () => { this.up(); this.keys.clear(); });
    document.addEventListener('pointerlockchange', () => { if (document.pointerLockElement !== c && this.mode === 'look') this.up(); });
    c.addEventListener('wheel', (e) => this.wheel(e), { passive: false });
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    addEventListener('keydown', (e) => {
      if (this.typing(e)) return;
      this.keys.add(e.code);
      if (e.code === 'KeyF' && !e.ctrlKey && !e.metaKey && !this.looking) this.focus();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    view.editorCamera = (dt) => this.update(dt);
    view.onReorient = () => this.readOrientation();
  }

  get speed() { return FLY.speeds[this.level - 1]; }

  private typing(e: KeyboardEvent) { const t = (e.target as HTMLElement).tagName; return t === 'INPUT' || t === 'SELECT' || t === 'TEXTAREA'; }
  private get cam() { return this.view.camera as PerspectiveCamera; }

  private readOrientation() {
    const e = this.cam.rotation.clone().setFromQuaternion(this.cam.quaternion, 'YXZ');
    this.yaw = e.y; this.pitch = e.x;
  }

  private apply() { this.cam.rotation.set(this.pitch, this.yaw, 0, 'YXZ'); }
  private forward() { return this.f.set(0, 0, -1).applyEuler(this.cam.rotation); }

  private down(e: PointerEvent) {
    if (e.target !== this.view.canvas || this.view.player?.active) return;
    if (e.button === 0 && e.altKey) { this.mode = 'orbit'; e.stopImmediatePropagation(); e.preventDefault(); }
    else if (e.button === 1) { this.mode = 'pan'; e.stopImmediatePropagation(); e.preventDefault(); }
    else if (e.button === 2) {
      this.mode = e.altKey ? 'dolly' : 'look';
      this.looking = this.mode === 'look';
      if (this.looking) { try { void (this.view.canvas.requestPointerLock() as unknown as Promise<void> | undefined)?.catch?.(() => {}); } catch { /* navegador recusou: segue sem a trava */ } }
    } else return;
    this.readOrientation();
    this.view.canvas.style.cursor = this.mode === 'look' ? 'none' : 'grabbing';
  }

  private up() {
    if (!this.mode) return;
    this.mode = null;
    this.looking = false;
    this.view.canvas.style.cursor = '';
    if (document.pointerLockElement === this.view.canvas) document.exitPointerLock();
  }

  private move(e: MouseEvent) {
    if (!this.mode) return;
    const dx = e.movementX, dy = e.movementY;
    if (!dx && !dy) return;
    const cam = this.cam;
    if (this.mode === 'look' || this.mode === 'orbit') {
      const k = ((this.mode === 'look' ? FLY.lookDegPerPx : FLY.orbitDegPerPx) * Math.PI) / 180, lim = (FLY.pitchLimitDeg * Math.PI) / 180;
      let pivot: Vector3 | null = null, r = 0;
      if (this.mode === 'orbit') {
        this.apply();
        pivot = this.focusPoint()?.clone() ?? cam.position.clone().addScaledVector(this.forward(), this.dist);
        r = cam.position.distanceTo(pivot);
      }
      this.yaw -= dx * k;
      this.pitch = Math.max(-lim, Math.min(lim, this.pitch - dy * k));
      this.apply();
      if (pivot) { cam.position.copy(pivot).addScaledVector(this.forward(), -r); this.dist = r; }
    } else if (this.mode === 'pan') {
      const perPx = (2 * this.dist * Math.tan((cam.fov * Math.PI) / 360)) / Math.max(1, this.view.canvas.clientHeight);
      cam.updateMatrixWorld();
      const right = this.r.setFromMatrixColumn(cam.matrixWorld, 0), up = this.tmp.setFromMatrixColumn(cam.matrixWorld, 1);
      cam.position.addScaledVector(right, -dx * perPx).addScaledVector(up, dy * perPx);
    } else if (this.mode === 'dolly') {
      this.apply();
      cam.position.addScaledVector(this.forward(), -dy * Math.max(1, this.dist) * FLY.altDollyPerPx);
    }
    this.moved = true;
  }

  private wheel(e: WheelEvent) {
    e.preventDefault();
    if (this.view.player?.active) return;
    const dir = e.deltaY < 0 ? 1 : -1;
    if (this.looking) {
      this.level = Math.min(FLY.speeds.length, Math.max(1, this.level + dir));
      try { localStorage.setItem(STORE, String(this.level)); } catch { /* sem armazenamento */ }
      return;
    }
    const mag = Math.min(3, Math.max(0.25, Math.abs(e.deltaY) / 100));
    const step = Math.min(FLY.wheelMax, Math.max(FLY.wheelMin, this.dist * FLY.wheelFraction)) * mag;
    this.apply();
    this.cam.position.addScaledVector(this.forward(), dir * step);
    this.moved = true;
  }

  private focus() {
    const p = this.focusPoint();
    if (!p) return;
    this.readOrientation();
    this.apply();
    this.cam.position.copy(p).addScaledVector(this.forward(), -FLY.focusDistance);
    this.dist = FLY.focusDistance;
    this.moved = true;
  }

  /** distância até o chão no centro da tela (null = olhando para cima/sem chão) */
  private groundDistance(): number | null {
    const cam = this.cam, f = this.forward();
    if (f.y > -0.02) return null;
    let t = 2;
    for (let i = 0; i < 220 && t < 4000; i++) {
      const x = cam.position.x + f.x * t, y = cam.position.y + f.y * t, z = cam.position.z + f.z * t;
      const h = this.view.sampleHeight(x, -z);
      if (h !== null && y <= h) return t;
      t += Math.max(1.5, t * 0.04);
    }
    return null;
  }

  private update(dt: number) {
    const cam = this.cam, controls = this.view.controls;
    controls.enabled = false; // a câmera é esta; o OrbitControls só continua sendo chamado para o target e o damping não brigarem
    this.apply();
    const want = this.tmp.set(0, 0, 0);
    if (this.looking) {
      const f = this.forward().clone(), r = this.r.set(1, 0, 0).applyEuler(cam.rotation);
      if (this.keys.has('KeyW')) want.add(f);
      if (this.keys.has('KeyS')) want.sub(f);
      if (this.keys.has('KeyD')) want.add(r);
      if (this.keys.has('KeyA')) want.sub(r);
      if (this.keys.has('KeyE')) want.y += 1;
      if (this.keys.has('KeyQ')) want.y -= 1;
      if (want.lengthSq()) want.normalize().multiplyScalar(this.speed * (this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') ? FLY.shift : 1));
    }
    this.vel.lerp(want, 1 - Math.exp(-FLY.ease * dt));
    if (!want.lengthSq() && this.vel.lengthSq() < 1e-3) this.vel.set(0, 0, 0);
    if (this.vel.lengthSq()) { cam.position.addScaledVector(this.vel, dt); this.moved = true; }
    if (this.moved) {
      const g = this.mode === 'orbit' ? null : this.groundDistance();
      if (g !== null) this.dist = Math.min(2000, Math.max(5, g));
      this.moved = false;
    }
    // o "alvo" do OrbitControls fica à frente da câmera: streaming dos tiles, HUD e botões "aqui" leem controls.target
    controls.target.copy(cam.position).addScaledVector(this.forward(), this.dist);
  }
}
