/** Todas as coordenadas estão no espaço original do FlyFF (Direct3D, mão esquerda, Y para cima). */
export const MAP_SIZE = 128;
export const PATCHES = 16;
export const HGT_NOWALK = 1000;

/** Tipos de objeto (ordem de g_root[] em Common/Object.cpp). */
export const OT = { OBJ: 0, ANI: 1, CTRL: 2, SFX: 3, ITEM: 4, MOVER: 5, REGION: 6, SHIP: 7, PATH: 8 } as const;

export interface WorldObject {
  type: number;
  modelId: number;
  /** graus: x (pitch), y (yaw), z (roll) */
  rot: [number, number, number];
  pos: [number, number, number];
  scale: [number, number, number];
  motion: number;
  ai: number;
  ai2: number;
  /** só movers */
  name?: string;
  characterKey?: string;
  /** índice original na lista de objetos do .lnd (para o editor identificar o objeto ao exportar alterações) */
  src?: number;
}
