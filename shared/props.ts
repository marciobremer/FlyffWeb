import { Box3, BoxGeometry, DoubleSide, Group, Mesh, MeshLambertMaterial, NoColorSpace, Vector3, type Material, type Object3D, type Texture } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { PropEdit } from './worldedits';

/** tamanho do .glb em unidades do próprio arquivo, e o objeto já com materiais Lambert (mesma iluminação do resto do mundo) */
export interface Template { obj: Object3D; size: Vector3; /** triângulos (x,y,z ×3) no espaço do .glb, para a colisão; caixa se a malha for muito pesada */ tris: Float32Array }

/** acima disso a colisão vira uma caixa (o jogador testa todos os triângulos do tile por passo) */
const MAX_COLLISION_TRIS = 400000;

export interface PropNode extends Group { userData: { prop: PropEdit; size: Vector3 | null; tris: Float32Array | null } }

const loader = new GLTFLoader();
const failed = new MeshLambertMaterial({ color: 0xff44aa });

/**
 * Props 3D extras do mundo (`WorldEdits.props`): .glb de `/res/<file>` na cena (não dentro de `root`, que inverte o z).
 * `node.position = (x, y, -z)` da posição FlyFF; o editor mexe no node e grava de volta com `toEdit`.
 */
export class PropLayer {
  readonly group = new Group();
  private cache = new Map<string, Promise<Template | null>>();
  /** chamado quando um prop termina de carregar (o editor atualiza o tamanho mostrado) */
  onLoaded: (node: PropNode) => void = () => {};
  /** a lista ou a posição de algum prop mudou (a colisão do mundo se refaz) */
  onChanged: () => void = () => {};
  changed() { this.onChanged(); }

  get nodes(): PropNode[] { return this.group.children as PropNode[]; }

  private load(file: string): Promise<Template | null> {
    let p = this.cache.get(file);
    if (!p) {
      p = loader.loadAsync('/res/' + file.split('/').map(encodeURIComponent).join('/')).then((g) => {
        g.scene.traverse((o) => {
          const m = o as Mesh;
          if (!m.isMesh) return;
          m.castShadow = m.receiveShadow = true;
          const mats = (Array.isArray(m.material) ? m.material : [m.material]) as Array<Material & { map?: unknown; color?: unknown; alphaTest?: number }>;
          // o mundo desenha com outputColorSpace linear e texturas .dds sem conversão (ver world.ts): o glTF marca a textura como sRGB e
          // ela sairia escura; tratar como as do mundo deixa as cores iguais às do Cruma
          for (const s of mats) { const t = s.map as Texture | null | undefined; if (t && t.colorSpace !== NoColorSpace) { t.colorSpace = NoColorSpace; t.needsUpdate = true; } }
          const conv = mats.map((s) => new MeshLambertMaterial({
            map: (s.map as MeshLambertMaterial['map']) ?? null,
            color: (s.color as MeshLambertMaterial['color']) ?? 0xffffff,
            alphaTest: s.alphaTest ?? 0,
            side: DoubleSide,
          }));
          m.material = Array.isArray(m.material) ? conv : conv[0];
        });
        const box = new Box3().setFromObject(g.scene);
        return { obj: g.scene, size: box.getSize(new Vector3()), tris: collisionTris(g.scene, box) };
      }).catch((e) => { console.warn('Falha ao ler prop', file, e); return null; });
      this.cache.set(file, p);
    }
    return p;
  }

  /** o .glb carregado (cópia própria para quem for desenhar fora do mundo, ex.: miniaturas do editor) */
  async preview(file: string): Promise<Template | null> {
    const t = await this.load(file);
    return t ? { obj: t.obj.clone(true), size: t.size.clone(), tris: t.tris } : null;
  }

  /** esquece os .glb já lidos (o arquivo foi exportado de novo); os props atuais continuam como estão até recarregar a lista */
  clearCache() { this.cache.clear(); }

  /** substitui todos os props pela lista (ao abrir o mundo / descartar) */
  set(list: PropEdit[]) {
    for (const n of [...this.nodes]) this.remove(n);
    for (const e of list) this.add(e);
    this.changed();
  }

  add(e: PropEdit): PropNode {
    const node = new Group() as PropNode;
    node.userData = { prop: { ...e, pos: [...e.pos] }, size: null, tris: null };
    this.apply(node);
    this.group.add(node);
    this.load(e.file).then((t) => {
      if (!node.parent) return; // removido enquanto carregava
      if (t) { if (!e.hidden) node.add(t.obj.clone(true)); node.userData.size = t.size; node.userData.tris = t.tris; }
      else node.add(new Mesh(new BoxGeometry(1, 1, 1).translate(0, 0.5, 0), failed)); // arquivo ausente/ilegível: caixa rosa
      this.onLoaded(node);
      this.changed();
    });
    return node;
  }

  remove(node: PropNode) {
    this.group.remove(node);
    node.traverse((o) => { if ((o as Mesh).isMesh) (o as Mesh).geometry.dispose?.(); });
    this.changed();
  }

  /** dados do prop → posição/giro/escala do node */
  apply(node: PropNode) {
    const e = node.userData.prop;
    node.position.set(e.pos[0], e.pos[1], -e.pos[2]);
    node.rotation.set(0, (e.rotY * Math.PI) / 180, 0);
    node.scale.setScalar(e.scale);
    this.changed();
  }

  /** node (mexido pelo gizmo) → dados do prop */
  sync(node: PropNode): PropEdit {
    const e = node.userData.prop;
    e.pos = [node.position.x, node.position.y, -node.position.z];
    e.rotY = (node.rotation.y * 180) / Math.PI;
    e.scale = node.scale.x;
    return e;
  }

  /** triângulos de colisão do prop em coordenadas FlyFF (x, y, z; a cena inverte o z); null se não colide ou ainda não carregou */
  collisionTris(node: PropNode): Float32Array | null {
    const t = node.userData.tris;
    if (!t || node.userData.prop.collide === false) return null;
    node.updateMatrixWorld(true);
    const m = node.matrixWorld, v = new Vector3(), out = new Float32Array(t.length);
    for (let i = 0; i < t.length; i += 3) {
      v.set(t[i], t[i + 1], t[i + 2]).applyMatrix4(m);
      out[i] = v.x; out[i + 1] = v.y; out[i + 2] = -v.z;
    }
    return out;
  }

  edits(): PropEdit[] { return this.nodes.map((n) => ({ ...n.userData.prop, pos: [...n.userData.prop.pos] as [number, number, number] })); }
}

/** triângulos de todas as malhas do .glb (espaço do arquivo); acima de MAX_COLLISION_TRIS usa só a caixa */
function collisionTris(root: Object3D, box: Box3): Float32Array {
  root.updateMatrixWorld(true);
  const out: number[] = [];
  const v = new Vector3();
  root.traverse((o) => {
    const m = o as Mesh;
    if (!m.isMesh || out.length / 9 > MAX_COLLISION_TRIS) return;
    const pos = m.geometry.getAttribute('position'), idx = m.geometry.index;
    const n = idx ? idx.count : pos.count;
    for (let i = 0; i + 2 < n; i += 3) {
      for (let k = 0; k < 3; k++) {
        v.fromBufferAttribute(pos, idx ? idx.getX(i + k) : i + k).applyMatrix4(m.matrixWorld);
        out.push(v.x, v.y, v.z);
      }
    }
  });
  if (out.length / 9 <= MAX_COLLISION_TRIS) return new Float32Array(out);
  const { min: a, max: b } = box;
  const c = [[a.x, a.y, a.z], [b.x, a.y, a.z], [b.x, a.y, b.z], [a.x, a.y, b.z], [a.x, b.y, a.z], [b.x, b.y, a.z], [b.x, b.y, b.z], [a.x, b.y, b.z]];
  const faces = [[0, 1, 2], [0, 2, 3], [4, 6, 5], [4, 7, 6], [0, 5, 1], [0, 4, 5], [1, 6, 2], [1, 5, 6], [2, 7, 3], [2, 6, 7], [3, 4, 0], [3, 7, 4]];
  return new Float32Array(faces.flatMap((f) => f.flatMap((i) => c[i])));
}
