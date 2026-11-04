import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../servers/common/config';
import { cleanEdits, emptyEdits, type PropEdit } from '../shared/worldedits';
import { geoCollisionGlb, geoFile, hasGeo, readGeo } from './l2geo';
import { hasLayers, writeNativeTerrain } from './l2terrain';

/**
 * Cria um mapa do FlyFF a partir de tiles do L2 exportados pelo Cruma (tools/cruma): o terreno e os objetos viram props .glb
 * (shared/props.ts) num mundo próprio, e o servidor passa a ter o mapa (//mapa l2 no chat de GM). Vários tiles ficam lado a lado,
 * nas posições relativas que têm no L2.
 *
 *   npx tsx tools/l2world.ts <tile[,tile…]|all> [NomeDoMundo] [--scale 0.01] [--id 100] [--from <pasta com os tiles>]
 *   npm run l2world -- 22_22 WdL2Giran            um tile
 *   npm run l2world -- 22_22,23_22,22_23 WdL2Giran   três tiles vizinhos
 *   npm run l2world -- all WdL2Giran               todos os tiles exportados em data/l2/objects/terrain
 *
 * Lê `<from>/<tile>/` (<tile>.glb, scene.glb, meta.json, height.f32) e escreve:
 *   data/res-extra/L2/terrain/<tile>/        os .glb e o meta.json (servidos em /res/L2/terrain/<tile>/…)
 *   data/res-extra/World/<Nome>/<Nome>.wld   o mapa (tiles de 512, céu/luz padrão, `noterrain 1` = sem terreno do FlyFF: o chão é o dos props)
 *   data/res-extra/World/<Nome>/l2world.json { id, define, start } — o servidor lê e registra o mapa
 *   data/world-edits/<Nome>.json             os props (terreno: colide; objetos: só visual por enquanto)
 */
const args = process.argv.slice(2);
const flag = (n: string, d: string) => { const i = args.indexOf(n); if (i < 0) return d; const [, v] = args.splice(i, 2); return v ?? d; };
const scale = Number(flag('--scale', '0.01'));
const id = Number(flag('--id', '100'));
const root = flag('--from', path.join(ROOT, 'data', 'l2', 'objects', 'terrain'));
/** ponto de chegada em coordenadas do L2 (x,y,z do Cruma; z = altura): ex. --spawn 80880,148199,-2950. Padrão: o centro do primeiro tile */
const spawnArg = flag('--spawn', '');
/** sobe (em unidades do L2) só o platô achatado sob a cidade, onde o piso das construções fica acima do terreno: ex. --lift 90 para Giran */
const lift = Number(flag('--lift', '0'));
/** pasta do geodata do L2 (`<tile>_conv.dat`, a que o Cruma lê): as alturas e paredes de colisão vêm dele onde o terreno não basta (cidades, pontes, andares) */
const geoDir = flag('--geodata', 'C:/L2/Cruma/Source/GeoData');
const geoTol = Number(flag('--geo-tol', '40'));
const geoWall = Number(flag('--geo-wall', '160'));
const geoWallDiff = Number(flag('--geo-wall-diff', '48'));
/** paredes do geodata (bordas bloqueadas): desligadas por padrão — os muros e casas vêm dos objetos sólidos, e o geodata bloqueia onde não há nada visível */
const geoWalls = args.includes('--geo-walls') ? (args.splice(args.indexOf('--geo-walls'), 1), true) : false;
const spec = args[0] ?? '';
const tileList = spec === 'all'
  ? (fs.existsSync(root) ? fs.readdirSync(root).filter((d) => fs.existsSync(path.join(root, d, 'meta.json'))).sort() : [])
  : spec.split(',').map((s) => s.trim()).filter(Boolean);
const name = args[1] ?? 'WdL2' + (tileList.length === 1 ? tileList[0].replace(/[^A-Za-z0-9]/g, '') : 'Mapa');
if (!tileList.length || tileList.some((t) => !/^[\w-]+$/.test(t)) || !(scale > 0) || !Number.isInteger(id) || id < 10 || !/^[A-Za-z0-9_]{1,40}$/.test(name)) {
  console.error('Uso: npx tsx tools/l2world.ts <tile[,tile…]|all> [NomeDoMundo] [--scale 0.01] [--id 100] [--from <pasta>] [--spawn x,y,z do L2] [--lift uu] [--geodata <pasta>] [--geo-tol 40] [--geo-wall 160]');
  process.exit(1);
}

/**
 * Malha de colisão do chão (.glb só de posições e índices): a grade de alturas COMPLETA do tile (height.f32), sem os buracos do terreno
 * visível — o L2 achata o terreno sob a cidade e cobre com malhas de piso, que aqui não colidem; sem isso a cidade ficaria sem chão.
 * Coordenadas do arquivo = as do <tile>.glb (x, altura, y), 1 vértice a cada `step` células.
 */
function walkGlb(heights: Buffer, gw: number, gh: number, dx: number, dy: number, step: number, plateau: number, lift: number): Buffer {
  const cs: number[] = [], rs: number[] = [];
  for (let c = 0; c < gw - 1; c += step) cs.push(c);
  cs.push(gw - 1);
  for (let r = 0; r < gh - 1; r += step) rs.push(r);
  rs.push(gh - 1);
  const nc = cs.length, nr = rs.length;
  const pb = Buffer.alloc(nc * nr * 12), ib = Buffer.alloc((nc - 1) * (nr - 1) * 6 * 4);
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (let r = 0; r < nr; r++) for (let c = 0; c < nc; c++) {
    const h = heights.readFloatLE((rs[r] * gw + cs[c]) * 4);
    const v = [cs[c] * dx, Math.abs(h - plateau) <= 1 ? h + lift : h, rs[r] * dy]; // o piso da cidade fica `lift` acima do platô achatado do terreno
    v.forEach((x, k) => { pb.writeFloatLE(x, (r * nc + c) * 12 + k * 4); mn[k] = Math.min(mn[k], x); mx[k] = Math.max(mx[k], x); });
  }
  let o = 0;
  for (let r = 0; r < nr - 1; r++) for (let c = 0; c < nc - 1; c++) {
    const a = r * nc + c, b = a + 1, d = a + nc, e = d + 1;
    for (const i of [a, e, b, a, d, e]) { ib.writeUInt32LE(i, o); o += 4; }
  }
  const body = Buffer.concat([pb, ib]);
  const js = JSON.stringify({
    asset: { version: '2.0', generator: 'l2world' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
    accessors: [{ bufferView: 0, componentType: 5126, count: nc * nr, type: 'VEC3', min: mn, max: mx }, { bufferView: 1, componentType: 5125, count: ib.length / 4, type: 'SCALAR' }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: pb.length }, { buffer: 0, byteOffset: pb.length, byteLength: ib.length }], buffers: [{ byteLength: body.length }],
  });
  const jb = Buffer.from(js + ' '.repeat((4 - (js.length % 4)) % 4), 'utf8');
  const head = Buffer.alloc(20), tail = Buffer.alloc(8);
  head.writeUInt32LE(0x46546c67, 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(20 + jb.length + 8 + body.length, 8);
  head.writeUInt32LE(jb.length, 12); head.writeUInt32LE(0x4e4f534a, 16);
  tail.writeUInt32LE(body.length, 0); tail.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([head, jb, tail, body]);
}

/**
 * Colisão dos objetos sólidos: do scene.glb, as instâncias cujas superfícies são TODAS opacas (casas, muros, pedras, cercas…) com a matriz de cada nó
 * aplicada — árvores e mato têm folhas com recorte de alfa e ficam de fora. Mesmas coordenadas do <tile>.glb (x, altura, y), só posições e índices.
 */
function solidGlb(sceneGlb: Buffer, maxTris: number): { glb: Buffer; tris: number; nodes: number } | null {
  const jl = sceneGlb.readUInt32LE(12);
  const json = JSON.parse(sceneGlb.subarray(20, 20 + jl).toString('utf8')) as {
    nodes: { mesh?: number; matrix?: number[] }[]; meshes: { primitives: { attributes: { POSITION: number }; indices?: number; material?: number }[] }[];
    accessors: { bufferView: number; byteOffset?: number; componentType: number; count: number }[]; bufferViews: { byteOffset?: number }[]; materials: { alphaMode?: string; name?: string }[];
  };
  const bin = sceneGlb.subarray(20 + jl + 8);
  const at = (a: { bufferView: number; byteOffset?: number }) => (json.bufferViews[a.bufferView].byteOffset ?? 0) + (a.byteOffset ?? 0);
  const solid = json.meshes.map((m) => m.primitives.every((p) => p.indices !== undefined && (json.materials[p.material ?? 0]?.alphaMode ?? 'OPAQUE') === 'OPAQUE' && json.materials[p.material ?? 0]?.name !== 'water'));
  const pos: number[] = [], idx: number[] = [];
  let nodes = 0;
  for (const nd of json.nodes) {
    if (nd.mesh === undefined || !nd.matrix || !solid[nd.mesh]) continue;
    const m = nd.matrix;
    nodes++;
    const baseOf = new Map<number, number>(); // as primitivas de uma malha dividem os vértices: cada conjunto entra uma vez por instância
    for (const pr of json.meshes[nd.mesh].primitives) {
      const pa = json.accessors[pr.attributes.POSITION], ia = json.accessors[pr.indices!];
      if (idx.length / 3 + ia.count / 3 > maxTris) throw new Error(`os objetos sólidos passam de ${maxTris} triângulos`);
      let base = baseOf.get(pr.attributes.POSITION);
      if (base === undefined) {
        base = pos.length / 3;
        baseOf.set(pr.attributes.POSITION, base);
        for (let i = 0; i < pa.count; i++) {
          const x = bin.readFloatLE(at(pa) + i * 12), y = bin.readFloatLE(at(pa) + i * 12 + 4), z = bin.readFloatLE(at(pa) + i * 12 + 8);
          pos.push(m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]);
        }
      }
      const u16 = ia.componentType === 5123;
      for (let i = 0; i < ia.count; i++) idx.push(base + (u16 ? bin.readUInt16LE(at(ia) + i * 2) : bin.readUInt32LE(at(ia) + i * 4)));
    }
  }
  if (idx.length < 3) return null;
  return { glb: positionsGlb(pos, idx), tris: idx.length / 3, nodes };
}

/** .glb mínimo: uma malha de posições (float3) e índices (uint32) */
function positionsGlb(pos: number[], idx: number[]): Buffer {
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pos.length; i++) { mn[i % 3] = Math.min(mn[i % 3], pos[i]); mx[i % 3] = Math.max(mx[i % 3], pos[i]); }
  const pb = Buffer.alloc(pos.length * 4), ib = Buffer.alloc(idx.length * 4);
  pos.forEach((v, i) => pb.writeFloatLE(v, i * 4));
  idx.forEach((v, i) => ib.writeUInt32LE(v, i * 4));
  const body = Buffer.concat([pb, ib]);
  const js = JSON.stringify({
    asset: { version: '2.0', generator: 'l2world' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
    accessors: [{ bufferView: 0, componentType: 5126, count: pos.length / 3, type: 'VEC3', min: mn, max: mx }, { bufferView: 1, componentType: 5125, count: idx.length, type: 'SCALAR' }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: pb.length }, { buffer: 0, byteOffset: pb.length, byteLength: ib.length }], buffers: [{ byteLength: body.length }],
  });
  const jb = Buffer.from(js + ' '.repeat((4 - (js.length % 4)) % 4), 'utf8');
  const head = Buffer.alloc(20), tail = Buffer.alloc(8);
  head.writeUInt32LE(0x46546c67, 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(20 + jb.length + 8 + body.length, 8);
  head.writeUInt32LE(jb.length, 12); head.writeUInt32LE(0x4e4f534a, 16);
  tail.writeUInt32LE(body.length, 0); tail.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([head, jb, tail, body]);
}

interface Meta { origin: [number, number]; cell: [number, number]; grid: [number, number]; zRange: [number, number] }
const tiles = tileList.map((t) => {
  const dir = path.join(root, t);
  if (!fs.existsSync(path.join(dir, 'meta.json'))) { console.error(`Não achei ${path.join(dir, 'meta.json')} — exporte o terreno do tile ${t} no Cruma primeiro.`); process.exit(1); }
  const meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8')) as Meta;
  const [gw, gh] = meta.grid;
  const W = (gw - 1) * Math.abs(meta.cell[0]), D = (gh - 1) * Math.abs(meta.cell[1]);
  let hc = (meta.zRange[0] + meta.zRange[1]) / 2; // altura no centro (height.f32: float32 LE, gw×gh, x varia mais rápido)
  try { hc = fs.readFileSync(path.join(dir, 'height.f32')).readFloatLE((Math.floor(gh / 2) * gw + Math.floor(gw / 2)) * 4); } catch { /* usa o meio da faixa */ }
  return { t, dir, ox: meta.origin[0], oy: meta.origin[1], W, D, hc, gw, gh, dx: Math.abs(meta.cell[0]), dy: Math.abs(meta.cell[1]) };
});

// retângulo que todos os tiles ocupam no L2 (unidades L2) e o mapa que o comporta
const minX = Math.min(...tiles.map((k) => k.ox)), maxX = Math.max(...tiles.map((k) => k.ox + k.W));
const minY = Math.min(...tiles.map((k) => k.oy)), maxY = Math.max(...tiles.map((k) => k.oy + k.D));
const totalW = (maxX - minX) * scale, totalD = (maxY - minY) * scale;
const TILE = 512; // 128 células × 4 (MPU)
const size = Math.max(2, Math.ceil(Math.max(totalW, totalD) / TILE) + 1);
const cx = (size * TILE) / 2, cz = (size * TILE) / 2, ground = 100;
const left = cx - totalW / 2, top = cz + totalD / 2;
const yOffset = ground - tiles[0].hc * scale; // o centro do primeiro tile fica a 100 de altura; os outros seguem a mesma referência

/** terreno nativo do FlyFF (.lnd, texturas e camadas) quando o Cruma exportou as camadas (layers.json); `--no-native` volta ao terreno em .glb */
const native = !args.includes('--no-native') && hasLayers(tiles);
if (args.includes('--no-native')) args.splice(args.indexOf('--no-native'), 1);

const props: PropEdit[] = [];
for (const k of tiles) {
  const assetDir = path.join(ROOT, 'data', 'res-extra', 'L2', 'terrain', k.t);
  fs.mkdirSync(assetDir, { recursive: true });
  for (const f of [`${k.t}.glb`, 'scene.glb', 'meta.json']) {
    if (fs.existsSync(path.join(k.dir, f))) fs.copyFileSync(path.join(k.dir, f), path.join(assetDir, f));
    else if (f !== 'scene.glb') { console.error(`Falta ${f} em ${k.dir}`); process.exit(1); }
  }
  // no L2 o y cresce para o "norte"; no prop, z FlyFF = pos.z − escala × z_local, então o tile mais ao sul (menor y) fica com z maior
  const pos: [number, number, number] = [left + (k.ox - minX) * scale, yOffset, top - (k.oy - minY) * scale];
  // sem terreno nativo: o terreno visível (.glb) tem buracos sob a cidade, e quem colide é a grade completa de alturas, escondida
  if (!native) props.push({ file: `L2/terrain/${k.t}/${k.t}.glb`, pos, rotY: 0, scale, collide: false });
  if (fs.existsSync(path.join(assetDir, 'scene.glb'))) props.push({ file: `L2/terrain/${k.t}/scene.glb`, pos, rotY: 0, scale, collide: false });
  if (!native) try {
    const hb = fs.readFileSync(path.join(k.dir, 'height.f32'));
    const walk = walkGlb(hb, k.gw, k.gh, k.dx, k.dy, 2, k.hc, lift);
    fs.writeFileSync(path.join(assetDir, 'walk.glb'), walk);
    props.push({ file: `L2/terrain/${k.t}/walk.glb`, pos, rotY: 0, scale, hidden: true });
    console.log(`  ${k.t}: colisão do chão ${(walk.length / 1024).toFixed(0)} KB (grade de alturas sem buracos)`);
  } catch (e) { console.error(`  ${k.t}: sem height.f32 — o terreno não vai colidir (${(e as Error).message})`); }
  if (fs.existsSync(path.join(assetDir, 'scene.glb'))) {
    try {
      const sol = solidGlb(fs.readFileSync(path.join(assetDir, 'scene.glb')), 380000);
      if (sol) {
        fs.writeFileSync(path.join(assetDir, 'solid.glb'), sol.glb);
        props.push({ file: `L2/terrain/${k.t}/solid.glb`, pos, rotY: 0, scale, hidden: true });
        console.log(`  ${k.t}: objetos sólidos ${sol.nodes} instâncias → colisão de ${sol.tris} triângulos, ${(sol.glb.length / 1024 / 1024).toFixed(1)} MB (casas, muros, pedras; árvores e mato não colidem)`);
      }
    } catch (e) { console.error(`  ${k.t}: objetos sólidos não usados (${(e as Error).message})`); }
  }
  if (hasGeo(geoDir, k.t)) {
    try {
      const g = readGeo(fs.readFileSync(geoFile(geoDir, k.t)));
      if (Math.abs((g.region[0] - 20) * 32768 - k.ox) > 1 || Math.abs((g.region[1] - 18) * 32768 - k.oy) > 1) throw new Error(`a região do geodata (${g.region}) não bate com a origem do tile`);
      const geo = geoCollisionGlb(g, { heights: fs.readFileSync(path.join(k.dir, 'height.f32')), gw: k.gw, gh: k.gh, dx: k.dx, dy: k.dy }, { tol: geoTol, wall: geoWall, maxTris: 380000, wallDiff: geoWallDiff, walls: geoWalls });
      if (geo) {
        fs.writeFileSync(path.join(assetDir, 'geo.glb'), geo.glb);
        props.push({ file: `L2/terrain/${k.t}/geo.glb`, pos, rotY: 0, scale, hidden: true });
        console.log(`  ${k.t}: geodata ${g.layers} camadas → colisão de ${geo.tris} triângulos (${geo.floors} pisos, ${geo.walls} paredes; geodata ${geo.offset >= 0 ? '+' : ''}${geo.offset} acima do terreno, já descontado), ${(geo.glb.length / 1024 / 1024).toFixed(1)} MB`);
      } else console.log(`  ${k.t}: geodata sem diferença em relação ao terreno`);
    } catch (e) { console.error(`  ${k.t}: geodata não usado (${(e as Error).message})`); }
  } else console.log(`  ${k.t}: sem ${geoFile(geoDir, k.t)} — só a grade de alturas colide`);
}

const worldDir = path.join(ROOT, 'data', 'res-extra', 'World', name);
fs.mkdirSync(worldDir, { recursive: true });
fs.writeFileSync(path.join(worldDir, `${name}.wld`), [
  '// World script — gerado por tools/l2world.ts (terreno e objetos vêm dos props .glb, em data/world-edits)', '',
  `size ${size}, ${size}`, 'indoor 0', 'ambient 0xff808080', 'bgColor 0xffe0e0ff', 'fly 1',
  `camera ${cx.toFixed(3)} 232.620 ${cz.toFixed(3)}  0.620  4.689`, 'revival 1 "flaris"', 'diffuse 0xff000000', 'lightDir  0.000  0.000  0.000',
  'fogSetting 100.000 700.000  0.000', 'bgm 0', 'pkmode 4194304', 'MPU 4', ...(native ? [] : ['noterrain 1']), 'sky default default default', 'cloud default default default',
  'sun default', 'moon default', 'seacloud default', '',
].join('\r\n'));
if (native) {
  for (const f of fs.readdirSync(worldDir)) if (/\.lnd$/i.test(f)) fs.unlinkSync(path.join(worldDir, f)); // tiles de uma geração anterior
  const r = writeNativeTerrain({
    name, worldDir, texDir: path.join(ROOT, 'data', 'res-extra', 'World', 'Texture'), incFile: path.join(ROOT, 'data', 'res-extra', 'terrain-extra.inc'),
    tiles, layout: { scale, left, top, minX, minY, yOffset, size },
  });
  console.log(`  terreno nativo: ${r.tiles} tiles .lnd, ${r.layers} camadas, ${r.textures} texturas${r.water ? ', com água' : ''}`);
} else console.log('  terreno em .glb (sem layers.json: exporte o terreno de novo no Cruma para o terreno nativo)');
const first = tiles[0];
let start: [number, number, number] = [
  Math.round(left + (first.ox - minX + first.W / 2) * scale), ground + 30, Math.round(top - (first.oy - minY + first.D / 2) * scale),
];
if (spawnArg) {
  const [sx, sy, sz] = spawnArg.split(',').map(Number);
  if ([sx, sy, sz].every(Number.isFinite)) start = [Math.round(left + (sx - minX) * scale), Math.round(yOffset + sz * scale), Math.round(top - (sy - minY) * scale)];
}
fs.writeFileSync(path.join(worldDir, 'l2world.json'), JSON.stringify({ id, define: `WI_WORLD_${name.replace(/^Wd/i, '').toUpperCase()}`, start }, null, 1));

const edits = emptyEdits(name);
edits.props = props;
const dst = path.join(ROOT, 'data', 'world-edits', `${name}.json`);
fs.mkdirSync(path.dirname(dst), { recursive: true });
fs.writeFileSync(dst, JSON.stringify(cleanEdits(edits, name), null, 1));

console.log(`Mapa ${name}: ${tiles.length} tile(s) (${tiles.map((k) => k.t).join(', ')}), ${size}×${size} tiles do FlyFF, terreno ${Math.round(totalW)}×${Math.round(totalD)} unidades, escala ${scale}.`);
console.log(`  chegada: x ${start[0]}, y ${start[1]}, z ${start[2]}   id ${id}`);
console.log('  reinicie o servidor do jogo e, no chat de GM, use  //mapa l2  (ou o painel do GM → Jogador → Mapas).');
