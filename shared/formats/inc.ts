/** Tabelas de projeto do FlyFF: mdlObj.inc, mdlDyna.inc, Terrain.inc e headers define*.h */

export interface ModelEntry {
  name: string; id: number; modelType: string; scale: number; type: number;
  /** bloco `{ "arquivo" MTI_x ... }` de movers: sufixo do .ani por símbolo de movimento */
  motions?: { file: string; symbol: string }[];
  /** campo `szPart` (itens): ex. "mCloBlueWedCap" ou "male/female" → Part_<nome>.o3d */
  part?: string;
}

const stripComments = (s: string) => s.split(/\r?\n/).map((l) => l.replace(/\/\/.*$/, '')).join('\n');

/** `#define SYMBOL 123` / `0x10` de defineObj.h etc. */
export function parseDefines(text: string, into = new Map<string, number>()): Map<string, number> {
  // blocos /* … */ ficam de fora: o defineJob.h novo guarda uma tabela antiga de JOB_* comentada que redefiniria os números
  for (const m of text.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/^\s*#define\s+(\w+)\s+(0x[0-9a-fA-F]+|\d+)/gm)) into.set(m[1], Number(m[2]));
  return into;
}

const SECTION: Record<string, number> = { ctrl: 2, sfx: 3, item: 4, mvr: 5, region: 6, ship: 7, path: 8 };

/** mdlObj.inc (type OBJ=0) e mdlDyna.inc (seções "ctrl" 2, "sfx" 3, "mvr" 5 ...). */
export function parseModelTable(text: string, defaultType: number, defines: Map<string, number>): ModelEntry[] {
  const out: ModelEntry[] = [];
  let type = defaultType;
  const lines = stripComments(text).split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const sec = line.match(/^\s*"([^"]+)"\s+(\d+)\s*$/);
    if (sec) {
      const t = SECTION[sec[1].toLowerCase()];
      if (t !== undefined) type = t;
      continue;
    }
    // nome entre aspas ("nome") ou solto (AiBatt) — mdlDyna.inc usa as duas formas
    const m = line.match(/^\s*(?:"([^"]+)"|([^\s"]+))\s+(\w+)\s+(MODELTYPE_\w+)\s*"([^"]*)"\s+\S+\s+\S+\s+\S+\s+([\d.]+)f?/);
    if (!m) continue;
    const id = /^\d+$/.test(m[3]) ? Number(m[3]) : defines.get(m[3]);
    if (id === undefined) continue;
    const entry: ModelEntry = { name: m[1] ?? m[2], id, modelType: m[4], scale: Number(m[6]), type, part: m[5] || undefined };
    // bloco de movimentos opcional logo após a entrada
    let j = i + 1;
    while (j < lines.length && !lines[j].trim()) j++;
    if (lines[j]?.trim() === '{') {
      const motions: { file: string; symbol: string }[] = [];
      for (j++; j < lines.length && lines[j].trim() !== '}'; j++) {
        const mm = lines[j].match(/^\s*"([^"]+)"\s+(\w+)/);
        if (mm) motions.push({ file: mm[1], symbol: mm[2] });
      }
      if (motions.length) entry.motions = motions;
      i = j;
    }
    out.push(entry);
  }
  return out;
}

/** Terrain.inc: `textureId 0 "arquivo.dds" 0 ""` */
export function parseTerrain(text: string): Map<number, string> {
  const m = new Map<number, string>();
  for (const x of stripComments(text).matchAll(/^\s*(\d+)\s+\d+\s+"([^"]*)"/gm)) m.set(Number(x[1]), x[2]);
  return m;
}

/** Nome do arquivo de modelo (CObject::GetModelFilename). */
export function modelFileName(e: ModelEntry): string {
  const root = ['Obj', 'Ani', 'Ctrl', 'Sfx', 'Item', 'Mvr', 'Region', 'Obj', 'Path'][e.type] ?? 'Obj';
  // CObject::GetModelFilename: SFX com '_' no nome usam o nome como está; senão prefixo da raiz
  if (e.modelType === 'MODELTYPE_SFX') return (e.type === 3 && e.name.includes('_') ? e.name : `${root}_${e.name}`) + '.sfx';
  return `${root}_${e.name}.o3d`;
}

/**
 * Listas de animação de água do Terrain.inc: seção `"Water" N { "nome" frames { id 0 "arq.dds" ... } ... }`.
 * O índice da lista é o byte `texture >> 2` de cada patch de água do .lnd (CProject::_loadTerrain / GetWaterTexture).
 */
export function parseWaterLists(text: string): number[][] {
  const lines = stripComments(text).split(/\r?\n/);
  const start = lines.findIndex((l) => /^\s*"Water"\s+\d+/.test(l));
  if (start < 0) return [];
  const lists: number[][] = [];
  let depth = 0, cur: number[] | null = null;
  for (let i = start + 1; i < lines.length; i++) {
    const l = lines[i].trim();
    if (l === '{') { depth++; continue; }
    if (l === '}') { depth--; if (depth === 1) cur = null; if (depth <= 0) break; continue; }
    if (depth === 1 && /^"[^"]*"\s+\d+/.test(l)) { cur = []; lists.push(cur); continue; }
    const m = l.match(/^(\d+)\s+\d+\s+"/);
    if (m && cur && depth === 2) cur.push(Number(m[1]));
  }
  return lists;
}
