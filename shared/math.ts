import { Matrix4 } from 'three';
import type { WorldObject } from './formats/types';

const rad = (d: number) => (d * Math.PI) / 180;

/**
 * Matriz de mundo de um objeto, replicando `CObject::_updateMatrix` (D3DX, vetor-linha):
 *   TM = Scale · RotationYawPitchRoll(-rotY, -rotX, rotZ) · Translation
 * D3DXMatrixRotationYawPitchRoll = Rz(roll)·Rx(pitch)·Ry(yaw). O resultado é transposto para o
 * formato vetor-coluna do Three.js. O espaço continua sendo o do FlyFF (mão esquerda): o Three
 * espelha em Z no grupo raiz (scale.z = -1).
 */
export function objectMatrix(o: Pick<WorldObject, 'rot' | 'pos' | 'scale'>, out = new Matrix4()): Matrix4 {
  const yaw = rad(-o.rot[1]), pitch = rad(-o.rot[0]), roll = rad(o.rot[2]);
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch), cr = Math.cos(roll), sr = Math.sin(roll);
  const S = new Matrix4().makeScale(o.scale[0], o.scale[1], o.scale[2]);
  const Rx = new Matrix4().set(1, 0, 0, 0, 0, cp, sp, 0, 0, -sp, cp, 0, 0, 0, 0, 1);
  const Ry = new Matrix4().set(cy, 0, -sy, 0, 0, 1, 0, 0, sy, 0, cy, 0, 0, 0, 0, 1);
  const Rz = new Matrix4().set(cr, sr, 0, 0, -sr, cr, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1);
  const T = new Matrix4().set(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, o.pos[0], o.pos[1], o.pos[2], 1);
  out.copy(S).multiply(Rz).multiply(Rx).multiply(Ry).multiply(T);
  return out.transpose();
}

/** Converte coordenadas FlyFF (x,y,z) para o espaço do Three fora do grupo raiz espelhado. */
/**
 * Tiques de lógica por segundo do Neuz/WorldServer: FRAME_PER_SEC é 60, mas o passo é `1000 / FRAME_PER_SEC` em inteiros
 * (16 ms, timer.cpp SetFST/IsDrawTiming) — na prática 62,5 tiques/s. Movimento (fSpeed por tique), animação
 * (m_fPerSlerp por tique, CModel::MoveFrame) e efeitos .sfx andam nesse ritmo.
 */
export const TICKS_PER_SEC = 1000 / Math.floor(1000 / 60);

export const toThree = (x: number, y: number, z: number): [number, number, number] => [x, y, -z];

// ---- matrizes D3D (vetor-linha) para efeitos/partículas: combine com .multiply() na ordem do D3DX e use `.transpose()` no fim ----
const c = (a: number) => Math.cos(a), sn = (a: number) => Math.sin(a);
export const rowRotX = (a: number) => new Matrix4().set(1, 0, 0, 0, 0, c(a), sn(a), 0, 0, -sn(a), c(a), 0, 0, 0, 0, 1);
export const rowRotY = (a: number) => new Matrix4().set(c(a), 0, -sn(a), 0, 0, 1, 0, 0, sn(a), 0, c(a), 0, 0, 0, 0, 1);
export const rowRotZ = (a: number) => new Matrix4().set(c(a), sn(a), 0, 0, -sn(a), c(a), 0, 0, 0, 0, 1, 0, 0, 0, 0, 1);
export const rowScale = (x: number, y: number, z: number) => new Matrix4().makeScale(x, y, z);
export const rowTrans = (x: number, y: number, z: number) => new Matrix4().set(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1);
/** D3DXMatrixRotationYawPitchRoll (radianos) = Rz(roll)·Rx(pitch)·Ry(yaw) */
export const rowYPR = (yaw: number, pitch: number, roll: number) => rowRotZ(roll).multiply(rowRotX(pitch)).multiply(rowRotY(yaw));
/** D3DXVec3TransformCoord com matriz linha */
export const transformCoord = (v: [number, number, number], rowM: Matrix4): [number, number, number] => {
  const e = rowM.elements; // column-major: e[col*4+row]; linha-vetor: v' = v·M → x' = v0·M00 + v1·M10 + v2·M20 + M30
  return [
    v[0] * e[0] + v[1] * e[1] + v[2] * e[2] + e[3],
    v[0] * e[4] + v[1] * e[5] + v[2] * e[6] + e[7],
    v[0] * e[8] + v[1] * e[9] + v[2] * e[10] + e[11],
  ];
};
