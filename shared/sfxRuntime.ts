import {
  AdditiveBlending, BufferAttribute, BufferGeometry, DoubleSide, Group, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, NormalBlending,
  Object3D, Quaternion, RepeatWrapping, TextureLoader, Vector3, type Camera, type Texture,
} from 'three';
import { TGALoader } from 'three/examples/jsm/loaders/TGALoader.js';
import { loadDds } from './dds';
import { fetchBuf } from './data';
import { parseSfx, sampleKey, SfxAlphaType, SfxBillType, SfxPartType, type Sfx, type SfxKey, type SfxPart, type V3 } from './formats/sfx';
import type { WorldObject } from './formats/types';
import type { LoadedModel, ModelLibrary } from './models';
import { rowRotX, rowRotZ, rowScale, rowTrans, rowYPR, TICKS_PER_SEC, transformCoord } from './math';

/**
 * Reprodução de efeitos .sfx (Common/SfxModel.cpp + Sfx.cpp). Ticks a 62,5 Hz como o Neuz (CModel::MoveFrame, perSlerp = 1).
 * Todos os nós ficam num grupo dentro do `root` espelhado em Z; as matrizes são calculadas em D3D (vetor-linha).
 */
const rad = (d: number) => (d * Math.PI) / 180;
// ritmo do Neuz (62,5 tiques/s): shared/math.ts
const flip = new Matrix4().makeScale(1, 1, -1);

// ---------------------------------------------------------------- biblioteca
export class SfxLibrary {
  private sfx = new Map<string, Promise<Sfx | null>>();
  private tex = new Map<string, Promise<Texture | null>>();
  private img = new TextureLoader();
  private tga = new TGALoader();
  constructor(private files: Set<string>, private texFiles: Set<string>, private models: ModelLibrary) {}
  reset(files: Set<string>, texFiles: Set<string>) { this.files = files; this.texFiles = texFiles; this.sfx.clear(); this.tex.clear(); }
  has(file: string) { return this.files.has(file.toLowerCase()); }
  get modelLib() { return this.models; }

  getSfx(file: string): Promise<Sfx | null> {
    const k = file.toLowerCase();
    let p = this.sfx.get(k);
    if (!p) {
      p = this.files.has(k)
        ? fetchBuf('/res/Data/SFX/' + encodeURIComponent(file)).then((b) => { try { return b ? parseSfx(b) : null; } catch { return null; } })
        : Promise.resolve(null);
      this.sfx.set(k, p);
    }
    return p;
  }

  texture(name: string): Promise<Texture | null> {
    const k = name.toLowerCase();
    let p = this.tex.get(k);
    if (!p) {
      if (!this.texFiles.has(k)) p = Promise.resolve(null);
      else {
        const url = '/res/Data/SFX/Texture/' + encodeURIComponent(name);
        const fin = (t: Texture) => { t.flipY = false; t.wrapS = t.wrapT = RepeatWrapping; t.needsUpdate = true; return t; };
        if (k.endsWith('.dds')) p = loadDds(url).then((t) => { if (t) { t.wrapS = t.wrapT = RepeatWrapping; t.needsUpdate = true; } return t; });
        else if (k.endsWith('.tga')) p = new Promise((res) => this.tga.load(url, (t) => res(fin(t)), undefined, () => res(null)));
        else p = new Promise((res) => this.img.load(url, (t) => res(fin(t)), undefined, () => res(null)));
      }
      this.tex.set(k, p);
    }
    return p;
  }

  /** Texturas de um quad animado (`CSfxPart::_setTexture`: o nº de 2 dígitos antes da extensão avança por quadro). */
  frameTextures(part: SfxPart): Promise<(Texture | null)[]> {
    if (part.texFrame <= 1) return this.texture(part.textureName).then((t) => [t]);
    const n = part.textureName;
    const start = parseInt(n.slice(n.length - 6, n.length - 4), 10);
    const base = n.slice(0, n.length - 6), ext = n.slice(n.length - 4);
    return Promise.all(Array.from({ length: part.texFrame }, (_, i) => this.texture(`${base}${String(start + i).padStart(2, '0')}${ext}`)));
  }
}

// ---------------------------------------------------------------- geometria compartilhada
function quadGeometry() {
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array([-0.5, 0.5, 0, 0.5, 0.5, 0, 0.5, -0.5, 0, -0.5, -0.5, 0]), 3));
  g.setAttribute('uv', new BufferAttribute(new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), 2));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  return g;
}
const QUAD = quadGeometry();

interface Particle { frame: number; pos: V3; speed: V3; scale: V3; rotation: V3; scaleStart: V3; scaleEnd: V3; scaleSpeed: V3; swScal: boolean }

const MAX_PARTICLES = 200;
const blendOf = (t: SfxAlphaType) => (t === SfxAlphaType.Glow ? AdditiveBlending : NormalBlending);
const matFor = (part: SfxPart, map: Texture | null) =>
  new MeshBasicMaterial({ map, transparent: true, depthWrite: false, side: DoubleSide, blending: blendOf(part.alphaType), fog: false });

interface PartNode {
  part: SfxPart;
  mesh: Mesh | InstancedMesh | null;
  mat: MeshBasicMaterial | null;
  textures: (Texture | null)[];
  particles: Particle[];
  model?: LoadedModel | null;
  extra?: Mesh[];
}

const tmpV = new Vector3(), tmpQ = new Quaternion(), tmpM = new Matrix4();

export class SfxInstance {
  readonly group = new Group();
  private nodes: PartNode[] = [];
  private currentFrame = -0.5;
  private acc = 0;
  private matRot: Matrix4;
  private pos: V3;
  private scale: V3;
  private alive = true;
  /** efeito de uma vez só (skill): ao terminar `done` fica true e some; no máximo `maxAge` s */
  once = false;
  done = false;
  private age = 0;
  maxAge = 4;

  constructor(readonly lib: SfxLibrary, readonly sfx: Sfx, readonly source: WorldObject) {
    this.pos = [source.pos[0], source.pos[1] + 0.2, source.pos[2]];
    this.scale = source.scale;
    // matRot = YawPitchRoll(rot.y, rot.x, rot.z) com os ângulos do objeto em graus (CSfxModel::Render recebe m_rot)
    this.matRot = rowYPR(rad(source.rot[1]), rad(source.rot[0]), rad(source.rot[2]));
    this.group.matrixAutoUpdate = false;
    for (const part of sfx.parts) {
      const node: PartNode = { part, mesh: null, mat: null, textures: [], particles: [] };
      this.nodes.push(node);
      if (!part.visible) continue;
      if (part.type === SfxPartType.Mesh) {
        void lib.modelLib.getByFile(part.textureName).then((m) => {
          if (!m || !this.alive) return;
          node.model = m;
          node.extra = m.parts.map((p) => {
            const mat = new MeshBasicMaterial({
              map: (p.materials[0] as MeshBasicMaterial | undefined)?.map ?? null, transparent: true, depthWrite: false, side: DoubleSide,
              blending: blendOf(part.alphaType), fog: false, color: 0xffffff,
            });
            const mesh = new Mesh(p.geometry, mat);
            mesh.matrixAutoUpdate = false; mesh.visible = false; mesh.frustumCulled = false;
            this.group.add(mesh);
            return mesh;
          });
        });
        continue;
      }
      node.mat = matFor(part, null);
      if (part.type === SfxPartType.Particle) {
        const im = new InstancedMesh(QUAD, node.mat, MAX_PARTICLES);
        im.count = 0; im.frustumCulled = false; im.matrixAutoUpdate = false;
        node.mesh = im;
      } else if (part.type === SfxPartType.CustomMesh) {
        const g = new BufferGeometry();
        const n = ((part.pointCount ?? 20) * 2 + 1) * 2;
        g.setAttribute('position', new BufferAttribute(new Float32Array(n * 3), 3));
        g.setAttribute('uv', new BufferAttribute(new Float32Array(n * 2), 2));
        const idx: number[] = [];
        for (let i = 0; i < n - 2; i++) idx.push(...(i % 2 === 0 ? [i, i + 1, i + 2] : [i + 1, i, i + 2]));
        g.setIndex(idx);
        const m = new Mesh(g, node.mat);
        m.frustumCulled = false; m.matrixAutoUpdate = false;
        node.mesh = m;
      } else {
        const m = new Mesh(QUAD, node.mat);
        m.frustumCulled = false; m.matrixAutoUpdate = false;
        node.mesh = m;
      }
      node.mesh.visible = false;
      this.group.add(node.mesh);
      void lib.frameTextures(part).then((t) => { node.textures = t; });
    }
  }

  // ------------------------------------------------------------ simulação (CSfxModel::_nextFrame)
  private nextFrame(): boolean {
    let ret = false;
    this.currentFrame += 1;
    const frame = Math.trunc(this.currentFrame);
    for (const node of this.nodes) {
      const part = node.part;
      if (part.type === SfxPartType.Particle && part.particle) {
        const pp = part.particle;
        const list = node.particles;
        for (let j = 0; j < list.length; j++) {
          const p = list[j];
          for (let k = 0; k < 3; k++) { p.pos[k] += p.speed[k]; p.speed[k] += pp.accel[k]; }
          if (!pp.repeatScal) for (let k = 0; k < 3; k++) p.scale[k] += pp.scaleSpeed[k];
          p.frame++;
          if (p.frame >= pp.frameDisappear) { list.splice(j, 1); j--; }
        }
        const start = part.keys[0]?.frame ?? 0, end = part.keys.length ? part.keys[part.keys.length - 1].frame : 0;
        if (frame >= start && frame <= end - pp.frameDisappear) {
          if ((pp.create === 0 && frame === start) || (pp.create !== 0 && (frame - start) % pp.create === 0)) {
            const r1 = Math.floor(Math.random() * 50000) / 50000, r2 = Math.floor(Math.random() * 50000) / 50000, r3 = Math.floor(Math.random() * 50000) / 50000;
            for (let j = 0; j < pp.createNum && list.length < MAX_PARTICLES; j++) {
              const angle = (Math.floor(Math.random() * 50000) / 50000) * 360; // (sic) o original usa graus em sin/cos
              const factor = pp.xzLow + r2 * (pp.xzHigh - pp.xzLow);
              list.push({
                frame: 0,
                pos: [Math.sin(angle) * pp.startPosVar, r1 * pp.startPosVarY, Math.cos(angle) * pp.startPosVar],
                speed: [Math.sin(angle) * factor, pp.yLow + r2 * (pp.yHigh - pp.yLow), Math.cos(angle) * factor],
                scale: [...pp.scale], scaleStart: [...pp.scale], scaleEnd: [...pp.scaleEnd], swScal: false,
                rotation: [pp.rotationLow[0] + r1 * (pp.rotationHigh[0] - pp.rotationLow[0]), pp.rotationLow[1] + r3 * (pp.rotationHigh[1] - pp.rotationLow[1]), pp.rotationLow[2] + r2 * (pp.rotationHigh[2] - pp.rotationLow[2])],
                scaleSpeed: [pp.scalSpeedXLow + r3 * (pp.scalSpeedXHigh - pp.scalSpeedXLow), pp.scalSpeedYLow + r2 * (pp.scalSpeedYHigh - pp.scalSpeedYLow), pp.scalSpeedZLow + r1 * (pp.scalSpeedZHigh - pp.scalSpeedZLow)],
              });
            }
          }
        }
        if (list.length > 0 || frame < start) ret = true;
        if (pp.repeat && end >= 0) {
          const f = this.currentFrame / end;
          if (f >= 0.65) this.currentFrame = end * 0.6;
        }
      } else if (part.keys.some((k) => k.frame >= frame)) ret = true;
    }
    return ret;
  }

  // ------------------------------------------------------------ atualização por frame de render
  update(dt: number, camera: Camera) {
    if (this.done) return;
    this.age += dt;
    this.acc += dt * TICKS_PER_SEC;
    while (this.acc >= 1) {
      this.acc -= 1;
      if (!this.nextFrame()) {
        if (this.once) { this.done = true; break; }
        this.currentFrame = -0.5;
      }
    }
    if (this.once && this.age > this.maxAge) this.done = true;
    if (this.done) { this.group.visible = false; return; }
    const frame = Math.max(0, Math.trunc(this.currentFrame));
    camera.getWorldQuaternion(tmpQ);
    const rcam = new Matrix4().makeRotationFromQuaternion(tmpQ);
    for (const node of this.nodes) this.updatePart(node, frame, rcam);
  }

  /** muda a posição (efeitos que se movem) */
  place(x: number, y: number, z: number) { this.pos = [x, y + 0.2, z]; }

  /** translação D3D: pos + TransformCoord(key.pos, matRot·YPR(posRotate))·scale */
  private anchor(key: SfxKey, withKeyRotate: boolean): V3 {
    const pr = key.posRotate.map(rad) as V3;
    const m = this.matRot.clone().multiply(rowYPR(pr[1], pr[0], pr[2]));
    void withKeyRotate;
    const t = transformCoord(key.pos, m);
    return [this.pos[0] + t[0] * this.scale[0], this.pos[1] + t[1] * this.scale[1], this.pos[2] + t[2] * this.scale[2]];
  }

  /** orientação de bill/pole em espaço Three: T · Rcam · Rz(rz) · (S) → convertida para o espaço do grupo raiz (espelhado) */
  private billboardLocal(trans: V3, rcam: Matrix4, rz: number, sx: number, sy: number, sz: number): Matrix4 {
    const t3 = new Matrix4().makeTranslation(trans[0], trans[1], -trans[2]);
    const rzm = new Matrix4().makeRotationZ(rz);
    return flip.clone().multiply(t3).multiply(rcam).multiply(rzm).multiply(new Matrix4().makeScale(sx, sy, sz));
  }

  private rowToLocal(row: Matrix4) { return row.clone().transpose(); }

  private applyAlphaTexture(node: PartNode, alpha: number, frameForTex: number) {
    const mat = node.mat;
    if (!mat) return;
    const p = node.part;
    let tex: Texture | null = node.textures[0] ?? null;
    if (p.texFrame > 1 && node.textures.length) {
      const first = p.keys.find((k) => k.frame >= 0)?.frame ?? 0;
      tex = node.textures[Math.floor((p.texFrame * (frameForTex - first)) / Math.max(1, p.texLoop)) % p.texFrame] ?? null;
    }
    if (mat.map !== tex) { mat.map = tex; mat.needsUpdate = true; }
    // sem a textura (ainda baixando) o quadro sairia branco: fica escondido até ela chegar
    mat.visible = !!tex;
    mat.opacity = Math.max(0, Math.min(1, alpha / 255));
    mat.color.setScalar(1);
  }

  private updatePart(node: PartNode, frame: number, rcam: Matrix4) {
    const part = node.part;
    if (!part.visible) return;
    const key = sampleKey(part, frame);
    if (part.type === SfxPartType.Mesh) { this.updateMeshPart(node, key); return; }
    const mesh = node.mesh;
    if (!mesh) return;
    if (part.type === SfxPartType.Particle) { this.updateParticles(node, key, frame, rcam); return; }

    const first = part.keys[0];
    if (!key || !first || (part.texFrame > 1 && frame < first.frame)) { mesh.visible = false; return; }
    mesh.visible = true;
    this.applyAlphaTexture(node, key.alpha, frame);
    const s: V3 = [this.scale[0] * key.scale[0], this.scale[1] * key.scale[1], this.scale[2] * key.scale[2]];
    const trans = this.anchor(key, false);

    if (part.type === SfxPartType.CustomMesh) { this.updateCustom(node, key, trans, rcam); return; }

    switch (part.billType) {
      case SfxBillType.Bill:
      case SfxBillType.Pole:
        mesh.matrix.copy(this.billboardLocal(trans, rcam, rad(key.rotate[2]), s[0], s[1], s[2]));
        break;
      case SfxBillType.Bottom: {
        const m = rowScale(...s).multiply(rowRotZ(rad(key.rotate[2] - this.source.rot[2]))).multiply(rowRotX(rad(90))).multiply(rowTrans(...trans));
        mesh.matrix.copy(this.rowToLocal(m));
        break;
      }
      default: {
        const r = key.rotate.map(rad) as V3;
        // SFXPARTBILLTYPE_NORMAL: o quad do original fica deitado (plano XZ) — círculos mágicos e anéis de skill ficam no chão; a rotação da chave vem depois
        const m = rowScale(...s).multiply(rowRotX(rad(90))).multiply(rowYPR(r[1], r[0], r[2])).multiply(this.matRot).multiply(rowTrans(...trans));
        mesh.matrix.copy(this.rowToLocal(m));
      }
    }
    mesh.matrixWorldNeedsUpdate = true;
  }

  private updateMeshPart(node: PartNode, key: ReturnType<typeof sampleKey>) {
    const part = node.part;
    if (!node.extra) return;
    if (!key) { node.extra.forEach((m) => (m.visible = false)); return; }
    const s: V3 = [this.scale[0] * key.scale[0], this.scale[1] * key.scale[1], this.scale[2] * key.scale[2]];
    const yaw = rad(this.source.rot[1]);
    const rot = [rad(key.rotate[0]), rad(key.rotate[1]) + yaw, rad(key.rotate[2])];
    const pr = [rad(key.posRotate[0]), rad(key.posRotate[1]) + yaw, rad(key.posRotate[2])];
    const t = transformCoord(key.pos, rowYPR(pr[1], pr[0], pr[2]));
    const m = rowScale(...s).multiply(rowYPR(rot[1], rot[0], rot[2])).multiply(rowTrans(this.pos[0] + t[0] * this.scale[0], this.pos[1] + t[1] * this.scale[1], this.pos[2] + t[2] * this.scale[2]));
    const local = this.rowToLocal(m);
    for (const mesh of node.extra) {
      mesh.visible = true;
      mesh.matrix.copy(local);
      const mat = mesh.material as MeshBasicMaterial;
      mat.opacity = Math.max(0, Math.min(1, key.alpha / 255));
    }
    void part;
  }

  private updateCustom(node: PartNode, key: NonNullable<ReturnType<typeof sampleKey>>, trans: V3, rcam: Matrix4) {
    const part = node.part, mesh = node.mesh as Mesh;
    const n = part.pointCount ?? 20;
    const g = mesh.geometry as BufferGeometry;
    const pos = g.getAttribute('position') as BufferAttribute, uv = g.getAttribute('uv') as BufferAttribute;
    for (let i = 0; i < n * 2 + 1; i++) {
      const a = rad((360 / (n * 2)) * i);
      const top = i * 2, bot = i * 2 + 1;
      pos.setXYZ(top, Math.sin(a) * key.scale[0] * this.scale[0], key.scale[1] * this.scale[1], Math.cos(a) * key.scale[0] * this.scale[2]);
      pos.setXYZ(bot, Math.sin(a) * key.scale[2] * this.scale[0], 0, Math.cos(a) * key.scale[2] * this.scale[2]);
      const u = key.posRotate[0] === 0 ? (i % 2 === 0 ? 0 : 1) : (key.posRotate[0] * i) / (n * 2);
      uv.setXY(top, u, key.posRotate[1] + 0.1); uv.setXY(bot, u, key.posRotate[2]);
    }
    pos.needsUpdate = true; uv.needsUpdate = true;
    const rzv = rad(key.rotate[2] - this.source.rot[2]);
    switch (part.billType) {
      case SfxBillType.Bill:
      case SfxBillType.Pole:
        mesh.matrix.copy(this.billboardLocal(trans, rcam, rzv, 1, 1, 1));
        break;
      case SfxBillType.Bottom:
        mesh.matrix.copy(this.rowToLocal(rowRotZ(rad(key.rotate[2])).multiply(rowRotX(rad(90))).multiply(rowTrans(...trans))));
        break;
      default: {
        const r = key.rotate.map(rad) as V3;
        mesh.matrix.copy(this.rowToLocal(rowYPR(r[1], r[0], r[2]).multiply(this.matRot).multiply(rowTrans(...trans))));
      }
    }
    (node.mat as MeshBasicMaterial).side = DoubleSide;
  }

  private updateParticles(node: PartNode, key: ReturnType<typeof sampleKey>, frame: number, rcam: Matrix4) {
    const part = node.part, pp = part.particle!;
    const im = node.mesh as InstancedMesh;
    if (!key || !node.particles.length) { im.visible = false; return; }
    im.visible = true;
    const list = node.particles;
    // posição base: pos + TransformCoord(key.pos, matRot·YPR(posRotate))  (variável `temp` no original)
    const prm = key.posRotate.map(rad) as V3;
    const base = transformCoord(key.pos, this.matRot.clone().multiply(rowYPR(prm[1], prm[0], prm[2])));
    const kr = key.rotate.map(rad) as V3;
    const krp = [rad(key.rotate[0] + key.posRotate[0]), rad(key.rotate[1] + key.posRotate[1]), rad(key.rotate[2] + key.posRotate[2])];
    const posMat = rowYPR(krp[1], krp[0], krp[2]).multiply(this.matRot);
    const m = new Matrix4();
    let alphaSum = 0;
    im.count = list.length;
    list.forEach((p, i) => {
      if (pp.repeatScal) {
        const len = Math.hypot(...p.scale), end = Math.hypot(...p.scaleEnd), st = Math.hypot(...p.scaleStart);
        if (len >= end) p.swScal = true; else if (len <= st) p.swScal = false;
        for (let k = 0; k < 3; k++) p.scale[k] += p.swScal ? -p.scaleSpeed[k] : p.scaleSpeed[k];
      }
      const t = transformCoord(p.pos, posMat);
      const world: V3 = [this.pos[0] + base[0] + t[0] * this.scale[0], this.pos[1] + base[1] + t[1] * this.scale[1], this.pos[2] + base[2] + t[2] * this.scale[2]];
      const lerp = key.frame !== 0 ? (frame - key.prevFrame) / key.frame : 0;
      const tr = [p.rotation[0] * lerp, p.rotation[1] * lerp, p.rotation[2] * lerp].map(rad) as V3;
      const sx = p.scale[0] * this.scale[0], sy = p.scale[1] * this.scale[1];
      if (part.billType === SfxBillType.Bill || part.billType === SfxBillType.Pole) {
        // Rtemp · Scale · Rz(key.rotate.z) · invView · T  → coluna: T · Rcam · Rz · Scale · Rtemp
        const rtemp = rowYPR(tr[1], tr[0], tr[2]).transpose();
        const t3 = new Matrix4().makeTranslation(world[0], world[1], -world[2]);
        m.copy(flip).multiply(t3).multiply(rcam).multiply(new Matrix4().makeRotationZ(kr[2])).multiply(new Matrix4().makeScale(sx, sy, this.scale[2])).multiply(rtemp);
      } else {
        const orient = part.billType === SfxBillType.Bottom ? rowRotZ(kr[2]).multiply(rowRotX(rad(90))) : rowRotX(rad(90)).multiply(rowYPR(kr[1], kr[0], kr[2])).multiply(this.matRot);
        const row = rowYPR(tr[1], tr[0], tr[2]).multiply(rowScale(sx, sy, this.scale[2])).multiply(orient).multiply(rowTrans(...world));
        m.copy(row.transpose());
      }
      im.setMatrixAt(i, m);
      let a = key.alpha;
      if (p.frame < pp.frameAppear) a = (p.frame * key.alpha) / Math.max(1, pp.frameAppear);
      else if (p.frame > pp.frameKeep) a = key.alpha - (key.alpha * (p.frame - pp.frameKeep)) / Math.max(1, pp.frameDisappear - pp.frameKeep);
      alphaSum += a;
    });
    im.instanceMatrix.needsUpdate = true;
    // um único material por parte: usa a média do alfa das partículas
    this.applyAlphaTexture(node, alphaSum / list.length, frame);
    void tmpV; void tmpM; void Object3D;
  }

  dispose() {
    this.alive = false;
    this.group.removeFromParent();
    for (const n of this.nodes) { n.mat?.dispose(); n.extra?.forEach((m) => (m.material as MeshBasicMaterial).dispose()); }
  }
}

// ---------------------------------------------------------------- gerenciador por proximidade
export class SfxManager {
  private active = new Map<WorldObject, SfxInstance>();
  private pending = new Set<WorldObject>();
  /** candidatos ativos (de tiles carregados) com o arquivo .sfx de cada um */
  constructor(private parent: Group, private lib: SfxLibrary, public maxInstances = 80, public radius = 650) {}
  get count() { return this.active.size; }

  clear() { for (const i of this.active.values()) i.dispose(); this.active.clear(); this.pending.clear(); for (const s of this.shots) s.dispose(); this.shots.length = 0; for (const d of this.drivers) d.inst.dispose(); this.drivers.length = 0; }

  refresh(candidates: { obj: WorldObject; file: string }[], x: number, z: number) {
    const near = candidates
      .map((c) => ({ c, d: Math.hypot(c.obj.pos[0] - x, c.obj.pos[2] - z) }))
      .filter((n) => n.d < this.radius)
      .sort((a, b) => a.d - b.d)
      .slice(0, this.maxInstances);
    const keep = new Set(near.map((n) => n.c.obj));
    for (const [obj, inst] of this.active) if (!keep.has(obj)) { inst.dispose(); this.active.delete(obj); }
    for (const { c } of near) {
      if (this.active.has(c.obj) || this.pending.has(c.obj)) continue;
      this.pending.add(c.obj);
      void this.lib.getSfx(c.file).then((sfx) => {
        this.pending.delete(c.obj);
        if (!sfx || this.active.has(c.obj)) return;
        const inst = new SfxInstance(this.lib, sfx, c.obj);
        this.parent.add(inst.group);
        this.active.set(c.obj, inst);
      });
    }
  }

  update(dt: number, camera: Camera) {
    for (const i of this.active.values()) i.update(dt, camera);
    for (let k = this.drivers.length - 1; k >= 0; k--) {
      const d = this.drivers[k];
      d.inst.update(dt, camera);
      if (d.step(dt)) { d.inst.dispose(); this.drivers.splice(k, 1); }
    }
    for (let k = this.shots.length - 1; k >= 0; k--) {
      const s = this.shots[k];
      s.update(dt, camera);
      if (s.done) { s.dispose(); this.shots.splice(k, 1); }
    }
  }

  /** efeitos que se movem ou seguem alguém (projétil de magia, buff): `step` devolve true ao terminar */
  private drivers: { inst: SfxInstance; step: (dt: number) => boolean }[] = [];
  private spawn(file: string, pos: V3, rotY: number, step: (inst: SfxInstance, dt: number) => boolean, scale: V3 = [1, 1, 1]) {
    void this.lib.getSfx(file).then((sfx) => {
      if (!sfx) return;
      const o: WorldObject = { type: 3, modelId: 0, pos: [pos[0], pos[1], pos[2]], rot: [0, rotY, 0], scale: [...scale], motion: 0, ai: 0, ai2: 0 };
      const inst = new SfxInstance(this.lib, sfx, o);
      this.parent.add(inst.group);
      this.drivers.push({ inst, step: (dt) => step(inst, dt) });
    });
  }
  /** projétil: sai de `from` e chega em `to` em `secs`; `onEnd` quando chega (ex.: tocar o impacto) */
  playMoving(file: string, from: V3, to: V3, rotY: number, secs: number, onEnd: () => void) {
    let t = 0;
    this.spawn(file, from, rotY, (inst, dt) => {
      t += dt;
      const k = Math.min(1, t / secs);
      inst.place(from[0] + (to[0] - from[0]) * k, from[1] + (to[1] - from[1]) * k, from[2] + (to[2] - from[2]) * k);
      if (k >= 1) { onEnd(); return true; }
      return false;
    });
  }
  /** efeito que acompanha `getPos()` por `secs` segundos (buff) */
  playFollow(file: string, getPos: () => V3 | null, secs: number, rotY = 0) {
    let t = 0;
    const p0 = getPos();
    if (!p0) return;
    this.spawn(file, p0, rotY, (inst, dt) => {
      t += dt;
      const p = getPos();
      if (p) inst.place(p[0], p[1], p[2]);
      return t >= secs || !p;
    });
  }

  /**
   * efeito preso em alguém enquanto `alive()` (repete sem parar): a cada quadro vai para `getPos()` (null = ainda sem
   * posição, fica escondido). Ex.: efeito do conjunto +3…+10 nos ossos do personagem (CSfxPartsLinkShoulder).
   */
  playAttached(file: string, scale: V3, alive: () => boolean, getPos: () => V3 | null) {
    this.spawn(file, [0, 0, 0], 0, (inst, dt) => {
      if (!alive()) return true;
      const p = getPos();
      inst.group.visible = !!p;
      if (p) inst.place(p[0], p[1], p[2]);
      return false;
    }, scale);
  }

  /** efeitos de uma vez só (skills, golpes): tocam e somem */
  private shots: SfxInstance[] = [];
  play(file: string, pos: V3, rotY: number, scale = 1) {
    void this.lib.getSfx(file).then((sfx) => {
      if (!sfx) return;
      const o: WorldObject = { type: 3, modelId: 0, pos: [pos[0], pos[1], pos[2]], rot: [0, rotY, 0], scale: [scale, scale, scale], motion: 0, ai: 0, ai2: 0 };
      const inst = new SfxInstance(this.lib, sfx, o);
      inst.once = true;
      this.parent.add(inst.group);
      this.shots.push(inst);
    });
  }
}
