import {
  Color, DepthTexture, Mesh, OrthographicCamera, PlaneGeometry, Scene, ShaderMaterial, UnsignedIntType, Vector2,
  WebGLRenderTarget, type PerspectiveCamera, type WebGLRenderer,
} from 'three';
import type { FilterSettings } from './worldedits';

/**
 * Filtros de tela (pós-processamento). A cena é desenhada numa textura (cor + profundidade) e um quad de tela aplica o
 * filtro. "zelda" imita o visual de Breath of the Wild: contorno pela profundidade, luz em faixas suaves (cel), cores
 * mais saturadas com sombras frias e luzes quentes, brilho suave nas partes claras e névoa azulada na distância.
 * As cores do renderer já saem em espaço de tela (outputColorSpace linear sem conversão), então o shader trabalha nelas direto.
 */
export const defaultFilter = (): FilterSettings => ({ filter: 'none', strength: 1, outline: true, saturation: 1 });

/** distância (unidades) em que o contorno some e a névoa começa/termina */
const OUTLINE_FADE = 220, HAZE_START = 60, HAZE_END = 900;

const vert = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const frag = /* glsl */ `
uniform sampler2D tColor;
uniform sampler2D tDepth;
uniform vec2 texel;
uniform float cNear, cFar, strength, outline, saturation;
uniform vec3 haze;
varying vec2 vUv;

float lin(vec2 uv) {
  float z = texture2D(tDepth, uv).x * 2.0 - 1.0;
  return 2.0 * cNear * cFar / (cFar + cNear - z * (cFar - cNear));
}
float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

void main() {
  vec3 src = texture2D(tColor, vUv).rgb;
  float raw = texture2D(tDepth, vUv).x;
  bool sky = raw >= 0.99999;
  float d = lin(vUv);
  vec3 c = src;

  // brilho suave: média das partes claras ao redor (dois anéis)
  vec3 glow = vec3(0.0);
  for (int i = 0; i < 12; i++) {
    float a = float(i) * 0.5236;
    vec2 o = vec2(cos(a), sin(a));
    vec3 s1 = texture2D(tColor, vUv + o * texel * 5.0).rgb;
    vec3 s2 = texture2D(tColor, vUv + o * texel * 11.0).rgb;
    glow += s1 * max(luma(s1) - 0.62, 0.0) + s2 * max(luma(s2) - 0.62, 0.0) * 0.6;
  }
  glow /= 12.0;

  if (!sky) {
    // luz em faixas suaves (cel): puxa a luminância para 4 degraus sem perder a textura
    float l = luma(c);
    float bands = floor(l * 4.0 + 0.5) / 4.0;
    float toon = mix(l, mix(bands, l, 0.45), 0.8);
    c *= (toon + 0.02) / (l + 0.02);
  }

  // saturação e contraste
  float l2 = luma(c);
  c = mix(vec3(l2), c, 1.32 * saturation);
  c = (c - 0.5) * 1.08 + 0.5;
  // sombras frias (azul-esverdeado), luzes quentes (amarelo)
  float t = smoothstep(0.15, 0.85, l2);
  c *= mix(vec3(0.90, 0.97, 1.08), vec3(1.07, 1.02, 0.90), t);
  c += glow * 0.55;

  if (!sky) {
    // névoa azulada da distância (perspectiva aérea)
    float h = smoothstep(${HAZE_START.toFixed(1)}, ${HAZE_END.toFixed(1)}, d) * 0.55;
    c = mix(c, haze, h);
    // contorno: diferença relativa de profundidade com os vizinhos
    if (outline > 0.5) {
      float e = 0.0;
      e += abs(lin(vUv + vec2(texel.x, 0.0)) - d);
      e += abs(lin(vUv - vec2(texel.x, 0.0)) - d);
      e += abs(lin(vUv + vec2(0.0, texel.y)) - d);
      e += abs(lin(vUv - vec2(0.0, texel.y)) - d);
      float edge = smoothstep(0.06, 0.16, e / max(d, 1.0)) * (1.0 - smoothstep(${(OUTLINE_FADE * 0.5).toFixed(1)}, ${OUTLINE_FADE.toFixed(1)}, d));
      c = mix(c, c * 0.28 + vec3(0.02, 0.03, 0.06), edge * 0.85);
    }
  }

  // vinheta leve
  vec2 v = vUv - 0.5;
  c *= 1.0 - dot(v, v) * 0.45;

  gl_FragColor = vec4(mix(src, clamp(c, 0.0, 1.0), strength), 1.0);
}`;

export class PostFx {
  settings: FilterSettings = defaultFilter();
  private rt: WebGLRenderTarget | null = null;
  private readonly scene = new Scene();
  private readonly cam = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly mat = new ShaderMaterial({
    vertexShader: vert, fragmentShader: frag, depthTest: false, depthWrite: false,
    uniforms: {
      tColor: { value: null }, tDepth: { value: null }, texel: { value: new Vector2() },
      cNear: { value: 1 }, cFar: { value: 1000 }, strength: { value: 1 }, outline: { value: 1 }, saturation: { value: 1 }, haze: { value: new Color(0.66, 0.8, 0.95) },
    },
  });

  constructor(private readonly renderer: WebGLRenderer) {
    const quad = new Mesh(new PlaneGeometry(2, 2), this.mat);
    quad.frustumCulled = false;
    this.scene.add(quad);
  }

  get active() { return this.settings.filter !== 'none' && this.settings.strength > 0; }

  /** Começa o quadro: com filtro ativo, desenha numa textura do tamanho da tela; sem filtro, direto na tela. */
  begin() {
    const r = this.renderer;
    if (!this.active) { r.setRenderTarget(null); return; }
    const size = r.getDrawingBufferSize(new Vector2());
    if (!this.rt || this.rt.width !== size.x || this.rt.height !== size.y) {
      this.rt?.dispose();
      const depth = new DepthTexture(size.x, size.y, UnsignedIntType);
      this.rt = new WebGLRenderTarget(size.x, size.y, { depthTexture: depth, samples: 4 });
    }
    r.setRenderTarget(this.rt);
  }

  /** Termina o quadro: aplica o filtro na tela. `haze` = cor da névoa/céu do ambiente atual. */
  end(camera: PerspectiveCamera, haze?: Color) {
    const r = this.renderer;
    if (!this.active || !this.rt) return;
    r.setRenderTarget(null);
    const u = this.mat.uniforms;
    u.tColor.value = this.rt.texture; u.tDepth.value = this.rt.depthTexture;
    u.texel.value.set(1 / this.rt.width, 1 / this.rt.height);
    u.cNear.value = camera.near; u.cFar.value = camera.far;
    u.strength.value = Math.min(1, Math.max(0, this.settings.strength));
    u.outline.value = this.settings.outline ? 1 : 0;
    u.saturation.value = this.settings.saturation ?? 1;
    if (haze) u.haze.value.copy(haze).lerp(new Color(0.62, 0.78, 0.97), 0.5);
    r.render(this.scene, this.cam);
  }
}
