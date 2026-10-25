import { AddEquation, BufferAttribute, CustomBlending, OneFactor, SrcAlphaFactor, BufferGeometry, type Camera, Mesh, PerspectiveCamera, Points, ShaderMaterial, Vector2, Vector3, type WebGLRenderer } from 'three';
import type { WorldData } from './data';
import { handAttachment, slotOf, type Sex } from './humans';
import { GLOW_FROM, GLOW_TAG, parseLook } from './look';
import type { MoverInstance } from './movers';

/**
 * Brilho do enchant. No mundo, o efeito do CONJUNTO são os .sfx do jogo (WorldView.attachSetSfx); a fumaça de partículas
 * abaixo (`setAura`) só é usada na prévia do inventário, que não tem os efeitos do mundo.
 * (descrição original, como no FlyFF Universe):
 * - armadura, pelo CONJUNTO (capacete, roupa, luvas e botas, o menor enchant decide — shared/look.ts setGlowLevel): +3 uma
 *   fumacinha azul leve sobe do corpo, +5 mais forte, +8 muito forte, +10 ultra forte, a ponto de o personagem quase sumir
 *   na fumaça; +8 ganha uma bola de luz azul pulsando e piscando na mão esquerda, +10 nas duas; vale também por baixo da
 *   roupa de cash. A fumaça fica em VOLTA do corpo (aura, tipo super saiyajin): só aparece no contorno visto pela câmera,
 *   nunca na frente do rosto/peito;
 * - arma (ou escudo) a partir do +3: envolta em luz azul; com elemento, também partículas da cor do elemento.
 * No original (CModelObject::CreateParticle) as partículas nascem ao longo da lâmina; aqui nascem em vértices sorteados da
 * própria malha da peça (já com a pose do quadro), então funciona igual para armadura, arco, ioiô e escudo.
 * Tudo num único `Points` por personagem, em espaço do modelo (acompanha o corpo), com mistura aditiva.
 */

/** cor de cada elemento (0 nenhum, 1 fogo, 2 água, 3 elétrico, 4 vento, 5 terra) */
const ELEMENT_COLOR: [number, number, number][] = [[0.3, 0.55, 1], [1, 0.42, 0.08], [0.2, 0.65, 1], [1, 0.92, 0.3], [0.35, 1, 0.5], [0.9, 0.62, 0.25]];
const BLUE: [number, number, number] = [0.28, 0.55, 1];
/** quanto cada tipo de peça solta (pelo tamanho da malha): roupa inteira 1, capacete, botas e luvas menos */
const PART_WEIGHT: Record<string, number> = { upper: 1, lower: 0.6, cap: 0.15, foot: 0.35, hand: 0.25, cloak: 0.6, mask: 0.3 };
/** partículas simuladas; depois delas vão as bolas dos punhos (ORBS, fixas, redesenhadas a cada quadro) */
const MAX = 640, ORBS = 4;
/** fumaça do conjunto por nível (1 = +3, 2 = +5, 3 = +8, 4 = +10): partículas/s (peça de peso 1), opacidade, tamanho final, subida */
const SET_TIER = [
  null,
  { rate: 12, alpha: 0.14, size: 0.42, rise: 0.16 },
  { rate: 34, alpha: 0.24, size: 0.58, rise: 0.19 },
  { rate: 55, alpha: 0.3, size: 0.72, rise: 0.22 },
  { rate: 100, alpha: 0.42, size: 0.95, rise: 0.25 },
];
const ORB_COLOR: [number, number, number] = [0.55, 0.78, 1];

interface Emitter {
  meshes: Mesh[];
  /** partículas por segundo e acumulado */
  rate: number; acc: number;
  color: [number, number, number];
  /** vida (s), tamanho inicial/final, subida (unidades/s), espalhamento, opacidade */
  life: [number, number]; size: [number, number]; rise: number; spread: number; alpha: number;
  /** fumaça do conjunto: desenhada como aura (só no contorno) */
  aura?: boolean;
}

const VERT = `
attribute float aSize; attribute float aAlpha; attribute vec3 aColor; attribute float aAura;
uniform float uScale;
varying float vAlpha; varying vec3 vColor;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * uScale / max(0.1, -mv.z);
  vAlpha = aAlpha; vColor = aColor;
  vec3 toCam = normalize(-mv.xyz);
  if (aAura > 0.5) {
    // aura: distância ao eixo do corpo (x = z = 0 do modelo, na mesma altura) vista pela câmera. A parte que aponta para a
    // câmera (na frente do rosto/peito) some; a que fica de lado (o contorno) brilha e é empurrada um pouco para fora.
    vec3 axis = (modelViewMatrix * vec4(0.0, position.y, 0.0, 1.0)).xyz;
    vec3 r = mv.xyz - axis;
    vec3 side = r - toCam * dot(r, toCam);
    float rl = length(r), sl = length(side);
    float rim = rl > 1e-4 ? sl / rl : 0.0;
    vAlpha *= smoothstep(0.45, 0.95, rim) * 1.35;
    if (sl > 1e-4) mv.xyz += side / sl * 0.16;
    mv.xyz += toCam * min(0.2, -mv.z * 0.5);
  } else {
    // as partículas nascem NA peça: metade fica "atrás" dela e o teste de profundidade escondia o brilho conforme o ângulo
    // da câmera. Puxa cada uma um pouco para a câmera (continua escondida atrás de paredes e do chão).
    mv.xyz += toCam * min(0.45, -mv.z * 0.5);
  }
  gl_Position = projectionMatrix * mv;
}`;
const FRAG = `
varying float vAlpha; varying vec3 vColor;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float a = vAlpha * pow(max(0.0, 1.0 - d), 1.6);
  if (a < 0.003) discard;
  gl_FragColor = vec4(vColor, a);
}`;

const tmp = new Vector3();
const drawSize = new Vector2();
const rnd = (a: number, b: number) => a + Math.random() * (b - a);

export class EnchantGlow {
  private emitters: Emitter[] = [];
  private pos = new Float32Array((MAX + ORBS) * 3);
  private vel = new Float32Array(MAX * 3);
  private col = new Float32Array((MAX + ORBS) * 3);
  private size = new Float32Array(MAX + ORBS);
  private alpha = new Float32Array(MAX + ORBS);
  private aura = new Float32Array(MAX + ORBS);
  /** idade, vida, tamanho inicial/final, opacidade máxima */
  private age = new Float32Array(MAX);
  private life = new Float32Array(MAX);
  private s0 = new Float32Array(MAX);
  private s1 = new Float32Array(MAX);
  private a0 = new Float32Array(MAX);
  private n = 0;
  private points: Points;
  private geo = new BufferGeometry();
  private mat: ShaderMaterial;
  /** ossos dos punhos para as bolas de luz (+10); vazio = sem bolas */
  private orbBones: number[] = [];
  private clock = 0;

  /** `equip`: lista do visual (shared/look.ts, com `@enchant.elemento.nível`); null se nada brilha */
  static create(inst: MoverInstance, equip: string[], sex: Sex, data: WorldData, setAura = true): EnchantGlow | null {
    const g = new EnchantGlow(inst);
    const byFile = (file: string) => inst.meshFiles.filter((m) => m.file.toLowerCase() === file.toLowerCase()).map((m) => m.mesh);
    for (const s of equip) {
      if (s.startsWith(GLOW_TAG)) {
        const lv = Number(s.slice(GLOW_TAG.length));
        if (setAura) g.addSetGlow(lv >= 10 ? 4 : lv >= 8 ? 3 : lv >= 5 ? 2 : lv >= 3 ? 1 : 0);
        continue;
      }
      const { sym, u, e, el } = parseLook(s);
      if (u < GLOW_FROM && !e) continue;
      const hand = handAttachment(data, sym);
      const meshes = hand ? byFile(hand.file) : [];
      if (!meshes.length) continue;
      const k = Math.min(1, Math.max(0, (u - GLOW_FROM) / (10 - GLOW_FROM)));
      {
        if (u >= GLOW_FROM) g.emitters.push({ meshes, rate: 14 + 30 * k, acc: 0, color: BLUE, life: [0.3, 0.7], size: [0.12 + 0.05 * k, 0.03], rise: 0.06, spread: 0.04, alpha: 0.25 + 0.2 * k });
        if (e > 0 && e < ELEMENT_COLOR.length) {
          const ke = Math.min(1, Math.max(0, el / 10));
          g.emitters.push({ meshes, rate: 10 + 26 * ke, acc: 0, color: ELEMENT_COLOR[e], life: [0.35, 0.8], size: [0.14 + 0.06 * ke, 0.03], rise: e === 1 ? 0.6 : e === 4 ? 0.3 : 0.12, spread: e === 3 ? 0.3 : 0.1, alpha: 0.3 + 0.22 * ke });
        }
      }
    }
    if (!g.emitters.length && !g.orbBones.length) { g.dispose(); return null; }
    return g;
  }

  /**
   * Fumaça do conjunto: sai de todas as malhas do corpo que estão à mostra (roupa, luvas, botas, capacete — inclusive de
   * cash), cada uma pelo tamanho: luvas e botas são malhas pequenas (os vértices ficam todos nos punhos/pés), soltam menos.
   */
  private addSetGlow(tier: number) {
    const t = SET_TIER[tier];
    if (!t) return;
    for (const { mesh, file } of this.inst.meshFiles) {
      const m = /^Part_(.+)\.o3d$/i.exec(file);
      if (!m) continue;
      const w = PART_WEIGHT[slotOf(m[1])];
      if (w === undefined) continue; // cabeça, cabelo
      this.emitters.push({ meshes: [mesh], rate: t.rate * w, acc: 0, color: BLUE, life: [0.7 + 0.08 * tier, 1.1 + 0.1 * tier], // fica em volta do corpo: sobe pouco e some antes de passar da cabeça
        size: [0.14 * (0.6 + 0.4 * w), t.size * (0.6 + 0.4 * w)], rise: t.rise, spread: 0.08 + 0.03 * tier, alpha: t.alpha, aura: true });
    }
    // bolas de luz: +8 na mão esquerda, +10 nas duas
    const sk = this.inst.tpl.skeleton;
    this.orbBones = (tier >= 4 ? [sk.lHand, sk.rHand] : tier >= 3 ? [sk.lHand] : []).filter((b) => b >= 0);
  }

  private constructor(private inst: MoverInstance) {
    const geo = this.geo;
    geo.setAttribute('position', new BufferAttribute(this.pos, 3));
    geo.setAttribute('aColor', new BufferAttribute(this.col, 3));
    geo.setAttribute('aSize', new BufferAttribute(this.size, 1));
    geo.setAttribute('aAlpha', new BufferAttribute(this.alpha, 1));
    geo.setAttribute('aAura', new BufferAttribute(this.aura, 1));
    geo.setDrawRange(0, 0);
    // aditivo na cor e também no alfa (src + dst): no canvas transparente da prévia do inventário o brilho precisa somar opacidade
    this.mat = new ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms: { uScale: { value: 400 } }, transparent: true, depthWrite: false,
      blending: CustomBlending, blendEquation: AddEquation, blendSrc: SrcAlphaFactor, blendDst: OneFactor, blendSrcAlpha: OneFactor, blendDstAlpha: OneFactor });
    this.points = new Points(geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    // tamanho em pixels: segue a altura da tela e o campo de visão de quem desenha (vale também para a prévia do inventário)
    this.points.onBeforeRender = (renderer: WebGLRenderer, _s, camera: Camera) => {
      const fov = camera instanceof PerspectiveCamera ? camera.fov : 45;
      this.mat.uniforms.uScale.value = renderer.getDrawingBufferSize(drawSize).y * 0.5 / Math.tan((fov * Math.PI) / 360);
    };
    inst.modelSpace.add(this.points);
  }

  update(dt: number) {
    dt = Math.min(dt, 0.1);
    for (const em of this.emitters) {
      em.acc += em.rate * dt;
      while (em.acc >= 1) { em.acc--; this.spawn(em); }
    }
    let w = 0;
    for (let i = 0; i < this.n; i++) {
      const age = this.age[i] + dt;
      if (age >= this.life[i]) continue;
      const t = age / this.life[i];
      // compacta as vivas no começo dos arrays
      if (w !== i) {
        for (let c = 0; c < 3; c++) { this.pos[w * 3 + c] = this.pos[i * 3 + c]; this.vel[w * 3 + c] = this.vel[i * 3 + c]; this.col[w * 3 + c] = this.col[i * 3 + c]; }
        this.aura[w] = this.aura[i]; this.life[w] = this.life[i]; this.s0[w] = this.s0[i]; this.s1[w] = this.s1[i]; this.a0[w] = this.a0[i];
      }
      this.age[w] = age;
      for (let c = 0; c < 3; c++) this.pos[w * 3 + c] += this.vel[w * 3 + c] * dt;
      this.size[w] = this.s0[w] + (this.s1[w] - this.s0[w]) * t;
      this.alpha[w] = this.a0[w] * Math.min(1, t * 5) * (1 - t);
      w++;
    }
    this.n = w;
    // bolas de luz nos punhos (+10): halo grande e núcleo claro em cada osso da mão, pulsando e piscando
    this.clock += dt;
    let o = w;
    for (const [k, bone] of this.orbBones.entries()) {
      const m = this.inst.boneMatrix(bone);
      if (!m) continue;
      tmp.setFromMatrixPosition(m);
      const pulse = 0.5 + 0.5 * Math.sin(this.clock * 7 + k * 1.7), blink = 0.55 + 0.45 * Math.abs(Math.sin(this.clock * 11 + k));
      for (const [size, alpha, white] of [[1.1 + 0.45 * pulse, 0.45 * blink, 0], [0.42 + 0.15 * pulse, 0.95 * blink, 0.6]]) {
        this.pos[o * 3] = tmp.x; this.pos[o * 3 + 1] = tmp.y; this.pos[o * 3 + 2] = tmp.z;
        for (let c = 0; c < 3; c++) this.col[o * 3 + c] = ORB_COLOR[c] + (1 - ORB_COLOR[c]) * white;
        this.size[o] = size; this.alpha[o] = alpha; this.aura[o] = 0;
        o++;
      }
    }
    this.geo.setDrawRange(0, o);
    for (const name of ['position', 'aColor', 'aSize', 'aAlpha', 'aAura']) (this.geo.getAttribute(name) as BufferAttribute).needsUpdate = true;
  }

  private spawn(em: Emitter) {
    if (this.n >= MAX) return;
    const mesh = em.meshes[(Math.random() * em.meshes.length) | 0];
    const count = mesh.geometry.getAttribute('position').count;
    if (!count) return;
    // posição do vértice com a pose atual (skinning) e, para a arma presa à mão, a matriz da malha
    mesh.getVertexPosition((Math.random() * count) | 0, tmp);
    tmp.applyMatrix4(mesh.matrix);
    const i = this.n++;
    this.pos[i * 3] = tmp.x + rnd(-em.spread, em.spread) * 0.3; this.pos[i * 3 + 1] = tmp.y; this.pos[i * 3 + 2] = tmp.z + rnd(-em.spread, em.spread) * 0.3;
    this.vel[i * 3] = rnd(-em.spread, em.spread); this.vel[i * 3 + 1] = em.rise * rnd(0.6, 1.3); this.vel[i * 3 + 2] = rnd(-em.spread, em.spread);
    this.col[i * 3] = em.color[0]; this.col[i * 3 + 1] = em.color[1]; this.col[i * 3 + 2] = em.color[2];
    this.age[i] = 0; this.life[i] = rnd(em.life[0], em.life[1]);
    this.s0[i] = em.size[0] * rnd(0.7, 1.2); this.s1[i] = em.size[1] * rnd(0.7, 1.2); this.a0[i] = em.alpha;
    this.size[i] = this.s0[i]; this.alpha[i] = 0; this.aura[i] = em.aura ? 1 : 0;
  }

  dispose() {
    this.points.removeFromParent();
    this.geo.dispose();
    this.mat.dispose();
    if (this.inst.effect === this) this.inst.effect = null;
  }
}

/** liga (ou troca) o brilho de um personagem conforme o visual */
/** `setAura` false: o conjunto fica por conta dos .sfx do mundo (WorldView.attachSetSfx) */
export function applyEnchantGlow(inst: MoverInstance, equip: string[], sex: Sex, data: WorldData, setAura = true) {
  inst.effect?.dispose();
  inst.effect = EnchantGlow.create(inst, equip, sex, data, setAura);
}
