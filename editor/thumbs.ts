import { AmbientLight, Box3, DirectionalLight, LinearSRGBColorSpace, PerspectiveCamera, Scene, Vector3, WebGLRenderer } from 'three';
import type { PropLayer } from '../shared/props';

/**
 * Miniaturas dos .glb extras: um renderizador pequeno à parte (128 px) desenha cada modelo uma vez, em fila, e guarda o resultado
 * como imagem (data URL). Não mexe no mundo nem no renderizador principal.
 */
export class Thumbs {
  private renderer = new WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  private scene = new Scene();
  private cam = new PerspectiveCamera(32, 1, 0.01, 100000);
  private cache = new Map<string, Promise<string | null>>();
  private chain: Promise<unknown> = Promise.resolve();

  constructor(private layer: PropLayer, size = 128) {
    this.renderer.outputColorSpace = LinearSRGBColorSpace; // como o mundo (shared/world.ts)
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(size, size, false);
    this.renderer.setClearColor(0x000000, 0);
    this.scene.add(new AmbientLight(0xffffff, 1.4));
    const sun = new DirectionalLight(0xffffff, 1.6);
    sun.position.set(-1, 2, 1.5);
    this.scene.add(sun);
  }

  clear() { this.cache.clear(); }

  get(file: string): Promise<string | null> {
    let p = this.cache.get(file);
    if (!p) {
      p = new Promise<string | null>((res) => { this.chain = this.chain.then(() => this.make(file).then(res, () => res(null))); });
      this.cache.set(file, p);
    }
    return p;
  }

  private async make(file: string): Promise<string | null> {
    const t = await this.layer.preview(file);
    if (!t) return null;
    this.scene.add(t.obj);
    try {
      const box = new Box3().setFromObject(t.obj);
      const center = box.getCenter(new Vector3());
      const radius = Math.max(box.getSize(new Vector3()).length() / 2, 0.001);
      const dist = (radius / Math.sin((this.cam.fov * Math.PI) / 360)) * 1.02;
      this.cam.position.copy(center).add(new Vector3(0.7, 0.35, 1).normalize().multiplyScalar(dist));
      this.cam.near = dist / 100;
      this.cam.far = dist * 10;
      this.cam.updateProjectionMatrix();
      this.cam.lookAt(center);
      this.renderer.render(this.scene, this.cam);
      return this.renderer.domElement.toDataURL('image/png');
    } finally {
      this.scene.remove(t.obj);
    }
  }
}
