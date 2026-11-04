import type { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { MathUtils, Quaternion, type Camera, type PerspectiveCamera, type Vector3 } from 'three';

/**
 * Ajustes do gizmo (mover/girar/escalar) no estilo do Unreal Engine 5, compartilhados pelos três editores (objetos do mundo, props e
 * NPCs): snap de grade ligável, gizmo menor e rotação que acompanha o cursor.
 *
 * O TransformControls do three gira a ~2,2× a velocidade do cursor (ROTATION_SPEED = 20 / distância contra o raio do anel, que
 * também depende da distância e do fov); aqui o ângulo é refeito para o anel acompanhar o ponteiro (1:1 com rotateFeel = 1).
 */
export const GIZMO = {
  size: 0.85,
  /** unidades FlyFF (UE5: 10 cm) */
  snapMove: 1,
  /** UE5 usa 10° */
  snapRotateDeg: 15,
  snapScale: 0.25,
  /** 1 = o anel acompanha o cursor; menor deixa a rotação mais lenta, maior mais rápida */
  rotateFeel: 1,
};

export const snapState = { on: true };
const all: TransformControls[] = [];
const ratioOf = new WeakMap<TransformControls, () => number>();

/** razão entre o ângulo "acompanhando o cursor" e o ângulo que o TransformControls calcula (não depende da distância) */
function cursorRatio(camera: Camera): number {
  const fov = (camera as PerspectiveCamera).fov ?? 50;
  const ring = (0.5 * Math.min(1.9 * Math.tan((fov * Math.PI) / 360), 7) * GIZMO.size) / 4;
  return GIZMO.rotateFeel / (20 * ring);
}

/** chamar logo depois de criar o TransformControls, antes de registrar os ouvintes do editor (eles leem o objeto já corrigido) */
export function tuneGizmo(tc: TransformControls, camera: Camera) {
  tc.setSize(GIZMO.size);
  all.push(tc);
  ratioOf.set(tc, () => cursorRatio(camera));
  refreshSnap();
  const start = new Quaternion(), dq = new Quaternion();
  tc.addEventListener('mouseDown', () => { if (tc.object) start.copy(tc.object.quaternion); });
  tc.addEventListener('objectChange', () => {
    const o = tc.object, t = tc as unknown as { rotationAngle: number; rotationAxis: Vector3; dragging: boolean };
    if (!o || tc.mode !== 'rotate' || !t.dragging) return;
    dq.setFromAxisAngle(t.rotationAxis, t.rotationAngle * ratioOf.get(tc)!());
    o.quaternion.copy(dq).multiply(start).normalize();
  });
}

/** reaplica o snap (ligar/desligar) em todos os gizmos; o passo da rotação é dividido pela razão para sobrar o passo certo depois da correção */
export function refreshSnap() {
  for (const tc of all) {
    const k = ratioOf.get(tc)?.() ?? 1;
    tc.setTranslationSnap(snapState.on ? GIZMO.snapMove : null);
    tc.setRotationSnap(snapState.on ? MathUtils.degToRad(GIZMO.snapRotateDeg) / k : null);
    tc.setScaleSnap(snapState.on ? GIZMO.snapScale : null);
  }
}
