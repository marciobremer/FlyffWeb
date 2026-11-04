import { Euler, Raycaster, Vector2, Vector3, type Object3D, type Camera, type PerspectiveCamera, type Scene } from 'three';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { WorldView } from '../shared/world';
import type { PropNode } from '../shared/props';
import { tuneGizmo } from './gizmo';

const UP = new Vector3(0, 1, 0);
import type { PropEdit } from '../shared/worldedits';

/**
 * Edição de props 3D (.glb de data/res-extra, ex.: objetos exportados do Cruma): clicar seleciona (gizmo mover/girar em Y),
 * escala/altura por número, "ao chão", duplicar, remover e desfazer. Nada vai para os arquivos do FlyFF: ao salvar, a lista vai em
 * `props` do `data/world-edits/<Mundo>.json` (ver shared/worldedits.ts) e o jogo desenha por cima do mundo.
 */
export class PropEditor {
  enabled = false;
  selected: PropNode | null = null;
  /** escala usada ao adicionar (o .glb do L2 vem em unidades do L2: um objeto de 800 vira ~8 com 0.01) */
  defaultScale = 0.01;
  onChange: () => void = () => {};
  private tc: TransformControls;
  private undoStack: string[] = [];
  private savedJson = '[]';
  private dragBefore: string | null = null;
  private ray = new Raycaster();

  constructor(private view: WorldView, scene: Scene, private camera: PerspectiveCamera | Camera, private dom: HTMLElement, private orbit: OrbitControls) {
    this.tc = new TransformControls(camera, dom);
    tuneGizmo(this.tc, camera);
    this.tc.setSpace('world');
    scene.add(this.tc.getHelper());
    this.tc.getHelper().visible = false;
    this.tc.addEventListener('dragging-changed', (e) => { this.orbit.enabled = !(e as unknown as { value: boolean }).value; });
    this.tc.addEventListener('mouseDown', () => { this.dragBefore = this.snapshot(); });
    this.tc.addEventListener('objectChange', () => {
      if (!this.selected) return;
      // só gira em Y: tira o yaw do quaternion em ordem YXZ (zerar x/z do Euler XYZ virava o objeto de cabeça para baixo passando de 90°)
      if (this.tc.mode === 'rotate') this.selected.quaternion.setFromAxisAngle(UP, new Euler().setFromQuaternion(this.selected.quaternion, 'YXZ').y);
      this.selected.scale.setScalar(this.selected.userData.prop.scale);
      this.view.props.sync(this.selected);
      this.onChange();
    });
    this.tc.addEventListener('mouseUp', () => {
      if (this.dragBefore !== null && this.dragBefore !== this.snapshot()) this.undoStack.push(this.dragBefore);
      this.dragBefore = null;
      this.view.props.changed(); // a colisão acompanha o prop depois de arrastar
      this.onChange();
    });
    this.setMode('translate');
  }

  get dragging() { return this.tc.dragging; }
  /** posição do prop selecionado, para a tecla F da câmera */
  get focusPoint(): Vector3 | null { return this.selected ? this.selected.getWorldPosition(new Vector3()) : null; }
  get hoveringGizmo() { return this.tc.axis !== null; }
  get count() { return this.view.props.nodes.length; }
  get dirty() { return this.snapshot() !== this.savedJson; }

  private snapshot() { return JSON.stringify(this.view.props.edits()); }
  private push() { this.undoStack.push(this.snapshot()); if (this.undoStack.length > 100) this.undoStack.shift(); }

  /** mundo carregado: o que veio do servidor é o "salvo" */
  reset() {
    this.savedJson = this.snapshot();
    this.undoStack = [];
    this.deselect();
  }

  markSaved() { this.savedJson = this.snapshot(); this.onChange(); }

  setEnabled(on: boolean) {
    this.enabled = on;
    if (!on) this.deselect();
    this.onChange();
  }

  setMode(mode: 'translate' | 'rotate') {
    this.tc.setMode(mode);
    this.tc.showX = mode !== 'rotate';
    this.tc.showZ = mode !== 'rotate';
    this.tc.showY = true;
  }

  // ---------- seleção ----------
  select(n: PropNode) {
    this.selected = n;
    this.tc.attach(n);
    this.tc.getHelper().visible = true;
    this.onChange();
  }

  deselect() {
    this.selected = null;
    this.tc.detach();
    this.tc.getHelper().visible = false;
    this.onChange();
  }

  /** prop sob o ponteiro */
  pick(ev: { clientX: number; clientY: number }): PropNode | null {
    const r = this.dom.getBoundingClientRect();
    this.ray.setFromCamera(new Vector2(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1), this.camera);
    const hit = this.ray.intersectObjects(this.view.props.nodes, true)[0];
    let o: Object3D | null = hit ? hit.object : null;
    while (o) {
      if (o.parent === this.view.props.group) return o as PropNode;
      o = o.parent;
    }
    return null;
  }

  /** ponto do mundo sob o ponteiro (x, z FlyFF), ou null se o ponteiro não está sobre o mapa */
  groundAt(ev: { clientX: number; clientY: number }): [number, number] | null {
    const r = this.dom.getBoundingClientRect();
    this.ray.setFromCamera(new Vector2(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1), this.camera);
    const hit = this.ray.intersectObjects(this.view.tilesGroup.children, true)[0];
    return hit ? [hit.point.x, -hit.point.z] : null;
  }

  // ---------- edição ----------
  /** adiciona o .glb no chão em (x, z) FlyFF */
  add(file: string, x: number, z: number, atY?: number) {
    this.push();
    const y = atY ?? this.view.sampleHeight(x, z) ?? 0;
    const e: PropEdit = { file, pos: [x, y, z], rotY: 0, scale: this.defaultScale };
    this.select(this.view.props.add(e));
  }

  /** altura final do prop (unidades FlyFF), se o arquivo já carregou */
  heightOf(n: PropNode): number | null { return n.userData.size ? n.userData.size.y * n.userData.prop.scale : null; }

  setScale(scale: number) {
    const n = this.selected;
    if (!n || !(scale > 0)) return;
    this.push();
    n.userData.prop.scale = Math.min(1000, Math.max(0.0001, scale));
    this.defaultScale = n.userData.prop.scale;
    this.view.props.apply(n);
    this.onChange();
  }

  /** define a altura final (unidades FlyFF) a partir do tamanho natural do arquivo */
  setHeight(h: number) {
    const n = this.selected;
    if (!n?.userData.size || !(h > 0) || !(n.userData.size.y > 0)) return;
    this.setScale(h / n.userData.size.y);
  }

  setRotY(deg: number) {
    const n = this.selected;
    if (!n || !Number.isFinite(deg)) return;
    this.push();
    n.userData.prop.rotY = deg;
    this.view.props.apply(n);
    this.onChange();
  }

  setCollide(on: boolean) {
    const n = this.selected;
    if (!n) return;
    this.push();
    if (on) delete n.userData.prop.collide; else n.userData.prop.collide = false;
    this.view.props.changed();
    this.onChange();
  }

  snapToGround() {
    const n = this.selected;
    if (!n) return;
    const h = this.view.sampleHeight(n.userData.prop.pos[0], n.userData.prop.pos[2]);
    if (h === null) return;
    this.push();
    n.userData.prop.pos[1] = h;
    this.view.props.apply(n);
    this.onChange();
  }

  duplicateSelected() {
    const n = this.selected;
    if (!n) return;
    this.push();
    const e = this.view.props.sync(n);
    this.select(this.view.props.add({ ...e, pos: [e.pos[0] + 3, e.pos[1], e.pos[2]] }));
  }

  deleteSelected() {
    const n = this.selected;
    if (!n) return;
    this.push();
    this.deselect();
    this.view.props.remove(n);
    this.onChange();
  }

  undo() {
    const s = this.undoStack.pop();
    if (s === undefined) return;
    this.deselect();
    this.view.props.set(JSON.parse(s) as PropEdit[]);
    this.onChange();
  }

  revertToSaved() {
    this.deselect();
    this.view.props.set(JSON.parse(this.savedJson) as PropEdit[]);
    this.undoStack = [];
    this.onChange();
  }

  /** lista para gravar em `props` das edições do mundo */
  buildEdits(): PropEdit[] { return this.view.props.edits(); }
}
