import { type Object3D, type PerspectiveCamera, BufferAttribute, BufferGeometry, Bone, Color, Group, Material, Matrix4, Mesh, Quaternion, Skeleton as ThreeSkeleton, SkinnedMesh, Sphere, Vector3, MeshLambertMaterial } from 'three';
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { parseChr, parseAni, type Motion, type Skeleton } from './formats/chr';
import { parseO3d, type O3dPart } from './formats/o3d';
import type { ModelEntry } from './formats/inc';
import type { ModelLibrary } from './models';
import { objectMatrix, TICKS_PER_SEC } from './math';
import { OT, type WorldObject } from './formats/types';
import type { RectXZ } from './formats/rgn';

/** Dados compartilhados por todas as instâncias de um mover (malhas, esqueleto, animação). */
export interface MoverTemplate {
  entry: ModelEntry;
  /** `file`: o .o3d de onde a malha veio (Part_*.o3d / Item_*.o3d) — o brilho do enchant acha a peça por ele */
  parts: { part: O3dPart; geometry: BufferGeometry; materials: Material[]; file?: string }[];
  skeleton: Skeleton;
  boneInverses: Matrix4[];
  bindWorld: Matrix4[];
  motion: Motion | null;
  motionName: string | null;
  base: string;
  lib: ModelLibrary;
  /** movimentos extras (MTI_*) carregados sob demanda */
  motionCache: Map<string, Promise<Motion | null>>;
  /** topo da malha na pose de bind (espaço do modelo), para posicionar o nome acima da cabeça */
  height: number;
  /** raio do corpo (maior extensão horizontal ou meia altura), para a área de clique e o anel de seleção */
  radius: number;
  /** quanto subir o corpo para a sola não entrar no chão (humanos: `part_*Foot` vai abaixo de y = 0 na pose de bind) */
  lift?: number;
}

/** Movimento `symbol` (ex. MTI_WALK) do template: arquivo `<base>_<arquivo>.ani`, com cache. */
export function getMotion(tpl: MoverTemplate, symbol: string): Promise<Motion | null> {
  let p = tpl.motionCache.get(symbol);
  if (!p) {
    const file = tpl.entry.motions?.find((m) => m.symbol === symbol)?.file;
    p = file ? tpl.lib.fetchModelFile(`${tpl.base}_${file}.ani`).then((b) => { try { return b ? parseAni(b) : null; } catch { return null; } }) : Promise.resolve(null);
    p.then((m) => motionReady(tpl).set(symbol, m));
    tpl.motionCache.set(symbol, p);
  }
  return p;
}

/** movimentos já carregados por template (troca síncrona em `play`, sem esperar a promise) */
const readyMotions = new WeakMap<MoverTemplate, Map<string, Motion | null>>();
const motionReady = (tpl: MoverTemplate) => { let m = readyMotions.get(tpl); if (!m) readyMotions.set(tpl, (m = new Map())); return m; };

/** Baixa de antemão os movimentos usados com frequência (ex.: personagem: andar/correr/pular), para trocar sem atraso. */
export function preloadMotions(tpl: MoverTemplate, symbols: string[]) {
  return Promise.all(symbols.map((s) => getMotion(tpl, s)));
}

const BONE_PARENT = 2;
let NIGHT = false;
/** partes marcadas como "light" no .o3d só são desenhadas à noite */
export const setMoverNight = (n: boolean) => { NIGHT = n; };
const m4 = (a: number[]) => new Matrix4().fromArray(a); // linha-vetor D3D → coluna Three (transposta)

/** Escolhe o movimento de repouso: MTI_STAND, senão MTI_IDLE1, senão o primeiro. */
function pickMotion(entry: ModelEntry): string | null {
  const ms = entry.motions;
  if (!ms?.length) return null;
  return (ms.find((m) => m.symbol === 'MTI_STAND') ?? ms.find((m) => m.symbol === 'MTI_IDLE1') ?? ms[0]).file;
}

export async function loadMoverTemplate(entry: ModelEntry, lib: ModelLibrary): Promise<MoverTemplate | null> {
  const base = `Mvr_${entry.name}`;
  return loadTemplate(entry, [base + '.o3d'], base, lib);
}

/** arma/escudo preso a um osso (CModelObject::Render: TM do objeto × m_mLocalRH/LH/Shield/Knuckle × osso animado; o escudo vai no antebraço esquerdo) */
export interface HandAttachment { file: string; slot: 'rh' | 'lh' | 'shield' | 'knuckle' }

/** produto de matrizes D3D linha-vetor (a × b) */
function mul16(a: number[], b: number[]) {
  const o: number[] = new Array(16);
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
    let s = 0;
    for (let k = 0; k < 4; k++) s += a[i * 4 + k] * b[k * 4 + j];
    o[i * 4 + j] = s;
  }
  return o;
}

/** Template a partir de uma ou mais malhas .o3d que compartilham o esqueleto `<base>.chr` (humanos = várias partes). */
export async function loadTemplate(entry: ModelEntry, o3dFiles: string[], base: string, lib: ModelLibrary, hands: HandAttachment[] = []): Promise<MoverTemplate | null> {
  const [chrBuf, ...o3dBufs] = await Promise.all([lib.fetchModelFile(base + '.chr'), ...o3dFiles.map((f) => lib.fetchModelFile(f))]);
  const bufs = o3dBufs.filter((x): x is ArrayBuffer => !!x);
  if (!bufs.length || !chrBuf) return null;
  const fileOf = new Map<unknown, string>();
  const handBufs = await Promise.all(hands.map((h) => lib.fetchModelFile(h.file)));
  try {
    const allParts = o3dBufs.flatMap((bf, k) => { if (!bf) return []; try { const ps = parseO3d(bf).parts; for (const p of ps) fileOf.set(p, o3dFiles[k]); return ps; } catch { return []; } });
    const skeleton = parseChr(chrBuf);
    // armas: malhas comuns presas ao osso da mão, com a matriz local do esqueleto (não entram na altura/raio do corpo)
    const handParts = new Set<unknown>();
    hands.forEach((h, k) => {
      const bf = handBufs[k];
      const local = h.slot === 'rh' ? skeleton.localRH : h.slot === 'lh' ? skeleton.localLH : h.slot === 'shield' ? skeleton.localShield : skeleton.localKnuckle;
      // knuckle no antebraço direito (moverequip.cpp: IK3_KNUCKLEHAMMER → SetParent(GetRArmIdx())), com m_mLocalKnuckle
      const bone = h.slot === 'rh' ? skeleton.rHand : h.slot === 'knuckle' ? skeleton.rArm : h.slot === 'shield' ? skeleton.lArm : skeleton.lHand;
      if (!bf || !local || bone < 0) return;
      let ps: ReturnType<typeof parseO3d>['parts'] = [];
      try { ps = parseO3d(bf).parts; } catch { return; }
      for (const p of ps) {
        if (p.skinned) continue;
        p.transform = mul16(p.transform, local);
        p.parentType = BONE_PARENT;
        p.parentId = bone;
        handParts.add(p);
        fileOf.set(p, h.file);
        allParts.push(p);
      }
    });
    const parts: MoverTemplate['parts'] = [];
    for (const part of allParts) {
      if (!part.positions.length || !part.indices.length) continue;
      const geo = new BufferGeometry();
      geo.setAttribute('position', new BufferAttribute(part.positions, 3));
      geo.setAttribute('normal', new BufferAttribute(part.normals, 3));
      geo.setAttribute('uv', new BufferAttribute(part.uvs, 2));
      geo.setIndex(new BufferAttribute(part.indices, 1));
      const names = part.textures.length ? part.textures : [''];
      if (part.skinned && part.skinWeights && part.skinIndices && part.blocks.length) {
        // Cada MaterialBlock tem sua lista de ossos (constantes c[i*3] ligadas por bloco em _renderSkin): índice do vértice = 3·posição
        // nessa lista. Para suportar esqueletos com >28 ossos duplicamos os vértices por bloco, já com o osso global resolvido.
        const maxBone = skeleton.bones.length - 1;
        const P: number[] = [], N: number[] = [], U: number[] = [], SI: number[] = [], SW: number[] = [], IDX: number[] = [];
        const groups: { start: number; count: number; material: number }[] = [];
        for (const b of part.blocks) {
          const map = b.usedBones.length ? b.usedBones : part.usedBones;
          const seen = new Map<number, number>();
          const start = IDX.length;
          for (let k = 0; k < b.triangles * 3; k++) {
            const v = part.indices[b.start + k];
            let nv = seen.get(v);
            if (nv === undefined) {
              nv = P.length / 3;
              seen.set(v, nv);
              P.push(part.positions[v * 3], part.positions[v * 3 + 1], part.positions[v * 3 + 2]);
              N.push(part.normals[v * 3], part.normals[v * 3 + 1], part.normals[v * 3 + 2]);
              U.push(part.uvs[v * 2], part.uvs[v * 2 + 1]);
              const a = part.skinIndices[v * 2] / 3, c = part.skinIndices[v * 2 + 1] / 3;
              SI.push(Math.min(maxBone, map.length ? map[a] ?? 0 : a), Math.min(maxBone, map.length ? map[c] ?? 0 : c), 0, 0);
              SW.push(part.skinWeights[v * 2], part.skinWeights[v * 2 + 1], 0, 0);
            }
            IDX.push(nv);
          }
          groups.push({ start, count: IDX.length - start, material: Math.min(b.material, names.length - 1) });
        }
        const g2 = new BufferGeometry();
        g2.setAttribute('position', new BufferAttribute(new Float32Array(P), 3));
        g2.setAttribute('normal', new BufferAttribute(new Float32Array(N), 3));
        g2.setAttribute('uv', new BufferAttribute(new Float32Array(U), 2));
        g2.setAttribute('skinIndex', new BufferAttribute(new Uint16Array(SI), 4));
        g2.setAttribute('skinWeight', new BufferAttribute(new Float32Array(SW), 4));
        g2.setIndex(new BufferAttribute(new Uint32Array(IDX), 1));
        for (const gr of groups) g2.addGroup(gr.start, gr.count, gr.material);
        g2.computeBoundingSphere();
        parts.push({ part, geometry: g2, materials: await Promise.all(names.map((t) => lib.material(t))), file: fileOf.get(part) });
        continue;
      }
      if (part.skinned && part.skinWeights && part.skinIndices) {
        const n = part.positions.length / 3;
        const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
        const ub = part.usedBones;
        for (let i = 0; i < n; i++) {
          // Skin.vs: 2 pesos + 2 índices locais à lista usedBones do objeto
          // o índice é um registrador de constante: cada matriz de osso ocupa 3 registradores (c[i*3])
          const a = part.skinIndices[i * 2] / 3, b = part.skinIndices[i * 2 + 1] / 3;
          const maxBone = skeleton.bones.length - 1;
          si[i * 4] = Math.min(maxBone, ub.length ? ub[a] ?? 0 : a); si[i * 4 + 1] = Math.min(maxBone, ub.length ? ub[b] ?? 0 : b);
          sw[i * 4] = part.skinWeights[i * 2]; sw[i * 4 + 1] = part.skinWeights[i * 2 + 1];
        }
        geo.setAttribute('skinIndex', new BufferAttribute(si, 4));
        geo.setAttribute('skinWeight', new BufferAttribute(sw, 4));
      }
      if (part.blocks.length) for (const b of part.blocks) geo.addGroup(b.start, b.triangles * 3, Math.min(b.material, names.length - 1));
      else geo.addGroup(0, part.indices.length, 0);
      geo.computeBoundingSphere();
      parts.push({ part, geometry: geo, materials: await Promise.all(names.map((t) => lib.material(t))), file: fileOf.get(part) });
    }
    if (!parts.length) return null;
    let height = 0;
    let radius = 0;
    for (const p of parts) {
      if (handParts.has(p.part)) continue;
      p.geometry.computeBoundingBox();
      const b = p.geometry.boundingBox!;
      height = Math.max(height, b.max.y);
      radius = Math.max(radius, -b.min.x, b.max.x, -b.min.z, b.max.z);
    }
    radius = Math.max(radius, height * 0.5);

    const motionName = pickMotion(entry);
    let motion: Motion | null = null;
    if (motionName) {
      const buf = await lib.fetchModelFile(`${base}_${motionName}.ani`);
      if (buf) { try { motion = parseAni(buf); } catch { motion = null; } }
    }
    return {
      entry, parts, skeleton, motion, motionName, base, lib, motionCache: new Map(), height, radius,
      boneInverses: skeleton.bones.map((b) => m4(b.inverseTm)),
      bindWorld: skeleton.bones.map((b) => m4(b.tm)),
    };
  } catch (e) {
    console.warn('mover', entry.name, e);
    return null;
  }
}

const lpos = new Vector3();
const bfP = new Vector3(), bfQ = new Quaternion(), bfS = new Vector3();
const tmpQ = new Quaternion(), tmpQ2 = new Quaternion(), tmpV = new Vector3(), tmpV2 = new Vector3(), tmpS = new Vector3(1, 1, 1), tmpM = new Matrix4();

export class MoverInstance {
  readonly group = new Group();
  /** malhas do modelo (filho de `group`), deslocadas por `tpl.lift` */
  private body = new Group();
  private bones: Bone[];
  private worlds: Matrix4[];
  private attached: { mesh: Mesh; parent: number; transform: Matrix4 }[] = [];
  /** malhas e o arquivo .o3d de cada uma (para efeitos presos a uma peça) */
  readonly meshFiles: { mesh: Mesh; file: string }[] = [];
  /** grupo das malhas (espaço do modelo): efeitos que acompanham o corpo entram aqui */
  get modelSpace() { return this.body; }
  /** matriz do osso `i` no quadro atual (espaço do modelo, o mesmo de `modelSpace`) */
  boneMatrix(i: number): Matrix4 | null { return this.worlds[i] ?? null; }
  /** efeito que anda junto com a animação (ex.: brilho do enchant — shared/enchantGlow.ts) */
  effect: { update(dt: number): void; dispose(): void } | null = null;
  private time = Math.random() * 10;
  /** multiplicador de velocidade do movimento atual */
  private rate = 1;
  private motion: Motion | null;
  private motionSymbol = 'MTI_STAND';
  /** false = ANILOOP_1PLAY: para no último quadro e marca `finished` */
  private loop = true;
  private ended = false;
  private loading = false;
  private lightMeshes: Mesh[] = [];
  /** poses locais (por osso) do último quadro e do movimento anterior, para misturar ao trocar de movimento */
  private lastLocal: Matrix4[] = [];
  private blendFrom: Matrix4[] | null = null;
  private blendT = 1;
  /** duração (s) da mistura ao trocar de movimento */
  blendTime = 0.15;

  constructor(readonly tpl: MoverTemplate, readonly source: WorldObject, world: Matrix4) {
    this.motion = tpl.motion;
    this.bones = tpl.skeleton.bones.map(() => { const b = new Bone(); b.matrixAutoUpdate = false; b.matrixWorldAutoUpdate = false; return b; });
    this.worlds = tpl.bindWorld.map((m) => m.clone());
    const skeleton = new ThreeSkeleton(this.bones, tpl.boneInverses);
    for (const { part, geometry, materials, file } of tpl.parts) {
      const mat = materials.length > 1 ? materials : materials[0];
      if (part.skinned) {
        const mesh = new SkinnedMesh(geometry, mat);
        if (file) this.meshFiles.push({ mesh, file });
        mesh.frustumCulled = false;
        mesh.castShadow = mesh.receiveShadow = true;
        mesh.boundingSphere = geometry.boundingSphere ?? new Sphere(); // evita recomputar com ossos ainda não posicionados
        mesh.bindMode = 'detached';
        mesh.bind(skeleton, new Matrix4());
        this.body.add(mesh);
        if (part.light) this.lightMeshes.push(mesh);
      } else {
        const mesh = new Mesh(geometry, mat);
        if (file) this.meshFiles.push({ mesh, file });
        mesh.castShadow = mesh.receiveShadow = true;
        mesh.matrixAutoUpdate = false;
        mesh.matrix.copy(m4(part.transform));
        this.body.add(mesh);
        if (part.light) this.lightMeshes.push(mesh);
        if (part.parentType === BONE_PARENT && part.parentId >= 0) this.attached.push({ mesh, parent: part.parentId, transform: m4(part.transform) });
      }
    }
    this.body.position.y = tpl.lift ?? 0;
    this.group.add(this.body);
    const info = { objects: [source], label: 'Mover', kind: 'Mover', labelOf: (o: WorldObject) => `${tpl.entry.name}${o.name ? ' ' + o.name : ''}` };
    this.group.traverse((o) => { if (o instanceof Mesh) o.userData.pick = info; });
    this.group.matrixAutoUpdate = false;
    this.group.matrix.copy(world);
    this.pos = [world.elements[12], world.elements[13], world.elements[14]];
    this.rotY = source.rot[1];
    this.pose(0);
  }

  /** Avança a animação (perSlerp quadros por tique do Neuz — 62,5/s —, como CModel::MoveFrame). */
  update(dt: number) {
    for (const m of this.lightMeshes) m.visible = NIGHT;
    this.effect?.update(dt);
    const mo = this.motion;
    if (!mo || mo.frameCount < 2) return;
    this.time += dt * this.rate;
    if (this.blendT < 1) { this.blendT = Math.min(1, this.blendT + dt / this.blendTime); if (this.blendT >= 1) this.blendFrom = null; }
    const frames = this.time * mo.perSlerp * TICKS_PER_SEC;
    if (!this.loop && !this.loading && frames >= mo.frameCount - 1) this.ended = true;
    const f = this.loop ? frames % mo.frameCount : Math.min(frames, mo.frameCount - 1);
    this.pose(f);
    this.afterPose?.();
  }
  /** chamado depois de posar os ossos a cada quadro (ex.: vassoura/bike acompanha a altura do quadril) */
  afterPose: (() => void) | null = null;

  private pose(frame: number) {
    const { skeleton } = this.tpl;
    const motion = this.motion;
    const n = this.bones.length;
    if (!motion || motion.boneCount !== n) {
      for (let i = 0; i < n; i++) this.bones[i].matrixWorld.copy(this.worlds[i]);
    } else {
      const f0 = Math.floor(frame), f1 = (f0 + 1) % motion.frameCount, t = frame - f0;
      for (let i = 0; i < n; i++) {
        const fr = motion.frames[i];
        const out = this.worlds[i];
        if (fr) {
          const a = f0 * 7, b = f1 * 7;
          tmpQ.set(fr[a], fr[a + 1], fr[a + 2], fr[a + 3]).normalize();
          tmpQ2.set(fr[b], fr[b + 1], fr[b + 2], fr[b + 3]).normalize();
          tmpQ.slerp(tmpQ2, t);
          tmpV.set(fr[a + 4], fr[a + 5], fr[a + 6]);
          tmpV2.set(fr[b + 4], fr[b + 5], fr[b + 6]);
          tmpV.lerp(tmpV2, t);
          out.compose(tmpV, tmpQ, tmpS);
        } else out.fromArray(motion.staticTm[i] ?? skeleton.bones[i].tm);
        // mistura suave (0,15 s) com a pose do movimento anterior para não "estalar" ao trocar de animação
        if (this.blendFrom && this.blendT < 1) {
          const k = this.blendT * this.blendT * (3 - 2 * this.blendT);
          out.decompose(tmpV, tmpQ, tmpV2);
          this.blendFrom[i].decompose(bfP, bfQ, bfS);
          tmpV.lerpVectors(bfP, tmpV, k);
          tmpQ.slerpQuaternions(bfQ, tmpQ, k);
          tmpV2.lerpVectors(bfS, tmpV2, k);
          out.compose(tmpV, tmpQ, tmpV2);
        }
        (this.lastLocal[i] ??= new Matrix4()).copy(out);
        const p = motion.parents[i];
        if (p >= 0) out.premultiply(this.worlds[p]);
      }
      for (let i = 0; i < n; i++) this.bones[i].matrixWorld.copy(this.worlds[i]);
    }
    for (const a of this.attached) a.mesh.matrix.copy(tmpM.copy(this.worlds[a.parent]).multiply(a.transform));
  }

  /**
   * Troca o movimento (MTI_*): carrega o .ani sob demanda e recomeça a animação. Mantém o atual se o arquivo não existir.
   * `loop = false` toca uma vez e para no último quadro (ANILOOP_1PLAY); `finished` indica o fim (ou que o arquivo não existe).
   */
  /** toca do começo mesmo se já é o movimento atual (ex.: repetir um emote) */
  restart(symbol: string, loop = true) { this.motionSymbol = ''; this.play(symbol, loop); }

  /** `rate`: velocidade do movimento (1 = normal; o golpe do jogador toca na velocidade de ataque, como no original) */
  play(symbol: string, loop = true, rate = 1) {
    this.rate = rate;
    if (symbol === this.motionSymbol && loop === this.loop) return;
    this.motionSymbol = symbol;
    this.loop = loop;
    this.ended = false;
    const apply = (m: Motion | null) => {
      if (this.motionSymbol !== symbol) return;
      this.loading = false;
      if (!m || m.frameCount < 2) { this.ended = !loop; if (!m) return; }
      if (this.lastLocal.length) { this.blendFrom = this.lastLocal.map((x) => x.clone()); this.blendT = 0; }
      this.motion = m; this.time = 0;
    };
    // já carregado → troca neste mesmo quadro; senão baixa e troca quando chegar
    const ready = motionReady(this.tpl);
    if (ready.has(symbol)) { apply(ready.get(symbol)!); return; }
    this.loading = true;
    void getMotion(this.tpl, symbol).then(apply);
  }

  /** movimento atual e se um movimento de tocar-uma-vez terminou */
  get current() { return this.motionSymbol; }
  get finished() { return this.ended; }

  /** reposiciona na altura `y` (mobs de spawn assentados no terreno quando o tile termina de carregar) */
  setY(y: number) { this.place([this.pos[0], y, this.pos[2]], this.rotY); }

  /** posição (FlyFF) e rumo (graus, rot.y) atuais da instância — começam no objeto de origem e mudam na patrulha */
  pos: [number, number, number] = [0, 0, 0];
  rotY = 0;
  place(pos: [number, number, number], rotY: number) {
    this.pos = pos; this.rotY = rotY;
    const s = this.tpl.entry.scale;
    this.group.matrix.copy(objectMatrix({ pos, rot: [this.source.rot[0], rotY, this.source.rot[2]], scale: [s, s, s] }, new Matrix4()));
  }

  /** dono do candidato ('movers' = NPC do .dyo, 'spawns' = mob do .rgn) */
  owner = '';
  /** nome acima da cabeça (CSS2D); removido junto com a instância */
  label: CSS2DObject | null = null;
  /** altura do nome acima da cabeça (m); o balão de fala fica logo acima dele */
  private labelLift = 0.6;
  /**
   * `rank` pinta o nome (classes em world.css); admin e GM ganham o prefixo [Admin] / [GM] — `dataset.name` fica só com o
   * nome. `lift` = distância acima da cabeça (jogadores usam menos que NPCs).
   */
  setLabel(text: string, rank?: string, lift = 0.6) {
    this.label?.removeFromParent();
    const el = document.createElement('div');
    el.className = rank ? `npc-label ${rank}` : 'npc-label';
    el.textContent = rank === 'admin' ? `[Admin] ${text}` : rank === 'gm' ? `[GM] ${text}` : text;
    el.dataset.name = text;
    this.labelLift = lift;
    this.label = new CSS2DObject(el);
    this.label.position.set(0, this.tpl.height + lift, 0);
    this.group.add(this.label);
  }

  /** nome da guild em cima do nome (null tira) */
  setGuildTag(guild: string | null | undefined) {
    const el = this.label?.element;
    if (!el) return;
    let tag = el.querySelector<HTMLElement>('.guild-tag');
    if (!guild) { tag?.remove(); return; }
    if (!tag) { tag = document.createElement('span'); tag.className = 'guild-tag'; el.prepend(tag); }
    tag.textContent = guild;
  }

  private bubble: CSS2DObject | null = null;
  private bubbleTimer = 0;
  /** balão de fala acima do nome (chat), some sozinho; texto longo é cortado */
  say(text: string | HTMLElement, maxChars = 60, ms = 6000) {
    const t = typeof text !== 'string' || text.length <= maxChars ? text : text.slice(0, maxChars - 1) + '…';
    if (!this.bubble) {
      const el = document.createElement('div');
      el.className = 'chat-bubble';
      this.bubble = new CSS2DObject(el);
      // preso pela base: texto de várias linhas ou emoticon crescem para cima, sem cobrir o nome
      this.bubble.center.set(0.5, 1);
      this.bubble.position.set(0, this.tpl.height + this.labelLift + 0.2, 0);
      this.group.add(this.bubble);
    }
    // texto, ou um elemento pronto (emoticon da janela de movimentos)
    this.bubble.element.classList.toggle('emo', typeof t !== 'string');
    if (typeof t === 'string') this.bubble.element.textContent = t; else this.bubble.element.replaceChildren(t);
    clearTimeout(this.bubbleTimer);
    this.bubbleTimer = window.setTimeout(() => { this.bubble?.removeFromParent(); this.bubble = null; }, ms);
  }

  /**
   * Translúcido (GM invisível — Dark Illusion — visto por outro GM ou por ele mesmo). As malhas ganham cópia própria do
   * material (o do template é compartilhado por todos); desligar volta ao material original.
   */
  setGhost(on: boolean) {
    this.group.traverse((o) => {
      const mesh = o as Mesh;
      if (!mesh.isMesh || !(mesh.material instanceof MeshLambertMaterial)) return;
      const base = mesh.userData.ghostBase as MeshLambertMaterial | undefined;
      if (on && !base) {
        const m = mesh.material.clone();
        m.transparent = true; m.opacity = 0.35; m.depthWrite = false;
        mesh.userData.ghostBase = mesh.material;
        mesh.material = m;
      } else if (!on && base) {
        mesh.material.dispose();
        mesh.material = base;
        delete mesh.userData.ghostBase;
      }
    });
  }

  /** efeitos do conjunto presos nesta instância (WorldView.attachSetSfx); trocar o objeto ou null os desliga */
  setSfxToken: object | null = null;

  /**
   * Cor do cabelo (m_fHairColorR/G/B → m_fAmbient da malha do cabelo, MoverRender.cpp): multiplica a cor do material das
   * malhas `Part_<sexo>HairNN` desta instância (materiais clonados — o template é compartilhado). null volta ao original.
   */
  setHairColor(rgb: [number, number, number] | null) {
    for (const { mesh, file } of this.meshFiles) {
      if (!/^Part_(male|female)Hair\d+\.o3d$/i.test(file)) continue;
      const base = (mesh.userData.hairBase ??= mesh.material) as Material | Material[];
      if (!rgb) { mesh.material = base; continue; }
      const tint = (m: Material) => { const c = m.clone(); (c as Material & { color?: Color }).color?.setRGB(rgb[0], rgb[1], rgb[2]); return c; };
      mesh.material = Array.isArray(base) ? base.map(tint) : tint(base);
    }
  }

  dispose() { this.setSfxToken = null; clearTimeout(this.bubbleTimer); this.bubble?.removeFromParent(); this.label?.removeFromParent(); this.group.removeFromParent(); this.effect?.dispose(); this.effect = null; }
}

/** Mantém instâncias de movers apenas perto da câmera (carga sob demanda + cache de templates). */
export class MoverManager {
  private templates = new Map<string, Promise<MoverTemplate | null>>();
  private active = new Map<WorldObject, MoverInstance>();
  private pending = new Set<WorldObject>();
  candidates: { obj: WorldObject; entry: ModelEntry; index: number; owner: string; /** área de patrulha (retângulo do respawn) */ area?: RectXZ }[] = [];
  /** fSpeed do propMover (unidades por tique do Neuz, 16 ms) */
  speedOf: (modelId: number) => number = () => 0;
  /** terreno andável (sem NoWalk/NoMove/Die) — destinos de patrulha evitam o resto */
  walkable: (x: number, z: number) => boolean = () => true;
  private wander = new Map<MoverInstance, Wander>();
  enabled: (owner: string) => boolean = () => true;
  /** altura do terreno em (x, z) FlyFF, quando o tile está carregado (usado nos mobs espalhados dos spawns) */
  heightAt: (x: number, z: number) => number | null = () => null;
  isFlying: (modelId: number) => boolean = () => false;
  private needsHeight = new Map<WorldObject, MoverInstance>();
  onVisibleChange: (owner: string, index: number, hasModel: boolean) => void = () => {};
  /** texto do nome acima da cabeça (ex.: NPCs do .dyo); null = sem nome */
  labelOf: (owner: string, obj: WorldObject) => string | null = () => null;
  /** classe extra do nome (ex.: 'boss' = vermelho) */
  labelClassOf: (owner: string, obj: WorldObject) => string | undefined = () => undefined;
  /** nomes só até esta distância da câmera */
  labelDistance = 70;

  constructor(private parent: Group, private lib: ModelLibrary, public maxInstances = 120, public radius = 900) {}

  reset(lib: ModelLibrary) {
    this.clear(); this.templates.clear(); this.lib = lib; this.candidates = [];
  }
  clear() {
    this.wander.clear();
    this.external.clear(); this.externalObjs.clear();
    for (const [obj, inst] of this.active) { inst.dispose(); const c = this.candidates.find((x) => x.obj === obj); if (c && c.index >= 0) this.onVisibleChange(c.owner, c.index, false); }
    this.active.clear(); this.pending.clear();
  }
  get count() { return this.active.size; }
  /** instância viva de um objeto (NPC/mob), se estiver perto da câmera */
  instanceFor(obj: WorldObject): MoverInstance | null { return this.active.get(obj) ?? null; }
  /** tira todos os candidatos de um dono (e as instâncias vivas deles); o cache de modelos continua */
  removeOwner(owner: string) {
    for (const c of this.candidates) {
      if (c.owner !== owner) continue;
      const inst = this.active.get(c.obj);
      if (inst) { inst.dispose(); this.active.delete(c.obj); this.wander.delete(inst); }
      this.pending.delete(c.obj);
    }
    this.candidates = this.candidates.filter((c) => c.owner !== owner);
  }
  /** instância viva? (sai do raio → descartada) */
  isActive(inst: MoverInstance) { return [...this.active.values()].includes(inst); }

  /** Instância dona de um objeto 3D (malha atingida por raycast). */
  instanceOf(o: Object3D | null): MoverInstance | null {
    for (; o; o = o.parent) for (const inst of this.active.values()) if (inst.group === o) return inst;
    return null;
  }

  /**
   * Mover sob o ponto (px, py) da tela pela silhueta aproximada: círculo do corpo (raio do modelo × escala) projetado, com no mínimo
   * `minPx` pixels — clicar em mobs pequenos ou em movimento fica fácil. Entre vários, o de centro relativamente mais próximo.
   */
  nearestOnScreen(px: number, py: number, camera: PerspectiveCamera, width: number, height: number, minPx = 30): MoverInstance | null {
    let best: MoverInstance | null = null, bestK = 1;
    const focal = height / 2 / Math.tan((camera.fov * Math.PI) / 360);
    for (const inst of this.active.values()) {
      if (!inst.group.parent) continue;
      lpos.set(0, inst.tpl.height * 0.5, 0).applyMatrix4(inst.group.matrixWorld);
      const dist = lpos.distanceTo(camera.position);
      lpos.project(camera);
      if (lpos.z > 1 || dist < 1e-3) continue;
      const r = Math.max(minPx, (inst.tpl.radius * inst.tpl.entry.scale * focal) / dist);
      const k = Math.hypot((lpos.x * 0.5 + 0.5) * width - px, (-lpos.y * 0.5 + 0.5) * height - py) / r;
      if (k < bestK) { bestK = k; best = inst; }
    }
    return best;
  }

  /** variantes por instância (humanos: aparência vem do characterKey): devolve chave de cache + carregador */
  variant: ((entry: ModelEntry, obj: WorldObject) => { key: string; load: () => Promise<MoverTemplate | null> } | null) | null = null;

  private template(entry: ModelEntry, obj: WorldObject) {
    const v = this.variant?.(entry, obj) ?? null;
    const key = v ? v.key : String(entry.id);
    let p = this.templates.get(key);
    if (!p) { p = v ? v.load() : loadMoverTemplate(entry, this.lib); this.templates.set(key, p); }
    return p;
  }

  /** (x, z) em coordenadas FlyFF. */
  refresh(x: number, z: number) {
    const near = this.candidates
      .filter((c) => this.enabled(c.owner) && Math.hypot(c.obj.pos[0] - x, c.obj.pos[2] - z) < this.radius)
      .map((c) => ({ c, d: Math.hypot(c.obj.pos[0] - x, c.obj.pos[2] - z) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, this.maxInstances);
    const keep = new Set(near.map((n) => n.c.obj));
    for (const [obj, inst] of this.active) {
      if (this.externalObjs.has(obj)) continue; // mobs do servidor: entram e saem pelo servidor
      const c = this.candidates.find((k) => k.obj === obj);
      if (!keep.has(obj) || (c && !this.enabled(c.owner))) {
        inst.dispose(); this.active.delete(obj); this.wander.delete(inst);
        if (c && c.index >= 0) this.onVisibleChange(c.owner, c.index, false);
      }
    }
    for (const [obj, inst] of this.needsHeight) {
      if (!this.active.has(obj)) { this.needsHeight.delete(obj); continue; }
      const h = this.heightAt(obj.pos[0], obj.pos[2]);
      if (h !== null) { inst.setY(h); this.needsHeight.delete(obj); }
    }
    for (const { c } of near) {
      if (this.active.has(c.obj) || this.pending.has(c.obj)) continue;
      this.pending.add(c.obj);
      void this.template(c.entry, c.obj).then((tpl) => {
        this.pending.delete(c.obj);
        if (!tpl || this.active.has(c.obj) || !this.candidates.includes(c)) return;
        if (!keep.has(c.obj) && !this.enabled(c.owner)) return;
        // mobs de spawn andam no terreno (voadores mantêm a altura do spawn); sem o tile carregado usa a altura do spawn e corrige depois
        const grounded = c.owner === 'spawns' && !this.isFlying(c.entry.id);
        const h = grounded ? this.heightAt(c.obj.pos[0], c.obj.pos[2]) : null;
        const o = { ...c.obj, pos: [c.obj.pos[0], h ?? c.obj.pos[1], c.obj.pos[2]] as [number, number, number], scale: [c.entry.scale, c.entry.scale, c.entry.scale] as [number, number, number] };
        const inst = new MoverInstance(tpl, c.obj, objectMatrix(o, new Matrix4()));
        inst.owner = c.owner;
        const label = this.labelOf(c.owner, c.obj);
        if (label) inst.setLabel(label, this.labelClassOf(c.owner, c.obj));
        this.parent.add(inst.group);
        this.active.set(c.obj, inst);
        if (grounded && h === null) this.needsHeight.set(c.obj, inst);
        if (c.owner === 'spawns') this.wander.set(inst, { area: c.area, origin: [o.pos[0], o.pos[2]], target: null, wait: 1 + Math.random() * 6, flying: !grounded, speed: this.speedOf(c.entry.id) });
        if (c.index >= 0) this.onVisibleChange(c.owner, c.index, true);
      });
    }
  }

  /**
   * Patrulha de mob sem alvo (como o CAIMonster ocioso do cliente): fica parado alguns segundos, escolhe um ponto aleatório
   * dentro do retângulo do respawn (ou ±10 do ponto de origem), anda até lá em MTI_WALK e volta a esperar.
   */
  private patrol(inst: MoverInstance, w: Wander, dt: number) {
    if (!w.target) {
      w.wait -= dt;
      if (w.wait > 0) return;
      for (let k = 0; k < 6 && !w.target; k++) {
        const a = w.area;
        const x = a && a.xMax > a.xMin ? a.xMin + Math.random() * (a.xMax - a.xMin) : w.origin[0] + (Math.random() * 2 - 1) * 10;
        const z = a && a.zMax > a.zMin ? a.zMin + Math.random() * (a.zMax - a.zMin) : w.origin[1] + (Math.random() * 2 - 1) * 10;
        if (Math.hypot(x - inst.pos[0], z - inst.pos[2]) > 1 && (w.flying || this.walkable(x, z))) w.target = [x, z];
      }
      if (!w.target) { w.wait = 2; return; }
      inst.play('MTI_WALK');
    }
    const [tx, tz] = w.target;
    const dx = tx - inst.pos[0], dz = tz - inst.pos[2];
    const dist = Math.hypot(dx, dz);
    // andar de patrulha = metade do fSpeed (corrida) por tick, 60 ticks/s; mínimo para modelos sem velocidade na tabela
    const step = Math.max(0.6, (w.speed || 0.05) * TICKS_PER_SEC * 0.5) * dt;
    if (dist <= step) {
      w.target = null; w.wait = 2 + Math.random() * 6;
      inst.play('MTI_STAND');
    }
    const k = Math.min(1, step / Math.max(dist, 1e-6));
    const nx = inst.pos[0] + dx * k, nz = inst.pos[2] + dz * k;
    const ny = w.flying ? inst.pos[1] : this.heightAt(nx, nz) ?? inst.pos[1];
    inst.place([nx, ny, nz], dist > 1e-3 ? (Math.atan2(dx, -dz) * 180) / Math.PI : inst.rotY);
  }

  // ---------- mobs controlados pelo servidor (multiplayer) ----------
  private external = new Map<number, External>();
  private externalObjs = new Set<WorldObject>();

  /** Cria um mob vindo do servidor: modelo pelo `entry`, nome/seleção como os mobs de spawn (`owner` 'spawns'). */
  addExternal(id: number, entry: ModelEntry, x: number, z: number, h: number, state: string, y: number | null, hp = 1000) {
    this.removeExternal(id);
    const flying = y !== null;
    const gy = flying ? y : this.heightAt(x, z) ?? 100;
    const obj: WorldObject = { type: OT.MOVER, modelId: entry.id, pos: [x, gy, z], rot: [0, h, 0], scale: [1, 1, 1], motion: 0, ai: 0, ai2: 0, name: '' };
    const e: External = { obj, inst: null, target: [x, z], cur: [x, gy, z], h, curH: h, s: state, flying, gone: false, hp, oneShot: false };
    this.external.set(id, e);
    this.externalObjs.add(obj);
    void this.template(entry, obj).then((tpl) => {
      if (!tpl || e.gone) return;
      const s = entry.scale;
      const inst = new MoverInstance(tpl, obj, objectMatrix({ pos: e.cur, rot: [0, e.curH, 0], scale: [s, s, s] }, new Matrix4()));
      inst.owner = 'spawns';
      const label = this.labelOf('spawns', obj);
      if (label) inst.setLabel(label, this.labelClassOf('spawns', obj));
      inst.play(...mobMotion(e.s));
      this.parent.add(inst.group);
      this.active.set(obj, inst);
      e.inst = inst;
    });
  }

  moveExternal(id: number, x: number, z: number, h: number, state: string, hp?: number) {
    const e = this.external.get(id);
    if (!e) return;
    e.target = [x, z];
    e.h = h;
    if (hp !== undefined) e.hp = hp;
    if (state !== e.s) { e.s = state; if (state === 'dead' || !e.oneShot) { e.oneShot = false; e.inst?.play(...mobMotion(state)); } }
  }

  /** toca um movimento de uma vez no mob (MTI_ATK1 ao golpear, MTI_DMG1 ao apanhar); morto não reage */
  playExternal(id: number, motion: string) {
    const e = this.external.get(id);
    if (!e?.inst || e.s === 'dead') return;
    e.inst.play(motion, false);
    e.oneShot = true;
  }

  /** mob do servidor desenhado por esta instância (id) — para atacar o que foi clicado */
  externalIdOf(inst: MoverInstance) { for (const [id, e] of this.external) if (e.inst === inst) return id; return null; }

  /** posição (FlyFF), HP (milésimos), estado e instância de um mob do servidor */
  externalInfo(id: number) { const e = this.external.get(id); return e ? { pos: e.cur, hp: e.hp, s: e.s, inst: e.inst } : null; }
  /** posição (x, z) dos mobs do servidor vivos — pontos vermelhos do mini mapa */
  externalPositions(): [number, number][] { const out: [number, number][] = []; for (const e of this.external.values()) if (!e.gone && e.hp > 0) out.push([e.cur[0], e.cur[2]]); return out; }

  setExternalHp(id: number, hp: number) { const e = this.external.get(id); if (e) e.hp = hp; }

  /** muda só o estado (ex.: 'dead' assim que o servidor avisa a morte, antes da próxima atualização de posição) */
  setExternalState(id: number, s: string) { const e = this.external.get(id); if (e) this.moveExternal(id, e.target[0], e.target[1], e.h, s, s === 'dead' ? 0 : e.hp); }

  removeExternal(id: number) {
    const e = this.external.get(id);
    if (!e) return;
    e.gone = true;
    e.inst?.dispose();
    this.active.delete(e.obj);
    this.externalObjs.delete(e.obj);
    this.external.delete(id);
  }

  clearExternal() { for (const id of [...this.external.keys()]) this.removeExternal(id); }

  /** suaviza posição/rumo dos mobs do servidor (chegam 5×/s) e os assenta no terreno */
  private updateExternal(dt: number) {
    const k = 1 - Math.exp(-dt * 8);
    for (const e of this.external.values()) {
      const c = e.cur, [tx, tz] = e.target;
      if (Math.hypot(tx - c[0], tz - c[2]) > 30) { c[0] = tx; c[2] = tz; } else { c[0] += (tx - c[0]) * k; c[2] += (tz - c[2]) * k; }
      if (!e.flying) c[1] = this.heightAt(c[0], c[2]) ?? c[1];
      const dh = ((e.h - e.curH + 540) % 360) - 180;
      e.curH = (e.curH + dh * k + 360) % 360;
      e.inst?.place([c[0], c[1], c[2]], e.curH);
      if (e.oneShot && e.inst?.finished) { e.oneShot = false; e.inst.play(...mobMotion(e.s)); }
    }
  }

  /** `camera` (posição em espaço de mundo do Three) controla quais nomes aparecem */
  update(dt: number, camera?: Vector3) {
    for (const [inst, w] of this.wander) this.patrol(inst, w, dt);
    if (this.external.size) this.updateExternal(dt);
    for (const inst of this.active.values()) {
      inst.update(dt);
      if (inst.label && camera) inst.label.visible = inst.group.parent !== null && camera.distanceTo(lpos.setFromMatrixPosition(inst.label.matrixWorld)) < this.labelDistance;
    }
  }
}

interface Wander { area?: RectXZ; origin: [number, number]; target: [number, number] | null; wait: number; flying: boolean; speed: number }

interface External {
  obj: WorldObject; inst: MoverInstance | null; target: [number, number]; cur: [number, number, number]; h: number; curH: number; s: string; flying: boolean; gone: boolean;
  /** HP em milésimos do máximo; tocando um movimento de uma vez (golpe, dano) que depois volta ao do estado */
  hp: number; oneShot: boolean;
}

/** movimento do mob para o estado vindo do servidor */
const mobMotion = (s: string): [string, boolean] => s === 'walk' ? ['MTI_WALK', true] : s === 'run' ? ['MTI_RUN', true] : s === 'dead' ? ['MTI_DIE1', false] : ['MTI_STAND', true];
