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
export interface WorldEdits {
  format: 'reactionmmo-world-edits'; version: 1; world: string;
  npcs: { moved: Record<string, NpcMove>; removed: number[]; added: NpcAdded[] };
  environment?: EnvironmentEdits;
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
