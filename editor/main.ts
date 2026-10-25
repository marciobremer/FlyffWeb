import {
  BoxGeometry, BufferGeometry, CylinderGeometry, EdgesGeometry, Float32BufferAttribute, Group, InstancedMesh, LineBasicMaterial, LineLoop,
  LineSegments, Matrix4, Mesh, MeshLambertMaterial, Object3D, Quaternion, Raycaster, Vector2, Vector3,
} from 'three';
import { WorldView, type PickInfo, type TileView } from '../shared/world';
import type { WorldData } from '../shared/data';
import type { ColorMode } from '../shared/terrain';
import { OT, MAP_SIZE, type WorldObject } from '../shared/formats/types';
import type { Landscape } from '../shared/formats/lnd';
import type { RectXZ } from '../shared/formats/rgn';
import { download, exportWorld } from './export';
import { WorldEditor } from './editor';
import { NpcEditor } from './npcs';
import type { EnvironmentEdits, FilterSettings, ScreenFilter, ShadowSettings, WorldEdits } from '../shared/worldedits';

/** Editor de mapa: painel de camadas/ambiente, marcadores de .dyo/.rgn, inspeção de objetos, modo edição, locais e exportação. */
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const checked = (id: string) => $<HTMLInputElement>(id).checked;
const setStatus = (s: string) => { $('status').textContent = s; };

const view = new WorldView($<HTMLCanvasElement>('view'));
const { scene, camera, controls, root, overlays, tiles, moverGroup, lib } = view;
view.onStatus = setStatus;
view.onEnvironment = (t) => { $('envInfo').textContent = t; };

/** painel → estado do mundo */
function syncSettings() {
  view.layers = {
    terrain: checked('showTerrain'), objs: checked('showObjs'), sfx: checked('showSfx'), water: checked('showWater'), sky: checked('showSky'),
    movers: checked('showMovers'), spawns: checked('showSpawns'), wireframe: checked('wireframe'),
  };
  view.settings = {
    hour: Number($<HTMLInputElement>('hour').value), worldLight: checked('worldLight'), worldFog: checked('worldFog'),
    shadows: checked('shadows'), sunTilt: Number($<HTMLInputElement>('sunTilt').value),
  };
  view.radius = Number($<HTMLInputElement>('radius').value);
  view.playerControl = checked('playerMode');
}
syncSettings();

/** painel "Filtro" ↔ filtro de tela */
function filterFromPanel(): FilterSettings {
  return {
    filter: $<HTMLSelectElement>('filterType').value as ScreenFilter, strength: Number($<HTMLInputElement>('filterStrength').value),
    outline: checked('filterOutline'), saturation: Number($<HTMLInputElement>('filterSaturation').value),
  };
}
function filterLabels(f: FilterSettings) {
  $('filterStrengthVal').textContent = `${Math.round(f.strength * 100)}%`;
  $('filterSaturationVal').textContent = `${Math.round(f.saturation * 100)}%`;
}
function filterToPanel(f: FilterSettings) {
  $<HTMLSelectElement>('filterType').value = f.filter; $<HTMLInputElement>('filterStrength').value = String(f.strength);
  $<HTMLInputElement>('filterOutline').checked = f.outline; $<HTMLInputElement>('filterSaturation').value = String(f.saturation);
  filterLabels(f);
}
function syncFilter() {
  view.postfx.settings = filterFromPanel();
  filterLabels(view.postfx.settings);
}
for (const id of ['filterType', 'filterOutline']) $(id).addEventListener('change', syncFilter);

/** painel "Filtro" → qualidade da sombra do sol */
function shadowFromPanel(): ShadowSettings {
  return { area: Number($<HTMLInputElement>('shadowArea').value), res: Number($<HTMLSelectElement>('shadowRes').value), soft: Number($<HTMLInputElement>('shadowSoft').value) };
}
function shadowToPanel(q: ShadowSettings) {
  $<HTMLInputElement>('shadowArea').value = String(q.area); $<HTMLSelectElement>('shadowRes').value = String(q.res); $<HTMLInputElement>('shadowSoft').value = String(q.soft);
  $('shadowAreaVal').textContent = String(q.area); $('shadowSoftVal').textContent = String(q.soft);
}
function syncShadow() { const q = shadowFromPanel(); view.setShadow(q); shadowToPanel(view.shadowQuality); }
for (const id of ['shadowArea', 'shadowSoft']) $(id).addEventListener('input', syncShadow);
$('shadowRes').addEventListener('change', syncShadow);
for (const id of ['filterStrength', 'filterSaturation']) $(id).addEventListener('input', syncFilter);

// ---------- modo edição de mundo ----------
const editor = new WorldEditor({
  scene, camera, dom: view.canvas, orbit: controls, root, tiles: tiles as never,
  rebuild: (t) => view.rebuildTileObjects(t as TileView),
  sampleHeight: (x, z) => view.sampleHeight(x, z),
  say: (m) => setStatus(m),
});
editor.setMode('translate');
const npcs = new NpcEditor(view, scene, camera, view.canvas, controls);
view.inputBlocked = () => editor.enabled || npcs.enabled;
function updateEditInfo() {
  const s = editor.stats;
  $('editInfo').textContent = `${editor.hasSelection ? 'Objeto selecionado. ' : 'Clique em um objeto estático. '}Alterações: ${s.modified} movidos · ${s.added} novos · ${s.deleted} apagados.`;
}
editor.setOnChange(updateEditInfo);

function setEditMode(on: boolean) {
  if (on && npcs.enabled) setNpcMode(false);
  editor.setEnabled(on);
  $('editToggle').textContent = on ? '✔ Sair do modo edição' : '✏ Entrar no modo edição';
  $('editToggle').classList.toggle('on', on);
  $('editPanel').hidden = !on;
  if (on) { $<HTMLInputElement>('playerMode').checked = false; view.playerControl = false; } // a câmera livre é usada para editar
  updateEditInfo();
}

// ---------- NPCs (mover/adicionar/remover e salvar) ----------
function updateNpcInfo() {
  const s = npcs.stats(), sel = npcs.selected;
  const d = view.data;
  const who = sel ? `${sel.characterKey ? (d?.characters.get(sel.characterKey.toLowerCase())?.name ?? sel.characterKey) : (d?.moverNames.get(sel.modelId) ?? '#' + sel.modelId)}` : null;
  $('npcInfo').textContent = `${who ? `Selecionado: ${who} (x ${sel!.pos[0].toFixed(1)}, z ${sel!.pos[2].toFixed(1)}). ` : 'Clique em um NPC. '}${s.moved} movidos · ${s.added} novos · ${s.removed} removidos${s.dirty ? ' — NÃO SALVO' : ' — salvo'}.`;
  ($('npcSave') as HTMLButtonElement).disabled = !s.dirty;
}
npcs.onChange = updateNpcInfo;
npcs.onListChanged = () => { if (view.data) buildOverlays(view.data); updateNpcInfo(); };

function setNpcMode(on: boolean) {
  if (on && editor.enabled) setEditMode(false);
  npcs.setEnabled(on);
  $('npcToggle').textContent = on ? '✔ Sair da edição de NPCs' : '👤 Editar NPCs';
  $('npcToggle').classList.toggle('on', on);
  $('npcPanel').hidden = !on;
  if (on) {
    $<HTMLInputElement>('playerMode').checked = false; view.playerControl = false;
    $<HTMLInputElement>('showMovers').checked = true; syncSettings(); applyOverlayVisibility(); view.applyLayers();
  }
  updateNpcInfo();
}

/** lista de personagens (character.inc) para adicionar */
function renderNpcList() {
  const d = view.data, sel = $<HTMLSelectElement>('npcList');
  if (!d) return;
  const q = $<HTMLInputElement>('npcFilter').value.trim().toLowerCase();
  sel.textContent = '';
  let n = 0;
  for (const [k, c] of d.characters) {
    const label = `${c.name ?? k} — ${k}`;
    if (q && !label.toLowerCase().includes(q)) continue;
    if (++n > 300) break;
    const o = document.createElement('option');
    o.value = k; o.textContent = label;
    sel.appendChild(o);
  }
}

async function putEdits(next: WorldEdits): Promise<boolean> {
  try {
    const r = await fetch(`/gapi/world-edits?world=${encodeURIComponent(next.world)}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(next) });
    const j = await r.json();
    if (!r.ok) { const m = 'Erro ao salvar: ' + (j.error ?? r.status); setStatus(m); alert(m); return false; }
    if (view.data) view.data.edits = j as WorldEdits;
    npcs.saved = j as WorldEdits;
    return true;
  } catch (e) { const m = 'Erro ao salvar: ' + (e as Error).message; setStatus(m); alert(m); return false; }
}

// ---------- ambiente salvo (padrão do mundo) ----------
function envFromPanel(): EnvironmentEdits {
  return { hour: Number($<HTMLInputElement>('hour').value), worldLight: checked('worldLight'), shadows: checked('shadows'), sunTilt: Number($<HTMLInputElement>('sunTilt').value), worldFog: checked('worldFog'), showSky: checked('showSky'), showWater: checked('showWater'), filter: filterFromPanel(), shadow: shadowFromPanel() };
}
function envToPanel(e: EnvironmentEdits) {
  $<HTMLInputElement>('hour').value = String(e.hour); $<HTMLInputElement>('sunTilt').value = String(e.sunTilt);
  $<HTMLInputElement>('worldLight').checked = e.worldLight; $<HTMLInputElement>('shadows').checked = e.shadows; $<HTMLInputElement>('worldFog').checked = e.worldFog;
  $<HTMLInputElement>('showSky').checked = e.showSky; $<HTMLInputElement>('showWater').checked = e.showWater;
}
function envInfo() { $('envInfo2').textContent = view.data?.edits.environment ? 'Há um ambiente salvo para este mundo (vale no jogo).' : 'Sem ambiente salvo: o jogo usa o padrão do mundo.'; }

// ---------- locais para teleporte ----------
interface Place { group: string; name: string; x: number; y: number | null; z: number; detail?: string }
let places: Place[] = [];
const REVIVAL_NAMES: Record<string, string> = {
  saintmorning: 'Saint Morning', flaris: 'Flaris', darkon: 'Darkon', darkon1: 'Darkon 1', darkon3: 'Darkon 3',
  elliun: 'Elliun', ruendera: 'Ruendera', harmonin: 'Harmonin',
};
const prettyKey = (k: string) => REVIVAL_NAMES[k.toLowerCase()] ?? (k.charAt(0).toUpperCase() + k.slice(1).replace(/([a-z])([A-Z0-9])/g, '$1 $2'));

function buildPlaces(d: WorldData) {
  places = [];
  // 1) pontos de ressurreição (RI_REVIVAL = região tipo 13 com `key`): são as cidades/aldeias do jogo
  const byKey = new Map<string, { sx: number; sy: number; sz: number; n: number }>();
  for (const r of d.regions) {
    if (r.modelId !== 13 || !r.key) continue;
    // vários pontos por cidade: usa o primeiro (a média cairia no meio das montanhas)
    const a = byKey.get(r.key) ?? { sx: r.pos[0], sy: r.pos[1], sz: r.pos[2], n: 0 };
    a.n++;
    byKey.set(r.key, a);
  }
  for (const [k, a] of byKey) places.push({ group: 'Cidades (ressurreição)', name: prettyKey(k), x: a.sx, y: a.sy, z: a.sz, detail: a.n > 1 ? `${a.n} pontos` : undefined });
  // 2) continentes (centro do polígono de .wld.cnt)
  for (const c of d.continents) {
    if (c.vertices.length < 3 || !c.name) continue;
    const x = c.vertices.reduce((s, v) => s + v[0], 0) / c.vertices.length, z = c.vertices.reduce((s, v) => s + v[2], 0) / c.vertices.length;
    places.push({ group: 'Continentes', name: c.name.replace(/([a-zA-Z])(\d)/, '$1 $2').replace(/_/g, ' '), x, y: null, z });
  }
  // 3) regiões com título (RI_TRIGGER/nomes de áreas)
  const seen = new Set<string>();
  for (const r of d.regions) {
    if (!r.title) continue;
    const [l1, l2] = r.title.split('\n');
    const name = l1.trim() + (l2 ? ' — ' + l2.trim() : '');
    if (name.length > 48 || name.endsWith('.') || seen.has(name)) continue; // descrições longas não são nomes de lugar
    seen.add(name);
    places.push({ group: 'Regiões', name, x: (r.rect.xMin + r.rect.xMax) / 2 || r.pos[0], y: r.pos[1], z: (r.rect.zMin + r.rect.zMax) / 2 || r.pos[2] });
  }
  renderPlaces();
}

function renderPlaces() {
  const box = $('places');
  const q = $<HTMLInputElement>('placeFilter').value.trim().toLowerCase();
  box.textContent = '';
  let last = '';
  for (const p of places) {
    if (q && !p.name.toLowerCase().includes(q)) continue;
    if (p.group !== last) { const h = document.createElement('h4'); h.textContent = p.group; box.appendChild(h); last = p.group; }
    const b = document.createElement('button');
    b.textContent = p.name + (p.detail ? ` (${p.detail})` : '');
    b.title = `x ${p.x.toFixed(0)}  z ${p.z.toFixed(0)}`;
    b.addEventListener('click', () => void teleportTo(p));
    box.appendChild(b);
  }
  if (!box.children.length) box.textContent = 'Nenhum local.';
}

/** Teleporta a câmera: carrega o tile de destino e ajusta a altura pelo terreno. */
async function teleportTo(p: Place) {
  const d = view.data;
  if (!d) return;
  const s = MAP_SIZE * d.wld.mpu;
  view.lookAt(p.x, p.z, 120, p.y ?? undefined);
  await view.loadTile(Math.floor(p.x / s), Math.floor(p.z / s));
  view.lookAt(p.x, p.z, 120);
  $('gotoX').setAttribute('value', String(Math.floor(p.x / s)));
  setStatus(`Teleportado: ${p.name}`);
}

// ---------- personagem ----------
async function spawnPlayer(x: number, z: number, y = 100) {
  const info = $('playerInfo');
  info.textContent = 'Carregando personagem…';
  try {
    await view.spawnPlayer(x, z, y, $<HTMLSelectElement>('playerSex').value as 'male' | 'female');
    info.textContent = 'Personagem ativo. Arraste o mouse para girar a câmera.';
  } catch (e) { info.textContent = 'Erro: ' + (e as Error).message; }
}

// ---------- overlays (marcadores do editor) ----------
const markers: Record<string, { mesh: InstancedMesh; objs: WorldObject[] }> = {};
const overlayGroups: Record<string, Object3D> = {};
function clearOverlays() {
  for (const k of Object.keys(markers)) delete markers[k];
  overlays.children.slice().forEach((c) => { overlays.remove(c); });
  for (const k of Object.keys(overlayGroups)) delete overlayGroups[k];
}
function rectLines(rects: { r: RectXZ; y: number }[], color: number): LineSegments {
  const pts: number[] = [];
  for (const { r, y } of rects) {
    const c: [number, number][] = [[r.xMin, r.zMin], [r.xMax, r.zMin], [r.xMax, r.zMax], [r.xMin, r.zMax]];
    for (let i = 0; i < 4; i++) { const a = c[i], b = c[(i + 1) % 4]; pts.push(a[0], y + 1, a[1], b[0], y + 1, b[1]); }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pts, 3));
  return new LineSegments(g, new LineBasicMaterial({ color }));
}
function markerMesh(objs: WorldObject[], color: number, info: PickInfo, h = 5): InstancedMesh {
  const mesh = new InstancedMesh(new CylinderGeometry(1.4, 1.4, h, 8).translate(0, h / 2, 0), new MeshLambertMaterial({ color }), objs.length);
  const m = new Matrix4();
  objs.forEach((o, i) => mesh.setMatrixAt(i, m.makeTranslation(o.pos[0], o.pos[1], o.pos[2])));
  mesh.computeBoundingSphere();
  mesh.userData.pick = info;
  return mesh;
}

function buildOverlays(d: WorldData) {
  clearOverlays();
  const dynaLabel = (t: number, id: number) => {
    const e = d.dynaModels.get(`${t}:${id}`);
    const nm = t === OT.MOVER ? d.moverNames.get(id) : undefined;
    return (nm ? nm + ' — ' : '') + (e ? `${e.name} (#${id})` : `mover #${id}`);
  };

  const movers = new Group();
  const moverObjs = d.movers;
  const mm = markerMesh(moverObjs, 0x35d07f, { objects: moverObjs, label: 'Mover (.dyo)', kind: 'Mover' }, 6);
  mm.userData.pick.labelOf = (o: WorldObject) => `${dynaLabel(OT.MOVER, o.modelId)} ${o.name ?? ''}`.trim();
  movers.add(mm);
  overlays.add(movers); overlayGroups.movers = movers;
  markers.movers = { mesh: mm, objs: moverObjs };

  const spawns = new Group();
  const spawnObjs: WorldObject[] = d.respawns.map((s) => ({ type: s.type, modelId: s.modelId, pos: s.pos, rot: [0, s.angle, 0], scale: [1, 1, 1], motion: 0, ai: 0, ai2: 0, name: `x${s.count} / ${s.time}s` }));
  const sm = markerMesh(spawnObjs, 0xff5a4d, { objects: spawnObjs, label: 'Spawn (.rgn)', kind: 'Spawn' }, 4);
  sm.userData.pick.labelOf = (o: WorldObject) => `${dynaLabel(o.type, o.modelId)} ${o.name ?? ''}`.trim();
  spawns.add(sm, rectLines(d.respawns.map((s) => ({ r: s.rect, y: s.pos[1] })), 0xff8a80));
  overlays.add(spawns); overlayGroups.spawns = spawns;
  markers.spawns = { mesh: sm, objs: spawnObjs };

  const regions = new Group();
  regions.add(rectLines(d.regions.map((r) => ({ r: r.rect, y: r.pos[1] })), 0x4da3ff));
  overlays.add(regions); overlayGroups.regions = regions;

  const conts = new Group();
  for (const c of d.continents) {
    if (c.vertices.length < 2) continue;
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(c.vertices.flatMap((v) => [v[0], 160, v[2]]), 3));
    conts.add(new LineLoop(g, new LineBasicMaterial({ color: c.town ? 0xffe066 : 0xb98cff })));
  }
  overlays.add(conts); overlayGroups.continents = conts;

  const s = MAP_SIZE * d.wld.mpu;
  const pts: number[] = [];
  for (let i = 0; i <= d.wld.width; i++) pts.push(i * s, 5, 0, i * s, 5, d.wld.height * s);
  for (let j = 0; j <= d.wld.height; j++) pts.push(0, 5, j * s, d.wld.width * s, 5, j * s);
  const gg = new BufferGeometry();
  gg.setAttribute('position', new Float32BufferAttribute(pts, 3));
  const grid = new LineSegments(gg, new LineBasicMaterial({ color: 0x222222, transparent: true, opacity: 0.5, depthTest: false }));
  grid.renderOrder = 10;
  overlays.add(grid); overlayGroups.grid = grid;

  // marcador some quando o modelo real do mover está carregado no lugar
  const zero = new Matrix4().makeScale(0, 0, 0), tmp = new Matrix4();
  view.moverMgr.onVisibleChange = (owner, index, has) => {
    const m = markers[owner];
    if (!m) return;
    const o = m.objs[index];
    m.mesh.setMatrixAt(index, has ? zero : tmp.makeTranslation(o.pos[0], o.pos[1], o.pos[2]));
    m.mesh.instanceMatrix.needsUpdate = true;
  };
  applyOverlayVisibility();
}

function applyOverlayVisibility() {
  const v = (k: string, id: string) => { if (overlayGroups[k]) overlayGroups[k].visible = checked(id); };
  v('movers', 'showMovers'); v('spawns', 'showSpawns'); v('regions', 'showRegions'); v('continents', 'showContinents'); v('grid', 'showGrid');
}

// ---------- inspeção (clique fora do modo personagem) e seleção do modo edição ----------
const raycaster = new Raycaster();
const selBox = new LineSegments(new EdgesGeometry(new BoxGeometry(1, 1, 1)), new LineBasicMaterial({ color: 0xffff00, depthTest: false }));
selBox.visible = false; selBox.renderOrder = 20;
root.add(selBox);
const fmt = (a: number[]) => a.map((n) => n.toFixed(1)).join(', ');

function pick(ev: PointerEvent) {
  const ndc = new Vector2((ev.clientX / innerWidth) * 2 - 1, -(ev.clientY / innerHeight) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  const data = view.data;
  if (editor.enabled) {
    if (editor.dragging || editor.hoveringGizmo) return;
    const meshes: Mesh[] = [];
    tiles.forEach((t) => { if (t.objGroup.visible) meshes.push(...t.pickables); });
    const hit = raycaster.intersectObjects(meshes, false).find((h) => h.instanceId !== undefined);
    const found = hit ? editor.findHit(hit.object as InstancedMesh, hit.instanceId!) : null;
    if (found) {
      editor.select(found.tile as unknown as TileView, found.obj);
      const en = data?.objModels.get(found.obj.modelId);
      $('info').textContent = `Editando: ${en ? en.name : '#' + found.obj.modelId} (modelID ${found.obj.modelId})\npos: ${fmt(found.obj.pos)}\nrotY: ${found.obj.rot[1].toFixed(1)}°  escala: ${found.obj.scale[0].toFixed(2)}`;
    } else editor.deselect();
    return;
  }
  if (npcs.enabled) {
    if (npcs.dragging || npcs.hoveringGizmo) return;
    const o = npcs.pick(ev);
    if (o) npcs.select(o); else npcs.deselect();
    return;
  }
  const targets: Mesh[] = [];
  tiles.forEach((t) => { if (t.objGroup.visible) targets.push(...t.pickables); });
  overlays.traverse((o) => { if (o instanceof InstancedMesh && o.visible && o.parent?.visible) targets.push(o); });
  moverGroup.traverse((o) => { if (o instanceof Mesh && o.userData.pick) targets.push(o); });
  const hits = raycaster.intersectObjects(targets, false);
  const info = $('info');
  if (!hits.length) {
    selBox.visible = false;
    const t = raycaster.intersectObjects([...tiles.values()].map((v) => v.terrain), true)[0];
    if (t) { const p = t.point; info.textContent = `Terreno\nx ${p.x.toFixed(1)}  y ${p.y.toFixed(1)}  z ${(-p.z).toFixed(1)}`; } else info.textContent = 'Nada sob o cursor.';
    return;
  }
  const h = hits[0];
  const mesh = h.object as InstancedMesh;
  const pi = mesh.userData.pick as PickInfo & { labelOf?: (o: WorldObject) => string };
  const obj = pi.objects[h.instanceId ?? 0];
  const entry = data?.modelFor(obj.type === OT.SFX ? OT.SFX : obj.type, obj.modelId);
  const realName = obj.type === OT.MOVER ? data?.moverNames.get(obj.modelId) : undefined;
  const lines = [`${pi.kind}: ${realName ? realName + ' — ' : ''}${pi.labelOf ? pi.labelOf(obj) : pi.label}`];
  if (entry) lines.push(`arquivo: ${entry.name}${lib.exists(entry) ? ' ✔ .o3d' : ' (sem .o3d — placeholder)'}`);
  lines.push(`modelID: ${obj.modelId}  tipo: ${obj.type}`, `pos: ${fmt(obj.pos)}`, `rot: ${fmt(obj.rot)}`, `escala: ${obj.scale.map((n) => n.toFixed(2)).join(', ')}`);
  if (pi.tile) lines.push(`tile: ${pi.tile}`);
  info.textContent = lines.join('\n');

  if (h.instanceId === undefined) { selBox.visible = false; return; }
  const bb = mesh.geometry.boundingBox ?? (mesh.geometry.computeBoundingBox(), mesh.geometry.boundingBox)!;
  const im = new Matrix4();
  mesh.getMatrixAt(h.instanceId!, im);
  const size = bb.getSize(new Vector3()), center = bb.getCenter(new Vector3());
  im.multiply(new Matrix4().compose(center, new Quaternion(), size));
  selBox.matrix.copy(im);
  selBox.matrixAutoUpdate = false;
  selBox.visible = true;
}
view.onPick = pick;

// ---------- UI ----------
function bindUi() {
  $('radius').addEventListener('input', () => { $('radiusVal').textContent = $<HTMLInputElement>('radius').value; syncSettings(); view.invalidate(); });
  $('colorMode').addEventListener('change', () => view.setColorMode($<HTMLSelectElement>('colorMode').value as ColorMode));
  for (const id of ['showTerrain', 'showObjs', 'showSfx', 'wireframe', 'showWater', 'showSky']) $(id).addEventListener('change', () => { syncSettings(); view.applyLayers(); });
  for (const id of ['showMovers', 'showSpawns', 'showRegions', 'showContinents', 'showGrid']) $(id).addEventListener('change', () => { syncSettings(); applyOverlayVisibility(); view.applyLayers(); });
  $('playerMode').addEventListener('change', syncSettings);
  $('placeFilter').addEventListener('input', renderPlaces);
  $('editToggle').addEventListener('click', () => setEditMode(!editor.enabled));
  document.querySelectorAll<HTMLButtonElement>('button.tool').forEach((b) => b.addEventListener('click', () => {
    editor.setMode(b.dataset.tool as 'translate' | 'rotate' | 'scale');
    document.querySelectorAll('button.tool').forEach((x) => x.classList.toggle('active', x === b));
  }));
  $('editGround').addEventListener('click', () => editor.snapToGround());
  $('editDup').addEventListener('click', () => editor.duplicateSelected());
  $('editDel').addEventListener('click', () => editor.deleteSelected());
  $('editUndo').addEventListener('click', () => editor.undo());
  $('npcToggle').addEventListener('click', () => setNpcMode(!npcs.enabled));
  document.querySelectorAll<HTMLButtonElement>('button.npctool').forEach((b) => b.addEventListener('click', () => {
    npcs.setMode(b.dataset.npctool as 'translate' | 'rotate');
    document.querySelectorAll('button.npctool').forEach((x) => x.classList.toggle('active', x === b));
  }));
  $('npcGround').addEventListener('click', () => npcs.snapToGround());
  $('npcDup').addEventListener('click', () => npcs.duplicateSelected());
  $('npcDel').addEventListener('click', () => npcs.deleteSelected());
  $('npcUndo').addEventListener('click', () => npcs.undo());
  $('npcFilter').addEventListener('input', renderNpcList);
  $('npcAdd').addEventListener('click', () => {
    const key = $<HTMLSelectElement>('npcList').value;
    if (!key) { setStatus('Escolha um personagem na lista.'); return; }
    // na mira da câmera (centro da tela, no chão)
    if (!npcs.addCharacter(key, controls.target.x, -controls.target.z)) setStatus('Não consegui criar esse NPC (sem modelo).');
  });
  $('npcSave').addEventListener('click', async () => {
    const d = view.data;
    if (!d) return;
    const ok = await putEdits({ ...d.edits, world: d.name, npcs: npcs.buildNpcEdits() });
    if (ok) { setStatus('NPCs salvos. O servidor já usa as novas posições (lojas); quem está jogando vê ao entrar de novo.'); updateNpcInfo(); }
  });
  $('npcRevert').addEventListener('click', () => { npcs.revertToSaved(); setStatus('Alterações de NPC descartadas (voltou ao salvo).'); });
  $('envSave').addEventListener('click', async () => {
    const d = view.data;
    if (!d) return;
    // grava o ambiente do painel com os NPCs que JÁ estão salvos (não leva junto o que ainda não foi salvo)
    if (await putEdits({ ...d.edits, world: d.name, environment: envFromPanel() })) { envInfo(); setStatus('Ambiente salvo como padrão deste mundo.'); }
  });
  $('envClear').addEventListener('click', async () => {
    const d = view.data;
    if (!d) return;
    const { environment: _drop, ...rest } = d.edits;
    if (await putEdits({ ...rest, world: d.name })) { envInfo(); setStatus('Ambiente salvo removido.'); }
  });
  $('editExport').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(editor.exportEdits(view.data?.name ?? ''), null, 1)], { type: 'application/json' });
    download(blob, `${view.data?.name ?? 'world'}_edits.json`);
  });
  $('spawnFlaris').addEventListener('click', () => {
    // ponto fixo escolhido pelo usuário (coordenadas FlyFF, como no HUD "alvo x z"); a altura vem do terreno
    void spawnPlayer(6976, 3327, places.find((q) => q.name === 'Flaris')?.y ?? 100);
  });
  $('spawnHere').addEventListener('click', () => void spawnPlayer(controls.target.x, -controls.target.z, controls.target.y));
  $('playerSex').addEventListener('change', () => { const p = view.player; if (p?.active) void spawnPlayer(p.pos[0], p.pos[2], p.pos[1]); });
  for (const id of ['sunTilt', 'hour']) $(id).addEventListener('input', () => { syncSettings(); view.refreshEnvironment(); });
  $('shadows').addEventListener('change', syncSettings);
  for (const id of ['worldLight', 'worldFog']) $(id).addEventListener('change', () => { syncSettings(); view.refreshEnvironment(true); view.invalidate(); });
  $('goto').addEventListener('click', () => {
    const d = view.data;
    if (!d) return;
    const s = MAP_SIZE * d.wld.mpu;
    view.lookAt(Number($<HTMLInputElement>('gotoX').value) * s + s / 2, Number($<HTMLInputElement>('gotoY').value) * s + s / 2);
  });
  $('reload').addEventListener('click', () => void openWorld($<HTMLInputElement>('worldName').value.trim()));
  $('exportLoaded').addEventListener('click', () => void doExport(false));
  $('exportAll').addEventListener('click', () => void doExport(true));
}

async function doExport(all: boolean) {
  const data = view.data;
  if (!data) return;
  const btns = [$('exportLoaded'), $('exportAll')] as HTMLButtonElement[];
  btns.forEach((b) => (b.disabled = true));
  try {
    let lands: Landscape[] = [];
    if (!all) lands = [...tiles.values()].map((t) => t.land);
    else {
      const list: [number, number][] = [];
      for (let y = 0; y < data.wld.height; y++) for (let x = 0; x < data.wld.width; x++) if (data.hasTile(x, y)) list.push([x, y]);
      let done = 0;
      const queue = list.slice();
      await Promise.all(Array.from({ length: 6 }, async () => {
        for (let t = queue.shift(); t; t = queue.shift()) {
          const l = await data.loadTile(t[0], t[1]);
          if (l) lands.push(l);
          setStatus(`Exportando: lendo tiles ${++done}/${list.length}`);
        }
      }));
      lands.sort((a, b) => a.tileY - b.tileY || a.tileX - b.tileX);
    }
    const blob = await exportWorld(data, lands, setStatus);
    download(blob, `${data.name}${all ? '' : '_parcial'}.zip`);
    setStatus(`Exportado ${lands.length} tiles (${(blob.size / 1048576).toFixed(1)} MB).`);
  } catch (e) {
    setStatus('Falha na exportação: ' + (e as Error).message);
  } finally { btns.forEach((b) => (b.disabled = false)); }
}

// ---------- abrir mundo ----------
view.onWorldLoaded = (d) => {
  if (d.edits.environment) { envToPanel(d.edits.environment); syncSettings(); }
  filterToPanel(view.postfx.settings);
  shadowToPanel(view.shadowQuality);
  buildOverlays(d); buildPlaces(d); npcs.reset(); renderNpcList(); envInfo(); updateNpcInfo();
};
async function openWorld(name: string) {
  selBox.visible = false;
  try {
    await view.open(name);
    const d = view.data!;
    const [cx, cz] = [d.wld.camera.pos[0], d.wld.camera.pos[2]];
    const s = MAP_SIZE * d.wld.mpu;
    $<HTMLInputElement>('gotoX').value = String(Math.floor(cx / s));
    $<HTMLInputElement>('gotoY').value = String(Math.floor(cz / s));
    view.lookAt(cx, cz, 300);
    // espera o tile central para ajustar a altura da câmera
    await view.loadTile(Math.floor(cx / s), Math.floor(cz / s));
    view.lookAt(cx, cz, 300);
  } catch (e) {
    setStatus('Erro: ' + (e as Error).message);
  }
}

// atalhos do modo edição
addEventListener('keydown', (e) => {
  const tag0 = (e.target as HTMLElement).tagName;
  if (npcs.enabled && tag0 !== 'INPUT' && tag0 !== 'SELECT') {
    const t = ({ Digit1: 'translate', Digit2: 'rotate' } as const)[e.code as 'Digit1'];
    if (t) { npcs.setMode(t); document.querySelectorAll('button.npctool').forEach((x) => x.classList.toggle('active', (x as HTMLElement).dataset.npctool === t)); }
    else if (e.code === 'Delete' || e.code === 'Backspace') npcs.deleteSelected();
    else if (e.code === 'KeyG') npcs.snapToGround();
    else if ((e.ctrlKey || e.metaKey) && e.code === 'KeyD') { e.preventDefault(); npcs.duplicateSelected(); }
    else if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ') { e.preventDefault(); npcs.undo(); }
    return;
  }
  if (!editor.enabled) return;
  const tag = (e.target as HTMLElement).tagName;
  if (tag === 'INPUT' || tag === 'SELECT') return;
  const tool = ({ Digit1: 'translate', Digit2: 'rotate', Digit3: 'scale' } as const)[e.code as 'Digit1'];
  if (tool) { editor.setMode(tool); document.querySelectorAll('button.tool').forEach((x) => x.classList.toggle('active', (x as HTMLElement).dataset.tool === tool)); }
  else if (e.code === 'Delete' || e.code === 'Backspace') editor.deleteSelected();
  else if (e.code === 'KeyG') editor.snapToGround();
  else if ((e.ctrlKey || e.metaKey) && e.code === 'KeyD') { e.preventDefault(); editor.duplicateSelected(); }
  else if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ') { e.preventDefault(); editor.undo(); }
});

view.onFrame = () => {
  const [tx, ty] = view.currentTile();
  $('hud').textContent = `tile ${tx},${ty} · alvo x ${controls.target.x.toFixed(0)} z ${(-controls.target.z).toFixed(0)} · ${view.fps.toFixed(0)} fps`;
};

bindUi();
view.start();
void openWorld($<HTMLInputElement>('worldName').value);
(window as unknown as Record<string, unknown>).__editor = { editor, view, spawnPlayer, openWorld };
