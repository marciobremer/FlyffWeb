import { Group, Mesh, type Object3D } from 'three';
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import type { WorldView } from '../shared/world';
import { OT } from '../shared/formats/types';

/**
 * Itens no chão (drops dos mobs; quem decide é o servidor — server/drops.ts e server/realtime.ts):
 * modelo do item (`Item_<nome>.o3d` do mdlDyna; penya = II_GOLD_SEED1–4) deitado no terreno, com o nome flutuando
 * (penya em dourado). Clicar no item ou no nome: o personagem anda até ele e pede ao servidor para pegar.
 */
export type GroundRow = [id: number, itemId: number, x: number, z: number, n: number, gold: number, upgrade: number, name: string];

interface Item { id: number; group: Group; label: CSS2DObject; x: number; z: number; gone: boolean }

const PICK_DIST = 1.4;

export class GroundItems {
  private items = new Map<number, Item>();
  private root = new Group();
  /** item que o personagem está indo pegar */
  private going: number | null = null;
  private nextMove = 0;
  /** manda o pedido de pegar ao servidor */
  sendPick: (id: number) => void = () => {};
  /** começou a ir pegar algo (o jogo para o ataque) */
  onGo: () => void = () => {};

  constructor(private view: WorldView) {
    view.playerGroup.add(this.root);
  }

  add(rows: GroundRow[]) {
    for (const [id, itemId, x, z, n, gold, upgrade, name] of rows) {
      this.remove(id);
      const y = this.view.sampleHeight(x, z) ?? 100;
      const group = new Group();
      group.position.set(x, y, z);
      group.rotation.y = Math.random() * Math.PI * 2;
      group.userData.groundItem = id;
      const el = document.createElement('div');
      el.className = `ground-label${gold ? ' gold' : ''}`;
      el.textContent = gold ? `${gold.toLocaleString('pt-BR')} Penya` : `${name || 'Item'}${upgrade ? ` +${upgrade}` : ''}${n > 1 ? ` (${n})` : ''}`;
      el.title = 'Clique para pegar';
      el.addEventListener('pointerdown', (e) => { e.stopPropagation(); });
      el.addEventListener('click', (e) => { e.stopPropagation(); this.go(id); });
      const label = new CSS2DObject(el);
      label.position.set(x, y + 0.6, z);
      const it: Item = { id, group, label, x, z, gone: false };
      this.items.set(id, it);
      this.root.add(group, label);
      void this.loadModel(itemId, group, it);
    }
  }

  private async loadModel(itemId: number, group: Group, it: Item) {
    const d = this.view.data;
    const entry = d?.dynaModels.get(`${OT.ITEM}:${itemId}`);
    if (!entry) return;
    const model = await this.view.lib.get(entry);
    if (!model || it.gone) return;
    for (const p of model.parts) {
      if (p.light) continue;
      const mesh = new Mesh(p.geometry, p.materials.length > 1 ? p.materials : p.materials[0]);
      mesh.castShadow = true;
      mesh.userData.groundItem = it.id;
      group.add(mesh);
    }
    const s = entry.scale || 1;
    group.scale.setScalar(s);
  }

  remove(id: number) {
    const it = this.items.get(id);
    if (!it) return;
    it.gone = true;
    it.group.removeFromParent();
    it.label.removeFromParent();
    it.label.element.remove();
    this.items.delete(id);
    if (this.going === id) this.going = null;
  }

  clear() { for (const id of [...this.items.keys()]) this.remove(id); }

  /** malha de item no chão sob o clique? (raio do WorldView) */
  pick(objects: Object3D[]): number | null {
    for (const o of objects) { let p: Object3D | null = o; while (p) { if (typeof p.userData.groundItem === 'number') return p.userData.groundItem; p = p.parent; } }
    return null;
  }

  /** malhas dos itens (para o raio do clique) */
  meshes() { const out: Object3D[] = []; this.root.traverse((o) => { if (o instanceof Mesh) out.push(o); }); return out; }

  /** andar até o item e pegar */
  go(id: number) {
    if (!this.items.has(id) || this.view.player?.dead) return;
    this.going = id;
    this.nextMove = 0;
    this.onGo();
  }

  cancel() { this.going = null; }

  frame(now: number) {
    const id = this.going, p = this.view.player;
    if (id === null || !p?.active) return;
    const it = this.items.get(id);
    if (!it || p.dead || this.view.moveKeysDown()) { this.going = null; return; }
    const dist = Math.hypot(it.x - p.pos[0], it.z - p.pos[2]);
    if (dist > PICK_DIST) { if (now >= this.nextMove) { p.moveTo(it.x, it.z); this.nextMove = now + 250; } return; }
    p.stop();
    this.going = null;
    this.sendPick(id);
  }
}
