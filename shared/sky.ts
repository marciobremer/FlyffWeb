import {
  AdditiveBlending, BufferAttribute, DoubleSide, BufferGeometry, Group, Mesh, NormalBlending, RepeatWrapping, ShaderMaterial, Sprite, SpriteMaterial,
  TextureLoader, type Camera, type Texture,
} from 'three';
import { loadDds } from './dds';
import type { WldInfo } from './formats/wld';
import type { Continent } from './formats/rgn';
import { skyBlend } from './environment';

/**
 * Skybox do FlyFF (Common/Skybox.cpp): cúpula de raio 110 com 28 segmentos que acompanha a câmera, camada de nuvens
 * (leque a y=40..100) e sol/lua. Texturas em Resource/Data/Weather; 3 variantes (dia/entardecer/noite) com fusão por hora.
 */
const RADIUS = 110, SEG = 28;

const VERT = /* glsl */ `
  attribute float aAlpha; varying vec2 vUv; varying float vA;
  uniform vec2 uvOffset;
  void main() { vUv = uv + uvOffset; vA = aAlpha; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const FRAG = /* glsl */ `
  uniform sampler2D map; uniform float tfactor; varying vec2 vUv; varying float vA;
  void main() { vec4 t = texture2D(map, vUv); gl_FragColor = vec4(t.rgb, vA * tfactor); }`;

function domeGeometry(): BufferGeometry {
  const pos: number[] = [], uv: number[] = [], alpha: number[] = [];
  const v = (x: number, y: number, z: number, u: number, t: number, a: number) => { pos.push(x, y, z); uv.push(u, t); alpha.push(a); };
  for (let i = 0; i < SEG; i++) {
    const a1 = (2 * Math.PI / SEG) * i, a2 = (2 * Math.PI / SEG) * (i + 1);
    const x1 = Math.sin(a1) * RADIUS, z1 = Math.cos(a1) * RADIUS, x2 = Math.sin(a2) * RADIUS, z2 = Math.cos(a2) * RADIUS;
    const u1 = i / SEG, u2 = (i + 1) / SEG;
    // faixa superior 150 → 0 (alpha 0 → 1), faixa inferior 0 → -20 (alpha 1 → 0)
    v(x1, 150, z1, u1, 0, 0); v(x1, 0, z1, u1, 0.9, 1); v(x2, 150, z2, u2, 0, 0);
    v(x2, 150, z2, u2, 0, 0); v(x1, 0, z1, u1, 0.9, 1); v(x2, 0, z2, u2, 0.9, 1);
    v(x1, 0, z1, u1, 0.9, 1); v(x1, -20, z1, u1, 1, 0); v(x2, 0, z2, u2, 0.9, 1);
    v(x2, 0, z2, u2, 0.9, 1); v(x1, -20, z1, u1, 1, 0); v(x2, -20, z2, u2, 1, 0);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2));
  g.setAttribute('aAlpha', new BufferAttribute(new Float32Array(alpha), 1));
  return g;
}

function cloudGeometry(): BufferGeometry {
  const pos: number[] = [], uv: number[] = [], alpha: number[] = [];
  const rim = (i: number) => {
    const x = Math.sin((2 * Math.PI / SEG) * i) * RADIUS, z = Math.cos((2 * Math.PI / SEG) * i) * RADIUS;
    return [x, 40, z, (x + RADIUS) / RADIUS, (z + RADIUS) / RADIUS] as const;
  };
  for (let i = 1; i <= SEG; i++) {
    const a = rim(i), b = rim(i + 1);
    pos.push(0, 100, 0, a[0], a[1], a[2], b[0], b[1], b[2]);
    uv.push(1, 1, a[3], a[4], b[3], b[4]);
    alpha.push(1, 0, 0);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2));
  g.setAttribute('aAlpha', new BufferAttribute(new Float32Array(alpha), 1));
  return g;
}

const defaults = {
  sky: ['skybox01_low.dds', 'skybox02_low.dds', 'skybox03.dds'],
  cloud: ['cloud01_low.dds', 'cloud02_low.dds', 'cloud03.dds'],
  sun: 'sundisk.bmp', moon: 'Moon.dds',
};

export class Sky {
  /** Grupo espelhado em Z como o resto do mundo (conteúdo em coordenadas FlyFF). */
  readonly group = new Group();
  private skyMeshes: Mesh[] = [];
  private cloudMeshes: Mesh[] = [];
  private sun = new Sprite(new SpriteMaterial({ blending: AdditiveBlending, depthTest: false, depthWrite: false, fog: false }));
  private moon = new Sprite(new SpriteMaterial({ blending: NormalBlending, transparent: true, depthTest: false, depthWrite: false, fog: false }));
  private cache = new Map<string, Promise<Texture | null>>();
  private img = new TextureLoader();
  private cloudPos = 0;
  private three = { sky: true, cloud: true };
  private sources = { sky: [...defaults.sky], cloud: [...defaults.cloud], sun: defaults.sun, moon: defaults.moon };
  private key = '';
  private hour = 12;

  constructor(private weatherFiles: Set<string>) {
    this.group.scale.z = -1;
    for (let i = 0; i < 2; i++) {
      this.skyMeshes.push(this.makeMesh(domeGeometry()));
      this.cloudMeshes.push(this.makeMesh(cloudGeometry()));
    }
    this.sun.scale.set(7, 7, 1); this.moon.scale.set(14, 14, 1);
    this.sun.renderOrder = this.moon.renderOrder = 10;
    this.group.add(this.sun, this.moon);
  }

  reset(files: Set<string>) { this.weatherFiles = files; this.cache.clear(); this.key = ''; }

  private makeMesh(geo: BufferGeometry) {
    const mat = new ShaderMaterial({
      uniforms: { map: { value: null }, tfactor: { value: 1 }, uvOffset: { value: { x: 0, y: 0 } } },
      vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthTest: false, depthWrite: false, side: DoubleSide,
    });
    const m = new Mesh(geo, mat);
    m.frustumCulled = false;
    m.visible = false;
    m.renderOrder = 1;
    this.group.add(m);
    return m;
  }

  private tex(name: string): Promise<Texture | null> {
    const k = name.toLowerCase();
    let p = this.cache.get(k);
    if (!p) {
      p = this.weatherFiles.has(k)
        ? new Promise<Texture | null>((res) => {
          const done = (t: Texture) => { t.wrapS = t.wrapT = RepeatWrapping; t.needsUpdate = true; res(t); };
          const url = '/res/Data/Weather/' + encodeURIComponent(name);
          if (k.endsWith('.dds')) void loadDds(url).then((t) => (t ? done(t) : res(null)));
          else this.img.load(url, done, undefined, () => res(null));
        })
        : Promise.resolve(null);
      this.cache.set(k, p);
    }
    return p;
  }

  /** `CSkybox::LoadTextures`: usa as texturas do continente (se useEnvir) ou as do .wld; "NO"/"default" = padrão. */
  configure(wld: WldInfo, continent: Continent | null) {
    const env = continent?.useEnvir ? continent : null;
    const key = env ? 'c' + env.id : 'w';
    if (key === this.key) return;
    this.key = key;
    const pick = (v: string | undefined, def: string) => (!v || v === 'NO' || v.toLowerCase() === 'default' ? def : v);
    if (env) {
      this.three.sky = env.sky === 'NO';
      this.three.cloud = env.cloud === 'NO';
      this.sources = {
        sky: this.three.sky ? [...defaults.sky] : [env.sky],
        cloud: this.three.cloud ? [...defaults.cloud] : [env.cloud],
        sun: pick(env.sun, defaults.sun), moon: pick(env.moon, defaults.moon),
      };
    } else {
      this.three = { sky: true, cloud: true };
      this.sources = {
        sky: [0, 1, 2].map((i) => pick(wld.sky[i], defaults.sky[i])),
        cloud: [0, 1, 2].map((i) => pick(wld.cloud[i], defaults.cloud[i])),
        sun: pick(wld.sun, defaults.sun), moon: pick(wld.moon, defaults.moon),
      };
    }
    void this.tex(this.sources.sun).then((t) => { if (t) { (this.sun.material as SpriteMaterial).map = t; (this.sun.material as SpriteMaterial).needsUpdate = true; } });
    void this.tex(this.sources.moon).then((t) => { if (t) { (this.moon.material as SpriteMaterial).map = t; (this.moon.material as SpriteMaterial).needsUpdate = true; } });
    this.applyHour(this.hour);
  }

  setHour(hour: number) { this.hour = hour; this.applyHour(hour); }

  private applyHour(hour: number) {
    const assign = (meshes: Mesh[], list: string[], three: boolean) => {
      const blend = three ? skyBlend(hour) : [{ index: 0, alpha: 1 }];
      meshes.forEach((m, i) => {
        const b = blend[i];
        m.visible = !!b;
        if (!b) return;
        const mat = m.material as ShaderMaterial;
        mat.uniforms.tfactor.value = b.alpha;
        void this.tex(list[b.index] ?? list[0]).then((t) => { if (t) mat.uniforms.map.value = t; else m.visible = false; });
      });
    };
    assign(this.skyMeshes, this.sources.sky, this.three.sky);
    assign(this.cloudMeshes, this.sources.cloud, this.three.cloud);

    // sol de dia (7..17h, aditivo) e lua à noite (>=20h ou 1..6h, alpha); posição num arco simples a 30 unidades
    const h = Math.floor(((hour % 24) + 24) % 24);
    const day = h >= 7 && h <= 17, night = h >= 20 || (h >= 1 && h <= 6);
    this.sun.visible = day; this.moon.visible = night;
    const t = ((hour % 24) + 24) % 24;
    const e = day ? ((t - 6) / 12) * Math.PI : (((t >= 18 ? t - 18 : t + 6) / 12)) * Math.PI;
    const target = day ? this.sun : this.moon;
    target.position.set(Math.cos(e) * 30, Math.max(3, Math.sin(e) * 30), 8);
  }

  /** Posição da câmera em coordenadas FlyFF (x, y, z); a cúpula só acompanha a translação. */
  update(cam: Camera, dt: number) {
    this.group.position.set(cam.position.x, cam.position.y, 0);
    // o grupo está espelhado em Z: posição local z = -z do mundo Three → z FlyFF
    this.group.position.z = cam.position.z;
    this.cloudPos += 0.0002 * 60 * dt;
    for (const m of this.cloudMeshes) { const o = (m.material as ShaderMaterial).uniforms.uvOffset.value; o.x = o.y = this.cloudPos; }
  }
}
