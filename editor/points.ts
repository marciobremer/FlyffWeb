import { ConeGeometry, CylinderGeometry, Group, InstancedMesh, Mesh, MeshBasicMaterial, Object3D, Raycaster, RingGeometry, Vector2, type Intersection } from 'three';
import type { TileView, WorldView } from '../shared/world';
import type { MapPoint } from '../shared/worldedits';

/**
 * Ferramenta "Pontos": clica em qualquer lugar do mapa (terreno, objetos, props) e mostra a posição exata (x, y, z FlyFF) para usar
 * como ponto de teleporte. O ponto fica num marcador (cone + haste + anel) que dá para ajustar pelos campos; os pontos salvos
 * (`points` em data/world-edits) aparecem como cones amarelos. O de nome `chegada` é onde se aparece ao entrar no mapa.
 */
export class PointTool {
  enabled = false;
  /** ponto marcado agora (x, y, z FlyFF) */
  current: [number, number, number] | null = null;
  /** chamado quando o ponto marcado muda (clique no mapa ou campos) */
  onChange: () => void = () => {};
  private readonly ray = new Raycaster();
  private readonly marker = new Group();
  private readonly saved = new Group();
  private readonly pickColor = new MeshBasicMaterial({ color: 0x35e0ff, depthTest: false, transparent: true, opacity: 0.95 });
  private readonly savedColor = new MeshBasicMaterial({ color: 0xffd23f, depthTest: false, transparent: true, opacity: 0.9 });
  private readonly arrivalColor = new MeshBasicMaterial({ color: 0x5cff7a, depthTest: false, transparent: true, opacity: 0.95 });

  constructor(private view: WorldView) {
    const cone = new Mesh(new ConeGeometry(0.45, 1.2, 16).rotateX(Math.PI).translate(0, 1.2, 0), this.pickColor);
    const pole = new Mesh(new CylinderGeometry(0.04, 0.04, 6, 6).translate(0, 4.2, 0), this.pickColor);
    const ring = new Mesh(new RingGeometry(0.7, 0.85, 32).rotateX(-Math.PI / 2).translate(0, 0.03, 0), this.pickColor);
    for (const m of [cone, pole, ring]) m.renderOrder = 30;
    this.marker.add(cone, pole, ring);
    this.marker.visible = false;
    view.scene.add(this.marker, this.saved);
  }

  setEnabled(on: boolean) {
    this.enabled = on;
    this.marker.visible = on && !!this.current;
  }

  /** a cena inverte o z em relação ao FlyFF */
  private place(g: Object3D, p: [number, number, number]) { g.position.set(p[0], p[1], -p[2]); }

  set(p: [number, number, number] | null) {
    this.current = p ? [p[0], p[1], p[2]] : null;
    if (p) this.place(this.marker, p);
    this.marker.visible = this.enabled && !!p;
    this.onChange();
  }

  /** marcadores dos pontos salvos do mundo */
  showSaved(points: MapPoint[]) {
    this.saved.clear();
    for (const pt of points) {
      const arrival = pt.name.toLowerCase() === 'chegada';
      const g = new Group();
      const cone = new Mesh(new ConeGeometry(0.4, 1.1, 12).rotateX(Math.PI).translate(0, 1.1, 0), arrival ? this.arrivalColor : this.savedColor);
      cone.renderOrder = 29;
      g.add(cone);
      this.place(g, pt.pos);
      this.saved.add(g);
    }
  }

  private visible(o: Object3D | null) { for (let n = o; n; n = n.parent) if (!n.visible) return false; return true; }

  /** raio do clique contra o terreno, os objetos e os props; devolve a posição FlyFF do primeiro acerto */
  pick(ev: PointerEvent): [number, number, number] | null {
    const r = this.view.canvas.getBoundingClientRect();
    this.ray.setFromCamera(new Vector2(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1), this.view.camera);
    const targets: Object3D[] = [this.view.props.group];
    this.view.tiles.forEach((t: TileView) => { targets.push(t.terrain, t.objGroup); });
    let best: Intersection | undefined;
    for (const h of this.ray.intersectObjects(targets, true)) {
      if (!this.visible(h.object)) continue;
      if (h.object instanceof InstancedMesh && h.instanceId === undefined) continue;
      best = h; break;
    }
    if (!best) return null;
    const p: [number, number, number] = [best.point.x, best.point.y, -best.point.z];
    this.set(p);
    return p;
  }
}
