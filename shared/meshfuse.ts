import {
  type Material, type SkinnedMesh, type WebGLRenderer, type Texture,
  BufferAttribute, BufferGeometry, Color, Mesh, MeshBasicMaterial, MeshLambertMaterial, NoBlending, OrthographicCamera, PlaneGeometry, Scene, WebGLRenderTarget,
  LinearFilter, LinearMipmapLinearFilter, DoubleSide,
} from 'three';

/**
 * Fusão de malhas (LOD de jogadores distantes): as peças do corpo (cada uma com 1+ materiais) viram UMA malha com UM material.
 * O atlas é montado na GPU (as texturas do jogo são DXT comprimidas — não dá para desenhá-las num canvas): cada par
 * (textura, cor) ocupa uma célula, as UVs são reescritas e os triângulos concatenados num só BufferGeometry com o mesmo
 * esqueleto. O resultado fica em cache pela chave do visual (equipamento + cor do cabelo), compartilhado entre jogadores iguais.
 */
export interface Fused { geometry: BufferGeometry; material: Material; rt: WebGLRenderTarget; tris: number }

const CELL = 128; // px por textura no atlas (jogador a mais de ~40 m ocupa poucos pixels)
const PAD = 0.03; // folga (fração da célula) para o mipmap não sangrar entre vizinhos
const CACHE_MAX = 48;
const cache = new Map<string, Fused>();

const matsOf = (m: Material | Material[]) => (Array.isArray(m) ? m : [m]);
type Lam = Material & { map?: Texture | null; color?: Color };

/** Funde as malhas skinned dadas; null se não há o que fundir (menos de 2 peças) ou algo não é suportado. */
export function fuseSkinned(key: string, meshes: SkinnedMesh[], renderer: WebGLRenderer): Fused | null {
  const hit = cache.get(key);
  if (hit) { cache.delete(key); cache.set(key, hit); return hit; }
  if (meshes.length < 2) return null;

  // células únicas por (textura, cor)
  const cellOf = new Map<string, number>();
  const cells: { map: Texture | null; color: Color }[] = [];
  const cellFor = (m: Lam) => {
    const k = `${m.map?.uuid ?? '-'}|${m.color?.getHexString() ?? 'ffffff'}`;
    let i = cellOf.get(k);
    if (i === undefined) { i = cells.length; cellOf.set(k, i); cells.push({ map: m.map ?? null, color: m.color ? m.color.clone() : new Color(1, 1, 1) }); }
    return i;
  };

  // 1ª passada: quais células cada grupo usa (precisa saber o total para o tamanho da grade)
  for (const mesh of meshes) for (const m of matsOf(mesh.material)) cellFor(m as Lam);
  const G = Math.max(1, Math.ceil(Math.sqrt(cells.length)));
  if (G * CELL > renderer.capabilities.maxTextureSize) return null;

  // geometria concatenada
  let nv = 0, ni = 0;
  for (const mesh of meshes) { const g = mesh.geometry; nv += g.getAttribute('position').count; ni += g.index ? g.index.count : 0; if (!g.index) return null; }
  const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), uv = new Float32Array(nv * 2);
  const si = new Uint16Array(nv * 4), sw = new Float32Array(nv * 4);
  const idx = new Uint32Array(ni);
  let vo = 0, io = 0;
  for (const mesh of meshes) {
    const g = mesh.geometry, n = g.getAttribute('position').count;
    pos.set(g.getAttribute('position').array as Float32Array, vo * 3);
    nor.set(g.getAttribute('normal').array as Float32Array, vo * 3);
    si.set(g.getAttribute('skinIndex').array as Uint16Array, vo * 4);
    sw.set(g.getAttribute('skinWeight').array as Float32Array, vo * 4);
    const src = g.getAttribute('uv').array as Float32Array, mats = matsOf(mesh.material);
    const done = new Uint8Array(n);
    const ix = g.index!.array;
    const groups = g.groups.length ? g.groups : [{ start: 0, count: ix.length, materialIndex: 0 }];
    for (const gr of groups) {
      const c = cellFor((mats[Math.min(gr.materialIndex ?? 0, mats.length - 1)]) as Lam);
      const cx = c % G, cy = Math.floor(c / G);
      for (let k = gr.start; k < gr.start + gr.count; k++) {
        const v = ix[k];
        if (!done[v]) {
          done[v] = 1;
          uv[(vo + v) * 2] = (cx + PAD + src[v * 2] * (1 - 2 * PAD)) / G;
          uv[(vo + v) * 2 + 1] = (cy + PAD + src[v * 2 + 1] * (1 - 2 * PAD)) / G;
        }
        idx[io + k] = v + vo;
      }
    }
    // vértices sem triângulo ficam com UV 0 (não são desenhados)
    io += ix.length; vo += n;
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(pos, 3));
  geometry.setAttribute('normal', new BufferAttribute(nor, 3));
  geometry.setAttribute('uv', new BufferAttribute(uv, 2));
  geometry.setAttribute('skinIndex', new BufferAttribute(si, 4));
  geometry.setAttribute('skinWeight', new BufferAttribute(sw, 4));
  geometry.setIndex(new BufferAttribute(idx, 1));
  geometry.addGroup(0, ni, 0);
  geometry.computeBoundingSphere();

  // atlas: um plano por célula, câmera ortográfica sobre a grade, sem mistura (o alfa da textura vai direto para o atlas)
  const rt = new WebGLRenderTarget(G * CELL, G * CELL, { minFilter: LinearMipmapLinearFilter, magFilter: LinearFilter, generateMipmaps: true, depthBuffer: false });
  const scene = new Scene();
  const quad = new PlaneGeometry(1 - 2 * PAD, 1 - 2 * PAD);
  const tmp: MeshBasicMaterial[] = [];
  cells.forEach((c, i) => {
    const mat = new MeshBasicMaterial({ map: c.map, color: c.color, blending: NoBlending, side: DoubleSide, toneMapped: false });
    tmp.push(mat);
    const q = new Mesh(quad, mat);
    q.position.set((i % G) + 0.5, Math.floor(i / G) + 0.5, 0);
    scene.add(q);
  });
  const cam = new OrthographicCamera(0, G, G, 0, -1, 1);
  const prevRt = renderer.getRenderTarget(), prevAuto = renderer.autoClear, prevAlpha = renderer.getClearAlpha();
  const prevColor = renderer.getClearColor(new Color());
  renderer.setRenderTarget(rt);
  renderer.autoClear = true;
  renderer.setClearColor(0x000000, 0);
  renderer.render(scene, cam);
  renderer.setRenderTarget(prevRt);
  renderer.autoClear = prevAuto;
  renderer.setClearColor(prevColor, prevAlpha);
  for (const m of tmp) m.dispose();
  quad.dispose();

  const material = new MeshLambertMaterial({ map: rt.texture, alphaTest: 0.4, side: DoubleSide });
  const fused: Fused = { geometry, material, rt, tris: ni / 3 };
  cache.set(key, fused);
  if (cache.size > CACHE_MAX) {
    // descarta o mais antigo; quem ainda o usa continua válido até trocar (não liberamos a GPU de um item em uso: só tira do cache)
    const first = cache.keys().next().value as string;
    cache.delete(first);
  }
  return fused;
}
