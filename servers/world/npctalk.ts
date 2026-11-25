import fs from 'node:fs';
import path from 'node:path';

/**
 * Falas dos NPCs na janela de conversa, como nos roteiros originais (WorldDialog): cada NPC tem funções `<nome>_<n>` no
 * NpcScript.cpp, na ordem do cabeçalho do WorldDialog.txt — 0 saudação, 3 saudação com quest nova, 4 sem quest nova,
 * 9 "Introduce" e 10 "Farewell" — e o número que passam a Say/Speak é a linha do WorldDialog.txt.
 * O .cpp fica em `Source/` ao lado da Resource; sem ele a janela abre só com as quests.
 */
export interface NpcScript { greet?: string; yes?: string; no?: string; intro?: string; bye?: string }

export function loadNpcScripts(resDir: string): Map<string, NpcScript> {
  const out = new Map<string, NpcScript>();
  let lines: string[], code: string;
  try {
    lines = new TextDecoder('windows-1252').decode(fs.readFileSync(path.join(resDir, 'WorldDialog.txt'))).split(/\r?\n/);
    code = fs.readFileSync(path.join(resDir, '..', 'Source', 'Source', 'WORLDDIALOG', 'NpcScript.cpp'), 'latin1');
  } catch { return out; }
  code = code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\r\n]*/g, '');
  const FIELD: Record<string, keyof NpcScript> = { 0: 'greet', 3: 'yes', 4: 'no', 9: 'intro', 10: 'bye' };
  for (const m of code.matchAll(/void\s+CNpcScript::(\w+?)_(\d+)\s*\(\s*\)\s*\{([\s\S]*?)\r?\n\}/g)) {
    const field = FIELD[m[2]];
    if (!field) continue;
    // todas as falas fixas da função (várias = parágrafos)
    const text = [...m[3].matchAll(/\b(?:Say\s*\(|Speak\s*\(\s*NpcId\s*\(\s*\)\s*,)\s*(\d+)\s*\)/g)].map((s) => lines[Number(s[1])]?.trim()).filter(Boolean).join('\n\n');
    if (!text) continue;
    const key = m[1].toLowerCase();
    let script = out.get(key);
    if (!script) out.set(key, (script = {}));
    script[field] = text;
  }
  return out;
}
