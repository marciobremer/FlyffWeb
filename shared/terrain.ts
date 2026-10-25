import {
  BufferAttribute, BufferGeometry, Color, DataTexture, Group, LessEqualDepth, LinearFilter, Mesh, MeshLambertMaterial, RGBAFormat,
  Matrix4, RepeatWrapping, ShaderMaterial, UniformsLib, UniformsUtils, Vector3, type Texture, UnsignedByteType, ClampToEdgeWrapping,
} from 'three';
import { loadDds } from './dds';
import type { Landscape } from './formats/lnd';
import { MAP_SIZE, PATCHES } from './formats/types';

export type ColorMode = 'textures' | 'layers' | 'attrs' | 'height';
const N = MAP_SIZE + 1;
const PATCH = MAP_SIZE / PATCHES; // 8 células

// ---------- cores (modos sem textura) ----------
const layerColorCache = new Map<number, Color>();
/** Cor determinística (tons terrosos/verdes) por textureID — usada nos modos sem textura e como placeholder. */
export function layerColor(textureId: number): Color {
  let c = layerColorCache.get(textureId);
  if (!c) {
    const f = ((textureId * 0.61803398875) % 1 + 1) % 1;
    c = new Color().setHSL(0.04 + 0.38 * f, 0.3 + 0.15 * ((textureId * 7) % 3) / 2, 0.36 + 0.1 * (((textureId * 5) % 4) / 3));
    layerColorCache.set(textureId, c);
  }
  return c;
}
const ATTR_COLORS = [new Color(0x5d8f4a), new Color(0xd9a441), new Color(0x4d8fd9), new Color(0x555a63), new Color(0xd94444)];

export function fillColors(land: Landscape, mode: ColorMode, out: Float32Array) {
  const c = new Color(), cs = new Color();
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const v = j * N + i;
      if (mode === 'attrs') c.copy(ATTR_COLORS[land.attrs[v]] ?? ATTR_COLORS[0]);
      else if (mode === 'height') {
        const t = Math.min(1, Math.max(0, land.heights[v] / 250));
        c.setHSL(0.33 - 0.33 * t, 0.5, 0.25 + 0.35 * t);
      } else {
        const cell = Math.min(j, MAP_SIZE - 1) * MAP_SIZE + Math.min(i, MAP_SIZE - 1);
        c.set(0x808080);
        let first = true;
        for (const layer of land.layers) {
          const a = layer.alpha[cell] / 255;
          if (first) { c.copy(layerColor(layer.textureId)); first = false; } else if (a > 0) c.lerp(cs.copy(layerColor(layer.textureId)), a);
        }
        if (land.attrs[v] === 3) c.multiplyScalar(0.55);
      }
      out[v * 3] = c.r; out[v * 3 + 1] = c.g; out[v * 3 + 2] = c.b;
    }
  }
}

// ---------- texturas de terreno ----------
/** Carrega `World/Texture/<arquivo>.dds` (nomes vindos de Terrain.inc) com cache. */
export class TerrainTextures {
  private cache = new Map<number, Promise<Texture | null>>();
  constructor(private names: Map<number, string>, private files: Set<string>) {}
  reset(names: Map<number, string>, files: Set<string>) { this.names = names; this.files = files; this.cache.clear(); }
  has(id: number) { const n = this.names.get(id); return !!n && this.files.has(n.toLowerCase()); }
  get(id: number): Promise<Texture | null> {
    let p = this.cache.get(id);
    if (!p) {
      const n = this.names.get(id);
      p = n && this.files.has(n.toLowerCase())
        ? loadDds('/res/World/Texture/' + encodeURIComponent(n)).then((t) => {
          if (t) { t.wrapS = t.wrapT = RepeatWrapping; t.needsUpdate = true; }
          return t;
        })
        : Promise.resolve(null);
      this.cache.set(id, p);
    }
    return p;
  }
}

// ---------- material de camada ----------
const VERT = /* glsl */ `
  attribute vec2 uv2;
  uniform mat4 shadowMatrix;
  varying vec2 vUv; varying vec2 vUv2; varying vec3 vN; varying vec4 vShadow;
  #include <fog_pars_vertex>
  void main() {
    vUv = uv; vUv2 = uv2;
    vShadow = shadowMatrix * modelMatrix * vec4(position, 1.0);
    vN = normalize(mat3(modelMatrix) * normal); // modelMatrix é ortonormal (espelho em Z)
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }`;
const FRAG = /* glsl */ `
  #include <packing>
  uniform sampler2D map; uniform sampler2D lightMap; uniform vec3 lightDir; uniform vec3 uAmbient; uniform vec3 uDiffuse; uniform float uLit; uniform float blend;
  uniform sampler2D shadowMap; uniform float shadowOn; uniform float shadowTexel; uniform float shadowBias; uniform float shadowSoft;
  varying vec2 vUv; varying vec2 vUv2; varying vec3 vN; varying vec4 vShadow;
  #include <fog_pars_fragment>
  // comparação de profundidade com interpolação bilinear entre os 4 pixels vizinhos do mapa (sem os degraus de 1 pixel)
  float shadowCmp(vec2 uv, float z) { return step(z, unpackRGBAToDepth(texture2D(shadowMap, uv))); }
  float shadowBilinear(vec2 uv, float z) {
    vec2 t = uv / shadowTexel - 0.5, f = fract(t), b = (floor(t) + 0.5) * shadowTexel;
    float a = shadowCmp(b, z), r = shadowCmp(b + vec2(shadowTexel, 0.0), z);
    float u = shadowCmp(b + vec2(0.0, shadowTexel), z), ur = shadowCmp(b + vec2(shadowTexel), z);
    return mix(mix(a, r, f.x), mix(u, ur, f.x), f.y);
  }
  // PCF 3x3 bilinear com raio \`shadowSoft\` (pixels do mapa; 0 = só o bilinear) sobre o mapa de profundidade empacotado
  // (mesmo formato do WebGLShadowMap do Three); perto da borda da área coberta a sombra esmaece em vez de cortar seco
  float terrainShadowAt() {
    if (shadowOn < 0.5) return 1.0;
    vec3 c = vShadow.xyz / vShadow.w;
    if (c.x < 0.0 || c.x > 1.0 || c.y < 0.0 || c.y > 1.0 || c.z > 1.0) return 1.0;
    c.z += shadowBias;
    float s = 0.0;
    for (int i = -1; i <= 1; i++) for (int j = -1; j <= 1; j++)
      s += shadowBilinear(c.xy + vec2(float(i), float(j)) * shadowTexel * shadowSoft, c.z);
    float edge = smoothstep(0.0, 0.08, min(min(c.x, 1.0 - c.x), min(c.y, 1.0 - c.y)));
    return mix(1.0, s / 9.0, edge);
  }
  void main() {
    vec4 lm = texture2D(lightMap, vUv2);
    vec3 tex = texture2D(map, vUv).rgb;
    // estágio 1 do D3D: modulação 2x com a cor da lightmap (127 = neutro)
    vec3 col = tex * lm.rgb * 2.0;
    // iluminação D3D de função fixa: ambiente + difusa·N·L (limitada a 1); uLit=0 → sem luz (como o ATools)
    vec3 l = mix(vec3(1.0), clamp(uAmbient + uDiffuse * max(dot(normalize(vN), lightDir), 0.0) * terrainShadowAt(), 0.0, 1.0), uLit);
    gl_FragColor = vec4(col * l, mix(1.0, lm.a, blend));
    #include <fog_fragment>
  }`;

/** Uniformes de luz compartilhados por todos os materiais de terreno (atualizados por environment). `lightDir` aponta PARA a luz, em espaço Three. */
export const terrainLight = {
  lightDir: { value: new Vector3(0, 1, 0) },
  uAmbient: { value: new Color(0.6, 0.6, 0.6) },
  uDiffuse: { value: new Color(0.4, 0.4, 0.4) },
  uLit: { value: 1 },
};
/** Sombras do sol no terreno (o shadow map do DirectionalLight é amostrado à mão no shader). */
export const terrainShadow = {
  shadowMap: { value: null as Texture | null },
  shadowMatrix: { value: new Matrix4() },
  shadowOn: { value: 0 },
  shadowTexel: { value: 1 / 4096 },
  shadowBias: { value: -0.0006 },
  /** raio do filtro (pixels do mapa de sombra): suavidade da borda */
  shadowSoft: { value: 1.5 },
};

function layerMaterial(map: Texture, lightMap: Texture, blend: boolean, order: number): ShaderMaterial {
  const m = new ShaderMaterial({
    uniforms: { ...UniformsUtils.merge([UniformsLib.fog, { map: { value: map }, lightMap: { value: lightMap }, blend: { value: blend ? 1 : 0 } }]), ...terrainLight, ...terrainShadow },
    vertexShader: VERT, fragmentShader: FRAG, fog: true,
    transparent: blend, depthWrite: !blend, depthFunc: LessEqualDepth,
    polygonOffset: blend, polygonOffsetFactor: -1 - order * 0.1, polygonOffsetUnits: -1 - order,
  });
  return m;
}

function lightmapTexture(rgb: Uint8Array, alpha: Uint8Array): DataTexture {
  const px = new Uint8Array(MAP_SIZE * MAP_SIZE * 4);
  for (let i = 0; i < MAP_SIZE * MAP_SIZE; i++) {
    px[i * 4] = rgb[i * 3]; px[i * 4 + 1] = rgb[i * 3 + 1]; px[i * 4 + 2] = rgb[i * 3 + 2]; px[i * 4 + 3] = alpha[i];
  }
  const t = new DataTexture(px, MAP_SIZE, MAP_SIZE, RGBAFormat, UnsignedByteType);
  t.minFilter = t.magFilter = LinearFilter;
  t.wrapS = t.wrapT = ClampToEdgeWrapping;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
}

// ---------- geometria ----------
function baseAttributes(land: Landscape, mpu: number) {
  const pos = new Float32Array(N * N * 3), uv = new Float32Array(N * N * 2), uv2 = new Float32Array(N * N * 2);
  const ox = land.tileX * MAP_SIZE, oz = land.tileY * MAP_SIZE;
  // Landscape.cpp:_setVertices — tu1 = j/8*3; tu2 = (x * (112/128)/128) + 1/256 (lightmap de 128 usa só 112 texels)
  const k2 = ((PATCH - 1) * PATCHES) / MAP_SIZE / MAP_SIZE;
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const v = j * N + i;
      pos[v * 3] = (ox + i) * mpu; pos[v * 3 + 1] = land.heights[v]; pos[v * 3 + 2] = (oz + j) * mpu;
      uv[v * 2] = (i / PATCH) * 3; uv[v * 2 + 1] = (j / PATCH) * 3;
      uv2[v * 2] = k2 * i + 0.5 / MAP_SIZE; uv2[v * 2 + 1] = k2 * j + 0.5 / MAP_SIZE;
    }
  }
  return { pos, uv, uv2 };
}

/** winding escolhido para que as normais apontem para +Y no espaço de dados */
function patchIndices(patches: number[]): Uint32Array {
  const idx = new Uint32Array(patches.length * PATCH * PATCH * 6);
  let k = 0;
  for (const p of patches) {
    const px = p % PATCHES, pz = Math.floor(p / PATCHES);
    for (let j = pz * PATCH; j < (pz + 1) * PATCH; j++) {
      for (let i = px * PATCH; i < (px + 1) * PATCH; i++) {
        const a = j * N + i, b = a + 1, c = a + N, d = c + 1;
        idx[k++] = a; idx[k++] = c; idx[k++] = b;
        idx[k++] = b; idx[k++] = c; idx[k++] = d;
      }
    }
  }
  return idx;
}
const allPatches = Array.from({ length: PATCHES * PATCHES }, (_, i) => i);

let vertexColorMaterial: MeshLambertMaterial | null = null;

function buildVertexColorMesh(land: Landscape, mpu: number, mode: ColorMode): Mesh {
  const { pos } = baseAttributes(land, mpu);
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(pos, 3));
  const colors = new Float32Array(N * N * 3);
  fillColors(land, mode, colors);
  geo.setAttribute('color', new BufferAttribute(colors, 3));
  geo.setIndex(new BufferAttribute(patchIndices(allPatches), 1));
  geo.computeVertexNormals();
  geo.computeBoundingSphere(); geo.computeBoundingBox();
  const mesh = new Mesh(geo, (vertexColorMaterial ??= new MeshLambertMaterial({ vertexColors: true })));
  mesh.receiveShadow = true;
  mesh.userData.kind = 'terrain';
  return mesh;
}

/**
 * Terreno de um tile. Em 'textures' reproduz o render original: uma passada por camada (CLandscape::Render);
 * em cada patch a primeira camada habilitada é opaca e as seguintes são misturadas pelo alpha da lightmap.
 */
export function buildTerrain(land: Landscape, mpu: number, mode: ColorMode, tex: TerrainTextures): Group {
  const group = new Group();
  group.userData.mode = mode;
  if (mode !== 'textures') { group.add(buildVertexColorMesh(land, mpu, mode)); return group; }

  const { pos, uv, uv2 } = baseAttributes(land, mpu);
  const shared = new BufferGeometry();
  shared.setAttribute('position', new BufferAttribute(pos, 3));
  shared.setAttribute('uv', new BufferAttribute(uv, 2));
  shared.setAttribute('uv2', new BufferAttribute(uv2, 2));
  const tmp = new BufferGeometry();
  tmp.setAttribute('position', shared.getAttribute('position'));
  tmp.setIndex(new BufferAttribute(patchIndices(allPatches), 1));
  tmp.computeVertexNormals();
  shared.setAttribute('normal', tmp.getAttribute('normal'));
  tmp.dispose();
  shared.computeBoundingSphere(); shared.computeBoundingBox();

  // cor compartilhada pelas lightmaps: a de qualquer camada onde alpha > 0 (a última vence), 127 caso contrário
  const rgb = new Uint8Array(MAP_SIZE * MAP_SIZE * 3).fill(127);
  for (const l of land.layers) for (let i = 0; i < MAP_SIZE * MAP_SIZE; i++) if (l.alpha[i] > 0) { rgb[i * 3] = l.rgb[i * 3]; rgb[i * 3 + 1] = l.rgb[i * 3 + 1]; rgb[i * 3 + 2] = l.rgb[i * 3 + 2]; }

  const drawn = new Uint8Array(PATCHES * PATCHES);
  land.layers.forEach((layer, li) => {
    const opaque: number[] = [], blended: number[] = [];
    for (let p = 0; p < PATCHES * PATCHES; p++) {
      if (!layer.patchEnable[p]) continue;
      (drawn[p] ? blended : opaque).push(p);
      drawn[p] = 1;
    }
    if (!opaque.length && !blended.length) return;
    const lightMap = lightmapTexture(rgb, layer.alpha);
    const pending = new DataTexture(new Uint8Array([...layerColor(layer.textureId).toArray().map((v) => Math.round(v * 255)), 255]), 1, 1, RGBAFormat);
    pending.needsUpdate = true;
    const mats: ShaderMaterial[] = [];
    for (const [list, blend] of [[opaque, false], [blended, true]] as const) {
      if (!list.length) continue;
      const g = new BufferGeometry();
      for (const name of ['position', 'uv', 'uv2', 'normal']) g.setAttribute(name, shared.getAttribute(name));
      g.setIndex(new BufferAttribute(patchIndices(list), 1));
      g.boundingSphere = shared.boundingSphere; g.boundingBox = shared.boundingBox;
      const mat = layerMaterial(pending, lightMap, blend, li);
      mats.push(mat);
      const mesh = new Mesh(g, mat);
      mesh.renderOrder = li;
      mesh.userData.kind = 'terrain';
      group.add(mesh);
    }
    void tex.get(layer.textureId).then((t) => { if (t) for (const m of mats) m.uniforms.map.value = t; });
  });
  return group;
}

export function disposeTerrain(group: Group) {
  group.traverse((o) => {
    if (o instanceof Mesh) {
      o.geometry.dispose();
      const m = o.material as ShaderMaterial;
      if (m.uniforms?.lightMap) (m.uniforms.lightMap.value as Texture).dispose();
      if (m.isShaderMaterial) m.dispose();
    }
  });
}

export function setTerrainWireframe(group: Group, on: boolean) {
  group.traverse((o) => { if (o instanceof Mesh) (o.material as ShaderMaterial | MeshLambertMaterial).wireframe = on; });
}
