import { BufferAttribute, BufferGeometry, Group, Mesh, MeshBasicMaterial } from 'three';
import type { WorldView } from '../shared/world';

/**
 * Botão "colisões" da barra: desenha como wireframe as MESMAS malhas contra as quais o personagem colide (objetos do mapa com
 * m_collObj e props .glb com colisão ligada), lidas de CollisionWorld — sem copiar os triângulos (a geometria usa o mesmo array).
 * Fica dentro de `root` (o grupo espelhado em z), porque os triângulos estão em coordenadas FlyFF.
 */
const CHECK_MS = 400;
const mapMat = new MeshBasicMaterial({ color: 0xe8f4ff, wireframe: true, transparent: true, opacity: 0.85 });
const propMat = new MeshBasicMaterial({ color: 0xffb454, wireframe: true, transparent: true, opacity: 0.9 });

export class CollisionView {
  private group = new Group();
  private meshes = new Map<string, { tris: Float32Array; mesh: Mesh }>();
  private on = false;
  private last = 0;

  constructor(private view: WorldView) {
    this.group.renderOrder = 15;
  }

  get enabled() { return this.on; }
  get triangles() { let n = 0; for (const { tris } of this.meshes.values()) n += tris.length / 9; return n; }

  set(on: boolean) {
    if (on === this.on) return;
    this.on = on;
    if (on) { this.view.root.add(this.group); this.sync(); } else { this.view.root.remove(this.group); this.clear(); }
    this.view.invalidate();
  }

  /** chamar a cada quadro: refaz só os tiles/props cuja colisão foi trocada (ex.: um objeto movido) */
  update() {
    if (!this.on) return;
    const now = performance.now();
    if (now - this.last < CHECK_MS) return;
    this.last = now;
    this.sync();
  }

  private sync() {
    const seen = new Set<string>();
    for (const [key, tris] of this.view.collision.entries()) {
      seen.add(key);
      const cur = this.meshes.get(key);
      if (cur?.tris === tris) continue;
      if (cur) this.drop(key);
      if (tris.length < 9) continue;
      const g = new BufferGeometry();
      g.setAttribute('position', new BufferAttribute(tris, 3));
      g.computeBoundingSphere();
      const mesh = new Mesh(g, key.startsWith('x:') ? propMat : mapMat);
      mesh.frustumCulled = true;
      this.group.add(mesh);
      this.meshes.set(key, { tris, mesh });
      this.view.invalidate();
    }
    for (const key of [...this.meshes.keys()]) if (!seen.has(key)) { this.drop(key); this.view.invalidate(); }
  }

  private drop(key: string) {
    const m = this.meshes.get(key);
    if (!m) return;
    this.group.remove(m.mesh);
    m.mesh.geometry.dispose(); // só a geometria nossa; o array de triângulos continua da colisão
    this.meshes.delete(key);
  }

  private clear() { for (const key of [...this.meshes.keys()]) this.drop(key); }
}
