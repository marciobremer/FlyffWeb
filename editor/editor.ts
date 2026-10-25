import { Group, InstancedMesh, Matrix4, Object3D, Quaternion, Vector3, type Camera, type PerspectiveCamera, type Scene } from 'three';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { Landscape } from '../shared/formats/lnd';
import { OT, type WorldObject } from '../shared/formats/types';
import { objectMatrix } from '../shared/math';

/**
 * Modo edição de mundo (MVP): seleciona objetos estáticos dos tiles, move/gira (Y)/escala, apaga, duplica, desfaz, e exporta as
 * alterações em JSON. A gravação de volta nos .lnd é um próximo passo (ver NEXT_STEPS.md).
 */
export interface EditableTile { x: number; y: number; land: Landscape; pickables: InstancedMesh[] }

export interface EditContext {
  scene: Scene;
  camera: PerspectiveCamera | Camera;
  dom: HTMLElement;
  orbit: OrbitControls;
  root: Group;
  tiles: Map<string, EditableTile>;
  /** reconstrói os meshes dos objetos do tile (após duplicar/apagar) */
  rebuild(tile: EditableTile): void;
  sampleHeight(x: number, z: number): number | null;
  say(msg: string): void;
}

type Snap = { pos: [number, number, number]; rot: [number, number, number]; scale: [number, number, number] };
const snap = (o: WorldObject): Snap => ({ pos: [...o.pos], rot: [...o.rot], scale: [...o.scale] });

type Action =
  | { kind: 'transform'; tile: EditableTile; obj: WorldObject; before: Snap; after: Snap }
  | { kind: 'delete'; tile: EditableTile; obj: WorldObject; wasAdded: boolean }
  | { kind: 'add'; tile: EditableTile; obj: WorldObject };

const flip = new Matrix4().makeScale(1, 1, -1);

export class WorldEditor {
  enabled = false;
  private tc: TransformControls;
  private proxy = new Object3D();
  private selected: { tile: EditableTile; obj: WorldObject } | null = null;
  private undoStack: Action[] = [];
  private original = new WeakMap<WorldObject, Snap>();
  private added = new Set<WorldObject>();
  private deleted = new Set<WorldObject>();
  private onChange: () => void = () => {};

  constructor(private ctx: EditContext) {
    this.tc = new TransformControls(ctx.camera, ctx.dom);
    this.tc.setSpace('world');
    ctx.scene.add(this.proxy, this.tc.getHelper());
    this.tc.getHelper().visible = false;
    this.tc.addEventListener('dragging-changed', (e) => { ctx.orbit.enabled = !(e as unknown as { value: boolean }).value; });
    this.tc.addEventListener('mouseDown', () => { this.dragBefore = this.selected ? snap(this.selected.obj) : null; });
    this.tc.addEventListener('objectChange', () => this.applyProxy());
    this.tc.addEventListener('mouseUp', () => this.commitDrag());
  }

  private dragBefore: Snap | null = null;

  setOnChange(fn: () => void) { this.onChange = fn; }
  get dragging() { return this.tc.dragging; }
  /** o ponteiro está sobre o gizmo? (evita selecionar outro objeto ao clicar numa alça) */
  get hoveringGizmo() { return this.tc.axis !== null; }
  get hasSelection() { return !!this.selected; }
  get stats() { return { modified: this.countModified(), added: this.added.size, deleted: this.deleted.size, undo: this.undoStack.length }; }

  setEnabled(on: boolean) {
    this.enabled = on;
    if (!on) this.deselect();
    this.ctx.say(on ? 'Modo edição: clique em um objeto para selecionar.' : 'Modo edição desligado.');
  }

  setMode(mode: 'translate' | 'rotate' | 'scale') {
    this.tc.setMode(mode);
    // rotação só em Y (yaw) para manter a convenção YPR do FlyFF; escala uniforme
    this.tc.showX = mode !== 'rotate';
    this.tc.showZ = mode !== 'rotate';
    this.tc.showY = true;
  }

  // ------------------------------------------------------------ seleção
  select(tile: EditableTile, obj: WorldObject) {
    this.selected = { tile, obj };
    this.syncProxy();
    this.tc.attach(this.proxy);
    this.tc.getHelper().visible = true;
    this.onChange();
  }

  deselect() {
    this.selected = null;
    this.tc.detach();
    this.tc.getHelper().visible = false;
    this.onChange();
  }

  /** objeto (WorldObject) correspondente a uma instância de um mesh de tile, se for editável */
  findHit(mesh: InstancedMesh, instanceId: number): { tile: EditableTile; obj: WorldObject } | null {
    const info = mesh.userData.pick as { objects: WorldObject[]; tile?: string; kind: string } | undefined;
    if (!info || info.kind !== 'Objeto' || !info.tile) return null;
    const tile = this.ctx.tiles.get(info.tile);
    const obj = info.objects[instanceId];
    return tile && obj ? { tile, obj } : null;
  }

  // ------------------------------------------------------------ transformação
  private syncProxy() {
    if (!this.selected) return;
    const world = flip.clone().multiply(objectMatrix(this.selected.obj, new Matrix4()));
    world.decompose(this.proxy.position, this.proxy.quaternion, this.proxy.scale);
    this.proxy.updateMatrix();
  }

  private applyProxy() {
    const sel = this.selected;
    if (!sel) return;
    const o = sel.obj;
    this.proxy.updateMatrix();
    const local = flip.clone().multiply(this.proxy.matrix); // espaço FlyFF (coluna)
    const p = new Vector3(), q = new Quaternion(), s = new Vector3();
    local.decompose(p, q, s);
    if (!this.original.has(o)) this.original.set(o, snap(o));
    o.pos = [p.x, p.y, p.z];
    // escala uniforme (média) — o ATools edita escala por eixo, mas o jogo usa uniforme na prática
    const u = (s.x + s.y + s.z) / 3;
    o.scale = this.tc.mode === 'scale' ? [u, u, u] : o.scale;
    if (this.tc.mode === 'rotate') {
      // yaw a partir da matriz: M = S·Ry(-rotY) (coluna): e[0] = cos(yaw), e[2] = -sin(yaw)
      const e = local.elements;
      const yaw = Math.atan2(-e[2], e[0]);
      o.rot = [o.rot[0], (-yaw * 180) / Math.PI, o.rot[2]];
    }
    this.refreshInstance(sel.tile, o);
    this.onChange();
  }

  private commitDrag() {
    const sel = this.selected;
    if (!sel || !this.dragBefore) return;
    this.undoStack.push({ kind: 'transform', tile: sel.tile, obj: sel.obj, before: this.dragBefore, after: snap(sel.obj) });
    this.dragBefore = null;
    this.onChange();
  }

  /** atualiza a matriz da instância em todos os meshes (partes) que representam este objeto */
  refreshInstance(tile: EditableTile, obj: WorldObject) {
    const m = new Matrix4();
    for (const mesh of tile.pickables) {
      const info = mesh.userData.pick as { objects: WorldObject[] } | undefined;
      const i = info ? info.objects.indexOf(obj) : -1;
      if (i < 0) continue;
      mesh.setMatrixAt(i, objectMatrix(obj, m));
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
    }
  }

  // ------------------------------------------------------------ operações
  snapToGround() {
    const sel = this.selected;
    if (!sel) return;
    const h = this.ctx.sampleHeight(sel.obj.pos[0], sel.obj.pos[2]);
    if (h === null) return;
    const before = snap(sel.obj);
    if (!this.original.has(sel.obj)) this.original.set(sel.obj, before);
    sel.obj.pos[1] = h;
    this.refreshInstance(sel.tile, sel.obj);
    this.undoStack.push({ kind: 'transform', tile: sel.tile, obj: sel.obj, before, after: snap(sel.obj) });
    this.syncProxy();
    this.onChange();
  }

  deleteSelected() {
    const sel = this.selected;
    if (!sel) return;
    const arr = sel.tile.land.objects;
    const i = arr.indexOf(sel.obj);
    if (i >= 0) arr.splice(i, 1);
    const wasAdded = this.added.has(sel.obj);
    if (wasAdded) this.added.delete(sel.obj); else this.deleted.add(sel.obj);
    this.undoStack.push({ kind: 'delete', tile: sel.tile, obj: sel.obj, wasAdded });
    this.deselect();
    this.ctx.rebuild(sel.tile);
  }

  duplicateSelected() {
    const sel = this.selected;
    if (!sel) return;
    const copy: WorldObject = { ...sel.obj, pos: [sel.obj.pos[0] + 6, sel.obj.pos[1], sel.obj.pos[2] + 6], rot: [...sel.obj.rot], scale: [...sel.obj.scale] };
    delete (copy as { src?: number }).src;
    sel.tile.land.objects.push(copy);
    this.added.add(copy);
    this.undoStack.push({ kind: 'add', tile: sel.tile, obj: copy });
    this.ctx.rebuild(sel.tile);
    this.select(sel.tile, copy);
  }

  undo() {
    const a = this.undoStack.pop();
    if (!a) return;
    if (a.kind === 'transform') {
      a.obj.pos = [...a.before.pos]; a.obj.rot = [...a.before.rot]; a.obj.scale = [...a.before.scale];
      this.refreshInstance(a.tile, a.obj);
      if (this.selected?.obj === a.obj) this.syncProxy();
    } else if (a.kind === 'delete') {
      a.tile.land.objects.push(a.obj);
      if (a.wasAdded) this.added.add(a.obj); else this.deleted.delete(a.obj);
      this.ctx.rebuild(a.tile);
    } else {
      const arr = a.tile.land.objects;
      const i = arr.indexOf(a.obj);
      if (i >= 0) arr.splice(i, 1);
      this.added.delete(a.obj);
      if (this.selected?.obj === a.obj) this.deselect();
      this.ctx.rebuild(a.tile);
    }
    this.onChange();
  }

  // ------------------------------------------------------------ exportação das alterações
  private countModified() {
    let n = 0;
    for (const t of this.ctx.tiles.values()) for (const o of t.land.objects) if (this.original.has(o) && !this.added.has(o) && this.differs(o)) n++;
    return n;
  }
  private differs(o: WorldObject) {
    const b = this.original.get(o);
    if (!b) return false;
    return o.pos.some((v, i) => v !== b.pos[i]) || o.rot.some((v, i) => v !== b.rot[i]) || o.scale.some((v, i) => v !== b.scale[i]);
  }

  /** Alterações no formato `flyff-world-edits` v1 (identificam o objeto original por `src` = índice na lista do .lnd). */
  exportEdits(worldName: string) {
    const r = (a: number[]) => a.map((v) => Math.round(v * 1000) / 1000);
    const tiles: Record<string, { x: number; y: number; modified: unknown[]; added: unknown[]; deleted: unknown[] }> = {};
    const get = (t: EditableTile) => (tiles[`${t.x},${t.y}`] ??= { x: t.x, y: t.y, modified: [], added: [], deleted: [] });
    for (const t of this.ctx.tiles.values()) {
      for (const o of t.land.objects) {
        const src = (o as { src?: number }).src;
        if (this.added.has(o)) get(t).added.push({ modelId: o.modelId, type: o.type, pos: r(o.pos), rot: r(o.rot), scale: r(o.scale) });
        else if (this.differs(o)) get(t).modified.push({ src, modelId: o.modelId, pos: r(o.pos), rot: r(o.rot), scale: r(o.scale) });
      }
    }
    for (const o of this.deleted) {
      const src = (o as { src?: number }).src;
      // o tile do objeto apagado: pela posição original
      const orig = this.original.get(o);
      const px = (orig?.pos ?? o.pos)[0], pz = (orig?.pos ?? o.pos)[2];
      const any = [...this.ctx.tiles.values()][0];
      if (!any) continue;
      const t = [...this.ctx.tiles.values()].find((v) => Math.floor(px / 512) === v.x && Math.floor(pz / 512) === v.y) ?? any;
      get(t).deleted.push({ src, modelId: o.modelId });
    }
    return { format: 'flyff-world-edits', version: 1, world: worldName, tiles: Object.values(tiles).filter((t) => t.modified.length || t.added.length || t.deleted.length) };
  }

  /** restringe edição a objetos estáticos (OT_OBJ) */
  static editable(o: WorldObject) { return o.type === OT.OBJ; }
}
