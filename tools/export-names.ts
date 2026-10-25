import fs from 'node:fs';
import path from 'node:path';
import { ItemCatalog } from '../servers/common/items';
import { SkillCatalog } from '../servers/world/skills';
import { EXTRA_DIR } from '../servers/common/config';
import { decodeText, parseTxtTxt } from '../shared/formats/rgn';
import { parseCharacters } from '../shared/humans';

/**
 * Tabela de nomes de outra versão do FlyFF, pelo SÍMBOLO (II_*, MI_*, SI_*, chave do NPC) — para usar textos de um idioma
 * quando a versão instalada vem em outro (ex.: servidor novo só em francês, antigo em inglês). As chaves IDS_* mudam de uma
 * versão para outra; o símbolo não. O jogo usa a tabela por cima dos textos do Resource (servers/common/names.ts).
 *
 *   npx tsx tools/export-names.ts <pasta Resource de onde tirar os nomes> [saída]
 *   (padrão da saída: data/res-extra/names-en.json)
 */
const [src, out = path.join(EXTRA_DIR, 'names-en.json')] = process.argv.slice(2);
if (!src || !fs.existsSync(src)) { console.error('uso: npx tsx tools/export-names.ts <pasta Resource> [saída.json]'); process.exit(1); }

const read = (f: string) => { try { const b = fs.readFileSync(path.join(src, f)); return decodeText(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer, 'windows-1252'); } catch { return ''; } };
const items = new ItemCatalog(src, false).load();

const names = { items: {} as Record<string, string>, sets: {} as Record<string, string>, movers: {} as Record<string, string>, skills: {} as Record<string, [string, string]>, npcs: {} as Record<string, string> };
for (const d of items.byId.values()) if (d.name !== d.symbol) names.items[d.symbol] = d.name;
// set: pelo símbolo da 1ª peça (o número do SetItem também muda entre versões)
for (const s of items.sets) { const first = items.byId.get(s.elems[0]?.item)?.symbol; if (first && !s.name.startsWith('IDS_')) names.sets[first] = s.name; }

const moverTxt = parseTxtTxt(read('propMover.txt.txt'));
for (const line of read('propMover.txt').split(/\r?\n/)) {
  const c = line.split('\t');
  const name = moverTxt.get(c[1]?.trim());
  if (/^MI_/.test(c[0] ?? '') && name) names.movers[c[0].trim()] = name;
}

for (const s of new SkillCatalog(src, items, false).byId.values()) if (s.name !== s.symbol) names.skills[s.symbol] = [s.name, s.desc];

for (const base of ['character', 'character-etc', 'character-school']) {
  const txt = parseTxtTxt(read(`${base}.txt.txt`));
  const inc = read(`${base}.inc`);
  for (const [k, c] of parseCharacters(inc)) {
    const n = c.name?.startsWith('IDS_') ? txt.get(c.name) : c.name;
    if (n) names.npcs[k] = n;
  }
}

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(names));
console.log(`${out}: ${Object.keys(names.items).length} itens, ${Object.keys(names.sets).length} sets, ${Object.keys(names.movers).length} monstros/NPCs, ` +
  `${Object.keys(names.skills).length} skills, ${Object.keys(names.npcs).length} NPCs`);
