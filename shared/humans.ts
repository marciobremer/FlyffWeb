import type { ModelEntry } from './formats/inc';
import type { WorldData } from './data';
import { loadTemplate, type HandAttachment, type MoverTemplate } from './movers';
import type { ModelLibrary } from './models';
import { OT } from './formats/types';
import { isLeftHand, lookSymbol } from './look';

/**
 * Humanos (MI_MALE / MI_FEMALE): não existe `Mvr_male.o3d`; o corpo é montado com várias malhas `Part_*.o3d` sobre o esqueleto
 * `mvr_male.chr`/`mvr_female.chr` (CMover::_loadModel + CAnimatedMesh::Load em Common/Mover.cpp / AnimatedMesh.cpp).
 */
export type Sex = 'male' | 'female';

export interface CharacterDef {
  key: string; sex: Sex | null; hair: number; hairColor: number; head: number; equip: string[];
  /** `SetName("…")` ou `SetName(IDS_…)` (resolvido depois por character*.txt.txt) */
  name?: string;
}

/**
 * character.inc: `Chave { setting { SetEquip(II_x, II_y…); SetFigure(MI_MALE, cabelo, cor, cabeça); … } SetName("…") }`
 * (CProject::_loadCharacter). Só nos interessa a aparência.
 */
export function parseCharacters(text: string): Map<string, CharacterDef> {
  const out = new Map<string, CharacterDef>();
  const lines = text.split(/\r?\n/);
  let depth = 0, key = '', buf: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i].replace(/\/\/.*$/, '');
    const line = raw.trim();
    if (depth === 0) {
      const m = line.match(/^([A-Za-z_]\w*)$/);
      if (m && lines.slice(i + 1).find((l) => l.replace(/\/\/.*$/, '').trim())?.replace(/\/\/.*$/, '').trim() === '{') { key = m[1]; buf = []; continue; }
    }
    for (const ch of raw) { if (ch === '{') depth++; else if (ch === '}') depth--; }
    if (key) buf.push(raw);
    if (depth === 0 && key && buf.length) {
      const body = buf.join('\n');
      const fig = body.match(/SetFigure\s*\(\s*(MI_\w+)\s*,\s*(\d+)\s*,\s*(0x[0-9a-fA-F]+|\d+)\s*,\s*(\d+)\s*\)/);
      const eq = body.match(/SetEquip\s*\(([^)]*)\)/);
      const def: CharacterDef = {
        key, sex: fig ? (fig[1] === 'MI_FEMALE' ? 'female' : fig[1] === 'MI_MALE' ? 'male' : null) : null,
        hair: fig ? Number(fig[2]) : 0, hairColor: fig ? Number(fig[3]) : 0, head: fig ? Number(fig[4]) : 0,
        equip: eq ? eq[1].split(',').map((x) => x.trim()).filter(Boolean) : [],
      };
      const nm = body.match(/SetName\s*\(\s*(?:"([^"]*)"|(IDS_\w+))\s*\)/);
      if (nm) def.name = nm[1] ?? nm[2];
      out.set(key.toLowerCase(), def);
      key = ''; buf = [];
    }
  }
  return out;
}

type Slot = 'upper' | 'lower' | 'hand' | 'foot' | 'cap' | 'mask' | 'cloak' | 'head' | 'hair' | 'other';

/** `CModelMng::GetModelPart`: o slot sai do sufixo do nome do arquivo. */
export function slotOf(partName: string): Slot {
  const n = partName.toLowerCase();
  if (n.endsWith('hand') || n.endsWith('gloves')) return 'hand';
  if (n.endsWith('cap') || n.endsWith('hat')) return 'cap';
  if (n.endsWith('upper') || n.endsWith('suit')) return 'upper';
  if (n.endsWith('lower')) return 'lower';
  if (n.endsWith('foot') || n.endsWith('shoes') || n.endsWith('boots')) return 'foot';
  if (n.startsWith('mas')) return 'mask';
  if (n.endsWith('cape') || n.includes('cloak')) return 'cloak';
  if (n.includes('head')) return 'head';
  if (n.includes('hair')) return 'hair';
  return 'other';
}

const two = (n: number) => String(n).padStart(2, '0');

/**
 * Nomes (sem `Part_` e `.o3d`) das partes de um humano: corpo padrão + cabeça + cabelo, com o equipamento substituindo o slot.
 * `hide`: peças base que um item equipado esconde (dwBasePartsIgnore — chapéu/cabelo de cash no lugar do cabelo).
 */
export function humanPartNames(sex: Sex, hair: number, head: number, equipParts: string[], hide: { head?: boolean; hair?: boolean } = {}): string[] {
  const s = sex;
  const slots = new Map<Slot, string[]>([
    ['upper', [`${s}Upper`]], ['lower', [`${s}Lower`]], ['hand', [`${s}Hand`]], ['foot', [`${s}Foot`]],
    ['head', [`${s}Head${two(head || 1)}`]], ['hair', [`${s}Hair${two(hair || 1)}`]],
  ]);
  for (const p of equipParts) {
    const slot = slotOf(p);
    if (slot === 'cap' || slot === 'mask' || slot === 'cloak' || slot === 'other') slots.set(slot, [...(slots.get(slot) ?? []), p]);
    else slots.set(slot, [p]);
  }
  // a suit (roupa) cobre o corpo inteiro: o Part_<sexo>Lower só existe sem roupa equipada
  if (equipParts.some((p) => slotOf(p) === 'upper') && !equipParts.some((p) => slotOf(p) === 'lower')) slots.delete('lower');
  // MoverRender.cpp: SetEffect(dwBasePartsIgnore, XE_HIDE); esconder a cabeça (PARTS_HEAD) esconde o cabelo junto
  if (hide.head) { slots.delete('head'); slots.delete('hair'); }
  if (hide.hair) slots.delete('hair');
  return [...slots.values()].flat();
}

/** Nome da peça de um item II_* para o sexo (campo "male/female" ou único). */
export function itemPartName(data: WorldData, symbol: string, sex: Sex): string | null {
  const id = data.defines.get(symbol);
  if (id === undefined) return null;
  const part = data.dynaModels.get(`${OT.ITEM}:${id}`)?.part;
  if (!part) return null;
  const i = part.indexOf('/');
  return i >= 0 ? (sex === 'male' ? part.slice(0, i) : part.slice(i + 1)) : part;
}

/**
 * Arma/escudo: item sem peça de corpo no mdlDyna, desenhado com `Item_<nome>.o3d` preso à mão. Qual mão pelo tipo
 * (o servidor sabe o PARTS_*, aqui basta o símbolo): escudo (II_ARM_ARM_SHI_*) e arco na esquerda, knuckle com a matriz
 * própria, o resto na direita. A 2ª arma da Blade (PARTS_LWEAPON) vem marcada na lista do visual e vai na esquerda (loadHumanTemplate).
 */
export function handAttachment(data: WorldData, symbol: string): HandAttachment | null {
  const id = data.defines.get(symbol);
  const e = id === undefined ? undefined : data.dynaModels.get(`${OT.ITEM}:${id}`);
  if (!e || e.part) return null;
  const isShield = /^II_ARM_ARM_SHI_/.test(symbol);
  if (!isShield && !/^II_WEA_/.test(symbol)) return null;
  const slot = isShield ? 'shield' : /^II_WEA_BOW_/.test(symbol) ? 'lh' : /^II_WEA_KNU_/.test(symbol) ? 'knuckle' : 'rh';
  return { file: `Item_${e.name}.o3d`, slot };
}

export interface HumanSpec { sex: Sex; hair: number; head: number; equip: string[] }

export const humanKey = (s: HumanSpec) => `human:${s.sex}:${s.hair}:${s.head}:${s.equip.join(',')}`;

export async function loadHumanTemplate(entry: ModelEntry, spec: HumanSpec, data: WorldData, lib: ModelLibrary): Promise<MoverTemplate | null> {
  const equip = spec.equip.map(lookSymbol); // tira o enchant (`II_X@7.0.0`, shared/look.ts): o modelo é o mesmo
  const parts = equip.map((sym) => itemPartName(data, sym, spec.sex)).filter((x): x is string => !!x);
  const hide = { head: equip.some((s) => data.hidesHead.has(s)), hair: equip.some((s) => data.hidesHair.has(s)) };
  const files = humanPartNames(spec.sex, spec.hair, spec.head, parts, hide).map((n) => `Part_${n}.o3d`).filter((f) => lib.hasModelFile(f));
  // 2ª arma da Blade (PARTS_LWEAPON, `~lh:` na lista): na mão esquerda, com m_mLocalLH (moverequip.cpp: SetParent(GetLHandIdx()))
  const hands = equip.map((sym, k) => { const h = handAttachment(data, sym); return h && isLeftHand(spec.equip[k]) && h.slot === 'rh' ? { ...h, slot: 'lh' as const } : h; })
    .filter((x): x is HandAttachment => !!x && lib.hasModelFile(x.file));
  const tpl = await loadTemplate(entry, files, `Mvr_${spec.sex}`, lib, hands);
  // a malha do pé fica um pouco abaixo de y = 0 (−0,049 no male): sobe o corpo para a sola ficar sobre o chão. Só os pés
  // contam — arma, escudo e capa têm malhas que descem mais e deixavam o personagem flutuando (~0,15 acima do chão)
  if (tpl) {
    let minY = 0;
    for (const p of tpl.parts) {
      const m = /^Part_(.+)\.o3d$/i.exec(p.file ?? '');
      if (!m || slotOf(m[1]) !== 'foot') continue; // pés, sapatos ou botas (inclusive de cash)
      p.geometry.computeBoundingBox();
      minY = Math.min(minY, p.geometry.boundingBox!.min.y);
    }
    tpl.lift = -minY;
  }
  return tpl;
}

export const isHumanEntry = (e: ModelEntry) => e.name === 'male' || e.name === 'female';
