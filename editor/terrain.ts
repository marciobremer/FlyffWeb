import { BufferAttribute, BufferGeometry, Line, LineBasicMaterial, Mesh, Raycaster, Vector2 } from 'three';
import type { WorldView } from '../shared/world';
import { MAP_SIZE } from '../shared/formats/types';
import { decodeTerrain, encodeTerrain, type WorldEdits } from '../shared/worldedits';

/**
 * Ferramenta Terreno: sobe, desce, nivela ou suaviza uma área do terreno (pequenos reparos).
 *   Montanha / Erosão ... como no ATools: clique no ponto, arraste o mouse para CIMA (sobe o morro) ou para BAIXO (desce) e solte
 *                         para fixar. Montanha só sobe (arrastar para baixo volta ao chão original), Erosão só desce; com Shift
 *                         o arrasto vale nos dois sentidos. O formato do morro é o do pincel (raio) com borda suave.
 *   Plano / Suavizar .... clique e passe o mouse sobre a área (segurando): nivela na altura do primeiro ponto, ou alisa
 *   Ctrl + roda ......... aumenta/diminui o raio do pincel; o botão direito continua sendo a câmera
 *   Ctrl+Z .............. desfaz o último traço
 * As alturas mudam no próprio Landscape (então sampleHeight, a colisão e o personagem já usam o novo chão) e na malha, no lugar.
 * Salvas em `WorldEdits.terrain`, por vértice, e reaplicadas ao carregar o tile (shared/data.ts). Objetos e props NÃO acompanham o chão.
 */
export type Brush = 'raise' | 'lower' | 'smooth' | 'flatten';
export const BRUSH = {
  radiusMin: 2, radiusMax: 150,
  /** montanha/erosão: unidades de altura no centro por pixel de arrasto do mouse (vezes o valor da força) */
  heightPerPx: 0.02,
  /** Ctrl + roda: fator do raio por passo da roda */
  wheelFactor: 1.12,
  /** suavizar/nivelar: velocidade com que a altura se aproxima do alvo (por segundo, vezes a força) */
  blendPerSecond: 0.6,
  /** maior passo de tempo de um quadro (um quadro lento não dá um salto) */
  maxDt: 0.05,
};
const N = MAP_SIZE + 1;
const RING_POINTS = 72;

type Change = { tile: string; idx: number; h: number };

export class TerrainSculpt {
  enabled = false;
  brush: Brush = 'raise';
  radius = 16;
  strength = 8;
  onChange: () => void = () => {};

  /** altura de cada vértice mexido desde o último salvar (para descartar), por tile "x,y" */
  private base = new Map<string, Map<number, number>>();
  private undoStack: { tile: string; idx: number; before: number }[][] = [];
  private stroke: Map<string, { tile: string; idx: number; before: number }> | null = null;
  private pointer: { x: number; y: number } | null = null;
  private shift = false;
  private flat: number | null = null;
  private ray = new Raycaster();
  private ring: Line;
  private lastHit: [number, number, number] | null = null;
  private lastY = 0;
  /** arrasto montanha/erosão em andamento: o centro fica onde o clique caiu e as alturas partem das de antes do clique */
  private drag: { c: [number, number, number]; y0: number; verts: { tile: string; idx: number; h0: number; w: number }[]; last: number } | null = null;
  /** o raio mudou pela roda (o painel atualiza o controle) */
  onRadius: (r: number) => void = () => {};

  constructor(private view: WorldView) {
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(new Float32Array((RING_POINTS + 1) * 3), 3));
    this.ring = new Line(geo, new LineBasicMaterial({ color: 0xffffff, depthTest: false, transparent: true, opacity: 0.9 }));
    this.ring.renderOrder = 40;
    this.ring.frustumCulled = false;
    this.ring.visible = false;
    view.scene.add(this.ring);
    addEventListener('pointerdown', (e) => this.down(e), true);
    addEventListener('pointermove', (e) => { this.shift = e.shiftKey; this.lastY = e.clientY; this.pointer = e.target === view.canvas ? { x: e.clientX, y: e.clientY } : null; }, true);
    addEventListener('wheel', (e) => this.wheel(e), { capture: true, passive: false });
    addEventListener('pointerup', () => this.up(), true);
    addEventListener('blur', () => this.up());
  }

  setEnabled(on: boolean) {
    this.enabled = on;
    if (!on) { this.up(); this.ring.visible = false; }
    this.view.invalidate();
    this.onChange();
  }

  get dirty() {
    const d = this.view.data;
    if (!d) return false;
    for (const [tile, m] of this.base) for (const [idx, was] of m) if (Math.abs((d.terrainDraft.get(tile)?.get(idx) ?? was) - was) > 0.004) return true;
    return false;
  }

  get touched() { let n = 0; for (const m of this.base.values()) n += m.size; return n; }
  get tiles() { return this.base.size; }

  // ---------- entrada ----------
  private down(e: PointerEvent) {
    if (!this.enabled || e.target !== this.view.canvas || e.button !== 0 || e.altKey) return;
    e.stopImmediatePropagation(); e.preventDefault();
    this.shift = e.shiftKey;
    this.pointer = { x: e.clientX, y: e.clientY };
    this.stroke = new Map();
    this.flat = null;
    this.lastY = e.clientY;
    if (this.brush === 'raise' || this.brush === 'lower') this.beginDrag(e.clientY);
  }

  /** Ctrl + roda sobre o mapa: raio do pincel (o zoom do navegador e o da câmera ficam de fora) */
  private wheel(e: WheelEvent) {
    if (!this.enabled || !e.ctrlKey || e.target !== this.view.canvas) return;
    e.preventDefault(); e.stopImmediatePropagation();
    const f = e.deltaY < 0 ? BRUSH.wheelFactor : 1 / BRUSH.wheelFactor;
    this.radius = Math.round(Math.min(BRUSH.radiusMax, Math.max(BRUSH.radiusMin, this.radius * f)) * 10) / 10;
    this.onRadius(this.radius);
  }

  /** guarda os vértices sob o pincel (com o peso de cada um) e as alturas de antes do clique */
  private beginDrag(y: number) {
    const hit = this.pointer ? this.pick(this.pointer) : null;
    const d = this.view.data;
    if (!hit || !d) { this.stroke = null; return; }
    const mpu = d.wld.mpu, s = MAP_SIZE * mpu, r = this.radius, verts: { tile: string; idx: number; h0: number; w: number }[] = [];
    for (let ty = Math.floor((hit[2] - r) / s); ty <= Math.floor((hit[2] + r) / s); ty++) {
      for (let tx = Math.floor((hit[0] - r) / s); tx <= Math.floor((hit[0] + r) / s); tx++) {
        const t = this.view.tiles.get(`${tx},${ty}`);
        if (!t) continue;
        const i0 = Math.max(0, Math.ceil((hit[0] - r) / mpu - tx * MAP_SIZE)), i1 = Math.min(N - 1, Math.floor((hit[0] + r) / mpu - tx * MAP_SIZE));
        const j0 = Math.max(0, Math.ceil((hit[2] - r) / mpu - ty * MAP_SIZE)), j1 = Math.min(N - 1, Math.floor((hit[2] + r) / mpu - ty * MAP_SIZE));
        for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
          const dist = Math.hypot((tx * MAP_SIZE + i) * mpu - hit[0], (ty * MAP_SIZE + j) * mpu - hit[2]);
          if (dist >= r) continue;
          const k = 1 - (dist / r) ** 2, idx = j * N + i;
          verts.push({ tile: `${tx},${ty}`, idx, h0: t.land.heights[idx], w: k * k });
        }
      }
    }
    this.drag = { c: hit, y0: y, verts, last: 0 };
  }

  private up() {
    const s = this.stroke;
    this.stroke = null;
    this.drag = null;
    if (s?.size) { this.undoStack.push([...s.values()]); if (this.undoStack.length > 100) this.undoStack.shift(); this.onChange(); }
  }

  // ---------- quadro ----------
  /** chamar a cada quadro: mostra o anel do pincel e, com o botão esquerdo segurado, aplica o pincel */
  update(dt: number) {
    if (!this.enabled) return;
    if (this.drag) { this.ring.visible = true; this.drawRing(this.drag.c); this.dragTick(); return; }
    const hit = this.pointer ? this.pick(this.pointer) : null;
    this.lastHit = hit;
    this.ring.visible = !!hit;
    if (!hit) return;
    this.drawRing(hit);
    if (this.stroke) this.apply(hit, Math.min(dt, BRUSH.maxDt));
  }

  /** altura = a de antes do clique + (pixels arrastados para cima × força) × peso do vértice; absoluta, então não acumula entre quadros */
  private dragTick() {
    const g = this.drag;
    if (!g) return;
    let amount = (g.y0 - this.lastY) * BRUSH.heightPerPx * this.strength;
    if (!this.shift) amount = this.brush === 'raise' ? Math.max(0, amount) : Math.min(0, amount);
    if (amount === g.last) return;
    g.last = amount;
    this.write(g.verts.map((v) => ({ tile: v.tile, idx: v.idx, h: v.h0 + amount * v.w })), true);
  }

  private pick(p: { x: number; y: number }): [number, number, number] | null {
    const targets = [...this.view.tiles.values()].filter((t) => t.terrain.visible).map((t) => t.terrain);
    this.ray.setFromCamera(new Vector2((p.x / innerWidth) * 2 - 1, -(p.y / innerHeight) * 2 + 1), this.view.camera);
    const h = this.ray.intersectObjects(targets, true)[0];
    return h ? [h.point.x, h.point.y, -h.point.z] : null; // Three → FlyFF
  }

  private drawRing(c: [number, number, number]) {
    const a = this.ring.geometry.getAttribute('position') as BufferAttribute;
    for (let k = 0; k <= RING_POINTS; k++) {
      const t = (k / RING_POINTS) * Math.PI * 2, x = c[0] + Math.cos(t) * this.radius, z = c[2] + Math.sin(t) * this.radius;
      a.setXYZ(k, x, (this.view.sampleHeight(x, z) ?? c[1]) + 0.25, -z);
    }
    a.needsUpdate = true;
    this.view.invalidate();
  }

  // ---------- pincel ----------
  private apply(c: [number, number, number], dt: number) {
    const d = this.view.data;
    if (!d || dt <= 0) return;
    const mpu = d.wld.mpu, s = MAP_SIZE * mpu, r = this.radius, view = this.view;
    const changes: Change[] = [];
    if (this.brush === 'flatten' && this.flat === null) this.flat = view.sampleHeight(c[0], c[2]) ?? c[1];
    const blend = (w: number) => 1 - Math.exp(-this.strength * BRUSH.blendPerSecond * dt * w);
    for (let ty = Math.floor((c[2] - r) / s); ty <= Math.floor((c[2] + r) / s); ty++) {
      for (let tx = Math.floor((c[0] - r) / s); tx <= Math.floor((c[0] + r) / s); tx++) {
        const t = view.tiles.get(`${tx},${ty}`);
        if (!t) continue;
        const i0 = Math.max(0, Math.ceil((c[0] - r) / mpu - tx * MAP_SIZE)), i1 = Math.min(N - 1, Math.floor((c[0] + r) / mpu - tx * MAP_SIZE));
        const j0 = Math.max(0, Math.ceil((c[2] - r) / mpu - ty * MAP_SIZE)), j1 = Math.min(N - 1, Math.floor((c[2] + r) / mpu - ty * MAP_SIZE));
        for (let j = j0; j <= j1; j++) {
          for (let i = i0; i <= i1; i++) {
            const x = (tx * MAP_SIZE + i) * mpu, z = (ty * MAP_SIZE + j) * mpu, dist = Math.hypot(x - c[0], z - c[2]);
            if (dist >= r) continue;
            const k = 1 - (dist / r) ** 2, w = k * k, idx = j * N + i, h = t.land.heights[idx];
            let nh = h;
            if (this.brush === 'smooth') {
              const near = [view.sampleHeight(x - mpu, z), view.sampleHeight(x + mpu, z), view.sampleHeight(x, z - mpu), view.sampleHeight(x, z + mpu)].map((v) => v ?? h);
              nh = h + ((near[0] + near[1] + near[2] + near[3]) / 4 - h) * blend(w);
            } else nh = h + ((this.flat ?? h) - h) * blend(w);
            if (nh !== h) changes.push({ tile: `${tx},${ty}`, idx, h: nh });
          }
        }
      }
    }
    this.write(changes, true);
  }

  /** grava as alturas (Landscape, rascunho do mundo e malha); `track` guarda o valor anterior para desfazer e descartar */
  private write(changes: Change[], track: boolean) {
    const d = this.view.data;
    if (!d || !changes.length) return;
    const byTile = new Map<string, number[]>();
    for (const c of changes) {
      const t = this.view.tiles.get(c.tile);
      if (!t) continue;
      const before = t.land.heights[c.idx];
      if (track) {
        let b = this.base.get(c.tile);
        if (!b) this.base.set(c.tile, (b = new Map()));
        if (!b.has(c.idx)) b.set(c.idx, before);
        if (this.stroke && !this.stroke.has(`${c.tile}:${c.idx}`)) this.stroke.set(`${c.tile}:${c.idx}`, { tile: c.tile, idx: c.idx, before });
      }
      t.land.heights[c.idx] = c.h;
      let dr = d.terrainDraft.get(c.tile);
      if (!dr) d.terrainDraft.set(c.tile, (dr = new Map()));
      dr.set(c.idx, c.h);
      (byTile.get(c.tile) ?? byTile.set(c.tile, []).get(c.tile)!).push(c.idx);
    }
    for (const [key, idxs] of byTile) this.refreshMesh(key, idxs);
    this.view.invalidate();
    this.onChange();
  }

  /** malha do tile: y dos vértices e normais (do vértice e dos vizinhos) no lugar; as camadas do tile compartilham os mesmos atributos */
  private refreshMesh(key: string, idxs: number[]) {
    const t = this.view.tiles.get(key), d = this.view.data;
    if (!t || !d) return;
    const mesh = t.terrain.children.find((o): o is Mesh => (o as Mesh).isMesh);
    if (!mesh) return;
    const pos = mesh.geometry.getAttribute('position') as BufferAttribute, nor = mesh.geometry.getAttribute('normal') as BufferAttribute | undefined;
    const h = t.land.heights, mpu = d.wld.mpu, ox = t.x * MAP_SIZE, oz = t.y * MAP_SIZE;
    const todo = new Set<number>();
    for (const idx of idxs) {
      pos.setY(idx, h[idx]);
      const i = idx % N, j = (idx - i) / N;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { const a = i + di, b = j + dj; if (a >= 0 && a < N && b >= 0 && b < N) todo.add(b * N + a); }
    }
    if (nor) {
      for (const idx of todo) {
        const i = idx % N, j = (idx - i) / N, x = (ox + i) * mpu, z = (oz + j) * mpu, y = h[idx];
        const L = this.view.sampleHeight(x - mpu, z) ?? y, R = this.view.sampleHeight(x + mpu, z) ?? y, U = this.view.sampleHeight(x, z - mpu) ?? y, D = this.view.sampleHeight(x, z + mpu) ?? y;
        const nx = (L - R) / (2 * mpu), nz = (U - D) / (2 * mpu), len = Math.hypot(nx, 1, nz);
        nor.setXYZ(idx, nx / len, 1 / len, nz / len);
      }
      nor.needsUpdate = true;
    }
    pos.needsUpdate = true;
    // a esfera/caixa de culling é a mesma nas camadas do tile: recalcular numa delas vale para todas (o chão subiu)
    mesh.geometry.computeBoundingSphere(); mesh.geometry.computeBoundingBox();
  }

  // ---------- desfazer / descartar / salvar ----------
  undo() {
    const s = this.undoStack.pop();
    if (!s) return false;
    this.write(s.map((c) => ({ tile: c.tile, idx: c.idx, h: c.before })), false);
    return true;
  }

  /** volta tudo ao que estava no último salvar (ou na abertura do mapa) */
  revert() {
    const d = this.view.data;
    const changes: Change[] = [];
    for (const [tile, m] of this.base) for (const [idx, h] of m) changes.push({ tile, idx, h });
    this.write(changes, false);
    if (d) for (const tile of this.base.keys()) d.terrainDraft.delete(tile);
    this.base.clear();
    this.undoStack = [];
    this.onChange();
  }

  /** o que vai para `WorldEdits.terrain`: o já salvo, com as alturas mexidas por cima */
  buildEdits(saved: WorldEdits['terrain']): Record<string, string> | undefined {
    const d = this.view.data;
    const out: Record<string, string> = { ...(saved ?? {}) };
    if (d) {
      for (const [tile, m] of this.base) {
        const entries = new Map(decodeTerrain(saved?.[tile] ?? '') ?? []);
        for (const idx of m.keys()) { const h = d.terrainDraft.get(tile)?.get(idx); if (h !== undefined) entries.set(idx, h); }
        if (entries.size) out[tile] = encodeTerrain(entries);
      }
    }
    return Object.keys(out).length ? out : undefined;
  }

  /** depois de salvar: o rascunho vira o estado salvo (o tile que sai e volta o lê de world-edits) */
  markSaved() {
    this.view.data?.terrainDraft.clear();
    this.base.clear();
    this.undoStack = [];
    this.onChange();
  }

  /** mundo novo carregado */
  reset() { this.base.clear(); this.undoStack = []; this.stroke = null; this.flat = null; this.onChange(); }
}
