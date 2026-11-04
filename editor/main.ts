import { EditorCamera } from './flycam';
import { refreshSnap, snapState } from './gizmo';
import {
  BoxGeometry, BufferGeometry, CylinderGeometry, EdgesGeometry, Float32BufferAttribute, Group, InstancedMesh, LineBasicMaterial, LineLoop,
  LineSegments, Matrix4, Mesh, MeshLambertMaterial, Object3D, Quaternion, Raycaster, Vector2, Vector3,
} from 'three';
import { WorldView, type PickInfo, type TileView } from '../shared/world';
import type { WorldData } from '../shared/data';
import type { ColorMode } from '../shared/terrain';
import { OT, MAP_SIZE, type WorldObject } from '../shared/formats/types';
import type { Landscape } from '../shared/formats/lnd';
import { decodeText, type RectXZ } from '../shared/formats/rgn';
import { parseAegonTeleports } from '../shared/formats/teleport';
import { download, exportWorld } from './export';
import { WorldEditor } from './editor';
import { NpcEditor } from './npcs';
import { PropEditor } from './props';
import { PointTool } from './points';
import { Thumbs } from './thumbs';
import { Library, type LibItem } from './library';
import { Placer } from './placer';
import { CollisionView } from './collisionview';
import { TerrainSculpt, type Brush } from './terrain';
import { ARRIVAL_POINT, type EnvironmentEdits, type FilterSettings, type MapPoint, type ScreenFilter, type ShadowSettings, type WorldEdits, diffObjects } from '../shared/worldedits';

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
const props = new PropEditor(view, scene, camera, view.canvas, controls);
const points = new PointTool(view);
if (location.hostname === 'localhost') Object.assign(window, { __view: view, __props: props }); // para depurar no console do navegador
view.inputBlocked = () => editor.enabled || npcs.enabled || props.enabled || terrain.enabled;
/** câmera estilo Unreal (botão direito + WASD, roda, Alt+arrastar, F); a roda no voo troca o nível de velocidade */
const flycam = new EditorCamera(view, () => (props.enabled ? props.focusPoint : npcs.enabled ? npcs.focusPoint : editor.focusPoint));
function updateEditInfo() {
  const s = editor.stats;
  $('editInfo').textContent = `${editor.hasSelection ? 'Objeto selecionado. ' : 'Clique em um objeto estático. '}Alterações: ${s.modified} movidos · ${s.added} novos · ${s.deleted} apagados.`;
}
editor.setOnChange(updateEditInfo);

function setEditMode(on: boolean) {
  if (on && terrain.enabled) setTerrainMode(false);
  if (on && points.enabled) setPointMode(false);
  if (on && npcs.enabled) setNpcMode(false);
  if (on && props.enabled) setPropMode(false);
  editor.setEnabled(on);
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
  if (on && terrain.enabled) setTerrainMode(false);
  if (on && points.enabled) setPointMode(false);
  if (on && editor.enabled) setEditMode(false);
  if (on && props.enabled) setPropMode(false);
  npcs.setEnabled(on);
  $('npcToggle').classList.toggle('on', on);
  $('npcPanel').hidden = !on;
  if (on) {
    $<HTMLInputElement>('playerMode').checked = false; view.playerControl = false;
    $<HTMLInputElement>('showMovers').checked = true; syncSettings(); applyOverlayVisibility(); view.applyLayers();
  }
  updateNpcInfo();
}

// ---------- props 3D (.glb de data/res-extra) ----------
function updatePropInfo() {
  const sel = props.selected;
  const h = sel ? props.heightOf(sel) : null;
  $('propInfo').textContent = `${props.count} prop(s)${props.dirty ? ' — NÃO SALVO' : ' — salvo'}. ` + (sel
    ? `Selecionado: ${sel.userData.prop.file} — x ${sel.userData.prop.pos[0].toFixed(1)}, y ${sel.userData.prop.pos[1].toFixed(1)}, z ${sel.userData.prop.pos[2].toFixed(1)}${h !== null ? ` · altura ${h.toFixed(2)}` : ''}`
    : 'Clique em um prop para selecionar.');
  ($('propSave') as HTMLButtonElement).disabled = !props.dirty;
  const setVal = (id: string, v: string) => { const el = $<HTMLInputElement>(id); if (document.activeElement !== el) el.value = v; };
  if (sel) {
    setVal('propScale', String(Math.round(sel.userData.prop.scale * 1e6) / 1e6));
    setVal('propRot', String(Math.round(sel.userData.prop.rotY * 10) / 10));
    setVal('propHeight', h !== null ? h.toFixed(2) : '');
    $<HTMLInputElement>('propCollide').checked = sel.userData.prop.collide !== false;
  }
}
props.onChange = updatePropInfo;
view.props.onLoaded = (n) => { if (n === props.selected) updatePropInfo(); };

function setPropMode(on: boolean) {
  if (on && terrain.enabled) setTerrainMode(false);
  if (on && points.enabled) setPointMode(false);
  if (on && editor.enabled) setEditMode(false);
  if (on && npcs.enabled) setNpcMode(false);
  props.setEnabled(on);
  $('propToggle').classList.toggle('on', on);
  $('propPanel').hidden = !on;
  if (on) { $<HTMLInputElement>('playerMode').checked = false; view.playerControl = false; }
  updatePropInfo();
}

// ---------- lista de elementos (árvore da esquerda) e o item "na mão" ----------
const thumbs = new Thumbs(view.props);
const library = new Library($('lib'), $<HTMLInputElement>('libSearch'), thumbs);
let propFiles = false;
const byLabel = (a: LibItem, b: LibItem) => a.label.localeCompare(b.label, 'pt', { sensitivity: 'base' }) || a.key.localeCompare(b.key);

/** .glb disponíveis: data/res-extra (raiz) e data/res-extra/L2 */
async function loadPropList() {
  const files: string[] = [];
  for (const dir of ['', 'L2']) {
    try {
      const r = await fetch('/api/list?dir=' + encodeURIComponent(dir));
      if (r.ok) for (const n of (await r.json()) as string[]) if (/\.glb$/i.test(n)) files.push(dir ? `${dir}/${n}` : n);
    } catch { /* sem a pasta */ }
  }
  propFiles = true;
  library.set('prop', files.sort().map((f) => ({ kind: 'prop' as const, key: f, label: (f.split('/').pop() ?? f).replace(/\.glb$/i, '') })));
  if (!files.length) setStatus('Nenhum .glb em data/res-extra (nem em data/res-extra/L2).');
}

/** objetos (mdlObj.inc) e NPCs (character.inc) do mundo aberto */
function loadWorldElements() {
  const d = view.data;
  if (!d) return;
  library.set('object', [...d.objModels.values()].map((e) => ({ kind: 'object' as const, key: String(e.id), label: e.name.replace(/\.o3d$/i, '') })).sort(byLabel));
  library.set('npc', [...d.characters].map(([k, c]) => ({ kind: 'npc' as const, key: k, label: c.name ?? k })).sort(byLabel));
}

const placer = new Placer(view, {
  enter(kind) {
    if (kind === 'prop' && !props.enabled) setPropMode(true);
    else if (kind === 'npc' && !npcs.enabled) setNpcMode(true);
    else if (kind === 'object' && !editor.enabled) setEditMode(true);
    props.deselect(); npcs.deselect(); editor.deselect(); // o gizmo não pode agarrar o clique que coloca
  },
  place(it, x, y, z) {
    if (it.kind === 'prop') { props.add(it.key, x, z, y); props.deselect(); return true; }
    if (it.kind === 'npc') {
      if (!npcs.addCharacter(it.key, x, z, y)) { setStatus('Não consegui criar esse NPC (sem modelo).'); return false; }
      npcs.deselect();
      return true;
    }
    const d = view.data;
    const s = d ? MAP_SIZE * d.wld.mpu : 0;
    const tile = s ? tiles.get(`${Math.floor(x / s)},${Math.floor(z / s)}`) : undefined;
    if (!tile) { setStatus('Esse ponto está fora dos tiles carregados.'); return false; }
    editor.addObject(tile as never, Number(it.key), [x, y, z]);
    return true;
  },
  makeNpc: (key) => npcs.makeNpc(key, 0, 0, 0),
  propScale: () => props.defaultScale,
  onChange: (it) => { library.setActive(it); syncToolbar(); },
  say: (m) => setStatus(m),
});
library.onPick = (it) => placer.start(it);
/** botão "colisões" da barra: wireframe das malhas que bloqueiam o personagem */
const collisions = new CollisionView(view);
/** ferramenta Terreno: pincel de altura */
const terrain = new TerrainSculpt(view);

function updateTerrainInfo() {
  $('terrainInfo').textContent = terrain.touched ? `${terrain.touched} vértices em ${terrain.tiles} tile(s)${terrain.dirty ? ' — NÃO SALVO' : ''}.` : 'Nada alterado ainda.';
}
terrain.onChange = updateTerrainInfo;
if (location.hostname === 'localhost') Object.assign(window, { __terrain: terrain, __collisions: collisions, __saveAll: () => saveAll() }); // depuração

function setTerrainMode(on: boolean) {
  if (on && points.enabled) setPointMode(false);
  if (on && editor.enabled) setEditMode(false);
  if (on && npcs.enabled) setNpcMode(false);
  if (on && props.enabled) setPropMode(false);
  if (on) { placer.stop(); $<HTMLInputElement>('playerMode').checked = false; view.playerControl = false; }
  terrain.setEnabled(on);
  $('terrainToggle').classList.toggle('on', on);
  $('terrainPanel').hidden = !on;
  updateTerrainInfo();
}
if (location.hostname === 'localhost') Object.assign(window, { __placer: placer, __npcs: npcs, __editor3: editor }); // depuração

// ---------- barra de ferramentas (comanda os botões que já existem no painel Detalhes) ----------
type Mode = 'obj' | 'npc' | 'prop' | 'pt' | 'terrain' | null;
const curMode = (): Mode => (editor.enabled ? 'obj' : npcs.enabled ? 'npc' : props.enabled ? 'prop' : terrain.enabled ? 'terrain' : points.enabled ? 'pt' : null);
const ACTION_BTN: Record<string, Partial<Record<string, string>>> = {
  obj: { ground: 'editGround', dup: 'editDup', del: 'editDel', undo: 'editUndo' },
  npc: { ground: 'npcGround', dup: 'npcDup', del: 'npcDel', undo: 'npcUndo' },
  prop: { ground: 'propGround', dup: 'propDup', del: 'propDel', undo: 'propUndo' },
  pt: {},
  terrain: {},
};

/** Salvar da barra: grava NPCs e props numa só gravação (duas seguidas se sobrescreveriam). Objetos do mapa não têm como ir para o jogo ainda. */
/** objetos do mapa: refaz a entrada de cada tile aberto (ou com alterações guardadas) comparando com o original; os demais tiles mantêm o que já estava salvo */
function buildObjectEdits(saved: WorldEdits['objects']): WorldEdits['objects'] {
  const d = view.data;
  if (!d) return saved;
  const out: NonNullable<WorldEdits['objects']> = { ...(saved ?? {}) };
  for (const k of new Set([...view.tiles.keys(), ...d.objectDraft.keys()])) {
    const objs = view.tiles.get(k)?.land.objects ?? d.objectDraft.get(k), base = d.objectBase.get(k);
    if (!objs || !base) continue;
    const e = diffObjects(objs, base);
    if (e) out[k] = e; else delete out[k];
  }
  return Object.keys(out).length ? out : undefined;
}

async function saveAll() {
  const d = view.data;
  if (!d) return;
  const tr = terrain.buildEdits(d.edits.terrain);
  const next: WorldEdits = { ...d.edits, world: d.name, npcs: npcs.buildNpcEdits(), props: props.buildEdits() };
  if (tr) next.terrain = tr; else delete next.terrain;
  const ob = buildObjectEdits(d.edits.objects);
  if (ob) next.objects = ob; else delete next.objects;
  if (JSON.stringify(next).length > 900_000) { const m = 'Salvar: o arquivo ficaria grande demais (limite de 1 MB do servidor). Descarte parte das alterações de terreno.'; setStatus(m); alert(m); return; }
  const ok = await putEdits(next);
  if (!ok) return;
  props.markSaved(); updateNpcInfo(); updatePropInfo();
  // o servidor em uso pode ser anterior ao campo `terrain` e descartá-lo em silêncio: confere que voltou o que mandamos
  const missing = Object.keys(tr ?? {}).some((k) => !view.data?.edits.terrain?.[k]) || Object.keys(ob ?? {}).some((k) => !view.data?.edits.objects?.[k]);
  if (missing) { setStatus('ATENÇÃO: o servidor não gravou o terreno/objetos (versão antiga em execução). Reinicie o servidor pelo painel e salve de novo; as alterações continuam aqui.'); alert('O servidor não gravou o terreno/objetos. Reinicie o servidor pelo painel e salve de novo (as alterações continuam no editor).'); return; }
  terrain.markSaved();
  editor.markSaved();
  d.objectDraft.clear();
  setStatus('Objetos, NPCs, props e terreno salvos em data/world-edits. O jogo já mostra o mapa assim.');
}
const TOOL_ATTR: Record<string, string> = { obj: 'tool', npc: 'npctool', prop: 'proptool' };
let toolbarSig = '';
function syncToolbar() {
  const held = placer.item;
  // o modo do item na mão foi desligado: solta o item (stop() chama syncToolbar de novo)
  if (held && curMode() !== ({ object: 'obj', npc: 'npc', prop: 'prop' } as const)[held.kind]) { placer.stop(); return; }
  const m = curMode();
  const tool = m && TOOL_ATTR[m] ? document.querySelector<HTMLElement>(`button.${TOOL_ATTR[m]}.active`)?.dataset[TOOL_ATTR[m]] ?? '' : '';
  const sig = `${m}|${tool}|${placer.item ? placer.item.kind + placer.item.key : ''}|${collisions.enabled}|${terrain.brush}|${view.data ? view.data.name : ''}`;
  if (sig === toolbarSig) return;
  toolbarSig = sig;
  for (const [id, mm] of [['editToggle', 'obj'], ['npcToggle', 'npc'], ['propToggle', 'prop'], ['terrainToggle', 'terrain'], ['ptToggle', 'pt']] as const) $(id).setAttribute('aria-pressed', String(m === mm));
  document.querySelectorAll<HTMLButtonElement>('#toolbar [data-act]').forEach((b) => {
    const act = b.dataset.act!;
    const has = !!ACTION_BTN[m ?? '']?.[act] || (m === 'terrain' && act === 'undo');
    const gizmo = act === 'translate' || act === 'rotate' || act === 'scale';
    if (act === 'collisions') { b.disabled = false; b.setAttribute('aria-pressed', String(collisions.enabled)); return; }
    b.disabled = gizmo ? !(m === 'obj' || ((m === 'npc' || m === 'prop') && act !== 'scale')) : act === 'add' || act === 'select' ? false : act === 'save' ? !view.data : !has;
    b.setAttribute('aria-pressed', String(act === 'add' ? !!placer.item : act === 'select' ? !placer.item && !!m : gizmo && tool === act));
  });
  $('detailsEmpty').hidden = !!m;
  $('terrainTools').hidden = m !== 'terrain';
  document.querySelectorAll<HTMLElement>('#terrainTools .brush').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.brush === terrain.brush)));
  $('toolHint').textContent = placer.item ? `Na mão: ${placer.item.label} · clique no mapa para colocar · Esc solta` : '';
}
function showTab(name: string) {
  for (const t of ['elements', 'details', 'world']) {
    $(`tab-${t}`).setAttribute('aria-selected', String(t === name));
    $(`pane-${t}`).hidden = t !== name;
  }
}
function bindToolbar() {
  document.querySelectorAll<HTMLButtonElement>('#dock [role=tab]').forEach((t) => t.addEventListener('click', () => showTab(t.id.replace('tab-', ''))));
  document.querySelectorAll<HTMLButtonElement>('#toolbar [data-act]').forEach((b) => b.addEventListener('click', () => {
    const act = b.dataset.act!, m = curMode();
    if (act === 'add') { showTab('elements'); $('libSearch').focus(); return; }
    if (act === 'select') { placer.stop(); return; }
    if (act === 'translate' || act === 'rotate' || act === 'scale') {
      const attr = m ? TOOL_ATTR[m] : null;
      if (attr) document.querySelector<HTMLElement>(`button[data-${attr}="${act}"]`)?.click();
      return;
    }
    if (act === 'collisions') { collisions.set(!collisions.enabled); toolbarSig = ''; syncToolbar(); return; }
    if (act === 'undo' && m === 'terrain') { terrain.undo(); return; }
    if (act === 'save') { void saveAll(); return; }
    const target = m ? ACTION_BTN[m]?.[act] : null;
    if (target) $(target).click();
  }));
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
  // 4) portais de dungeon deste mapa (.rgn: região que leva a outro mundo). O ponto onde se SAI do outro mundo para cá é `saida:<mapa de origem>` (ferramenta Pontos)
  for (const r of d.regions) {
    if (r.teleportWorld <= 0) continue;
    places.push({ group: 'Portais (levam a outro mapa)', name: `Portal → mundo ${r.teleportWorld}`, x: (r.rect.xMin + r.rect.xMax) / 2, y: r.pos[1] || null, z: (r.rect.zMin + r.rect.zMax) / 2, detail: `chega em ${r.teleportPos.map((v) => Math.round(v)).join(', ')}` });
  }
  renderPlaces();
  void addTeleporterPlaces(d);
}

/** destinos da janela Teleporter (tecla V) deste mapa, do AegonTeleporter.inc; para trocar o lugar, salve um ponto com o MESMO nome do destino */
async function addTeleporterPlaces(d: WorldData) {
  try {
    const r = await fetch('/res/AegonTeleporter.inc');
    if (!r.ok) return;
    const want = [`WI_WORLD_${d.name.replace(/^Wd/, '')}`, `WI_DUNGEON_${d.name.replace(/^Du/, '')}`].map((s) => s.toUpperCase());
    const list = parseAegonTeleports(decodeText(await r.arrayBuffer(), 'windows-1252')).filter((t) => want.includes(t.world.toUpperCase()));
    for (const t of list) places.push({ group: 'Teleporter (tecla V)', name: t.name, x: t.pos[0], y: t.pos[1], z: t.pos[2], detail: 'salve um ponto com este nome para mudar' });
    if (list.length) renderPlaces();
  } catch { /* sem o arquivo */ }
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
  if (points.enabled) {
    if (!points.pick(ev)) $('ptInfo').textContent = 'Nada sob o cursor: clique no chão ou num objeto.';
    return;
  }
  if (props.enabled) {
    if (props.dragging || props.hoveringGizmo) return;
    const n = props.pick(ev);
    if (n) props.select(n); else props.deselect();
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
  $('terrainToggle').addEventListener('click', () => setTerrainMode(!terrain.enabled));
  document.querySelectorAll<HTMLButtonElement>('button.brush').forEach((b) => b.addEventListener('click', () => {
    terrain.brush = b.dataset.brush as Brush;
    syncToolbar();
  }));
  terrain.onRadius = (r) => { $<HTMLInputElement>('brushRadius').value = String(r); $('brushRadiusVal').textContent = String(r); };
  for (const [id, key] of [['brushRadius', 'radius'], ['brushStrength', 'strength']] as const) {
    $(id).addEventListener('input', () => { terrain[key] = Number($<HTMLInputElement>(id).value); $(`${id}Val`).textContent = String(terrain[key]); });
  }
  $('terrainRevert').addEventListener('click', () => { terrain.revert(); setStatus('Alterações do terreno descartadas.'); });
  $<HTMLInputElement>('snapToggle').addEventListener('change', (e) => { snapState.on = (e.target as HTMLInputElement).checked; refreshSnap(); });
  document.querySelectorAll<HTMLButtonElement>('button.tool').forEach((b) => b.addEventListener('click', () => {
    editor.setMode(b.dataset.tool as 'translate' | 'rotate' | 'scale');
    document.querySelectorAll('button.tool').forEach((x) => x.classList.toggle('active', x === b));
  }));
  $('editGround').addEventListener('click', () => editor.snapToGround());
  $('editDup').addEventListener('click', () => editor.duplicateSelected());
  $('editDel').addEventListener('click', () => editor.deleteSelected());
  $('editUndo').addEventListener('click', () => editor.undo());
  $('ptToggle').addEventListener('click', () => setPointMode(!points.enabled));
  for (const id of ['ptX', 'ptY', 'ptZ']) $(id).addEventListener('input', () => { if (['ptX', 'ptY', 'ptZ'].every((k) => $<HTMLInputElement>(k).value !== '' && Number.isFinite(ptNum(k)))) points.set([ptNum('ptX'), ptNum('ptY'), ptNum('ptZ')]); });
  const copy = async (text: string, what: string) => { try { await navigator.clipboard.writeText(text); $('ptInfo').textContent = `${what} copiado: ${text}`; } catch { $('ptInfo').textContent = `Copie à mão: ${text}`; } };
  $('ptCopy').addEventListener('click', () => { const p = points.current; if (p) void copy(`${r2(p[0])} ${r2(p[1])} ${r2(p[2])}`, 'x y z'); });
  $('ptCopyTp').addEventListener('click', () => { const p = points.current; if (p) void copy(`//tp ${r2(p[0])} ${r2(p[2])} ${r2(p[1])}`, 'Comando'); });
  $('ptSave').addEventListener('click', () => void savePoint($<HTMLInputElement>('ptName').value));
  $('ptArrival').addEventListener('click', () => void savePoint(ARRIVAL_POINT));
  const chosenPoint = () => savedPoints().find((q) => q.name === $<HTMLSelectElement>('ptList').value);
  $('ptList').addEventListener('change', () => { const q = chosenPoint(); if (q) $<HTMLInputElement>('ptName').value = q.name; });
  $('ptGo').addEventListener('click', () => { const q = chosenPoint(); if (q) view.lookAt(q.pos[0], q.pos[2], 30, q.pos[1], 0.9, 0.5); });
  $('ptLoad').addEventListener('click', () => { const q = chosenPoint(); if (q) points.set([...q.pos]); });
  $('ptDel').addEventListener('click', async () => {
    const q = chosenPoint(), d = view.data;
    if (!q || !d || !confirm(`Apagar o ponto "${q.name}"?`)) return;
    if (await putEdits({ ...d.edits, world: d.name, points: savedPoints().filter((x) => x !== q) })) renderPoints();
  });
  $('propToggle').addEventListener('click', () => setPropMode(!props.enabled));
  document.querySelectorAll<HTMLButtonElement>('button.proptool').forEach((b) => b.addEventListener('click', () => {
    props.setMode(b.dataset.proptool as 'translate' | 'rotate');
    document.querySelectorAll('button.proptool').forEach((x) => x.classList.toggle('active', x === b));
  }));
  $('propGround').addEventListener('click', () => props.snapToGround());
  $('propDup').addEventListener('click', () => props.duplicateSelected());
  $('propDel').addEventListener('click', () => props.deleteSelected());
  $('propUndo').addEventListener('click', () => props.undo());
  $('propHeight').addEventListener('change', () => props.setHeight(Number($<HTMLInputElement>('propHeight').value)));
  $('propScale').addEventListener('change', () => props.setScale(Number($<HTMLInputElement>('propScale').value)));
  $('propCollide').addEventListener('change', () => props.setCollide($<HTMLInputElement>('propCollide').checked));
  $('propRot').addEventListener('change', () => props.setRotY(Number($<HTMLInputElement>('propRot').value)));
  $('propSave').addEventListener('click', async () => {
    const d = view.data;
    if (!d) return;
    const ok = await putEdits({ ...d.edits, world: d.name, props: props.buildEdits() });
    if (ok) { props.markSaved(); setStatus('Props salvos em data/world-edits. O jogo desenha por cima do mapa.'); }
  });
  $('propRevert').addEventListener('click', () => { props.revertToSaved(); setStatus('Props descartados (voltou ao salvo).'); });
  $('npcToggle').addEventListener('click', () => setNpcMode(!npcs.enabled));
  document.querySelectorAll<HTMLButtonElement>('button.npctool').forEach((b) => b.addEventListener('click', () => {
    npcs.setMode(b.dataset.npctool as 'translate' | 'rotate');
    document.querySelectorAll('button.npctool').forEach((x) => x.classList.toggle('active', x === b));
  }));
  $('npcGround').addEventListener('click', () => npcs.snapToGround());
  $('npcDup').addEventListener('click', () => npcs.duplicateSelected());
  $('npcDel').addEventListener('click', () => npcs.deleteSelected());
  $('npcUndo').addEventListener('click', () => npcs.undo());
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
  $('reload').addEventListener('click', () => void openWorld($<HTMLSelectElement>('worldName').value.trim()));
  $('worldName').addEventListener('change', () => void openWorld($<HTMLSelectElement>('worldName').value.trim()));
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


// ---------- pontos de teleporte (ferramenta "Pontos") ----------
const ptNum = (id: string) => Number($<HTMLInputElement>(id).value);
const r2 = (n: number) => Math.round(n * 100) / 100;
const savedPoints = (): MapPoint[] => view.data?.edits.points ?? [];

function renderPoints() {
  const sel = $<HTMLSelectElement>('ptList');
  const keep = sel.value;
  sel.textContent = '';
  for (const p of savedPoints()) {
    const o = document.createElement('option');
    o.value = p.name;
    o.textContent = `${p.name.toLowerCase() === ARRIVAL_POINT ? '⭐ ' : ''}${p.name} — ${p.pos.map(r2).join(', ')}`;
    sel.appendChild(o);
  }
  if ([...sel.options].some((o) => o.value === keep)) sel.value = keep;
  points.showSaved(savedPoints());
}

function updatePointInfo() {
  const p = points.current;
  const setVal = (id: string, v: string) => { const el = $<HTMLInputElement>(id); if (document.activeElement !== el) el.value = v; };
  setVal('ptX', p ? String(r2(p[0])) : ''); setVal('ptY', p ? String(r2(p[1])) : ''); setVal('ptZ', p ? String(r2(p[2])) : '');
  for (const id of ['ptCopy', 'ptCopyTp', 'ptSave', 'ptArrival']) ($(id) as HTMLButtonElement).disabled = !p;
  $('ptInfo').textContent = p ? `Ponto: x ${r2(p[0])}  y ${r2(p[1])}  z ${r2(p[2])}   ·   no jogo: //tp ${r2(p[0])} ${r2(p[2])} ${r2(p[1])}` : 'Nenhum ponto marcado: clique no mapa.';
}
points.onChange = updatePointInfo;

function setPointMode(on: boolean) {
  if (on && terrain.enabled) setTerrainMode(false);
  if (on && editor.enabled) setEditMode(false);
  if (on && npcs.enabled) setNpcMode(false);
  if (on && props.enabled) setPropMode(false);
  points.setEnabled(on);
  $('ptToggle').classList.toggle('on', on);
  $('ptPanel').hidden = !on;
  if (on) { $<HTMLInputElement>('playerMode').checked = false; view.playerControl = false; renderPoints(); }
  updatePointInfo();
}

async function savePoint(name: string) {
  const d = view.data, p = points.current;
  if (!d || !p) return;
  const n = name.trim();
  if (!n) { $('ptInfo').textContent = 'Dê um nome ao ponto.'; return; }
  const next = [...savedPoints().filter((q) => q.name.toLowerCase() !== n.toLowerCase()), { name: n, pos: [r2(p[0]), r2(p[1]), r2(p[2])] as [number, number, number] }];
  if (await putEdits({ ...d.edits, world: d.name, points: next })) { renderPoints(); $('ptInfo').textContent = `Ponto "${n}" salvo em data/world-edits. No jogo: //ponto ${n}`; }
}

// ---------- abrir mundo ----------
view.onWorldLoaded = (d) => {
  if (d.edits.environment) { envToPanel(d.edits.environment); syncSettings(); }
  filterToPanel(view.postfx.settings);
  shadowToPanel(view.shadowQuality);
  terrain.reset(); points.set(null); renderPoints(); buildOverlays(d); buildPlaces(d); npcs.reset(); props.reset(); updatePropInfo(); if (!propFiles) void loadPropList(); loadWorldElements(); envInfo(); updateNpcInfo();
};
/** lista de mapas do menu: os do jogo (Resource) e, num grupo à parte, os extras do projeto (data/res-extra/World, ex.: os do L2) */
async function loadWorldList() {
  const sel = $<HTMLSelectElement>('worldName');
  try {
    const r = await fetch('/gapi/worlds');
    if (!r.ok) return;
    const { main, extra } = (await r.json()) as { main: string[]; extra: string[] };
    const keep = sel.value;
    sel.textContent = '';
    const group = (label: string, names: string[]) => {
      if (!names.length) return;
      const g = document.createElement('optgroup');
      g.label = label;
      for (const n of names) { const o = document.createElement('option'); o.value = o.textContent = n; g.appendChild(o); }
      sel.appendChild(g);
    };
    group('Mapas do jogo', main);
    group('Mapas extras (L2)', extra);
    sel.value = [...main, ...extra].includes(keep) ? keep : (main[0] ?? keep);
  } catch { /* sem a API: fica só o mapa atual */ }
}

async function openWorld(name: string) {
  selBox.visible = false;
  try {
    await view.open(name);
    const d = view.data!;
    const [cx, cz] = [d.wld.camera.pos[0], d.wld.camera.pos[2]];
    const s = MAP_SIZE * d.wld.mpu;
    $<HTMLInputElement>('gotoX').value = String(Math.floor(cx / s));
    $<HTMLInputElement>('gotoY').value = String(Math.floor(cz / s));
    // ao abrir um mapa a câmera começa mais baixa (altura ~210 em vez de ~240) e olhando mais para baixo (~51° em vez de ~39°)
    view.lookAt(cx, cz, 220, 100, 0.95, 0.55);
    // espera o tile central para ajustar a altura da câmera
    await view.loadTile(Math.floor(cx / s), Math.floor(cz / s));
    view.lookAt(cx, cz, 220, 100, 0.95, 0.55);
  } catch (e) {
    setStatus('Erro: ' + (e as Error).message);
  }
}

// atalhos do modo edição
addEventListener('keydown', (e) => {
  const tag0 = (e.target as HTMLElement).tagName;
  if (flycam.looking) return; // botão direito segurado: W A S D Q E são da câmera
  if (terrain.enabled && (e.ctrlKey || e.metaKey) && e.code === 'KeyZ' && tag0 !== 'INPUT') { e.preventDefault(); terrain.undo(); return; }
  const plain = !e.ctrlKey && !e.metaKey && !e.altKey;
  if (props.enabled && tag0 !== 'INPUT' && tag0 !== 'SELECT') {
    const t = plain ? ({ Digit1: 'translate', KeyW: 'translate', Digit2: 'rotate', KeyE: 'rotate' } as const)[e.code as 'Digit1'] : undefined;
    if (t) { props.setMode(t); document.querySelectorAll('button.proptool').forEach((x) => x.classList.toggle('active', (x as HTMLElement).dataset.proptool === t)); }
    else if (e.code === 'Delete' || e.code === 'Backspace') props.deleteSelected();
    else if (e.code === 'KeyG') props.snapToGround();
    else if ((e.ctrlKey || e.metaKey) && e.code === 'KeyD') { e.preventDefault(); props.duplicateSelected(); }
    else if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ') { e.preventDefault(); props.undo(); }
    return;
  }
  if (npcs.enabled && tag0 !== 'INPUT' && tag0 !== 'SELECT') {
    const t = plain ? ({ Digit1: 'translate', KeyW: 'translate', Digit2: 'rotate', KeyE: 'rotate' } as const)[e.code as 'Digit1'] : undefined;
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
  const tool = plain ? ({ Digit1: 'translate', KeyW: 'translate', Digit2: 'rotate', KeyE: 'rotate', Digit3: 'scale', KeyR: 'scale' } as const)[e.code as 'Digit1'] : undefined;
  if (tool) { editor.setMode(tool); document.querySelectorAll('button.tool').forEach((x) => x.classList.toggle('active', (x as HTMLElement).dataset.tool === tool)); }
  else if (e.code === 'Delete' || e.code === 'Backspace') editor.deleteSelected();
  else if (e.code === 'KeyG') editor.snapToGround();
  else if ((e.ctrlKey || e.metaKey) && e.code === 'KeyD') { e.preventDefault(); editor.duplicateSelected(); }
  else if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ') { e.preventDefault(); editor.undo(); }
});

view.onFrame = (dt) => {
  syncToolbar();
  collisions.update();
  terrain.update(dt);
  const [tx, ty] = view.currentTile();
  $('hud').textContent = `tile ${tx},${ty} · alvo x ${controls.target.x.toFixed(0)} z ${(-controls.target.z).toFixed(0)} · câmera ${flycam.level}/8 (${flycam.speed} u/s) · ${view.fps.toFixed(0)} fps`;
};

bindUi();
bindToolbar();
syncToolbar();
view.start();
void openWorld($<HTMLSelectElement>('worldName').value);
void loadWorldList();
(window as unknown as Record<string, unknown>).__editor = { editor, view, spawnPlayer, openWorld };
