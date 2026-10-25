import { Matrix4, Object3D, Quaternion, Vector3, type Camera, type PerspectiveCamera, type Scene } from 'three';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { WorldView } from '../shared/world';
import { OT, type WorldObject } from '../shared/formats/types';
import { objectMatrix } from '../shared/math';
import { applyNpcEdits, cleanEdits, emptyEdits, type WithSrc, type WorldEdits } from '../shared/worldedits';

/**
 * Edição de NPCs do .dyo: clicar num NPC o seleciona (gizmo para mover/girar), apagar, adicionar (um personagem do
 * character.inc na posição da câmera), duplicar, "ao chão" e desfazer. Nada é gravado nos arquivos originais: ao salvar, a
 * diferença para o .dyo vai para `data/world-edits/<Mundo>.json` (ver shared/worldedits.ts) pela API do servidor.
 */
type Pose = { pos: [number, number, number]; rotY: number };
type Action =
  | { kind: 'move'; obj: WithSrc; before: Pose; after: Pose }
  | { kind: 'delete'; obj: WithSrc; index: number }
  | { kind: 'add'; obj: WithSrc };

const flip = new Matrix4().makeScale(1, 1, -1);
const pose = (o: WorldObject): Pose => ({ pos: [o.pos[0], o.pos[1], o.pos[2]], rotY: o.rot[1] });

export class NpcEditor {
  enabled = false;
  private tc: TransformControls;
  private proxy = new Object3D();
  selected: WithSrc | null = null;
  private undoStack: Action[] = [];
  private dragBefore: Pose | null = null;
  /** edições que já estão salvas no servidor */
  saved: WorldEdits = emptyEdits('');
  onChange: () => void = () => {};

  constructor(private view: WorldView, scene: Scene, camera: PerspectiveCamera | Camera, dom: HTMLElement, private orbit: OrbitControls) {
    this.tc = new TransformControls(camera, dom);
    this.tc.setSpace('world');
    scene.add(this.proxy, this.tc.getHelper());
    this.tc.getHelper().visible = false;
    this.tc.addEventListener('dragging-changed', (e) => { this.orbit.enabled = !(e as unknown as { value: boolean }).value; });
    this.tc.addEventListener('mouseDown', () => { this.dragBefore = this.selected ? pose(this.selected) : null; });
    this.tc.addEventListener('objectChange', () => this.applyProxy());
    this.tc.addEventListener('mouseUp', () => this.commitDrag());
    this.setMode('translate');
  }

  get dragging() { return this.tc.dragging; }
  get hoveringGizmo() { return this.tc.axis !== null; }
  private get data() { return this.view.data!; }

  /** mundo carregado: guarda o que já está salvo e limpa o histórico */
  reset() {
    this.saved = this.data.edits;
    this.undoStack = [];
    this.deselect();
  }

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
  select(obj: WithSrc) {
    this.selected = obj;
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

  /** NPC (do .dyo ou novo) sob o clique, se houver */
  pick(ev: { clientX: number; clientY: number }): WithSrc | null {
    const inst = this.view.moverAt(ev);
    return inst && inst.owner === 'movers' ? (inst.source as WithSrc) : null;
  }

  // ---------- transformação ----------
  private syncProxy() {
    const o = this.selected;
    if (!o) return;
    flip.clone().multiply(objectMatrix({ pos: o.pos, rot: o.rot, scale: [1, 1, 1] }, new Matrix4())).decompose(this.proxy.position, this.proxy.quaternion, this.proxy.scale);
    this.proxy.updateMatrix();
  }

  private applyProxy() {
    const o = this.selected;
    if (!o) return;
    this.proxy.updateMatrix();
    const local = flip.clone().multiply(this.proxy.matrix);
    const p = new Vector3(), q = new Quaternion(), s = new Vector3();
    local.decompose(p, q, s);
    o.pos = [p.x, p.y, p.z];
    if (this.tc.mode === 'rotate') { const e = local.elements; o.rot = [o.rot[0], (-Math.atan2(-e[2], e[0]) * 180) / Math.PI, o.rot[2]]; }
    this.moveInstance(o);
    this.onChange();
  }

  private commitDrag() {
    const o = this.selected;
    if (!o || !this.dragBefore) return;
    this.undoStack.push({ kind: 'move', obj: o, before: this.dragBefore, after: pose(o) });
    this.dragBefore = null;
    this.onChange();
  }

  /** o modelo na tela acompanha o objeto */
  private moveInstance(o: WithSrc) {
    this.view.moverMgr.instanceFor(o)?.place([o.pos[0], o.pos[1], o.pos[2]], o.rot[1]);
    this.view.invalidate();
  }

  // ---------- operações ----------
  snapToGround() {
    const o = this.selected;
    if (!o) return;
    const h = this.view.sampleHeight(o.pos[0], o.pos[2]);
    if (h === null) return;
    const before = pose(o);
    o.pos = [o.pos[0], h, o.pos[2]];
    this.undoStack.push({ kind: 'move', obj: o, before, after: pose(o) });
    this.moveInstance(o);
    this.syncProxy();
    this.onChange();
  }

  deleteSelected() {
    const o = this.selected;
    if (!o) return;
    const list = this.data.movers as WithSrc[];
    const index = list.indexOf(o);
    if (index < 0) return;
    list.splice(index, 1);
    this.undoStack.push({ kind: 'delete', obj: o, index });
    this.deselect();
    this.refresh();
  }

  /** cópia ao lado do selecionado (NPC novo com o mesmo personagem) */
  duplicateSelected() {
    const o = this.selected;
    if (!o) return;
    this.addNpc({ ...o, pos: [o.pos[0] + 2, o.pos[1], o.pos[2] + 2], rot: [...o.rot], scale: [...o.scale], src: -1 });
  }

  /** NPC novo: personagem do character.inc na posição indicada (no chão) */
  addCharacter(key: string, x: number, z: number) {
    const d = this.data;
    const def = d.characters.get(key.toLowerCase());
    if (!def) return false;
    const entry = [...d.dynaModels.values()].find((e) => e.type === OT.MOVER && e.name === (def.sex ?? 'male'));
    if (!entry) return false;
    const y = this.view.sampleHeight(x, z) ?? 100;
    this.addNpc({ type: OT.MOVER, modelId: entry.id, pos: [x, y, z], rot: [0, 0, 0], scale: [1, 1, 1], motion: 0, ai: 0, ai2: 0, characterKey: key, name: def.name, src: -1 });
    return true;
  }

  private addNpc(o: WithSrc) {
    (this.data.movers as WithSrc[]).push(o);
    this.undoStack.push({ kind: 'add', obj: o });
    this.refresh();
    this.select(o);
  }

  undo() {
    const a = this.undoStack.pop();
    if (!a) return;
    const list = this.data.movers as WithSrc[];
    if (a.kind === 'move') {
      a.obj.pos = [...a.before.pos]; a.obj.rot = [a.obj.rot[0], a.before.rotY, a.obj.rot[2]];
      this.moveInstance(a.obj);
      if (this.selected === a.obj) this.syncProxy();
    } else if (a.kind === 'delete') {
      list.splice(Math.min(a.index, list.length), 0, a.obj);
      this.refresh();
    } else {
      const i = list.indexOf(a.obj);
      if (i >= 0) list.splice(i, 1);
      if (this.selected === a.obj) this.deselect();
      this.refresh();
    }
    this.onChange();
  }

  /** a lista de NPCs mudou (novo/apagado): refaz os candidatos e os marcadores */
  private refresh() {
    this.view.reloadNpcs();
    this.onListChanged();
  }
  onListChanged: () => void = () => {};

  // ---------- o que mudou em relação ao salvo ----------
  /** edições dos NPCs: diferença entre a lista atual e o .dyo original */
  buildNpcEdits(): WorldEdits['npcs'] {
    const d = this.data, orig = d.moversOriginal;
    const out: WorldEdits['npcs'] = { moved: {}, removed: [], added: [] };
    const seen = new Set<number>();
    for (const o of d.movers as WithSrc[]) {
      if (o.src !== undefined && o.src >= 0) {
        seen.add(o.src);
        const b = orig[o.src];
        if (o.pos.some((v, i) => Math.abs(v - b.pos[i]) > 1e-3) || Math.abs(o.rot[1] - b.rot[1]) > 1e-3) out.moved[String(o.src)] = { pos: [o.pos[0], o.pos[1], o.pos[2]], rot: o.rot[1] };
      } else out.added.push({ type: o.type, modelId: o.modelId, characterKey: o.characterKey, name: o.name, pos: [o.pos[0], o.pos[1], o.pos[2]], rot: [o.rot[0], o.rot[1], o.rot[2]], scale: [o.scale[0], o.scale[1], o.scale[2]] });
    }
    orig.forEach((_, i) => { if (!seen.has(i)) out.removed.push(i); });
    return out;
  }

  /** quantidades para o painel: movidos · novos · apagados (em relação ao salvo no servidor) */
  stats() {
    const n = cleanEdits({ npcs: this.buildNpcEdits() }, '').npcs;
    return { moved: Object.keys(n.moved).length, added: n.added.length, removed: n.removed.length, dirty: JSON.stringify(n) !== JSON.stringify(this.saved.npcs) };
  }

  /** volta ao que está salvo (descarta o que não foi salvo) */
  revertToSaved() {
    const d = this.data;
    d.movers = applyNpcEdits(d.moversOriginal, this.saved.npcs);
    this.undoStack = [];
    this.deselect();
    this.refresh();
  }
}
