import { BufferAttribute, BufferGeometry, DoubleSide, Group, Mesh, MeshBasicMaterial, RepeatWrapping, type Texture } from 'three';
import { loadDds } from './dds';
import type { Landscape } from './formats/lnd';
import { MAP_SIZE, PATCHES } from './formats/types';

const PATCH = MAP_SIZE / PATCHES;
const MASK_WATERFRAME = 0xfc, WTYPE_CLOUD = 1, WTYPE_WATER = 2;
const ALPHA = 133 / 255; // D3DRS_TEXTUREFACTOR ARGB(133,0,0,0) (CWorld::_renderWater)
const SEACLOUD_DEFAULT_TEXTURE_ID = 10;

/**
 * Água animada e nuvens do mar (CLandscape::MakeWaterVertexBuffer / RenderWater).
 *  - byte `texture` do patch: (texture & 3) == 2 → água, lista = texture >> 2 (Terrain.inc "Water"); texture == 1 → nuvem do mar.
 *  - água: quad do patch (PATCH*MPU) na altura `height`, UV 0..3, 133/255 de opacidade, quadro avança 0.15 por tick (60 Hz).
 *  - nuvem: quad em y=0 deslocado +40 e +80, textura rolando (seacloudPos += 0.001/0.0015 por tick).
 */
export class WaterSystem {
  private frames: (Promise<Texture | null> | null)[][] = [];
  private mats: MeshBasicMaterial[] = [];
  private cur: number[] = [];
  private t = 0;
  private seaTex: Texture | null = null;
  private seaTex2: Texture | null = null;
  private cloudMats: MeshBasicMaterial[] = [];
  private seaPos = { x: 0, y: 0 };

  constructor(private lists: number[][], private names: Map<number, string>, private files: Set<string>, seacloudName = 'default') {
    this.reset(lists, names, files, seacloudName);
  }

  reset(lists: number[][], names: Map<number, string>, files: Set<string>, seacloudName = 'default') {
    this.lists = lists; this.names = names; this.files = files;
    this.frames = lists.map((l) => l.map(() => null));
    this.cur = lists.map(() => -1);
    this.mats.forEach((m) => m.dispose());
    this.mats = lists.map(() => new MeshBasicMaterial({ transparent: true, opacity: ALPHA, depthWrite: false, side: DoubleSide }));
    const seaFile = seacloudName === 'default' ? names.get(SEACLOUD_DEFAULT_TEXTURE_ID) : seacloudName;
    this.cloudMats = [0, 1].map(() => new MeshBasicMaterial({ transparent: true, opacity: ALPHA, depthWrite: false, side: DoubleSide }));
    this.seaTex = this.seaTex2 = null;
    if (seaFile && files.has(seaFile.toLowerCase())) {
      this.load(seaFile).then((t) => {
        if (!t) return;
        t.wrapS = t.wrapT = RepeatWrapping;
        this.seaTex = t; this.seaTex2 = t.clone(); this.seaTex2.needsUpdate = true;
        this.cloudMats[0].map = this.seaTex; this.cloudMats[1].map = this.seaTex2;
        this.cloudMats.forEach((m) => { m.needsUpdate = true; });
      });
    }
  }

  private load(file: string): Promise<Texture | null> {
    return loadDds('/res/World/Texture/' + encodeURIComponent(file)).then((t) => { if (t) { t.wrapS = t.wrapT = RepeatWrapping; t.needsUpdate = true; } return t; });
  }

  private frameTexture(list: number, frame: number): Promise<Texture | null> {
    let p = this.frames[list][frame];
    if (!p) {
      const file = this.names.get(this.lists[list][frame]);
      p = file && this.files.has(file.toLowerCase()) ? this.load(file) : Promise.resolve(null);
      this.frames[list][frame] = p;
    }
    return p;
  }

  /** Avança as animações (chamar a cada frame). */
  update(dt: number) {
    this.t += dt * 60 * 0.15;
    this.mats.forEach((mat, i) => {
      const n = this.lists[i].length;
      if (!n) return;
      const f = Math.floor(this.t) % n;
      if (f === this.cur[i]) return;
      this.cur[i] = f;
      void this.frameTexture(i, f).then((tex) => { if (tex && this.cur[i] === f) { mat.map = tex; mat.needsUpdate = true; } });
    });
    this.seaPos.x += 0.001 * 60 * dt; this.seaPos.y += 0.0015 * 60 * dt;
    if (this.seaTex) this.seaTex.offset.set(this.seaPos.x, this.seaPos.x);
    if (this.seaTex2) this.seaTex2.offset.set(this.seaPos.y, this.seaPos.y);
  }

  /** Malhas de água e nuvem de um tile (coordenadas FlyFF). */
  build(land: Landscape, mpu: number): Group {
    const group = new Group();
    const q = PATCH * mpu;
    const ox = land.tileX * MAP_SIZE * mpu, oz = land.tileY * MAP_SIZE * mpu;
    const water = new Map<number, number[]>(); // lista → [x,y,z do canto]
    const clouds: number[] = [];
    for (let i = 0; i < PATCHES; i++) {
      for (let j = 0; j < PATCHES; j++) {
        const k = j + i * PATCHES;
        const tex = land.waterTexture[k], h = land.waterHeight[k];
        if ((tex & ~MASK_WATERFRAME & 0xff) === WTYPE_WATER) {
          const list = tex >> 2;
          if (list < this.lists.length) { let a = water.get(list); if (!a) water.set(list, (a = [])); a.push(ox + j * q, h, oz + i * q); }
        } else if (tex === WTYPE_CLOUD) clouds.push(ox + j * q, 0, oz + i * q);
      }
    }
    const quads = (corners: number[], uvMax: number) => {
      const n = corners.length / 3;
      const pos = new Float32Array(n * 12), uv = new Float32Array(n * 8), idx = new Uint32Array(n * 6);
      for (let c = 0; c < n; c++) {
        const x = corners[c * 3], y = corners[c * 3 + 1], z = corners[c * 3 + 2];
        pos.set([x, y, z, x, y, z + q, x + q, y, z, x + q, y, z + q], c * 12);
        uv.set([0, 0, 0, uvMax, uvMax, 0, uvMax, uvMax], c * 8);
        // normal para +Y no espaço de dados
        idx.set([c * 4, c * 4 + 1, c * 4 + 2, c * 4 + 2, c * 4 + 1, c * 4 + 3], c * 6);
      }
      const g = new BufferGeometry();
      g.setAttribute('position', new BufferAttribute(pos, 3));
      g.setAttribute('uv', new BufferAttribute(uv, 2));
      g.setIndex(new BufferAttribute(idx, 1));
      g.computeBoundingSphere();
      return g;
    };
    for (const [list, corners] of water) {
      const m = new Mesh(quads(corners, 3), this.mats[list]);
      m.renderOrder = 100; m.userData.kind = 'water';
      group.add(m);
    }
    if (clouds.length) {
      const g = quads(clouds, 1);
      [40, 80].forEach((dy, i) => {
        const m = new Mesh(g, this.cloudMats[i]);
        m.position.y = dy; m.renderOrder = 101; m.userData.kind = 'seacloud';
        group.add(m);
      });
    }
    return group;
  }

  dispose(group: Group) {
    const seen = new Set<BufferGeometry>();
    group.traverse((o) => { if (o instanceof Mesh && !seen.has(o.geometry)) { seen.add(o.geometry); o.geometry.dispose(); } });
  }
}
