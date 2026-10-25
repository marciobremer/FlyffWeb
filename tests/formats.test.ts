import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { parseWld } from '../shared/formats/wld';
import { parseLnd } from '../shared/formats/lnd';
import { parseDyo } from '../shared/formats/dyo';
import { parseRgn, parseCnt, parseTxtTxt, decodeText } from '../shared/formats/rgn';
import { parseModelTable, parseTerrain } from '../shared/formats/inc';
import { parseO3d } from '../shared/formats/o3d';
import { parseSfx } from '../shared/formats/sfx';
import { CollisionWorld } from '../shared/collision';

const RES = path.resolve(import.meta.dirname, '..', process.env.FLYFF_RESOURCE ?? 'original/Resource');
/** `Data/X` do layout antigo: nas versões novas fica no cliente desempacotado (`Client/X`), como o /res do servidor procura */
const CLIENT = path.resolve(import.meta.dirname, '..', process.env.FLYFF_CLIENT ?? 'original/Client');
const data = (rel: string) => (fs.existsSync(path.join(RES, 'Data', rel)) ? path.join(RES, 'Data', rel) : path.join(CLIENT, rel));
const ab = (p: string) => { const b = fs.readFileSync(p); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer; };
const W = path.join(RES, 'World/WdMadrigal');

// qualquer byte não lido em um .lnd (console.warn) é falha
const warn = console.warn; let warned = 0; console.warn = (...a) => { warned++; warn(...a); };
const wld = parseWld(fs.readFileSync(path.join(W, 'WdMadrigal.wld'), 'utf8'));
assert.ok(wld.width > 0 && wld.mpu === 4);

let objs = 0, sfx = 0, tiles = 0;
const ids = new Set<number>();
for (let y = 0; y < 30; y++) for (let x = 0; x < 30; x++) {
  const f = path.join(W, `WdMadrigal${String(x).padStart(2, '0')}-${String(y).padStart(2, '0')}.lnd`);
  if (!fs.existsSync(f)) continue;
  const l = parseLnd(ab(f), x, y);
  assert.equal(l.tileX, x); assert.equal(l.tileY, y);
  for (const o of l.objects) { ids.add(o.modelId); assert.ok(o.pos[0] >= x * 512 && o.pos[0] < (x + 1) * 512, 'objeto fora do tile'); }
  objs += l.objects.length; sfx += l.sfx.length; tiles++;
}
assert.ok(tiles > 0 && objs > 0);

const dyo = parseDyo(ab(path.join(W, 'WdMadrigal.dyo')));
assert.ok(dyo.length > 0 && dyo.every((o) => [2, 4, 5].includes(o.type)));

const titles = parseTxtTxt(decodeText(ab(path.join(W, 'wdMadrigal.txt.txt'))));
const rgn = parseRgn(decodeText(ab(path.join(W, 'WdMadrigal.rgn'))), titles);
assert.ok(rgn.respawns.length > 0 && rgn.regions.length > 0);
assert.ok(rgn.regions.some((r) => r.title));
assert.ok(parseCnt(decodeText(ab(path.join(W, 'WdMadrigal.wld.cnt')))).length > 0);

const mdl = parseModelTable(decodeText(ab(path.join(RES, 'mdlObj.inc'))), 0, new Map());
const byId = new Map(mdl.map((m) => [m.id, m]));
for (const id of ids) assert.ok(byId.has(id), 'modelId sem entrada em mdlObj.inc: ' + id);
assert.equal(byId.get(21)?.name, 'MaCoPrTr02');
assert.ok(parseTerrain(decodeText(ab(path.join(RES, 'Terrain.inc')))).size > 200) // 1223 no Resource antigo, 260 no novo;

const o3d = parseO3d(ab(data('Model/Obj_MaCoPrTr02.o3d')));
assert.equal(o3d.name, 'Obj_MaCoPrTr02.o3d'); assert.ok(o3d.parts.length >= 1);
const mv = parseO3d(ab(data('Model/Mvr_MaFlJuria.o3d')));
assert.ok(mv.parts[0].skinned && mv.parts[0].positions.length > 0);
// índices de osso são SHORT2 (2×int16 no offset 20): o pulso da mão direita mistura R ForeArm (6) e R Hand (9), não o osso 0
{
  const h = parseO3d(ab(data('Model/part_maleHand.o3d'))).parts[0];
  const pairs = new Set<string>();
  for (let i = 0; i < h.positions.length / 3; i++) if (h.skinWeights![i * 2 + 1] > 0) pairs.add(`${h.skinIndices![i * 2]}/${h.skinIndices![i * 2 + 1]}`);
  assert.deepEqual([...pairs].sort(), ['0/3', '6/9']);
}

// colisão: ponte de Flaris (m_collObj) — chão do tabuleiro acima do rio e grades laterais bloqueando
{
  const file = fs.readdirSync(data('Model')).find((f) => f.toLowerCase() === 'obj_newflbrdg01.o3d')!;
  const bridge = parseO3d(ab(path.join(data('Model'), file)));
  assert.equal(bridge.collision?.indices.length, 168 * 3);
  const cw = new CollisionWorld();
  const obj = { type: 0, modelId: 0, pos: [6960.4, 99.6, 3396.2], rot: [0, 357, 0], scale: [1, 1, 1], motion: 0, ai: 0, ai2: 0, name: '' } as never;
  await cw.setTile('t', [obj], async () => bridge);
  const deck = cw.groundAt(6960.4, 3396, 200);
  assert.ok(deck !== null && Math.abs(deck - 99.66) < 0.1, 'altura do tabuleiro: ' + deck);
  assert.ok(cw.blocked(6960.4, 3396, 6966, 3396, deck!, 0.35, [0.75, 1.5]), 'grade lateral deveria bloquear');
  assert.ok(!cw.blocked(6960.4, 3390, 6960.4, 3400, deck!, 0.35, [0.75, 1.5]), 'ao longo da ponte não bloqueia');
}

// todos os .sfx do cliente devem ser consumidos até o último byte
const sfxDir = data('SFX');
let sfxCount = 0;
// (o cliente novo traz 1 arquivo quebrado — sfx_middlearrow_012.sfx —; tolera até 0,5 % e mostra quais)
const sfxBad: string[] = [];
for (const f of fs.readdirSync(sfxDir).filter((n) => n.toLowerCase().endsWith('.sfx'))) { try { parseSfx(ab(path.join(sfxDir, f))); sfxCount++; } catch { sfxBad.push(f); } }
assert.ok(sfxCount > 0);
if (sfxBad.length) console.log(`sfx que não leem: ${sfxBad.join(', ')}`);
assert.ok(sfxBad.length <= sfxCount * 0.005, `muitos .sfx com erro: ${sfxBad.length}`);
assert.equal(warned, 0);
console.log(`OK: ${tiles} tiles, ${objs} objetos, ${sfx} sfx, ${dyo.length} dyo, ${rgn.respawns.length} respawns, ${rgn.regions.length} regiões`);
