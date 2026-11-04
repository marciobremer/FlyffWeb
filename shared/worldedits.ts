import type { WorldObject } from './formats/types';

/** filtros de tela (aplicados por shared/postfx.ts) */
export type ScreenFilter = 'none' | 'zelda';
export const SCREEN_FILTERS: ScreenFilter[] = ['none', 'zelda'];
export interface FilterSettings {
  filter: ScreenFilter;
  /** 0..1: mistura entre a imagem original e a filtrada */
  strength: number;
  outline: boolean;
  /** multiplicador da saturação do filtro (1 = a do filtro; menos tira cor, 0 = cinza) */
  saturation: number;
}

/**
 * Edições do mundo salvas pelo editor, SEM mexer nos arquivos originais (`original/Resource`): `data/world-edits/<Mundo>.json`.
 * O servidor entrega pela API (`/gapi/world-edits?world=`) e quem carrega o mundo (editor, jogo, servidor) aplica por cima do .dyo.
 *   npcs.moved    NPCs do .dyo que mudaram de lugar/rumo (índice no .dyo → posição)
 *   npcs.removed  índices do .dyo que foram apagados
 *   npcs.added    NPCs novos (modelId, characterKey…)
 *   environment   o que está marcado no painel "Ambiente" do editor (vale como padrão do mundo)
 *   openAreas     retângulos onde o terreno NoWalk/NoMove (barreira invisível) deixa passar (`//liberar`)
 *   closedPortals portais de dungeon deste mapa que não teleportam (define WI_*; `//portal fechar`): a rampa vira só rampa
 *   points        pontos marcados com a ferramenta "Pontos" do editor; o de nome `chegada` é onde se aparece ao entrar no mapa
 */
export interface NpcMove { pos: [number, number, number]; rot: number }
export interface NpcAdded { modelId: number; type: number; characterKey?: string; name?: string; pos: [number, number, number]; rot: [number, number, number]; scale: [number, number, number] }
export interface EnvironmentEdits {
  hour: number; worldLight: boolean; shadows: boolean; sunTilt: number; worldFog: boolean; showSky: boolean; showWater: boolean;
  /** painel "Filtro" do editor (shared/postfx.ts) */
  filter?: FilterSettings;
  /** qualidade da sombra do sol (painel "Filtro" do editor) */
  shadow?: ShadowSettings;
}

/**
 * Sombra do sol: `area` = metade do lado da caixa coberta pelo mapa de sombra (unidades; menor = mais nítida, mas a sombra some
 * mais perto), `res` = resolução do mapa (px), `soft` = suavidade da borda (raio do filtro em pixels do mapa, 0 = dura).
 */
export interface ShadowSettings { area: number; res: number; soft: number }
export const SHADOW_RES_OPTIONS = [2048, 4096, 8192];
export const SHADOW_AREA = { min: 40, max: 260 }, SHADOW_SOFT_MAX = 4;
export const defaultShadow = (): ShadowSettings => ({ area: 120, res: 4096, soft: 1.5 });
/**
 * Prop 3D extra (um `.glb` em `data/res-extra`, servido em `/res/<file>`; ex.: objetos exportados do Cruma/Lineage 2).
 * `pos` em coordenadas FlyFF (x, y, z — a cena inverte o z); `rotY` = giro em Y da CENA, em graus; `scale` uniforme sobre o tamanho
 * do arquivo (o .glb vem em unidades do L2, então a escala de um objeto L2 é bem pequena, ~0.01).
 */
export interface PropEdit { file: string; pos: [number, number, number]; rotY: number; scale: number; /** false = atravessável (padrão: colide, como os objetos do mapa) */ collide?: boolean; /** true = não desenha, só colide (malha de colisão do cenário) */ hidden?: boolean }
export const PROP_FILE_RE = /^(?!.*\.\.)[\w .\-\/]{1,120}\.glb$/i;

/** ponto nomeado do mapa (x, y, z FlyFF — y é a altura do chão marcado) */
export interface MapPoint { name: string; pos: [number, number, number] }
/** nome do ponto onde o jogador aparece ao entrar no mapa (porta de dungeon, //mapa, reviver); vale no lugar do ponto do .rgn */
export const ARRIVAL_POINT = 'chegada';

/** retângulo (x, z FlyFF) onde NoWalk/NoMove deixam de valer */
export interface OpenArea { x1: number; z1: number; x2: number; z2: number }
/** (x, z) está numa área liberada? */
export const inOpenArea = (areas: OpenArea[] | undefined, x: number, z: number) => !!areas?.some((a) => x >= a.x1 && x <= a.x2 && z >= a.z1 && z <= a.z2);

export interface WorldEdits {
  format: 'reactionmmo-world-edits'; version: 1; world: string;
  npcs: { moved: Record<string, NpcMove>; removed: number[]; added: NpcAdded[] };
  environment?: EnvironmentEdits;
  props?: PropEdit[];
  points?: MapPoint[];
  closedPortals?: string[];
  openAreas?: OpenArea[];
  /** alturas do terreno mexidas no editor (ferramenta Terreno): tile "x,y" → vértices alterados em base64 (ver encodeTerrain) */
  terrain?: Record<string, string>;
  /** objetos do mapa (.lnd) mexidos no editor, por tile "x,y": movidos (índice no .lnd), apagados e novos */
  objects?: Record<string, TileObjectEdits>;
}

/** posição, giro e escala de um objeto do mapa (espaço do mundo FlyFF, 3 casas) */
export interface ObjectPose { pos: [number, number, number]; rot: [number, number, number]; scale: [number, number, number] }
export interface ObjectAdded extends ObjectPose { modelId: number; type: number }
/**
 * Edições dos objetos de UM tile: `moved` (índice do objeto no .lnd → pose nova), `removed` (índices apagados) e `added` (objetos
 * novos, sem índice). O editor recalcula isso do zero a cada salvar, comparando o tile com o original (`WorldData.objectBase`).
 */
export interface TileObjectEdits { moved: Record<string, ObjectPose>; removed: number[]; added: ObjectAdded[] }
export const OBJECT_LIMIT = { tiles: 400, perTile: 20000 };

const r3n = (n: number) => Math.round(n * 1000) / 1000;
const r3t = (a: ArrayLike<number>) => [r3n(a[0]), r3n(a[1]), r3n(a[2])] as [number, number, number];
export const poseOf = (o: { pos: number[]; rot: number[]; scale: number[] }): ObjectPose => ({ pos: r3t(o.pos), rot: r3t(o.rot), scale: r3t(o.scale) });
const samePose = (a: ObjectPose, b: ObjectPose) => a.pos.every((v, i) => v === b.pos[i]) && a.rot.every((v, i) => v === b.rot[i]) && a.scale.every((v, i) => v === b.scale[i]);

/** objetos do .lnd (`src` = índice no arquivo) com as edições salvas aplicadas: sem os apagados, com a pose nova e os novos no fim */
export function applyObjectEdits(objects: WorldObject[], e: TileObjectEdits | undefined): WorldObject[] {
  if (!e) return objects;
  const removed = new Set(e.removed);
  const out: WorldObject[] = [];
  for (const o of objects) {
    const i = (o as { src?: number }).src;
    if (i === undefined || removed.has(i)) continue;
    const m = e.moved[String(i)];
    out.push(m ? { ...o, pos: [...m.pos], rot: [...m.rot], scale: [...m.scale] } : o);
  }
  for (const a of e.added) out.push({ type: a.type, modelId: a.modelId, pos: [...a.pos], rot: [...a.rot], scale: [...a.scale], motion: 0, ai: 0, ai2: 0 });
  return out;
}

/** o que mudou no tile em relação ao original (`base` = pose de cada objeto do .lnd, pelo índice); null se nada mudou */
export function diffObjects(objects: WorldObject[], base: ObjectPose[]): TileObjectEdits | null {
  const e: TileObjectEdits = { moved: {}, removed: [], added: [] };
  const present = new Set<number>();
  for (const o of objects) {
    const i = (o as { src?: number }).src;
    if (i === undefined || i < 0 || i >= base.length) { e.added.push({ modelId: o.modelId, type: o.type, ...poseOf(o) }); continue; }
    present.add(i);
    const p = poseOf(o);
    if (!samePose(p, base[i])) e.moved[String(i)] = p;
  }
  for (let i = 0; i < base.length; i++) if (!present.has(i)) e.removed.push(i);
  return Object.keys(e.moved).length || e.removed.length || e.added.length ? e : null;
}

/** vértices por tile do terreno (129 × 129) */
export const TERRAIN_VERTS = 129 * 129;
const TERRAIN_BYTES = 6; // uint16 índice + float32 altura
const TERRAIN_MAX_TILE_BYTES = TERRAIN_VERTS * TERRAIN_BYTES;

/** vértices alterados de um tile → base64 de [uint16 índice][float32 altura] (little-endian), em ordem de índice */
export function encodeTerrain(entries: Iterable<[number, number]>): string {
  const list = [...entries].sort((a, b) => a[0] - b[0]);
  const buf = new Uint8Array(list.length * TERRAIN_BYTES), dv = new DataView(buf.buffer);
  list.forEach(([i, h], k) => { dv.setUint16(k * TERRAIN_BYTES, i, true); dv.setFloat32(k * TERRAIN_BYTES + 2, Math.round(h * 100) / 100, true); });
  let bin = '';
  for (let o = 0; o < buf.length; o += 0x8000) bin += String.fromCharCode(...buf.subarray(o, o + 0x8000));
  return btoa(bin);
}

/** inverso de encodeTerrain; null se o texto não é uma lista válida (tamanho, índice ou altura fora do esperado) */
export function decodeTerrain(b64: string): [number, number][] | null {
  if (typeof b64 !== 'string' || b64.length > TERRAIN_MAX_TILE_BYTES * 2 || !/^[A-Za-z0-9+/]*={0,2}$/.test(b64)) return null;
  let bin: string;
  try { bin = atob(b64); } catch { return null; }
  if (bin.length % TERRAIN_BYTES) return null;
  const dv = new DataView(Uint8Array.from(bin, (c) => c.charCodeAt(0)).buffer), out: [number, number][] = [];
  for (let o = 0; o < bin.length; o += TERRAIN_BYTES) {
    const i = dv.getUint16(o, true), h = dv.getFloat32(o + 2, true);
    if (i >= TERRAIN_VERTS || !Number.isFinite(h) || Math.abs(h) > 100000) return null;
    out.push([i, h]);
  }
  return out;
}

/** aplica as alturas salvas num tile (`heights` do Landscape) */
export function applyTerrain(heights: Float32Array, b64: string | undefined) {
  const list = b64 ? decodeTerrain(b64) : null;
  if (list) for (const [i, h] of list) heights[i] = h;
}

export const emptyEdits = (world: string): WorldEdits => ({ format: 'reactionmmo-world-edits', version: 1, world, npcs: { moved: {}, removed: [], added: [] } });

/** NPC com o índice dele no .dyo original (`src`); NPC novo = -1 */
export type WithSrc = WorldObject & { src?: number };

const v3 = (a: number[]) => [a[0], a[1], a[2]] as [number, number, number];

/** lista de NPCs com as edições aplicadas: originais (menos os apagados, com a posição nova) e depois os adicionados */
export function applyNpcEdits(original: WorldObject[], e: WorldEdits['npcs'] | undefined): WithSrc[] {
  const removed = new Set(e?.removed ?? []);
  const out: WithSrc[] = [];
  original.forEach((o, i) => {
    if (removed.has(i)) return;
    const m = e?.moved[String(i)];
    out.push({ ...o, src: i, pos: v3(m ? m.pos : o.pos), rot: m ? [o.rot[0], m.rot, o.rot[2]] : v3(o.rot), scale: v3(o.scale) });
  });
  for (const a of e?.added ?? []) out.push({ type: a.type, modelId: a.modelId, pos: v3(a.pos), rot: v3(a.rot), scale: v3(a.scale), motion: 0, ai: 0, ai2: 0, name: a.name, characterKey: a.characterKey, src: -1 });
  return out;
}

/** valida o que veio do disco/rede (descarta campos inesperados) */
export function cleanEdits(v: unknown, world: string): WorldEdits {
  const out = emptyEdits(world);
  const o = v as Partial<WorldEdits> | null;
  if (!o || typeof o !== 'object') return out;
  const num3 = (a: unknown): a is [number, number, number] => Array.isArray(a) && a.length === 3 && a.every((n) => typeof n === 'number' && Number.isFinite(n));
  const r3 = (a: number[]) => a.map((n) => Math.round(n * 1000) / 1000) as [number, number, number];
  for (const [k, m] of Object.entries(o.npcs?.moved ?? {})) if (/^\d+$/.test(k) && num3(m?.pos) && Number.isFinite(m.rot)) out.npcs.moved[k] = { pos: r3(m.pos), rot: Math.round(m.rot * 1000) / 1000 };
  out.npcs.removed = (o.npcs?.removed ?? []).filter((n) => Number.isInteger(n) && n >= 0);
  for (const a of o.npcs?.added ?? []) {
    if (!Number.isInteger(a?.modelId) || !Number.isInteger(a?.type) || !num3(a.pos) || !num3(a.rot) || !num3(a.scale)) continue;
    out.npcs.added.push({ modelId: a.modelId, type: a.type, characterKey: typeof a.characterKey === 'string' ? a.characterKey.slice(0, 64) : undefined, name: typeof a.name === 'string' ? a.name.slice(0, 64) : undefined, pos: r3(a.pos), rot: r3(a.rot), scale: r3(a.scale) });
  }
  for (const p of Array.isArray(o.props) ? o.props.slice(0, 500) : []) {
    if (typeof p?.file !== 'string' || !PROP_FILE_RE.test(p.file) || !num3(p.pos) || !Number.isFinite(p.rotY) || !Number.isFinite(p.scale) || p.scale <= 0) continue;
    (out.props ??= []).push({ file: p.file, pos: r3(p.pos), rotY: Math.round(p.rotY * 1000) / 1000, scale: Math.min(1000, Math.max(0.0001, Math.round(p.scale * 1e6) / 1e6)), ...(p.collide === false ? { collide: false } : {}), ...(p.hidden === true ? { hidden: true } : {}) });
  }
  const open = (Array.isArray(o.openAreas) ? o.openAreas : []).filter((a) => [a?.x1, a?.z1, a?.x2, a?.z2].every((n) => typeof n === 'number' && Number.isFinite(n))).slice(0, 200)
    .map((a) => ({ x1: Math.round(Math.min(a.x1, a.x2) * 100) / 100, z1: Math.round(Math.min(a.z1, a.z2) * 100) / 100, x2: Math.round(Math.max(a.x1, a.x2) * 100) / 100, z2: Math.round(Math.max(a.z1, a.z2) * 100) / 100 }));
  if (open.length) out.openAreas = open;
  const closed = (Array.isArray(o.closedPortals) ? o.closedPortals : []).filter((s): s is string => typeof s === 'string' && /^WI_[A-Za-z0-9_]{1,60}$/.test(s));
  if (closed.length) out.closedPortals = [...new Set(closed)];
  for (const p of Array.isArray(o.points) ? o.points.slice(0, 200) : []) {
    const name = typeof p?.name === 'string' ? p.name.trim().slice(0, 40) : '';
    if (!name || !num3(p.pos) || (out.points ?? []).some((q) => q.name.toLowerCase() === name.toLowerCase())) continue;
    (out.points ??= []).push({ name, pos: r3(p.pos) });
  }
  for (const [k, v] of Object.entries(o.terrain && typeof o.terrain === 'object' ? o.terrain : {}).slice(0, 400)) {
    if (/^\d{1,3},\d{1,3}$/.test(k) && decodeTerrain(v as string)?.length) (out.terrain ??= {})[k] = v as string;
  }
  const pose = (p: unknown): p is ObjectPose => !!p && typeof p === 'object' && num3((p as ObjectPose).pos) && num3((p as ObjectPose).rot) && num3((p as ObjectPose).scale);
  for (const [k, v] of Object.entries(o.objects && typeof o.objects === 'object' ? o.objects : {}).slice(0, OBJECT_LIMIT.tiles)) {
    if (!/^\d{1,3},\d{1,3}$/.test(k) || !v || typeof v !== 'object') continue;
    const t: TileObjectEdits = { moved: {}, removed: [], added: [] };
    for (const [s, p] of Object.entries(v.moved ?? {}).slice(0, OBJECT_LIMIT.perTile)) if (/^\d{1,6}$/.test(s) && pose(p)) t.moved[s] = poseOf(p);
    t.removed = [...new Set((Array.isArray(v.removed) ? v.removed : []).filter((n): n is number => Number.isInteger(n) && n >= 0 && n < 1_000_000))].slice(0, OBJECT_LIMIT.perTile);
    for (const a of (Array.isArray(v.added) ? v.added : []).slice(0, OBJECT_LIMIT.perTile)) if (Number.isInteger(a?.modelId) && Number.isInteger(a?.type) && pose(a)) t.added.push({ modelId: a.modelId, type: a.type, ...poseOf(a) });
    if (Object.keys(t.moved).length || t.removed.length || t.added.length) (out.objects ??= {})[k] = t;
  }
  const e = o.environment;
  if (e && typeof e === 'object' && Number.isFinite(e.hour) && Number.isFinite(e.sunTilt)) {
    out.environment = { hour: Math.min(23.75, Math.max(0, e.hour)), sunTilt: Math.min(70, Math.max(0, e.sunTilt)), worldLight: !!e.worldLight, shadows: !!e.shadows, worldFog: !!e.worldFog, showSky: !!e.showSky, showWater: !!e.showWater };
    const f = e.filter;
    if (f && typeof f === 'object' && SCREEN_FILTERS.includes(f.filter) && Number.isFinite(f.strength)) {
      out.environment.filter = { filter: f.filter, strength: Math.min(1, Math.max(0, f.strength)), outline: !!f.outline, saturation: Number.isFinite(f.saturation) ? Math.min(1.5, Math.max(0, f.saturation)) : 1 };
    }
    const sh = e.shadow;
    if (sh && typeof sh === 'object' && Number.isFinite(sh.area) && Number.isFinite(sh.soft)) {
      out.environment.shadow = {
        area: Math.min(SHADOW_AREA.max, Math.max(SHADOW_AREA.min, sh.area)),
        res: SHADOW_RES_OPTIONS.includes(sh.res) ? sh.res : 4096,
        soft: Math.min(SHADOW_SOFT_MAX, Math.max(0, sh.soft)),
      };
    }
  }
  return out;
}
