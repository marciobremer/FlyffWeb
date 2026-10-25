import {
  ColorManagement, LinearSRGBColorSpace, PCFSoftShadowMap, AmbientLight, BufferGeometry, Color, DirectionalLight, Fog, Group,
  InstancedMesh, Material, Matrix4, Mesh, MeshBasicMaterial, MeshLambertMaterial, OctahedronGeometry, RingGeometry,
  MOUSE, Object3D, PerspectiveCamera, Raycaster, Scene, Vector2, Vector3, WebGLRenderer, WebGLRenderTarget,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { WorldData } from './data';
import { buildTerrain, disposeTerrain, setTerrainWireframe, terrainLight, terrainShadow, TerrainTextures, type ColorMode } from './terrain';
import { getPlaceholderGeometry, ModelLibrary, placeholderMaterial } from './models';
import { objectMatrix, toThree } from './math';
import { OT, MAP_SIZE, type WorldObject } from './formats/types';
import type { Landscape } from './formats/lnd';
import { modelFileName } from './formats/inc';
import { MoverManager, setMoverNight, type MoverInstance } from './movers';
import { CollisionWorld } from './collision';
import { TargetWindow } from './target';
import { Player } from './player';
import { humanKey, isHumanEntry, loadHumanTemplate, type HumanSpec, type Sex } from './humans';
import { SfxLibrary, SfxManager } from './sfxRuntime';
import { WaterSystem } from './water';
import { Sky } from './sky';
import { computeEnvironment, findContinent, type Environment } from './environment';
import { attachSetSfx } from './setSfx';
import { defaultFilter, PostFx } from './postfx';
import { defaultShadow, type ShadowSettings } from './worldedits';
import './world.css';

/**
 * Mundo do FlyFF renderizado no navegador, compartilhado pelo editor (`editor/`) e pelo cliente do jogo (`game/`):
 * cena/câmera, streaming de tiles (terreno, objetos, água, SFX), colisão, NPCs e mobs (com patrulha e nomes), ambiente
 * (luz, névoa, céu, sombra), personagem jogável, clique para andar, seleção de alvo e cursores do cliente.
 * O que antes vinha de checkboxes do painel é estado da instância (`layers`, `settings`, `radius`, `playerControl`).
 */
export interface TileView {
  x: number; y: number; land: Landscape; group: Group; terrain: Group; pickables: InstancedMesh[]; disposed: boolean;
  objGroup: Group; sfxGroup: Group; waterGroup: Group;
  /** SFX com arquivo .sfx disponível: reproduzidos por SfxManager em vez de placeholder */
  sfxFx: { obj: WorldObject; file: string }[];
}

/** Informação para o "pick" do editor, guardada em `mesh.userData.pick`. */
export interface PickInfo { objects: WorldObject[]; label: string; tile?: string; kind: string }

export interface Layers { terrain: boolean; objs: boolean; sfx: boolean; water: boolean; sky: boolean; movers: boolean; spawns: boolean; wireframe: boolean }
export interface WorldSettings { hour: number; worldLight: boolean; worldFog: boolean; shadows: boolean; /** graus (0 = sol original a pino) */ sunTilt: number }

const key = (x: number, y: number) => `${x},${y}`;

/*
 * Câmera do jogo (com personagem): como o CCamera/WndWorld do FlyFF, zoom 0..7 → distância 4 + zoom·2 (4..18) e pitch
 * limitado; a câmera não entra no terreno e é puxada para perto do personagem quando algo fica no meio (CheckBound),
 * voltando devagar à distância escolhida. Fora do jogo (editor/câmera livre) nada disso se aplica.
 */
/** distância mínima/máxima da câmera ao personagem (zoom pela roda ou arrastando) */
const CAM_MIN_DIST = 4, CAM_MAX_DIST = 18;
/** inclinação em graus acima do horizonte: máximo olhando de cima, mínimo (negativo) olhando de baixo */
const CAM_PITCH_MAX_DEG = 80, CAM_PITCH_MIN_DEG = -60;
/** folga mínima da câmera acima do terreno no ponto onde ela está */
const CAM_GROUND_MARGIN = 1.0;
/** quanto a câmera fica antes do obstáculo (terreno/objeto) entre ela e o personagem */
const CAM_COLLISION_PAD = 0.4;
/** passo da amostragem do terreno ao longo da linha personagem→câmera */
const CAM_TERRAIN_STEP = 0.5;
/** velocidade (unidades/s) com que a câmera volta à distância escolhida depois de um obstáculo (entra na hora) */
const CAM_RECOVER_SPEED = 6;

export class WorldView {
  readonly renderer: WebGLRenderer;
  /** filtro de tela (painel "Filtro" do editor; o salvo no ambiente do mundo vale no jogo) */
  readonly postfx: PostFx;
  readonly labelRenderer = new CSS2DRenderer();
  readonly scene = new Scene();
  readonly skyScene = new Scene();
  readonly camera = new PerspectiveCamera(60, 1, 1, 30000);
  readonly controls: OrbitControls;
  /** O FlyFF usa mão esquerda (Direct3D). Todo conteúdo fica em um grupo espelhado em Z. */
  readonly root = new Group();
  readonly tilesGroup = new Group();
  /** marcadores/linhas do editor (o mundo não usa) */
  readonly overlays = new Group();
  readonly moverGroup = new Group();
  readonly playerGroup = new Group();
  readonly sfxFxGroup = new Group();

  data: WorldData | null = null;
  readonly lib = new ModelLibrary(new Set(), new Set());
  readonly tiles = new Map<string, TileView>();
  private loading = new Set<string>();
  readonly moverMgr: MoverManager;
  /** colisão com objetos estáticos (malha m_collObj) por tile; `collReady` resolve quando o tile termina de montar */
  readonly collision = new CollisionWorld();
  private collReady = new Map<string, Promise<void>>();
  readonly sfxLib: SfxLibrary;
  readonly sfxMgr: SfxManager;
  readonly terrainTex = new TerrainTextures(new Map(), new Set());
  readonly water = new WaterSystem([], new Map(), new Set());
  readonly sky = new Sky(new Set());
  private ambientLight = new AmbientLight(0xffffff, Math.PI);
  private sunLight = new DirectionalLight(0xffffff, 0);
  private loadToken = 0;

  layers: Layers = { terrain: true, objs: true, sfx: true, water: true, sky: true, movers: true, spawns: true, wireframe: false };
  settings: WorldSettings = { hour: 12, worldLight: true, worldFog: false, shadows: true, sunTilt: 30 };
  /** raio (em tiles) carregado em volta do alvo da câmera */
  radius = 3;
  colorMode: ColorMode = 'textures';
  /** WASD/clique controlam o personagem (senão WASD voa com a câmera livre) */
  playerControl = true;
  /** mobs vêm do servidor (jogo multiplayer): não cria os mobs dos respawns localmente — ver MoverManager.addExternal */
  serverMobs = false;
  player: Player | null = null;
  /** true enquanto outra ferramenta usa o mouse/teclado (ex.: modo edição do editor) */
  inputBlocked: () => boolean = () => false;

  onStatus: (text: string) => void = () => {};
  /** texto "hh:mm · continente" quando o ambiente muda */
  onEnvironment: (text: string) => void = () => {};
  /** depois de carregar as tabelas do mundo (antes dos tiles): o editor monta marcadores e lista de locais */
  onWorldLoaded: (d: WorldData) => void = () => {};
  /** clique que o mundo não tratou como alvo/movimento (o editor usa para inspecionar objetos) */
  onPick: (ev: PointerEvent) => void = () => {};
  /** clique num mob/NPC com o personagem no controle (o jogo usa para atacar) e clique no chão (para andar) */
  /** `again`: o mover clicado já era o alvo selecionado antes deste clique */
  onMoverClick: (inst: MoverInstance, again: boolean) => void = () => {};
  /** clique direito (sem arrastar) num mover: no jogo, a Action Slot */
  onMoverRightClick: (inst: MoverInstance) => void = () => {};
  onGroundClick: () => void = () => {};
  /** o jogo trata o clique antes (ex.: item no chão); true = já tratou */
  pickFirst: (ev: { clientX: number; clientY: number }) => boolean = () => false;
  /** a cada quadro, depois de renderizar */
  onFrame: (dt: number) => void = () => {};

  readonly keys = new Set<string>();
  fps = 0;
  private raycaster = new Raycaster();
  private lastStream = 0;
  private env: Environment | null = null;
  private envKey = '';
  private lightToSun = new Vector3(0, 1, 0);

  constructor(readonly canvas: HTMLCanvasElement) {
    // o pipeline fixo do Direct3D não faz conversão de gamma: mantém cores/texturas "cruas"
    ColorManagement.enabled = false;
    this.renderer = new WebGLRenderer({ canvas, antialias: true });
    this.renderer.outputColorSpace = LinearSRGBColorSpace;
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.autoClear = false;
    this.postfx = new PostFx(this.renderer);
    // nomes acima das cabeças (divs posicionadas sobre o canvas, sem capturar o mouse)
    this.labelRenderer.domElement.id = 'labels';
    canvas.after(this.labelRenderer.domElement);
    this.scene.fog = new Fog(0xe0e0ff, 500, 2000);
    // luzes do mundo (atualizadas por refreshEnvironment): ambiente + direcional, como a luz D3D de função fixa
    const sun = this.sunLight;
    sun.position.set(0, 1, 0);
    // sombras: o mapa cobre uma caixa ortográfica que segue o alvo da câmera
    sun.castShadow = true;
    Object.assign(sun.shadow.camera, { near: 1, far: 1400 });
    sun.shadow.bias = -0.0006;
    sun.shadow.normalBias = 0.4;
    this.setShadow(defaultShadow());
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFSoftShadowMap;
    this.scene.add(this.ambientLight, sun, sun.target);
    // skybox em cena própria, desenhado antes (sem profundidade) do mundo
    this.skyScene.add(this.sky.group);
    this.root.scale.z = -1;
    this.scene.add(this.root);
    this.root.add(this.tilesGroup, this.overlays, this.moverGroup, this.sfxFxGroup, this.playerGroup);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.15;
    this.controls.maxPolarAngle = Math.PI * 0.98; // permite olhar para cima (céu)

    this.moverMgr = new MoverManager(this.moverGroup, this.lib);
    this.sfxLib = new SfxLibrary(new Set(), new Set(), this.lib);
    this.sfxMgr = new SfxManager(this.sfxFxGroup, this.sfxLib);

    this.selRing.visible = false; this.selRing.renderOrder = 6;
    this.scene.add(this.selRing);
    this.moveMarker.visible = false; this.moveMarker.renderOrder = 5;
    this.root.add(this.moveMarker);
    this.targetWnd = new TargetWindow(document.body);

    addEventListener('resize', () => this.resize());
    this.resize();
    this.bindInput();
  }

  resize() {
    this.renderer.setSize(innerWidth, innerHeight, false);
    this.labelRenderer.setSize(innerWidth, innerHeight);
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
  }

  // ---------- objetos de um tile ----------
  private addInstances(parent: Group, objs: WorldObject[], geo: BufferGeometry, mat: Material | Material[], info: PickInfo, pick: InstancedMesh[]): InstancedMesh {
    const mesh = new InstancedMesh(geo, mat, objs.length);
    const m = new Matrix4();
    objs.forEach((o, i) => mesh.setMatrixAt(i, objectMatrix(o, m)));
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    mesh.computeBoundingBox();
    mesh.userData.pick = info;
    mesh.castShadow = mesh.receiveShadow = true;
    parent.add(mesh);
    pick.push(mesh);
    return mesh;
  }

  private buildObjects(view: TileView) {
    const d = this.data;
    if (!d) return;
    const byModel = new Map<number, WorldObject[]>();
    for (const o of view.land.objects) {
      let l = byModel.get(o.modelId);
      if (!l) byModel.set(o.modelId, (l = []));
      l.push(o);
    }
    for (const [id, objs] of byModel) {
      const entry = d.objModels.get(id);
      const label = entry ? `${entry.name} (#${id})` : `modelo #${id}`;
      // entradas de mdlObj.inc com MODELTYPE_SFX (ex.: "fire03") são efeitos .sfx colocados como objetos estáticos
      if (entry?.modelType === 'MODELTYPE_SFX') {
        const file = modelFileName(entry);
        if (this.sfxLib.has(file)) { for (const o of objs) view.sfxFx.push({ obj: o, file }); continue; }
      }
      const info: PickInfo = { objects: objs, label, tile: key(view.x, view.y), kind: 'Objeto' };
      const placeholder = this.addInstances(view.objGroup, objs, getPlaceholderGeometry(), placeholderMaterial(id), info, view.pickables);
      if (entry && this.lib.exists(entry)) {
        void this.lib.get(entry).then((model) => {
          if (!model || view.disposed) return;
          view.objGroup.remove(placeholder);
          view.pickables.splice(view.pickables.indexOf(placeholder), 1);
          placeholder.dispose();
          for (const part of model.parts) {
            const m = this.addInstances(view.objGroup, objs, part.geometry, part.materials.length > 1 ? part.materials : part.materials[0], info, view.pickables);
            if (part.light) { m.userData.nightOnly = true; m.visible = this.isNight(); }
          }
        });
      }
    }
    const tileKey = key(view.x, view.y);
    this.collReady.set(tileKey, this.collision.setTile(tileKey, view.land.objects, (o) => {
      const e = d.objModels.get(o.modelId);
      return e && e.modelType !== 'MODELTYPE_SFX' && this.lib.exists(e) ? this.lib.get(e).then((m) => m?.source ?? null) : Promise.resolve(null);
    }));
    // SFX com .sfx disponível → SfxManager; os demais (arquivo ausente) ficam como losango placeholder
    const fallback: WorldObject[] = [];
    for (const o of view.land.sfx) {
      const entry = d.dynaModels.get(`${OT.SFX}:${o.modelId}`);
      const file = entry ? modelFileName(entry) : '';
      if (file && this.sfxLib.has(file)) view.sfxFx.push({ obj: o, file });
      else fallback.push(o);
    }
    if (fallback.length) {
      const info: PickInfo = { objects: fallback, label: 'SFX (sem .sfx)', tile: key(view.x, view.y), kind: 'SFX' };
      this.addInstances(view.sfxGroup, fallback, new OctahedronGeometry(1.5).translate(0, 1.5, 0), new MeshLambertMaterial({ color: 0xffd23f, emissive: 0x554400 }), info, view.pickables);
    }
  }

  // ---------- tiles ----------
  async loadTile(x: number, y: number, token = this.loadToken) {
    const k = key(x, y);
    const d = this.data;
    if (!d || this.tiles.has(k) || this.loading.has(k) || !d.hasTile(x, y)) return;
    this.loading.add(k);
    try {
      const land = await d.loadTile(x, y);
      if (!land || token !== this.loadToken || !this.data) return;
      const group = new Group();
      const objGroup = new Group(), sfxGroup = new Group();
      const terrain = buildTerrain(land, d.wld.mpu, this.colorMode, this.terrainTex);
      const waterGroup = this.water.build(land, d.wld.mpu);
      group.add(terrain, objGroup, sfxGroup, waterGroup);
      const view: TileView = { x, y, land, group, terrain, pickables: [], disposed: false, objGroup, sfxGroup, waterGroup, sfxFx: [] };
      this.buildObjects(view);
      this.applyTileVisibility(view);
      this.tilesGroup.add(group);
      this.tiles.set(k, view);
      this.updateStats();
    } finally { this.loading.delete(k); }
  }

  private disposeTile(v: TileView) {
    v.disposed = true;
    this.tilesGroup.remove(v.group);
    disposeTerrain(v.terrain);
    this.water.dispose(v.waterGroup);
    for (const m of v.pickables) m.dispose();
    this.tiles.delete(key(v.x, v.y));
    this.collision.removeTile(key(v.x, v.y));
    this.collReady.delete(key(v.x, v.y));
  }

  /** Reconstrói os meshes de objetos/efeitos de um tile a partir de `land.objects` (após duplicar/apagar no editor). */
  rebuildTileObjects(view: TileView) {
    for (const m of view.pickables) m.dispose();
    view.pickables.length = 0;
    view.objGroup.clear();
    view.sfxGroup.clear();
    view.sfxFx.length = 0;
    this.buildObjects(view);
    this.applyTileVisibility(view);
  }

  private applyTileVisibility(v: TileView) {
    v.terrain.visible = this.layers.terrain;
    v.objGroup.visible = this.layers.objs;
    v.sfxGroup.visible = this.layers.sfx;
    this.sfxFxGroup.visible = this.layers.sfx;
    v.waterGroup.visible = this.layers.water;
    setTerrainWireframe(v.terrain, this.layers.wireframe);
  }

  /** Aplica `layers` em tudo (chamar depois de mudar `layers`). */
  applyLayers() {
    this.tiles.forEach((t) => this.applyTileVisibility(t));
    this.moverMgr.refresh(this.controls.target.x, -this.controls.target.z);
    this.lastStream = 0;
  }

  /** Troca o modo de cor do terreno e reconstrói os tiles carregados. */
  setColorMode(mode: ColorMode) {
    this.colorMode = mode;
    const d = this.data;
    if (!d) return;
    this.tiles.forEach((t) => {
      t.group.remove(t.terrain);
      disposeTerrain(t.terrain);
      t.terrain = buildTerrain(t.land, d.wld.mpu, mode, this.terrainTex);
      t.group.add(t.terrain);
      this.applyTileVisibility(t);
    });
  }

  statsText() {
    const d = this.data;
    if (!d) return '';
    let objs = 0;
    this.tiles.forEach((t) => (objs += t.land.objects.length));
    return `${d.name} — ${this.tiles.size} tiles · ${objs} objetos · ${d.movers.length} movers (${this.moverMgr.count} modelos ativos) · ${this.sfxMgr.count} efeitos · ${d.respawns.length} spawns · ${d.regions.length} regiões`;
  }
  private updateStats() { if (this.data) this.onStatus(this.statsText()); }

  currentTile(): [number, number] {
    const s = MAP_SIZE * (this.data?.wld.mpu ?? 4);
    return [Math.floor(this.controls.target.x / s), Math.floor(-this.controls.target.z / s)];
  }

  /** força o próximo quadro a recarregar tiles/movers/ambiente */
  invalidate() { this.lastStream = 0; }

  // ---------- ambiente (hora, continente, luz, névoa, céu) ----------
  /** CWorld::_setLight: `night` = hora >= 21 ou <= 6; partes "light" dos modelos só aparecem à noite */
  isNight() { const h = Math.floor(this.settings.hour) % 24; return h >= 21 || h <= 6; }
  private applyNight() {
    const n = this.isNight();
    setMoverNight(n);
    this.tiles.forEach((t) => t.objGroup.traverse((o) => { if (o.userData.nightOnly) o.visible = n; }));
  }

  refreshEnvironment(force = false) {
    const d = this.data;
    if (!d) return;
    const s = this.settings;
    const continent = findContinent(d.continents, this.controls.target.x, -this.controls.target.z);
    const k = `${continent?.id ?? -1}|${s.hour}|${s.worldLight}|${s.sunTilt}`;
    if (!force && k === this.envKey) return;
    this.envKey = k;
    const env = (this.env = computeEnvironment(d.wld, continent, s.hour));
    // luz D3D: a direção é a de propagação; no Three (grupo espelhado em Z) o vetor "para a luz" vira (-dx, -dy, +dz)
    const toLight = new Vector3(-env.direction.x, -env.direction.y, env.direction.z);
    if (toLight.lengthSq() < 1e-6) toLight.set(0, 1, 0);
    // o sol original fica praticamente a pino (sombras retas embaixo); a inclinação opcional dá direção às sombras (0° = original)
    toLight.x += Math.tan((s.sunTilt * Math.PI) / 180) * Math.abs(toLight.y);
    toLight.normalize();
    this.lightToSun.copy(toLight);
    terrainLight.lightDir.value.copy(toLight);
    terrainLight.uAmbient.value.copy(env.ambient);
    terrainLight.uDiffuse.value.copy(env.diffuse);
    terrainLight.uLit.value = s.worldLight ? 1 : 0;
    // MeshLambert divide por π: π·cor reproduz ambiente + difusa·N·L
    this.ambientLight.color.copy(s.worldLight ? env.ambient : new Color(1, 1, 1));
    this.sunLight.color.copy(env.diffuse);
    this.sunLight.intensity = s.worldLight ? Math.PI : 0;
    (this.scene.fog as Fog).color.copy(env.fog);
    this.renderer.setClearColor(env.fog);
    this.sky.configure(d.wld, continent);
    this.sky.setHour(s.hour);
    this.applyNight();
    this.onEnvironment(`${String(Math.floor(s.hour)).padStart(2, '0')}:${String(Math.round((s.hour % 1) * 60)).padStart(2, '0')}` + (continent ? ` · ${continent.name || 'continente ' + continent.id}` : ''));
  }

  /** Mantém a caixa de sombra centrada no alvo da câmera, com o centro "preso" à grade de texels (evita tremer ao mover). */
  private upVec = new Vector3(0, 1, 0); private sx = new Vector3(); private sy = new Vector3();
  /** qualidade da sombra (painel "Filtro" do editor; o salvo no ambiente do mundo vale no jogo) */
  shadowQuality: ShadowSettings = defaultShadow();
  setShadow(q: ShadowSettings) {
    const sun = this.sunLight;
    const res = Math.min(q.res, this.renderer.capabilities.maxTextureSize);
    this.shadowQuality = { ...q, res };
    const cam = sun.shadow.camera;
    Object.assign(cam, { left: -q.area, right: q.area, top: q.area, bottom: -q.area });
    cam.updateProjectionMatrix();
    if (sun.shadow.mapSize.x !== res) { sun.shadow.mapSize.set(res, res); sun.shadow.map?.dispose(); sun.shadow.map = null; } // recria no próximo quadro
    terrainShadow.shadowTexel.value = 1 / res;
    terrainShadow.shadowSoft.value = q.soft;
  }

  private updateShadow() {
    const sun = this.sunLight, sx = this.sx, sy = this.sy, toSun = this.lightToSun;
    const on = this.settings.shadows && this.settings.worldLight;
    sun.castShadow = on;
    terrainShadow.shadowOn.value = on ? 1 : 0;
    sx.crossVectors(this.upVec, toSun).normalize();
    if (sx.lengthSq() < 1e-6) sx.set(1, 0, 0);
    sy.crossVectors(toSun, sx).normalize();
    const texel = (2 * this.shadowQuality.area) / this.shadowQuality.res;
    const c = this.controls.target;
    const px = Math.round(c.dot(sx) / texel) * texel - c.dot(sx), py = Math.round(c.dot(sy) / texel) * texel - c.dot(sy);
    sun.target.position.copy(c).addScaledVector(sx, px).addScaledVector(sy, py);
    sun.position.copy(sun.target.position).addScaledVector(toSun, 700);
    sun.target.updateMatrixWorld();
    if (sun.shadow.map) terrainShadow.shadowMap.value = sun.shadow.map.texture;
    terrainShadow.shadowMatrix.value = sun.shadow.matrix;
  }

  private stream(now: number) {
    const d = this.data;
    if (!d || now - this.lastStream < 300) return;
    this.lastStream = now;
    const r = this.radius;
    const [cx, cy] = this.currentTile();
    const want: [number, number, number][] = [];
    for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) {
      if (x < 0 || y < 0 || x >= d.wld.width || y >= d.wld.height) continue;
      want.push([x, y, (x - cx) ** 2 + (y - cy) ** 2]);
    }
    want.sort((a, b) => a[2] - b[2]);
    for (const v of [...this.tiles.values()]) if (Math.abs(v.x - cx) > r + 1 || Math.abs(v.y - cy) > r + 1) this.disposeTile(v);
    for (const [x, y] of want) {
      if (this.loading.size >= 4) break;
      void this.loadTile(x, y);
    }
    const s = MAP_SIZE * d.wld.mpu;
    const fog = this.scene.fog as Fog;
    fog.near = Math.max(300, (r - 0.4) * s * 0.55);
    fog.far = Math.max(900, (r + 0.2) * s);
    if (this.settings.worldFog && this.env) { fog.near = this.env.fogStart; fog.far = this.env.fogEnd; }
    this.camera.far = Math.max(3000, (r + 2) * s * 1.6);
    this.camera.updateProjectionMatrix();
    this.moverMgr.refresh(this.controls.target.x, -this.controls.target.z);
    if (this.layers.sfx) {
      const cands: { obj: WorldObject; file: string }[] = [];
      this.tiles.forEach((t) => cands.push(...t.sfxFx));
      this.sfxMgr.refresh(cands, this.controls.target.x, -this.controls.target.z);
    } else this.sfxMgr.clear();
    this.refreshEnvironment();
    this.updateStats();
  }

  sampleHeight(x: number, z: number): number | null {
    const d = this.data;
    if (!d) return null;
    const s = MAP_SIZE * d.wld.mpu;
    const t = this.tiles.get(key(Math.floor(x / s), Math.floor(z / s)));
    if (!t) return null;
    const fx = (x - t.x * s) / d.wld.mpu, fz = (z - t.y * s) / d.wld.mpu;
    const ix = Math.min(MAP_SIZE - 1, Math.max(0, Math.floor(fx))), iz = Math.min(MAP_SIZE - 1, Math.max(0, Math.floor(fz)));
    const dx = fx - ix, dz = fz - iz, h = t.land.heights, N = MAP_SIZE + 1;
    return h[iz * N + ix] * (1 - dx) * (1 - dz) + h[iz * N + ix + 1] * dx * (1 - dz) + h[(iz + 1) * N + ix] * (1 - dx) * dz + h[(iz + 1) * N + ix + 1] * dx * dz;
  }

  /** atributo do vértice mais próximo (0 normal, 1 NoWalk, 2 NoFly, 3 NoMove, 4 Die); 0 se o tile não está carregado */
  attrAt(x: number, z: number): number {
    const d = this.data;
    if (!d) return 0;
    const s = MAP_SIZE * d.wld.mpu;
    const t = this.tiles.get(key(Math.floor(x / s), Math.floor(z / s)));
    if (!t) return 0;
    const ix = Math.min(MAP_SIZE, Math.max(0, Math.round((x - t.x * s) / d.wld.mpu)));
    const iz = Math.min(MAP_SIZE, Math.max(0, Math.round((z - t.y * s) / d.wld.mpu)));
    return t.land.attrs[iz * (MAP_SIZE + 1) + ix];
  }

  /** Posiciona a câmera olhando para (x,z) do mundo FlyFF. */
  lookAt(x: number, z: number, dist = 260, fallbackY = 100) {
    const y = this.sampleHeight(x, z) ?? fallbackY;
    const [tx, ty, tz] = toThree(x, y, z);
    this.controls.target.set(tx, ty, tz);
    this.camera.position.set(tx - dist * 0.7, ty + dist * 0.8, tz + dist * 0.7);
    this.controls.update();
    this.lastStream = 0;
  }

  // ---------- personagem ----------
  get controlling() { return !!this.player?.active && this.playerControl; }

  /** Leva o personagem para (x, z) FlyFF (teleporte de GM): carrega o tile e a colisão de lá e move a câmera junto. */
  async teleportPlayer(x: number, z: number, y = 100) {
    const d = this.data, p = this.player;
    if (!d || !p?.active) return;
    const s = MAP_SIZE * d.wld.mpu;
    await this.loadTile(Math.floor(x / s), Math.floor(z / s));
    await this.collReady.get(key(Math.floor(x / s), Math.floor(z / s)));
    const [ox, oy, oz] = p.pos;
    p.teleport(x, z, y);
    const [nx, ny, nz] = p.pos;
    this.camera.position.add(new Vector3(nx - ox, ny - oy, -(nz - oz)));
    this.controls.target.set(nx, ny + 1.8, -nz);
    this.controls.update();
  }

  /** Cria (ou recria) o personagem em (x, z) FlyFF; espera o tile e a colisão dele e põe a câmera atrás. */
  async spawnPlayer(x: number, z: number, y = 100, sex: Sex = 'male', look: { hair?: number; head?: number; equip?: string[] } = {}) {
    const d = this.data;
    if (!d) return;
    const s = MAP_SIZE * d.wld.mpu;
    const k = key(Math.floor(x / s), Math.floor(z / s));
    await this.loadTile(Math.floor(x / s), Math.floor(z / s));
    await this.collReady.get(k);
    if (!this.player) {
      this.player = new Player(this.playerGroup, d, this.lib, {
        heightAt: (px, pz) => this.sampleHeight(px, pz), attrAt: (px, pz) => this.attrAt(px, pz),
        objectGround: (px, pz, yTop) => this.collision.groundAt(px, pz, yTop),
        blocked: (x0, z0, x1, z1, py, r, hs) => this.collision.blocked(x0, z0, x1, z1, py, r, hs),
        attachSetSfx: (inst, equip) => this.attachSetSfx(inst, equip),
      });
    }
    await this.player.spawn(sex, x, y, z, look);
    const p = this.player.pos;
    this.controls.target.set(p[0], p[1] + 1.8, -p[2]);
    this.camera.position.set(p[0] - 6, p[1] + 5, -p[2] + 10);
    this.controls.update();
  }

  /**
   * Retrato do personagem (rosto de frente) para a janela de status: renderiza uma vez numa textura `size`×`size` fora da tela
   * e devolve um data URL (sem custo por quadro). Chamar depois de o personagem estar posado (um quadro após o spawn).
   */
  portrait(size = 96): string | null {
    const p = this.player, inst = p?.inst;
    if (!p || !inst) return null;
    const a = (p.heading * Math.PI) / 180;
    // o modelo olha para −Z local; no Three (z espelhado) a frente do personagem é (sin a, 0, cos a)
    const dir = new Vector3(Math.sin(a), 0, Math.cos(a));
    const headY = p.pos[1] + (inst.tpl.height + (inst.tpl.lift ?? 0)) * 0.86;
    const head = new Vector3(p.pos[0], headY, -p.pos[2]);
    const cam = new PerspectiveCamera(28, 1, 0.05, 50);
    cam.position.copy(head).addScaledVector(dir, 1.25).add(new Vector3(0, 0.05, 0));
    cam.lookAt(head);
    const rt = new WebGLRenderTarget(size, size);
    const r = this.renderer;
    try {
      r.setRenderTarget(rt);
      r.setClearColor(0xdde6f5, 1);
      r.clear();
      r.render(this.scene, cam);
      const px = new Uint8Array(size * size * 4);
      r.readRenderTargetPixels(rt, 0, 0, size, size, px);
      const c = document.createElement('canvas');
      c.width = c.height = size;
      const img = new ImageData(size, size);
      // WebGL lê de baixo para cima
      for (let y = 0; y < size; y++) img.data.set(px.subarray((size - 1 - y) * size * 4, (size - y) * size * 4), y * size * 4);
      c.getContext('2d')!.putImageData(img, 0, 0);
      return c.toDataURL();
    } finally {
      r.setRenderTarget(null);
      rt.dispose();
      if (this.env) r.setClearColor(this.env.fog);
    }
  }

  // ---------- abrir mundo ----------
  async open(name: string) {
    const token = ++this.loadToken;
    this.tiles.forEach((t) => this.disposeTile(t));
    this.selectTarget(null);
    const d = await WorldData.load(name, this.onStatus);
    if (token !== this.loadToken) return;
    this.data = d;
    this.lib.reset(d.modelFiles, d.textureFiles);
    this.terrainTex.reset(d.terrainTextures, d.terrainFiles);
    this.water.reset(d.waterLists, d.terrainTextures, d.terrainFiles, d.wld.seacloud);
    this.sky.reset(d.weatherFiles);
    this.sfxMgr.clear();
    this.sfxLib.reset(d.sfxFiles, d.sfxTextureFiles);
    this.setupMovers();
    // padrão do mundo salvo no editor (painel Ambiente): vale no jogo e já vem marcado no editor
    const env = d.edits.environment;
    if (env) {
      this.settings = { hour: env.hour, worldLight: env.worldLight, worldFog: env.worldFog, shadows: env.shadows, sunTilt: env.sunTilt };
      this.layers = { ...this.layers, sky: env.showSky, water: env.showWater };
    }
    this.postfx.settings = env?.filter ? { ...env.filter } : defaultFilter();
    this.setShadow(env?.shadow ?? defaultShadow());
    this.onWorldLoaded(d);
    this.refreshEnvironment(true);
  }

  /** som de um efeito: o .wav no campo de parte do mdlDyna.inc (CreateSfx toca junto com o efeito) */
  onSfxSound: (file: string, pos: [number, number, number]) => void = () => {};
  private sfxSound(id: number, pos: [number, number, number]) {
    const part = this.data?.dynaModels.get(`${OT.SFX}:${id}`)?.part;
    if (part && /\.wav$/i.test(part)) this.onSfxSound(part, pos);
  }

  /** toca o efeito `XI_*` (id) na posição FlyFF; `rotY` em graus. Sem o arquivo .sfx não faz nada. */
  playSfx(id: number, pos: [number, number, number], rotY = 0) {
    const d = this.data;
    if (!d || id < 0 || !this.layers.sfx) return;
    const entry = d.dynaModels.get(`${OT.SFX}:${id}`);
    const file = entry ? modelFileName(entry) : '';
    if (file && this.sfxLib.has(file)) { this.sfxMgr.play(file, pos, rotY); this.sfxSound(id, pos); }
  }

  /** projétil de magia de `from` até `to` (posições FlyFF) */
  playSfxMoving(id: number, from: [number, number, number], to: [number, number, number], rotY: number, secs: number, onEnd: () => void) {
    const file = this.sfxFile(id);
    if (!file || !this.layers.sfx) { onEnd(); return; }
    this.sfxSound(id, from);
    this.sfxMgr.playMoving(file, from, to, rotY, secs, onEnd);
  }
  /** efeito que acompanha uma posição por `secs` segundos (buff) */
  playSfxFollow(id: number, getPos: () => [number, number, number] | null, secs: number) {
    const file = this.sfxFile(id);
    if (file && this.layers.sfx) { this.sfxMgr.playFollow(file, getPos, secs); const p = getPos(); if (p) this.sfxSound(id, p); }
  }
  /** efeito do conjunto +3…+10 (shared/setSfx.ts) preso no personagem; chamar de novo troca/desliga o anterior */
  attachSetSfx(inst: MoverInstance, equip: string[]) {
    attachSetSfx(this.sfxMgr, (id) => this.sfxFile(id), inst, equip, () => this.layers.sfx);
  }

  sfxFile(id: number) {
    const d = this.data;
    if (!d || id < 0) return '';
    const entry = d.dynaModels.get(`${OT.SFX}:${id}`);
    const file = entry ? modelFileName(entry) : '';
    return file && this.sfxLib.has(file) ? file : '';
  }

  /** NPCs (.dyo com as edições do editor) como candidatos do MoverManager */
  private registerNpcs() {
    const d = this.data!;
    d.movers.forEach((o, index) => { const entry = d.dynaModels.get(`${OT.MOVER}:${o.modelId}`); if (entry) this.moverMgr.candidates.push({ obj: o, entry, index, owner: 'movers' }); });
  }
  /** a lista de NPCs (`data.movers`) mudou: refaz só os candidatos de NPC */
  reloadNpcs() {
    this.moverMgr.removeOwner('movers');
    this.registerNpcs();
    this.invalidate();
  }

  /** Candidatos de NPC (.dyo) e mob (.rgn) do MoverManager, com aparência, nomes, velocidade e patrulha. */
  setupMovers() {
    const d = this.data!;
    this.moverMgr.reset(this.lib);
    this.collision.clear(); this.collReady.clear();
    this.moverGroup.children.length = 0;
    this.registerNpcs();
    // spawns (.rgn): o ponto central + alguns representantes sorteados (determinísticos) dentro do retângulo, até 4 por respawn
    // (no jogo multiplayer os mobs vêm do servidor)
    d.respawns.forEach((r, index) => {
      if (r.type !== OT.MOVER || this.serverMobs) return;
      const entry = d.dynaModels.get(`${OT.MOVER}:${r.modelId}`);
      if (!entry) return;
      const o: WorldObject = { type: r.type, modelId: r.modelId, pos: r.pos, rot: [0, r.angle, 0], scale: [1, 1, 1], motion: 0, ai: 0, ai2: 0, name: `x${r.count} / ${r.time}s` };
      this.moverMgr.candidates.push({ obj: o, entry, index, owner: 'spawns', area: r.rect });
      for (let k = 1; k < Math.min(r.count, 4); k++) {
        const h = Math.sin((index + 1) * 12.9898 + k * 78.233) * 43758.5453, h2 = Math.sin((index + 1) * 39.346 + k * 11.135) * 24634.6345;
        const u = h - Math.floor(h), v = h2 - Math.floor(h2);
        const x = r.rect.xMin + u * (r.rect.xMax - r.rect.xMin), z = r.rect.zMin + v * (r.rect.zMax - r.rect.zMin);
        this.moverMgr.candidates.push({ obj: { ...o, pos: [x, o.pos[1], z], rot: [0, (u * 360) % 360, 0] }, entry, index: -1, owner: 'spawns', area: r.rect });
      }
    });
    const mm = this.moverMgr;
    mm.heightAt = (x, z) => this.sampleHeight(x, z);
    mm.isFlying = (id) => d.flyingMovers.has(id);
    // NPCs humanos (MI_MALE/MI_FEMALE): corpo = partes Part_*.o3d escolhidas por character.inc (SetFigure/SetEquip)
    mm.variant = (entry, obj) => {
      if (!isHumanEntry(entry)) return null;
      const ch = obj.characterKey ? d.characters.get(obj.characterKey.toLowerCase()) : undefined;
      const spec: HumanSpec = { sex: ch?.sex ?? (entry.name as Sex), hair: ch?.hair || 1, head: ch?.head || 1, equip: ch?.equip ?? [] };
      return { key: humanKey(spec), load: () => loadHumanTemplate(entry, spec, d, this.lib) };
    };
    // nome acima da cabeça: mobs = nome do propMover; NPCs = SetName do character.inc, senão o do propMover
    mm.labelClassOf = (owner, obj) => (owner === 'spawns' && d.bossMovers.has(obj.modelId) ? 'boss' : undefined);
    mm.labelOf = (owner, obj) => owner === 'spawns' ? d.moverNames.get(obj.modelId) ?? null
      : (obj.characterKey ? d.characters.get(obj.characterKey.toLowerCase())?.name : undefined) ?? d.moverNames.get(obj.modelId) ?? null;
    mm.speedOf = (id) => d.moverSpeed.get(id) ?? 0;
    mm.walkable = (x, z) => { const a = this.attrAt(x, z); return a !== 1 && a !== 3 && a !== 4; };
    mm.enabled = (owner) => (owner === 'movers' ? this.layers.movers : this.layers.spawns);
  }

  // ---------- clique para andar ----------
  private moveMarker = new Mesh(new RingGeometry(0.35, 0.5, 24).rotateX(-Math.PI / 2), new MeshBasicMaterial({ color: 0xffe066, transparent: true, opacity: 0.85, depthWrite: false }));

  private setRay(ev: { clientX: number; clientY: number }) {
    this.raycaster.setFromCamera(new Vector2((ev.clientX / innerWidth) * 2 - 1, -(ev.clientY / innerHeight) * 2 + 1), this.camera);
    return this.raycaster;
  }

  /** ponto do chão (terreno ou objeto) sob o ponto de tela, em coordenadas FlyFF; null se não atinge nada */
  groundPoint(ev: { clientX: number; clientY: number }): [number, number, number] | null {
    const targets: Object3D[] = [];
    this.tiles.forEach((t) => { if (t.terrain.visible) targets.push(t.terrain); if (t.objGroup.visible) targets.push(...t.pickables); });
    const hit = this.setRay(ev).intersectObjects(targets, true)[0];
    if (!hit) return null;
    const x = hit.point.x, z = -hit.point.z; // Three → FlyFF
    const y = Math.max(this.sampleHeight(x, z) ?? hit.point.y, this.collision.groundAt(x, z, hit.point.y + 0.7) ?? -Infinity);
    return [x, y, z];
  }

  /** Clique no terreno/objeto: o personagem anda até o ponto (x, z) atingido. */
  clickMove(ev: { clientX: number; clientY: number }) {
    if (!this.player) return;
    const g = this.groundPoint(ev);
    if (!g) return;
    this.player.moveTo(g[0], g[2]);
    // marcador no chão do destino (root já espelha z: posição em coordenadas FlyFF)
    this.moveMarker.position.set(g[0], g[1] + 0.06, g[2]);
    this.moveMarker.visible = true;
  }

  // ---------- escolher um ponto no chão (painel de GM: onde invocar) ----------
  private placeRing = new Mesh(new RingGeometry(0.88, 1, 48).rotateX(-Math.PI / 2), new MeshBasicMaterial({ color: 0xff5a3c, transparent: true, opacity: 0.9, depthWrite: false }));
  private placeFill = new Mesh(new RingGeometry(0, 0.88, 48).rotateX(-Math.PI / 2), new MeshBasicMaterial({ color: 0xff5a3c, transparent: true, opacity: 0.18, depthWrite: false }));
  private placing: { cursor: HTMLElement; x: number; y: number; done: (p: [number, number, number] | null) => void } | null = null;
  get isPlacing() { return !!this.placing; }

  /**
   * Modo de posicionar: o ponteiro vai para o centro da tela (trava do mouse do navegador + cursor desenhado) e um círculo
   * de raio `radius` acompanha o chão. Clique esquerdo confirma o ponto (FlyFF); Esc ou botão direito cancela (null).
   */
  pickGroundPoint(radius: number, done: (p: [number, number, number] | null) => void) {
    this.cancelPlacing();
    const c = this.canvas;
    const cursor = document.createElement('div');
    cursor.className = 'place-cursor';
    cursor.setAttribute('aria-hidden', 'true');
    document.body.append(cursor);
    const rect = c.getBoundingClientRect();
    this.placing = { cursor, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, done };
    for (const m of [this.placeRing, this.placeFill]) { m.scale.setScalar(radius); m.renderOrder = 6; if (!m.parent) this.root.add(m); m.visible = false; }
    this.controls.enabled = false;
    c.requestPointerLock?.();
    this.movePlacing(0, 0);
  }

  private movePlacing(dx: number, dy: number) {
    const pl = this.placing;
    if (!pl) return;
    const r = this.canvas.getBoundingClientRect();
    pl.x = Math.min(r.right - 1, Math.max(r.left, pl.x + dx));
    pl.y = Math.min(r.bottom - 1, Math.max(r.top, pl.y + dy));
    pl.cursor.style.left = `${pl.x}px`; pl.cursor.style.top = `${pl.y}px`;
    const g = this.groundPoint({ clientX: pl.x, clientY: pl.y });
    for (const m of [this.placeRing, this.placeFill]) { m.visible = !!g; if (g) m.position.set(g[0], g[1] + 0.07, g[2]); }
  }

  private endPlacing(p: [number, number, number] | null) {
    const pl = this.placing;
    if (!pl) return;
    this.placing = null;
    pl.cursor.remove();
    this.placeRing.visible = this.placeFill.visible = false;
    this.controls.enabled = true;
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
    pl.done(p);
  }
  cancelPlacing() { this.endPlacing(null); }

  // ---------- seleção de alvo (mobs e NPCs) ----------
  private targetWnd: TargetWindow;
  selected: MoverInstance | null = null;
  private selRing = new Mesh(new RingGeometry(0.82, 1, 40).rotateX(-Math.PI / 2), new MeshBasicMaterial({ transparent: true, opacity: 0.9, depthWrite: false }));

  /** Mover sob o ponto: malha atingida pelo raio ou, se nada, o de silhueta projetada mais próxima (mobs pequenos). */
  /** objetos sob o ponteiro (mais perto primeiro) entre `objects` */
  raycast(ev: { clientX: number; clientY: number }, objects: Object3D[]) { return this.setRay(ev).intersectObjects(objects, false).map((h) => h.object); }

  moverAt(ev: { clientX: number; clientY: number }): MoverInstance | null {
    if (!this.layers.movers && !this.layers.spawns) return null;
    const meshes: Object3D[] = [];
    this.moverGroup.traverse((o) => { if (o instanceof Mesh && o.visible) meshes.push(o); });
    const hit = this.setRay(ev).intersectObjects(meshes, false)[0];
    return (hit && this.moverMgr.instanceOf(hit.object)) || this.moverMgr.nearestOnScreen(ev.clientX, ev.clientY, this.camera, innerWidth, innerHeight);
  }

  /** alguma tecla de andar/pular apertada? (cancela o ataque automático) */
  moveKeysDown() { for (const k of ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space']) if (this.keys.has(k)) return true; return false; }

  /** instância selecionada (alvo) */
  get target() { return this.selected; }

  /** HP do alvo na janela (0–1) */
  setTargetHp(frac: number) { if (this.selected) this.targetWnd.setHp(frac); }

  selectTarget(inst: MoverInstance | null) {
    this.selected?.label?.element.classList.remove('selected');
    this.selected = inst;
    const d = this.data;
    if (!inst || !d) { this.selRing.visible = false; this.selArrows.hidden = true; this.targetWnd.hide(); return; }
    inst.label?.element.classList.add('selected');
    const hostile = inst.owner === 'spawns';
    const id = inst.source.modelId;
    const name = inst.label?.element.dataset.name ?? inst.label?.element.textContent ?? d.moverNames.get(id) ?? inst.tpl.entry.name;
    this.targetWnd.show({ name, level: hostile ? d.moverLevel.get(id) : undefined, hp: 1, hostile });
    // seleção como no FlyFF Universe: 4 setas nos cantos do alvo (updateSelection as posiciona a cada quadro)
    this.selArrows.classList.toggle('hostile', hostile);
    this.selArrows.hidden = false;
  }

  /** ponto de tela (x, y) da metade de cima de um mover (para abrir menus ao lado dele); null fora da tela */
  screenOf(inst: MoverInstance): [number, number] | null {
    const sc = inst.tpl.entry.scale || 1;
    const v = new Vector3().setFromMatrixPosition(inst.group.matrixWorld);
    v.y += (inst.tpl.height + (inst.tpl.lift ?? 0)) * sc * 0.7;
    v.project(this.camera);
    if (v.z > 1) return null;
    const rect = this.canvas.getBoundingClientRect();
    return [rect.left + (v.x + 1) / 2 * rect.width, rect.top + (1 - v.y) / 2 * rect.height];
  }

  /** as 4 setas da seleção (elementos de tela por cima do canvas) */
  private selArrows = (() => {
    const box = document.createElement('div');
    box.className = 'sel-arrows';
    box.hidden = true;
    box.setAttribute('aria-hidden', 'true');
    for (const k of ['tl', 'tr', 'bl', 'br']) { const a = document.createElement('i'); a.className = k; box.appendChild(a); }
    document.body.appendChild(box);
    return box;
  })();
  private selV = new Vector3();

  private updateSelection(_dt: number) {
    const s = this.selected;
    if (!s) return;
    // outros jogadores (client/net.ts RemotePlayers) não ficam no moverMgr: valem enquanto estão na cena
    if (s.owner === 'players' ? !s.group.parent : !this.moverMgr.isActive(s)) { this.selectTarget(null); return; }
    // contorno do alvo na tela: as 8 quinas da caixa (raio × altura do modelo) projetadas pela câmera
    const sc = s.tpl.entry.scale || 1, r = Math.max(0.35, s.tpl.radius * sc * 0.75), h = Math.max(0.8, (s.tpl.height + (s.tpl.lift ?? 0)) * sc);
    const base = new Vector3().setFromMatrixPosition(s.group.matrixWorld);
    const rect = this.canvas.getBoundingClientRect();
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, behind = false;
    for (const dx of [-r, r]) for (const dz of [-r, r]) for (const dy of [0, h]) {
      const v = this.selV.set(base.x + dx, base.y + dy, base.z + dz).project(this.camera);
      if (v.z > 1) { behind = true; break; }
      const px = rect.left + (v.x + 1) / 2 * rect.width, py = rect.top + (1 - v.y) / 2 * rect.height;
      x0 = Math.min(x0, px); x1 = Math.max(x1, px); y0 = Math.min(y0, py); y1 = Math.max(y1, py);
    }
    this.selArrows.hidden = behind;
    if (behind) return;
    Object.assign(this.selArrows.style, { left: `${x0}px`, top: `${y0}px`, width: `${x1 - x0}px`, height: `${y1 - y0}px` });
  }

  // ---------- entrada (mouse/teclado) e cursores do cliente ----------
  /** Data/Cursors/CurDefault1 (hotspot 0,0): espada sobre mob, balão sobre NPC, seta no resto */
  private cursors = (() => {
    const c = (f: string, fb: string) => `url("/res/Data/Cursors/CurDefault1/${f}") 0 0, ${fb}`;
    return { base: c('curBase.cur', 'default'), attack: c('curAttack.cur', 'crosshair'), npc: c('curNPC.cur', 'pointer') };
  })();
  private hoverAt: { clientX: number; clientY: number } | null = null;
  private hoverKind = '';
  private down: { x: number; y: number } | null = null;
  /** a trava do mouse do modo de posicionar chegou a valer (soltar depois = cancelar) */
  private placingLocked = false;
  private rightHeld = false;

  private bindInput() {
    const c = this.canvas;
    c.style.cursor = this.cursors.base;
    c.addEventListener('mousemove', (e) => { this.hoverAt = { clientX: e.clientX, clientY: e.clientY }; });
    c.addEventListener('mouseleave', () => { this.hoverAt = null; });
    c.addEventListener('pointerdown', (e) => {
      if (this.placing) { // posicionando: esquerdo confirma, direito cancela
        e.preventDefault(); e.stopImmediatePropagation();
        const pl = this.placing;
        this.endPlacing(e.button === 0 ? this.groundPoint({ clientX: pl.x, clientY: pl.y }) : null);
        this.down = null;
        return;
      }
      this.down = { x: e.clientX, y: e.clientY }; if (e.button === 2) this.rightHeld = true;
    });
    // com o mouse travado o cursor desenhado anda pelo movimento; sem a trava (navegador recusou) segue o ponteiro
    addEventListener('mousemove', (e) => { if (!this.placing) return; if (document.pointerLockElement === c) this.movePlacing(e.movementX, e.movementY); else { this.placing.x = e.clientX; this.placing.y = e.clientY; this.movePlacing(0, 0); } });
    addEventListener('keydown', (e) => { if (this.placing && e.code === 'Escape') { e.preventDefault(); this.cancelPlacing(); } }, true);
    document.addEventListener('pointerlockchange', () => { if (this.placing && document.pointerLockElement !== c && this.placingLocked) this.cancelPlacing(); this.placingLocked = document.pointerLockElement === c; });
    // botão direito segurado (gira a câmera; voando, a prancha segue para onde a câmera aponta)
    addEventListener('pointerup', (e) => { if (e.button === 2) this.rightHeld = false; });
    addEventListener('blur', () => { this.rightHeld = false; });
    c.addEventListener('contextmenu', (e) => e.preventDefault()); // o botão direito é do jogo (Action Slot / câmera)
    c.addEventListener('pointerup', (e) => {
      if (this.placing) return;
      const d = this.down;
      this.down = null;
      if (!d || Math.hypot(e.clientX - d.x, e.clientY - d.y) >= 4) return;
      const blocked = this.inputBlocked();
      if (e.button === 2) {
        const target = blocked || !this.controlling ? null : this.moverAt(e);
        if (target) { this.selectTarget(target); this.onMoverRightClick(target); }
        return;
      }
      if (e.button !== 0) return;
      if (!blocked && this.controlling && this.pickFirst(e)) return;
      const target = blocked ? null : this.moverAt(e);
      const again = !!target && target === this.target;
      if (target) this.selectTarget(target);
      if (!blocked && this.controlling) { if (!target) { this.clickMove(e); this.onGroundClick(); } else this.onMoverClick(target, again); } else this.onPick(e);
    });
    addEventListener('keydown', (e) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
      if (e.code === 'Escape') this.selectTarget(null);
      // X: alterna andar/correr (como no FlyFF); no voo liga/desliga o turbo
      if (e.code === 'KeyX' && !e.repeat && !e.ctrlKey && !e.altKey && !e.metaKey) { this.walkMode = !this.walkMode; this.turboPress = true; }
      this.keys.add(e.code);
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
  }

  /** uma checagem por quadro, só com o mouse sobre o canvas */
  private updateHoverCursor() {
    let kind = 'base';
    if (this.hoverAt && !this.inputBlocked() && !this.down) {
      const m = this.moverAt(this.hoverAt);
      if (m) kind = m.owner === 'spawns' ? 'attack' : 'npc';
    }
    if (kind !== this.hoverKind) { this.hoverKind = kind; this.canvas.style.cursor = this.cursors[kind as keyof typeof this.cursors]; }
  }

  // ---------- câmera do jogo ----------
  private gameCamera = false;
  /** distância mostrada (≤ a escolhida quando há obstáculo) */
  private camShownDist = Infinity; private camShortened = false;
  /** posição escolhida × posição mostrada neste quadro, quando um obstáculo encurtou a câmera */
  private camFix: { shown: Vector3; wanted: Vector3 } | null = null;
  private camDir = new Vector3(); private camProbe = new Vector3();

  /** Limites de zoom/pitch e botão direito girando (como no FlyFF) só com o personagem; fora dele, câmera livre do editor. */
  private setGameCamera(on: boolean) {
    if (on === this.gameCamera) return;
    this.gameCamera = on;
    const c = this.controls, deg = Math.PI / 180;
    c.minDistance = on ? CAM_MIN_DIST : 0;
    c.maxDistance = on ? CAM_MAX_DIST : Infinity;
    c.minPolarAngle = on ? (90 - CAM_PITCH_MAX_DEG) * deg : 0;
    c.maxPolarAngle = on ? (90 - CAM_PITCH_MIN_DEG) * deg : Math.PI * 0.98;
    c.enablePan = !on; // com pan, o alvo voltava ao personagem a cada quadro e a câmera se afastava sem limite
    c.mouseButtons.RIGHT = on ? MOUSE.ROTATE : MOUSE.PAN;
    this.camShownDist = Infinity; this.camShortened = false;
  }

  /** altura do terreno no ponto Three (x, z), ou null fora dos tiles carregados */
  private groundY(p: Vector3) { return this.sampleHeight(p.x, -p.z); }

  /**
   * Depois de `controls.update()`: mantém a câmera acima do terreno (isso vira o novo estado do orbit, sem "zona morta" ao
   * arrastar para baixo) e, se terreno ou objeto ficar entre ela e o personagem, a mostra antes do obstáculo neste quadro.
   */
  private constrainCamera(dt: number) {
    const camera = this.camera, t = this.controls.target, dir = this.camDir, p = this.camProbe;
    dir.subVectors(camera.position, t);
    const r0 = dir.length();
    if (r0 < 1e-6) return;
    // sobe a câmera até a folga do terreno girando sobre a esfera do orbit (mantém a distância, muda só a inclinação)
    for (let i = 0; i < 3; i++) {
      const g = this.groundY(camera.position);
      if (g === null || camera.position.y >= g + CAM_GROUND_MARGIN - 1e-3) break;
      const dy = Math.min(r0 * 0.999, g + CAM_GROUND_MARGIN - t.y), hz = Math.hypot(dir.x, dir.z) || 1e-6;
      const k = Math.sqrt(r0 * r0 - dy * dy) / hz;
      camera.position.set(t.x + dir.x * k, t.y + dy, t.z + dir.z * k);
      dir.subVectors(camera.position, t);
    }
    const g = this.groundY(camera.position);
    if (g !== null && camera.position.y < g + CAM_GROUND_MARGIN) camera.position.y = g + CAM_GROUND_MARGIN; // terreno íngreme
    const wanted = camera.position.clone();
    dir.subVectors(wanted, t);
    const len = dir.length();
    if (len < 1e-6) return;
    dir.divideScalar(len);
    let hit = len;
    for (let s = CAM_TERRAIN_STEP; s < len; s += CAM_TERRAIN_STEP) {
      p.copy(t).addScaledVector(dir, s);
      const h = this.groundY(p);
      if (h !== null && p.y < h) { hit = s; break; }
    }
    const obj = this.collision.segmentHit(t.x, t.y, -t.z, dir.x, dir.y, -dir.z, hit);
    if (obj !== null) hit = obj;
    const allowed = hit < len ? Math.max(0.5, hit - CAM_COLLISION_PAD) : len;
    // só volta devagar depois de um obstáculo; o zoom normal (sem nada no meio) é imediato
    this.camShownDist = Math.min(allowed, this.camShortened ? this.camShownDist + CAM_RECOVER_SPEED * dt : Infinity);
    this.camShortened = this.camShownDist < len - 1e-4;
    if (!this.camShortened) { camera.lookAt(t); return; }
    camera.position.copy(t).addScaledVector(dir, this.camShownDist);
    const gs = this.groundY(camera.position);
    if (gs !== null && camera.position.y < gs + CAM_GROUND_MARGIN) camera.position.y = gs + CAM_GROUND_MARGIN;
    camera.lookAt(t);
    this.camFix = { shown: camera.position.clone(), wanted };
  }

  // ---------- loop ----------
  private prev = performance.now();
  private fwd = new Vector3(); private right = new Vector3(); private delta = new Vector3();

  start() {
    const frame = (now: number) => {
      try { this.frame(now); } catch (e) { console.error(e); }
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  /** X alterna andar (true) / correr (false) */
  walkMode = false;
  /** X apertado neste quadro (voo: turbo) */
  private turboPress = false;

  private frame(now: number) {
    const dt = Math.min(0.1, (now - this.prev) / 1000);
    this.prev = now;
    this.fps += (1 / Math.max(dt, 1e-3) - this.fps) * 0.05;
    const keys = this.keys, camera = this.camera, controls = this.controls;
    const player = this.player;
    // devolve a câmera à posição escolhida (a do quadro anterior foi encurtada por obstáculo), se ninguém a moveu desde então
    if (this.camFix) {
      if (camera.position.equals(this.camFix.shown)) camera.position.copy(this.camFix.wanted);
      this.camFix = null;
    }
    this.setGameCamera(this.controlling && !!player);
    if (this.controlling && player) {
      const k = (c: string) => keys.has(c);
      const input = {
        forward: (k('KeyW') || k('ArrowUp') ? 1 : 0) - (k('KeyS') || k('ArrowDown') ? 1 : 0),
        right: (k('KeyD') || k('ArrowRight') ? 1 : 0) - (k('KeyA') || k('ArrowLeft') ? 1 : 0),
        walk: this.walkMode,
        turbo: this.turboPress,
        jump: k('Space'),
        steer: this.rightHeld,
      };
      this.turboPress = false;
      const d3 = player.update(dt, input, camera);
      // a câmera acompanha o personagem (deslocamento em D3D → Three: z invertido)
      camera.position.add(new Vector3(d3[0], d3[1], -d3[2]));
      controls.target.set(player.pos[0], player.pos[1] + 1.8, -player.pos[2]);
    } else if (keys.size && !this.inputBlocked()) {
      const { fwd, right, delta } = this;
      camera.getWorldDirection(fwd); fwd.y = 0; fwd.normalize();
      right.crossVectors(fwd, camera.up).normalize();
      delta.set(0, 0, 0);
      if (keys.has('KeyW')) delta.add(fwd);
      if (keys.has('KeyS')) delta.sub(fwd);
      if (keys.has('KeyD')) delta.add(right);
      if (keys.has('KeyA')) delta.sub(right);
      if (keys.has('KeyE')) delta.y += 1;
      if (keys.has('KeyQ')) delta.y -= 1;
      if (delta.lengthSq()) {
        const speed = Math.max(60, camera.position.distanceTo(controls.target) * 0.9) * (keys.has('ShiftLeft') ? 4 : 1);
        delta.normalize().multiplyScalar(speed * dt);
        camera.position.add(delta); controls.target.add(delta);
      }
    }
    controls.update();
    if (this.gameCamera) this.constrainCamera(dt);
    this.stream(now);
    this.moverMgr.update(dt, camera.position);
    this.updateShadow();
    this.water.update(dt);
    this.sfxMgr.update(dt, camera);
    this.sky.update(camera, dt);
    this.updateSelection(dt);
    this.updateHoverCursor();
    const r = this.renderer;
    this.postfx.begin();
    r.clear();
    if (this.layers.sky && !this.data?.wld.indoor) { this.sky.group.visible = true; r.render(this.skyScene, camera); }
    r.clearDepth();
    r.render(this.scene, camera);
    this.postfx.end(camera, (this.scene.fog as Fog).color);
    this.labelRenderer.render(this.scene, camera);
    if (this.moveMarker.visible && (!player?.target || !this.controlling)) this.moveMarker.visible = false;
    this.onFrame(dt);
  }
}
