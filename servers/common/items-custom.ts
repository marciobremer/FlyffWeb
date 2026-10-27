import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ItemDef } from './items';

/**
 * Alterações de itens feitas no painel admin (aba Items), por cima do Spec_Item.txt do FlyFF — o arquivo original não é mexido:
 *   edits    id → campos trocados (ex.: o Rudolph antigo ir para o espaço de fashion)
 *   added    itens novos (id e símbolo próprios); `base` copia tudo de um item existente antes de aplicar os campos
 *   removed  ids que somem do jogo
 * Fica em data/items-custom.json; o servidor do jogo lê ao iniciar (reiniciar para valer).
 */
export const ITEMS_CUSTOM_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'data', 'items-custom.json');

/** campos editáveis no painel (o resto do item fica como no Spec_Item) */
export interface ItemPatch {
  name?: string; desc?: string; icon?: string; parts?: number; kind1?: number; kind2?: number; kind3?: number;
  sex?: number; job?: number; level?: number; abilityMin?: number; abilityMax?: number; attackSpeed?: number;
  packMax?: number; cost?: number; grade?: number; handed?: number; weaponType?: number; element?: number;
  ignorePart?: number; shopAble?: number;
  /** bônus: até 6 pares [DST_*, valor] */
  fx?: [number, number][];
  /** visual: símbolo II_* de outro item cujo modelo aparece no personagem (para itens novos sem modelo próprio) */
  look?: string;
}
export interface NewItem extends ItemPatch { id: number; symbol: string; base?: string }
export interface ItemsCustom { edits: Record<string, ItemPatch>; added: NewItem[]; removed: number[] }

export const emptyCustom = (): ItemsCustom => ({ edits: {}, added: [], removed: [] });

export function readItemsCustom(): ItemsCustom {
  try {
    const j = JSON.parse(fs.readFileSync(ITEMS_CUSTOM_FILE, 'utf8')) as Partial<ItemsCustom>;
    return { edits: j.edits && typeof j.edits === 'object' ? j.edits : {}, added: Array.isArray(j.added) ? j.added : [], removed: Array.isArray(j.removed) ? j.removed.map(Number) : [] };
  } catch { return emptyCustom(); }
}

export function writeItemsCustom(c: ItemsCustom) {
  fs.mkdirSync(path.dirname(ITEMS_CUSTOM_FILE), { recursive: true });
  fs.writeFileSync(ITEMS_CUSTOM_FILE, JSON.stringify(c, null, 2) + '\n');
}

const NUM_FIELDS = ['parts', 'kind1', 'kind2', 'kind3', 'sex', 'job', 'level', 'abilityMin', 'abilityMax', 'attackSpeed', 'packMax', 'cost', 'grade', 'handed', 'weaponType', 'element', 'ignorePart', 'shopAble'] as const;

/** aplica os campos do patch num item (muda o próprio objeto) */
export function applyPatch(d: ItemDef, p: ItemPatch) {
  if (typeof p.name === 'string' && p.name.trim()) d.name = p.name.trim();
  if (typeof p.desc === 'string') d.desc = p.desc.trim() || undefined;
  if (typeof p.icon === 'string' && p.icon.trim()) d.icon = p.icon.trim();
  for (const k of NUM_FIELDS) { const v = p[k]; if (typeof v === 'number' && Number.isFinite(v)) (d as unknown as Record<string, number>)[k] = v; }
  if (Array.isArray(p.fx)) {
    const fx = p.fx.filter((x) => Array.isArray(x) && Number(x[0]) > 0).slice(0, 6);
    d.dest = Array.from({ length: 6 }, (_, i) => (fx[i] ? Number(fx[i][0]) : -1));
    d.adj = Array.from({ length: 6 }, (_, i) => (fx[i] ? Number(fx[i][1]) || 0 : 0));
  }
  if (typeof p.look === 'string') d.look = p.look.trim() || undefined;
  if (d.packMax < 1) d.packMax = 1;
}

/** item vazio (para "novo item" sem base) */
export function blankItem(id: number, symbol: string): ItemDef {
  return {
    id, symbol, name: symbol, icon: '', packMax: 1, parts: -1, sex: -1, level: 1, kind1: 0, kind2: 0, kind3: 0, cost: 0,
    abilityMin: 0, abilityMax: 0, weaponType: 0, attackSpeed: 0, rare: 0, shopAble: -1, dest: [-1, -1, -1, -1, -1, -1], adj: [0, 0, 0, 0, 0, 0],
    ready: 0, adjHit: 0, parry: 0, snd1: -1, snd2: -1, attackRange: 0, job: -1, handed: 1, ignorePart: -1, grade: 100, element: 0,
    referStat1: -1, referStat2: -1, referTarget1: -1, referTarget2: -1,
  };
}
