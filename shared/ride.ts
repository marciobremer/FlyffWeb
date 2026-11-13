import { Group, Matrix4, Mesh, Quaternion, Vector3 } from 'three';
import { OT } from './formats/types';
import { objectMatrix } from './math';
import { getMotion, loadTemplate, MoverInstance, preloadMotions } from './movers';
import type { Motion } from './formats/chr';
import type { ModelEntry } from './formats/inc';
import { lookSymbol, RIDE_TAG } from './look';
import type { WorldData } from './data';
import type { ModelLibrary } from './models';

/**
 * Voo (PARTS_RIDE): o item de voo equipado fica na lista do visual (II_RID_RID_*). Cada item diz qual conjunto de
 * movimentos usa (dwUseMotion = MTI_FSTAND1_X; o servidor manda como `~ride:X`): A vassoura (sentado de lado), B prancha
 * (em pé), C bike/cavalinho (montado), D asas, F outros. O modelo `Item_<nome>.o3d` fica sob os pés, na origem do corpo.
 */
export interface RideInfo { sym: string; file: string; set: string }

/** o item de voo da lista do visual, ou null */
export function rideOf(data: WorldData, equip: string[]): RideInfo | null {
  const sym = equip.map(lookSymbol).find((s) => /^II_RID_/.test(s));
  if (!sym) return null;
  const id = data.defines.get(sym);
  const e = id === undefined ? undefined : data.dynaModels.get(`${OT.ITEM}:${id}`);
  if (!e) return null;
  // sem a marca (visual antigo): pelo nome do item
  const tag = equip.find((s) => s.startsWith(RIDE_TAG))?.slice(RIDE_TAG.length);
  const set = tag && /^[A-Z]$/.test(tag) ? tag : /_BOR_/.test(sym) ? 'B' : /_WIN_/.test(sym) ? 'D' : /BIKE|WOODHORSE/.test(sym) ? 'C' : 'A';
  return { sym, file: `Item_${e.name}.o3d`, set };
}

/** põe o modelo da prancha/vassoura sob os pés do personagem (some junto com a instância) */
export async function attachRide(inst: MoverInstance, ride: RideInfo | null, lib: ModelLibrary) {
  if (!ride || !lib.hasModelFile(ride.file)) return;
  const m = await lib.getByFile(ride.file);
  if (!m || !inst.group.parent) return;
  const g = new Group();
  g.name = 'ride';
  for (const p of m.parts) if (!p.light) g.add(new Mesh(p.geometry, p.materials));
  inst.modelSpace.add(g);
  // vassoura e bike (IK3_STICK, `_STI_`) sobem até a altura do osso raiz (o quadril sentado) — CMover::Render: mRide =
  // Translation(0, bone0._42, 0) × mundo; a prancha fica nos pés (na origem)
  if (/_STI_/.test(ride.sym)) inst.afterPose = () => { const b = inst.boneMatrix(0); if (b) g.position.y = b.elements[13]; };
}

// ---------- montarias de chão (II_SYS_MOUNT_*, Mount.inc): modelo animado com esqueleto; o jogador senta num osso dele ----------
export interface MountInfo { sym: string; name: string; entry: ModelEntry }

/** a montaria de chão equipada (IK3_MOUNT) na lista do visual, ou null — as de voo (II_RID_*) são `rideOf` */
export function mountOf(data: WorldData, equip: string[]): MountInfo | null {
  const sym = equip.map(lookSymbol).find((s) => /^II_SYS_MOUNT_/.test(s));
  if (!sym) return null;
  const id = data.defines.get(sym);
  const entry = id === undefined ? undefined : data.dynaModels.get(`${OT.ITEM}:${id}`);
  return entry ? { sym, name: entry.name, entry } : null;
}

/** o que o Mount.inc diz de uma montaria: osso onde o jogador senta, rotação, deslocamento e arquivos de movimento (nome do .ani → MTI_*) */
interface MountSpec { bone: number; rot: [number, number, number]; offset: [number, number, number]; anims: { file: string; symbol: string }[] }
let mountInc: Promise<string> | null = null;
const loadMountInc = () => (mountInc ??= fetch('/res/Mount.inc').then((r) => (r.ok ? r.arrayBuffer() : null)).then((b) => (b ? new TextDecoder('windows-1252').decode(b) : '')).catch(() => ''));
async function mountSpec(sym: string): Promise<MountSpec | null> {
  const t = await loadMountInc();
  const m = new RegExp(`^${sym}\\s*$`, 'm').exec(t);
  if (!m) return null;
  const rest = t.slice(m.index + m[0].length);
  const end = rest.search(/^II_SYS_MOUNT_/m);
  const body = end < 0 ? rest : rest.slice(0, end);
  const nums = (name: string): [number, number, number] | null => {
    const r = new RegExp(`${name}\\(\\s*(-?[\\d.]+)f?\\s+(-?[\\d.]+)f?\\s+(-?[\\d.]+)f?`).exec(body);
    return r ? [Number(r[1]), Number(r[2]), Number(r[3])] : null;
  };
  const bone = Number(/SetBindBone\(\s*(\d+)/.exec(body)?.[1] ?? 0);
  const anims = [...body.matchAll(/"(\w+)"\s+(MTI_\w+)/g)].map((a) => ({ file: a[1], symbol: a[2] }));
  return { bone, rot: nums('Rotation') ?? [0, 0, 0], offset: nums('SetOffSet') ?? [0, 0, 0], anims };
}

/** depuração: ?mountrot=mount gira a montaria / ?mountrot=rider gira o jogador pelo Rotation do Mount.inc; o padrão (off) não gira: os modelos de montaria e os do jogador olham para +z */
const MOUNT_ROT = typeof location === 'undefined' ? 'off' : new URLSearchParams(location.search).get('mountrot') ?? 'off';
const mounted = new WeakMap<MoverInstance, string>();

/**
 * Põe o jogador na montaria de chão equipada (ou tira, com null): o modelo dela anda/corre/para conforme o movimento pedido, e o corpo do
 * jogador, na pose sentada (MTI_FSTAND1_F), tem a origem (os pés) no osso `SetBindBone` da montaria + `SetOffSet` do Mount.inc
 * (x lado, y para cima, z para frente; no tigre: 0,40 para baixo e 0,30 para frente do osso da bacia).
 */
export async function attachMount(inst: MoverInstance, mount: MountInfo | null, lib: ModelLibrary) {
  const had = mounted.get(inst);
  if (!mount) {
    if (!had) return;
    mounted.delete(inst);
    inst.rider = null;
    inst.group.getObjectByName('mount')?.removeFromParent();
    inst.modelSpace.position.set(0, inst.tpl.lift ?? 0, 0); inst.modelSpace.quaternion.identity();
    inst.restart(inst.requested);
    return;
  }
  if (had === mount.sym) return;
  mounted.set(inst, mount.sym);
  const spec = await mountSpec(mount.sym);
  const file = `Item_${mount.name}.o3d`;
  if (!spec || !lib.hasModelFile(file)) return;
  const tpl = await loadTemplate({ ...mount.entry, motions: spec.anims }, [file], `Item_${mount.name}`, lib);
  if (!tpl || !inst.group.parent || mounted.get(inst) !== mount.sym) return;
  tpl.lift = 0; // a altura certa (cascos no chão) é medida na pose parada, no primeiro quadro (abaixo)
  // a almofada da pata fica abaixo do osso mais baixo: o quanto, medido na pose de bind (malha × ossos)
  let meshMin = 0, boneMin = 0;
  for (const p of tpl.parts) { p.geometry.computeBoundingBox(); meshMin = Math.min(meshMin, p.geometry.boundingBox!.min.y); }
  for (const b of tpl.bindWorld) boneMin = Math.min(boneMin, b.elements[13]);
  const sole = Math.max(0, boneMin - meshMin);
  await preloadMotions(tpl, ['MTI_STAND', 'MTI_WALK', 'MTI_RUN', 'MTI_JUMP1', 'MTI_JUMP2', 'MTI_JUMP3', 'MTI_JUMP4']);
  if (!inst.group.parent || mounted.get(inst) !== mount.sym) return;
  inst.group.getObjectByName('mount')?.removeFromParent();
  const mi = new MoverInstance(tpl, inst.source, new Matrix4());
  mi.group.name = 'mount';
  // rotação do Mount.inc: na montaria (padrão) ou no jogador; vale a mesma convenção do resto do mundo (objectMatrix)
  const rotM = objectMatrix({ pos: [0, 0, 0], rot: spec.rot, scale: [1, 1, 1] });
  const rotQ = new Quaternion().setFromRotationMatrix(rotM);
  const onMount = MOUNT_ROT === 'mount', onRider = MOUNT_ROT === 'rider';
  if (onMount) mi.group.matrix.copy(rotM);
  inst.group.add(mi.group);
  const bp = new Vector3(), off = new Vector3(...spec.offset);
  let measured = false, seated: Motion | null = null;
  void getMotion(inst.tpl, 'MTI_FSTAND1_F').then((m) => { seated = m; });
  inst.rider = {
    pose: 'MTI_FSTAND1_F',
    poseMotion: () => seated,
    update(dt: number) {
      const req = inst.requested;
      // a montaria faz o que o jogador pediu: correr, andar ou os 4 tempos do pulo (no Mount.inc cada montaria diz qual .ani é cada um)
      const sym = /RUN/.test(req) ? 'MTI_RUN' : /WALK/.test(req) ? 'MTI_WALK' : /^MTI_JUMP[1-4]$/.test(req) ? req : 'MTI_STAND';
      mi.play(sym, !/JUMP/.test(sym));
      mi.update(dt);
      if (!measured) {
        // a animação já posiciona o modelo: o chão é o osso mais baixo da pose parada (não a caixa do modelo em T, que errava ~0,85)
        let low = Infinity;
        for (let i = 0; i < tpl.skeleton.bones.length; i++) { const m = mi.boneMatrix(i); if (m) low = Math.min(low, m.elements[13]); }
        if (Number.isFinite(low)) { tpl.lift = -low + sole; mi.modelSpace.position.y = tpl.lift; measured = true; }
      }
      const bm = mi.boneMatrix(spec.bone);
      if (!bm) return;
      bp.setFromMatrixPosition(bm);
      if (onMount) bp.applyMatrix4(rotM);
      const body = inst.modelSpace;
      if (onRider) body.quaternion.copy(rotQ); else body.quaternion.identity();
      // os pés do jogador ficam no osso da montaria + deslocamento (a pose sentada põe a bacia na altura da sela)
      body.position.set(bp.x + off.x, bp.y + (tpl.lift ?? 0) + off.y, bp.z + off.z);
    },
  };
  inst.restart(inst.requested);
}

/** movimento de voo: parado no ar, acelerando ou virando, do conjunto do item (o F só tem o parado) */
export function flyMotion(set: string, kind: 'idle' | 'run' | 'left' | 'right') {
  const v = set;
  if (v === 'F') return 'MTI_FSTAND1_F';
  return kind === 'run' ? `MTI_FRUNNING1_${v}` : kind === 'left' ? `MTI_FLTURN1_${v}` : kind === 'right' ? `MTI_FRTURN1_${v}` : `MTI_FSTAND1_${v}`;
}
