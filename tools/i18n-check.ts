import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../servers/common/config';

/**
 * Confere as traduções do jogo (shared/i18n.ts): lista os textos marcados para tradução que NÃO têm entrada em
 * `shared/locales/en.json` (ficam em português para quem escolheu inglês) e as entradas do dicionário que não são mais usadas.
 *   npm run i18n:check            sai com código 1 se falta tradução
 * Procura em client/*.ts: t('…'), tr(el, '…'), trAttr(el, 'atributo', '…') e `title: '…'` (títulos de janela); e em
 * client/index.html: o texto de cada data-i18n e o valor dos atributos listados em data-i18n-attrs.
 * Texto montado com crase (t(`…`)) não funciona como chave: o script avisa.
 */
const CLIENT = path.join(ROOT, 'client');
const dict = JSON.parse(fs.readFileSync(path.join(ROOT, 'shared', 'locales', 'en.json'), 'utf8')) as Record<string, string>;

const unescape = (s: string) => s.replace(/\\(['"\\n])/g, (_m, c: string) => (c === 'n' ? '\n' : c));
const Q = String.raw`'((?:[^'\\\n]|\\.)*)'`;
const found = new Map<string, string[]>();
const add = (key: string, where: string) => { if (key.trim()) (found.get(key) ?? found.set(key, []).get(key)!).push(where); };
const bad: string[] = [];

for (const f of fs.readdirSync(CLIENT).filter((n) => n.endsWith('.ts'))) {
  const text = fs.readFileSync(path.join(CLIENT, f), 'utf8');
  const lines = text.split(/\r?\n/);
  lines.forEach((line, i) => {
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
    const where = `client/${f}:${i + 1}`;
    for (const m of line.matchAll(new RegExp(String.raw`(?<![\w.])t\(\s*${Q}`, 'g'))) add(unescape(m[1]), where);
    for (const m of line.matchAll(new RegExp(String.raw`\btr\(\s*[\w.]+\s*,\s*${Q}`, 'g'))) add(unescape(m[1]), where);
    for (const m of line.matchAll(new RegExp(String.raw`\btrAttr\(\s*[\w.]+\s*,\s*'[\w-]+'\s*,\s*${Q}`, 'g'))) add(unescape(m[1]), where);
    for (const m of line.matchAll(new RegExp(String.raw`\btitle:\s*${Q}`, 'g'))) add(unescape(m[1]), where);
    // mensagens de status do login/seleção/criação: sayLogin('texto', erro?, { params }) — o texto é a chave
    const say = /\bsay(?:Login|Select|Create)\(/.exec(line);
    if (say) {
      let depth = 0, end = line.length;
      for (let k = say.index + say[0].length - 1; k < line.length; k++) {
        if (line[k] === '(') depth++;
        else if (line[k] === ')' && --depth === 0) { end = k; break; }
      }
      for (const m of line.slice(say.index, end).matchAll(new RegExp(Q, 'g'))) add(unescape(m[1]), where);
    }
    if (/(?<![\w.])t\(\s*`/.test(line)) bad.push(`${where}: t(\`…\`) não serve como chave — use t('texto {nome}', { nome })`);
  });
}

const html = fs.readFileSync(path.join(CLIENT, 'index.html'), 'utf8');
// data-i18n como atributo solto (data-i18n-attrs não conta): o texto traduzido é o primeiro texto não vazio do elemento
for (const m of html.matchAll(/<(\w+)\b[^>]*?\sdata-i18n(?=[\s>])[^>]*>/g)) {
  const from = m.index! + m[0].length, end = html.indexOf(`</${m[1]}>`, from);
  const first = html.slice(from, end < 0 ? undefined : end).split(/<[^>]*>/).map((s) => s.trim()).find(Boolean);
  if (first) add(first, 'client/index.html');
}
for (const m of html.matchAll(/<\w+([^>]*\sdata-i18n-attrs="([^"]*)"[^>]*)>/g)) {
  for (const a of m[2].split(/\s+/).filter(Boolean)) {
    const v = new RegExp(`\\s${a}="([^"]*)"`).exec(m[1]);
    if (v) add(v[1], 'client/index.html');
  }
}

const missing = [...found.keys()].filter((k) => !(k in dict));
const unused = Object.keys(dict).filter((k) => !found.has(k));
console.log(`${found.size} textos marcados · ${Object.keys(dict).length} no dicionário inglês`);
if (bad.length) { console.log('\nAVISOS:'); for (const b of bad) console.log('  ' + b); }
if (missing.length) { console.log(`\nSEM TRADUÇÃO PARA INGLÊS (${missing.length}):`); for (const k of missing) console.log(`  "${k}"  ← ${found.get(k)![0]}`); }
if (unused.length) { console.log(`\nNO DICIONÁRIO MAS NÃO USADOS (${unused.length}) — sobra de texto que mudou?`); for (const k of unused) console.log(`  "${k}"`); }
if (!missing.length && !bad.length) console.log('\nTudo traduzido.');
process.exit(missing.length || bad.length ? 1 : 0);
