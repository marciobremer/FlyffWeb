import { BufferAttribute, BufferGeometry, LineBasicMaterial, LineSegments } from 'three';
import type { WorldView } from '../shared/world';

/**
 * Chuva: o servidor (servers/world/events.ts) diz se está chovendo no mapa do jogador (mensagem `weather`). Aqui são riscos
 * que caem numa caixa em volta da câmera (acompanham o jogador) — sem textura, barato — e o aviso no chat.
 */
const DROPS = 1800, BOX = 90, HEIGHT = 60, FALL = 70, LEN = 2.4;

export class Rain {
  private geo = new BufferGeometry();
  private pos = new Float32Array(DROPS * 6);
  private mesh: LineSegments;
  private on = false;
  /** quanto da chuva já apareceu (0–1): entra e sai devagar */
  private level = 0;

  constructor(private view: WorldView) {
    for (let i = 0; i < DROPS; i++) {
      const x = (Math.random() - 0.5) * BOX, y = (Math.random() - 0.5) * HEIGHT, z = (Math.random() - 0.5) * BOX;
      this.pos.set([x, y, z, x - 0.25, y - LEN, z], i * 6);
    }
    this.geo.setAttribute('position', new BufferAttribute(this.pos, 3));
    const mat = new LineBasicMaterial({ color: 0xaec4e8, transparent: true, opacity: 0, depthWrite: false });
    this.mesh = new LineSegments(this.geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.mesh.renderOrder = 20;
    view.scene.add(this.mesh);
    const prev = view.onFrame;
    view.onFrame = (dt) => { prev(dt); this.update(dt); };
  }

  get raining() { return this.on; }
  set(on: boolean) { this.on = on; }

  private update(dt: number) {
    this.level = Math.max(0, Math.min(1, this.level + (this.on ? dt : -dt) / 4));
    this.mesh.visible = this.level > 0;
    if (!this.mesh.visible) return;
    (this.mesh.material as LineBasicMaterial).opacity = 0.55 * this.level;
    const cam = this.view.camera.position, p = this.pos, fall = FALL * dt;
    this.mesh.position.set(cam.x, cam.y - HEIGHT / 2, cam.z);
    for (let i = 0; i < DROPS; i++) {
      const o = i * 6;
      p[o + 1] -= fall; p[o + 4] -= fall;
      if (p[o + 4] < -HEIGHT / 2 - LEN) { // saiu por baixo: volta ao alto
        const x = (Math.random() - 0.5) * BOX, z = (Math.random() - 0.5) * BOX, y = HEIGHT / 2 + Math.random() * 6;
        p[o] = x; p[o + 1] = y; p[o + 2] = z; p[o + 3] = x - 0.25; p[o + 4] = y - LEN; p[o + 5] = z;
      }
    }
    this.geo.attributes.position.needsUpdate = true;
  }
}
