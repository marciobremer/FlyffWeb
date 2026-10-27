import { Bone, BufferAttribute, BufferGeometry, Group, Matrix4, Mesh, Quaternion, Skeleton, SkinnedMesh, Vector3, type Material } from 'three';
import type { O3d } from './formats/o3d';
import type { WorldObject } from './formats/types';
import type { LoadedModel, ModelLibrary } from './models';
import { skinnedGeometry } from './movers';
import { objectMatrix, TICKS_PER_SEC } from './math';

/**
 * Objetos do mapa que se mexem (sino da torre de Flaris, engrenagens, ventiladores, placas…), como o CModelObject do original:
 * o .o3d traz a animação — TM por objeto (CObject3D::Animate, `m_pFrame` de cada GMOBJECT) e/ou esqueleto próprio com
 * movimento (m_pBaseBone + CMotion::AnimateBone). O quadro anda m_fPerSlerp por tique (62,5/s) e repete.
 * Todas as cópias de um modelo usam a mesma pose (calculada uma vez por quadro); cada cópia é um Group com as malhas.
 */

const m4 = (a: number[]) => new Matrix4().fromArray(a); // linha-vetor D3D → coluna Three
const q0 = new Quaternion(), q1 = new Quaternion(), v0 = new Vector3(), v1 = new Vector3(), one = new Vector3(1, 1, 1);

/** quadro `f0`→`f1` (fração t) de uma trilha x,y,z,w,px,py,pz em `out` */
function sample(fr: Float32Array, f0: number, f1: number, t: number, out: Matrix4) {
  const a = f0 * 7, b = f1 * 7;
  q0.set(fr[a], fr[a + 1], fr[a + 2], fr[a + 3]).normalize();
  q1.set(fr[b], fr[b + 1], fr[b + 2], fr[b + 3]).normalize();
  q0.slerp(q1, t);
  v0.set(fr[a + 4], fr[a + 5], fr[a + 6]).lerp(v1.set(fr[b + 4], fr[b + 5], fr[b + 6]), t);
  return out.compose(v0, q0, one);
}

/** a .o3d tem animação que vale tocar? */
export function isAnimated(o: O3d) {
  return o.frameCount > 1 && (o.nodes.some((n) => n.frames) || !!o.bones?.frames.some((f) => f));
}

interface Instance { group: Group; meshes: (Mesh | null)[]; alive: () => boolean }

/** um modelo animado: hierarquia, esqueleto, malhas em espaço local e as cópias no mapa */
class AnimModel {
  private time = Math.random() * 5;
  private readonly perSlerp: number;
  /** nós do .o3d: pai (índice em `nodes`, ou osso se `bone`), matriz local fixa e trilha */
  private readonly nodes: { parent: number; bone: boolean; local: Matrix4; frames?: Float32Array }[];
  private readonly nodeWorld: Matrix4[];
  private readonly boneWorld: Matrix4[] = [];
  private readonly skeleton: Skeleton | null = null;
  /** malhas: nó de onde vem a matriz (−1 = skin, segue os ossos) */
  readonly parts: { node: number; geometry: BufferGeometry; material: Material | Material[]; light: boolean; skinned: boolean }[] = [];
  readonly instances = new Set<Instance>();

  constructor(private readonly o3d: O3d, materials: Material[][]) {
    this.perSlerp = o3d.perSlerp > 0 ? o3d.perSlerp : 0.5;
    const index = new Map(o3d.nodes.map((n, i) => [n.id, i]));
    this.nodes = o3d.nodes.map((n) => ({
      parent: n.parentId === -1 ? -1 : n.parentType === 2 ? n.parentId : index.get(n.parentId) ?? -1,
      bone: n.parentId !== -1 && n.parentType === 2,
      local: m4(n.transform), frames: n.frames,
    }));
    this.nodeWorld = this.nodes.map(() => new Matrix4());
    const b = o3d.bones;
    if (b) {
      const bones = b.base.map(() => { const x = new Bone(); x.matrixAutoUpdate = false; x.matrixWorldAutoUpdate = false; return x; });
      this.skeleton = new Skeleton(bones, b.inverse.map(m4));
      for (let i = 0; i < bones.length; i++) this.boneWorld.push(m4(b.base[i]));
    }
    const nodeOf = new Map(o3d.nodes.map((n, i) => [n.id, i]));
    o3d.parts.forEach((p, k) => {
      if (!p.positions.length || !p.indices.length) return;
      const mats = materials[k];
      const material = mats.length > 1 ? mats : mats[0];
      if (p.skinned && p.skinWeights && p.skinIndices && this.skeleton) {
        this.parts.push({ node: -1, geometry: skinnedGeometry(p, this.skeleton.bones.length, mats.length), material, light: p.light, skinned: true });
        return;
      }
      const geo = new BufferGeometry();
      geo.setAttribute('position', new BufferAttribute(p.positions, 3));
      geo.setAttribute('normal', new BufferAttribute(p.normals, 3));
      geo.setAttribute('uv', new BufferAttribute(p.uvs, 2));
      geo.setIndex(new BufferAttribute(p.indices, 1));
      if (p.blocks.length) for (const bl of p.blocks) geo.addGroup(bl.start, bl.triangles * 3, Math.min(bl.material, mats.length - 1));
      else geo.addGroup(0, p.indices.length, 0);
      geo.computeBoundingSphere();
      this.parts.push({ node: nodeOf.get(p.id) ?? -1, geometry: geo, material, light: p.light, skinned: false });
    });
    this.pose(0);
  }

  /** põe uma cópia em `o` (dentro de `parent`); some quando `alive` virar false */
  add(parent: Group, o: WorldObject, night: boolean, alive: () => boolean) {
    const group = new Group();
    group.matrixAutoUpdate = false;
    objectMatrix(o, group.matrix);
    const meshes: (Mesh | null)[] = [];
    for (const p of this.parts) {
      let mesh: Mesh;
      if (p.skinned && this.skeleton) {
        const sm = new SkinnedMesh(p.geometry, p.material);
        sm.bindMode = 'detached';
        sm.bind(this.skeleton, new Matrix4());
        sm.frustumCulled = false;
        mesh = sm;
        meshes.push(null);
      } else {
        mesh = new Mesh(p.geometry, p.material);
        mesh.matrixAutoUpdate = false;
        if (p.node >= 0) mesh.matrix.copy(this.nodeWorld[p.node]);
        meshes.push(mesh);
      }
      mesh.castShadow = mesh.receiveShadow = true;
      if (p.light) { mesh.userData.nightOnly = true; mesh.visible = night; }
      group.add(mesh);
    }
    parent.add(group);
    this.instances.add({ group, meshes, alive });
  }

  /** pose do quadro `frame` (fracionário) nos nós e ossos */
  private pose(frame: number) {
    const n = this.o3d.frameCount, f0 = Math.floor(frame) % n, f1 = (f0 + 1) % n, t = frame - Math.floor(frame);
    const b = this.o3d.bones;
    if (b && this.skeleton) {
      for (let i = 0; i < this.boneWorld.length; i++) {
        const out = this.boneWorld[i], fr = b.frames[i];
        if (fr) sample(fr, f0, f1, t, out); else out.fromArray(b.staticTm[i] ?? b.base[i]);
        const p = b.parents[i];
        if (p >= 0 && p < i) out.premultiply(this.boneWorld[p]);
        this.skeleton.bones[i].matrixWorld.copy(out);
      }
    }
    // os nós vêm em ordem (pai antes do filho), como o _mUpdate do original
    for (let i = 0; i < this.nodes.length; i++) {
      const nd = this.nodes[i], out = this.nodeWorld[i];
      if (nd.frames) sample(nd.frames, f0, f1, t, out); else out.copy(nd.local);
      if (nd.parent >= 0) {
        const pm = nd.bone ? this.boneWorld[nd.parent] : nd.parent < i ? this.nodeWorld[nd.parent] : null;
        if (pm) out.premultiply(pm);
      }
    }
  }

  update(dt: number) {
    for (const inst of this.instances) if (!inst.group.parent || !inst.alive()) this.instances.delete(inst); // tile descarregado ou refeito
    if (!this.instances.size) return;
    this.time += dt;
    this.pose((this.time * this.perSlerp * TICKS_PER_SEC) % this.o3d.frameCount);
    for (const inst of this.instances) {
      inst.meshes.forEach((m, k) => { const node = this.parts[k].node; if (m && node >= 0) m.matrix.copy(this.nodeWorld[node]); });
    }
  }
}

/** todos os modelos animados do mundo */
export class ObjectAnimations {
  private models = new Map<LoadedModel, Promise<AnimModel | null>>();
  constructor(private lib: ModelLibrary) {}

  /** prepara (uma vez) o modelo animado de `model`; null se ele não se mexe */
  get(model: LoadedModel): Promise<AnimModel | null> {
    let p = this.models.get(model);
    if (!p) {
      const o = model.source;
      p = isAnimated(o)
        ? Promise.all(o.parts.map((part) => Promise.all((part.textures.length ? part.textures : ['']).map((t) => this.lib.material(t))))).then((mats) => new AnimModel(o, mats))
        : Promise.resolve(null);
      this.models.set(model, p);
    }
    return p;
  }

  private live = new Set<AnimModel>();
  /** registra que `m` tem cópias no mapa (para atualizar) */
  track(m: AnimModel) { this.live.add(m); }

  update(dt: number) {
    for (const m of this.live) { m.update(dt); if (!m.instances.size) this.live.delete(m); }
  }
}
