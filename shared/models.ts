import { BoxGeometry, BufferAttribute, BufferGeometry, Color, Material, Matrix4, MeshLambertMaterial, type Texture } from 'three';
import { loadDds } from './dds';
import { fetchBuf } from './data';
import { parseO3d, type O3d } from './formats/o3d';
import { modelFileName, type ModelEntry } from './formats/inc';

export interface ModelPart { geometry: BufferGeometry; materials: Material[]; /** só é desenhada à noite (bit 31 do tipo no .o3d) */ light: boolean }
export interface LoadedModel { name: string; parts: ModelPart[]; source: O3d }

const placeholderGeo = new BoxGeometry(2, 2, 2).translate(0, 1, 0);
export const getPlaceholderGeometry = () => placeholderGeo;

const placeholderMats = new Map<number, MeshLambertMaterial>();
/** Placeholder: caixa colorida de forma estável por modelID. */
export function placeholderMaterial(id: number): MeshLambertMaterial {
  let m = placeholderMats.get(id);
  if (!m) {
    m = new MeshLambertMaterial({ color: new Color().setHSL(((id * 0.61803398875) % 1), 0.55, 0.55) });
    placeholderMats.set(id, m);
  }
  return m;
}

/** Carrega .o3d reais (e texturas .dds quando existem) sob demanda, com cache. */
export class ModelLibrary {
  private cache = new Map<string, Promise<LoadedModel | null>>();
  private textures = new Map<string, Promise<Texture | null>>();

  constructor(private modelFiles: Set<string>, private textureFiles: Set<string>) {}

  reset(modelFiles: Set<string>, textureFiles: Set<string>) {
    this.modelFiles = modelFiles; this.textureFiles = textureFiles;
    this.cache.clear(); this.textures.clear();
  }

  /** Baixa um arquivo de Data/Model se existir (case-insensitive). */
  async fetchModelFile(name: string): Promise<ArrayBuffer | null> {
    return this.modelFiles.has(name.toLowerCase()) ? fetchBuf('/res/Data/Model/' + name) : null;
  }
  hasModelFile(name: string) { return this.modelFiles.has(name.toLowerCase()); }

  /** Carrega um .o3d de Data/Model pelo nome do arquivo (usado por partes Mesh de SFX). */
  getByFile(file: string): Promise<LoadedModel | null> {
    if (!this.hasModelFile(file)) return Promise.resolve(null);
    let p = this.cache.get(file.toLowerCase());
    if (!p) { p = this.load(file); this.cache.set(file.toLowerCase(), p); }
    return p;
  }

  fileFor(entry: ModelEntry) { return modelFileName(entry); }
  exists(entry: ModelEntry) { return this.modelFiles.has(modelFileName(entry).toLowerCase()); }

  get(entry: ModelEntry): Promise<LoadedModel | null> {
    const file = modelFileName(entry);
    if (!this.exists(entry)) return Promise.resolve(null);
    let p = this.cache.get(file.toLowerCase());
    if (!p) {
      p = this.load(file);
      this.cache.set(file.toLowerCase(), p);
    }
    return p;
  }

  private async load(file: string): Promise<LoadedModel | null> {
    const buf = await fetchBuf('/res/Data/Model/' + file);
    if (!buf) return null;
    try {
      const o3d = parseO3d(buf);
      const byId = new Map(o3d.parts.map((p) => [p.id, p]));
      const world = (p: (typeof o3d.parts)[number], depth = 0): Matrix4 => {
        const m = new Matrix4().fromArray(p.transform);
        const parent = p.parentId !== -1 ? byId.get(p.parentId) : undefined;
        // D3D: updates[i] = transform * parent (vetor-linha) → no Three (coluna) é parent * transform
        return parent && depth < 16 ? world(parent, depth + 1).multiply(m) : m;
      };
      const parts: ModelPart[] = [];
      for (const p of o3d.parts) {
        if (!p.positions.length || !p.indices.length) continue;
        const geo = new BufferGeometry();
        geo.setAttribute('position', new BufferAttribute(p.positions, 3));
        geo.setAttribute('normal', new BufferAttribute(p.normals, 3));
        geo.setAttribute('uv', new BufferAttribute(p.uvs, 2));
        geo.setIndex(new BufferAttribute(p.indices, 1));
        if (!p.skinned) geo.applyMatrix4(world(p));
        const texNames = p.textures.length ? p.textures : [''];
        if (p.blocks.length) for (const b of p.blocks) geo.addGroup(b.start, b.triangles * 3, Math.min(b.material, texNames.length - 1));
        else geo.addGroup(0, p.indices.length, 0);
        geo.computeBoundingSphere();
        const materials = await Promise.all(texNames.map((t) => this.material(t)));
        parts.push({ geometry: geo, materials, light: p.light });
      }
      return { name: file, parts, source: o3d };
    } catch (e) {
      console.warn('Falha ao ler', file, e);
      return null;
    }
  }

  async material(texName: string): Promise<Material> {
    const tex = texName ? await this.texture(texName) : null;
    return new MeshLambertMaterial({ map: tex ?? null, color: tex ? 0xffffff : 0xb0b0b0, alphaTest: tex ? 0.4 : 0, side: 2 });
  }

  private texture(name: string): Promise<Texture | null> {
    const key = name.toLowerCase();
    let p = this.textures.get(key);
    if (!p) {
      p = this.textureFiles.has(key)
        ? loadDds('/res/Data/Model/Texture/' + encodeURIComponent(name))
        : Promise.resolve(null);
      this.textures.set(key, p);
    }
    return p;
  }
}
