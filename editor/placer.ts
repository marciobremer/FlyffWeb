import { CylinderGeometry, DoubleSide, Group, Mesh, MeshBasicMaterial, RingGeometry, type Object3D } from 'three';
import type { WorldView } from '../shared/world';
import type { WorldObject } from '../shared/formats/types';
import { OT } from '../shared/formats/types';
import type { LibItem } from './library';

/**
 * Colocar itens da lista no mapa: ao escolher um item ele "gruda" no mouse (um fantasma translúcido segue o chão sob o cursor),
 * clicar no mapa fixa uma cópia e o fantasma continua na mão para colocar outra; escolher outro item troca; Esc, clique direito
 * (sem arrastar) ou a ferramenta Selecionar largam. O botão direito arrastado continua sendo a câmera (flycam.ts).
 * O fantasma é o item de verdade, no tamanho real: props com a malha do .glb, objetos com a malha do .o3d (mesma matriz do mundo) e NPCs
 * com o modelo do próprio MoverManager (humanos vestidos, animados). O marcador (cilindro) só aparece se o modelo não existir.
 */
export interface PlacerDeps {
  /** liga o modo de edição certo para o tipo (objetos, NPCs ou props) e solta a seleção atual */
  enter(kind: LibItem['kind']): void;
  place(item: LibItem, x: number, y: number, z: number): boolean;
  /** o NPC do character.inc (fora da lista do mapa) para o fantasma; null se não há modelo */
  makeNpc(key: string): WorldObject | null;
  /** escala atual dos props (o fantasma usa a mesma) */
  propScale(): number;
  onChange(item: LibItem | null): void;
  say(msg: string): void;
}

const CLICK_PX = 4;
const MOVE_MS = 33;

const markerMat = { npc: new MeshBasicMaterial({ color: 0xffb454, transparent: true, opacity: 0.55, depthWrite: false }), object: new MeshBasicMaterial({ color: 0x59c9d9, transparent: true, opacity: 0.55, depthWrite: false }) };
const ringMat = new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8, depthWrite: false, side: DoubleSide });
const bodyGeo = new CylinderGeometry(0.5, 0.5, 2.2, 16).translate(0, 1.1, 0);
const ringGeo = new RingGeometry(0.9, 1.1, 32).rotateX(-Math.PI / 2).translate(0, 0.05, 0);

export class Placer {
  item: LibItem | null = null;
  private ghost = new Group();
  private seq = 0;
  /** NPC fantasma: candidato do MoverManager com dono 'ghost' (some com removeOwner) */
  private npc: WorldObject | null = null;
  private tip = document.getElementById('cursorTip')!;
  private at: [number, number, number] | null = null;
  private down: { x: number; y: number; button: number } | null = null;
  private last = 0;

  constructor(private view: WorldView, private deps: PlacerDeps) {
    this.ghost.visible = false;
    this.ghost.renderOrder = 30;
    view.scene.add(this.ghost);
    const c = view.canvas;
    addEventListener('pointermove', (e) => this.move(e), true);
    addEventListener('pointerdown', (e) => this.pointerDown(e), true);
    addEventListener('pointerup', (e) => this.pointerUp(e), true);
    addEventListener('keydown', (e) => { if (this.item && e.code === 'Escape') { e.preventDefault(); this.stop(); } }, true);
    addEventListener('blur', () => this.hide());
    c.addEventListener('pointerleave', () => this.hide());
  }

  /** pega este item (troca o que estava na mão); null solta */
  start(item: LibItem | null) {
    if (!item) { this.stop(); return; }
    this.item = item;
    this.deps.enter(item.kind);
    this.clearGhost();
    const mine = ++this.seq;
    void this.build(item, mine);
    this.tip.textContent = item.label;
    this.deps.onChange(item);
    this.deps.say(`${item.label} na mão: clique no mapa para colocar · Esc solta.`);
  }

  stop() {
    if (!this.item) return;
    this.item = null;
    this.seq++;
    this.clearGhost();
    this.hide();
    this.deps.onChange(null);
  }

  // ---------- fantasma ----------
  private clearGhost() {
    // nada a descartar: geometrias e materiais são os mesmos do mundo (o fantasma só os mostra de novo)
    if (this.npc) { this.view.moverMgr.removeOwner('ghost'); this.npc = null; this.view.invalidate(); }
    this.ghost.clear();
    this.ghost.visible = false;
  }

  private async build(item: LibItem, mine: number) {
    let body: Object3D;
    if (item.kind === 'prop') {
      const t = await this.view.props.preview(item.key);
      if (mine !== this.seq) return; // outro item foi escolhido enquanto o .glb carregava
      if (!t) { this.deps.say(`Não consegui ler ${item.key}.`); return; }
      body = t.obj;
      body.scale.multiplyScalar(this.deps.propScale());
    } else if (item.kind === 'object') {
      body = (await this.objectBody(item)) ?? this.marker('object');
      if (mine !== this.seq) return;
    } else {
      const npc = this.startNpc(item);
      if (npc) { this.npc = npc; this.paint(); return; } // o modelo vem do MoverManager, não de um grupo nosso
      body = this.marker('npc');
    }
    if (mine !== this.seq) return;
    this.ghost.add(body);
    this.paint();
  }

  private marker(kind: 'npc' | 'object'): Object3D {
    const g = new Group();
    g.add(new Mesh(bodyGeo, markerMat[kind]), new Mesh(ringGeo, ringMat));
    return g;
  }

  /** o .o3d do objeto no tamanho do mundo: as mesmas partes (geometria e material) que o tile desenha, dentro do espelho em z do mapa */
  private async objectBody(item: LibItem): Promise<Object3D | null> {
    const entry = this.view.data?.objModels.get(Number(item.key));
    if (!entry || entry.modelType === 'MODELTYPE_SFX' || !this.view.lib.exists(entry)) return null;
    const model = await this.view.lib.get(entry);
    if (!model) return null;
    const g = new Group();
    for (const part of model.parts) {
      if (part.light) continue; // partes de luz só aparecem à noite no mundo
      g.add(new Mesh(part.geometry, part.materials.length > 1 ? part.materials : part.materials[0]));
    }
    g.scale.z = -1; // o mundo desenha tudo dentro de um grupo espelhado em z (root.scale.z = -1)
    return g;
  }

  /** registra o NPC como candidato do MoverManager (ele cria o modelo vestido e animado); null se o personagem não tem modelo */
  private startNpc(item: LibItem): WorldObject | null {
    const d = this.view.data, o = this.deps.makeNpc(item.key);
    const entry = d && o ? d.dynaModels.get(`${OT.MOVER}:${o.modelId}`) : undefined;
    if (!o || !entry) return null;
    this.view.moverMgr.candidates.push({ obj: o, entry, index: -1, owner: 'ghost' });
    return o;
  }

  private paint() {
    const at = this.at, npc = this.npc;
    if (!this.item || !at) return;
    if (npc) {
      npc.pos = [at[0], at[1], at[2]];
      const mm = this.view.moverMgr, inst = mm.instanceFor(npc);
      if (inst) inst.place([at[0], at[1], at[2]], 0); else mm.refresh(at[0], at[2]); // ainda sem instância: o MoverManager a cria perto da câmera
      this.view.invalidate();
      return;
    }
    if (!this.ghost.children.length) return;
    this.ghost.position.set(at[0], at[1], -at[2]);
    this.ghost.visible = true;
  }

  private hide() { this.ghost.visible = false; this.tip.hidden = true; this.setNpcVisible(false); }

  private setNpcVisible(on: boolean) {
    const inst = this.npc ? this.view.moverMgr.instanceFor(this.npc) : null;
    if (inst) inst.group.visible = on;
  }

  // ---------- mouse ----------
  private overCanvas(e: Event) { return e.target === this.view.canvas; }

  private move(e: PointerEvent) {
    if (!this.item) return;
    if (!this.overCanvas(e)) { this.hide(); return; }
    this.tip.hidden = false;
    this.tip.style.transform = `translate(${e.clientX + 16}px, ${e.clientY + 18}px)`;
    const now = performance.now();
    if (now - this.last < MOVE_MS) return; // o raio contra o terreno inteiro não precisa rodar a cada evento
    this.last = now;
    this.at = this.view.groundPoint(e);
    if (this.at) { this.paint(); this.setNpcVisible(true); } else { this.ghost.visible = false; this.setNpcVisible(false); }
  }

  private pointerDown(e: PointerEvent) {
    if (!this.item || !this.overCanvas(e)) return;
    if (e.button === 2) { this.down = { x: e.clientX, y: e.clientY, button: 2 }; return; } // a câmera (flycam) trata o arrasto
    if (e.button !== 0 || e.altKey) return;
    // o clique é do posicionamento: o editor não deve selecionar nada nem o gizmo agarrar
    e.stopImmediatePropagation(); e.preventDefault();
    this.down = { x: e.clientX, y: e.clientY, button: 0 };
  }

  private pointerUp(e: PointerEvent) {
    const d = this.down;
    if (!this.item || !d || d.button !== e.button) return;
    this.down = null;
    if (d.button === 0) e.stopImmediatePropagation();
    if (Math.hypot(e.clientX - d.x, e.clientY - d.y) >= CLICK_PX) return;
    if (d.button === 2) { this.stop(); return; }
    const g = this.view.groundPoint(e) ?? this.at;
    if (!g) { this.deps.say('Clique sobre o terreno do mapa.'); return; }
    this.at = g;
    if (this.deps.place(this.item, g[0], g[1], g[2])) this.deps.say(`${this.item.label} colocado. Clique para colocar outro · Esc solta.`);
    this.paint();
  }
}
