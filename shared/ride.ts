import { Group, Mesh } from 'three';
import { OT } from './formats/types';
import { lookSymbol, RIDE_TAG } from './look';
import type { WorldData } from './data';
import type { ModelLibrary } from './models';
import type { MoverInstance } from './movers';

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

/** movimento de voo: parado no ar, acelerando ou virando, do conjunto do item (o F só tem o parado) */
export function flyMotion(set: string, kind: 'idle' | 'run' | 'left' | 'right') {
  const v = set;
  if (v === 'F') return 'MTI_FSTAND1_F';
  return kind === 'run' ? `MTI_FRUNNING1_${v}` : kind === 'left' ? `MTI_FLTURN1_${v}` : kind === 'right' ? `MTI_FRTURN1_${v}` : `MTI_FSTAND1_${v}`;
}
