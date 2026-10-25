import { Vector3 } from 'three';
import { GLOW_TAG } from './look';
import type { MoverInstance } from './movers';
import type { SfxManager } from './sfxRuntime';

/**
 * Efeito do conjunto +3…+10 como no cliente (CMover::CreateZckManagedSfx): o sfx do nível (XI_GEN_ITEM_SETITEM03…10 =
 * sfx_level03…10) preso em ossos que aumentam com o nível — ombros, braços, cotovelos, corpo, mãos e pés — e, do +8, a
 * bola de luz das mãos (XI_SETIEM_EFFECTHAND): +8/+9 na esquerda, +10 nas duas (um pouco maior que no original).
 * Serve para o mundo (WorldView) e para a prévia do inventário: os dois desenham os efeitos num grupo espelhado em Z.
 *
 * Onde vai cada um: [lugar, descida, escala, mão?]. Lugares (CSfxPartsLinkShoulder::Render): 0/1 ombros (ossos 15/11),
 * 2/3 cotovelos (16/12), 4/5 meio do braço, 6/7 corpo (2/3), 8/9 mão direita/esquerda, 26/29 pés. `mão` = a bola de luz.
 */
type SetSfxSpot = [number, number, number | [number, number, number], boolean?];
const SET_7: SetSfxSpot[] = [[0, 0, 1], [1, 0, 1], [4, 0, 1], [5, 0, 1], [2, 0.1, 1], [3, 0.1, 1], [8, 0.1, 1], [9, 0.1, 1]];
const HAND_SCALE = 1.5;
/** a bola fica no punho: sem a descida do original (0,2 + 0,05 a deixavam abaixo da mão, perto do joelho) */
const HAND_Y = -0.05;
const SET_SFX_LAYOUT: Record<number, SetSfxSpot[]> = {
  3: [[0, 0.1, 1], [1, 0.1, 1]],
  4: [[6, 0, 3]],
  5: [[0, 0.1, 1], [1, 0.1, 1], [4, 0, 1], [5, 0, 1]],
  6: [[0, 0, 1], [1, 0, 1], [4, 0, 1], [5, 0, 1], [2, 0.1, 1], [3, 0.1, 1]],
  7: SET_7,
  8: [...SET_7, [9, HAND_Y, HAND_SCALE, true]],
  9: [...SET_7, [26, 0, 1.5], [29, 0, 1.5], [9, HAND_Y, HAND_SCALE, true]],
  10: [[0, 0, 1], [1, 0, 1], [4, 0, 1], [5, 0, 1], [6, 0, [3, 4.5, 3]], [7, 0, 3], [8, 0.1, 1], [9, 0.1, 1], [2, 0, 1], [3, 0, 1],
    [26, 0, 1], [29, 0, 1], [8, HAND_Y, HAND_SCALE, true], [9, HAND_Y, HAND_SCALE, true]],
};

/**
 * Prende os efeitos do nível do conjunto (`~glow:N` na lista do visual) em `inst`. `fileOf` dá o arquivo .sfx de um id
 * XI_*; `enabled` desliga sem desmontar (camada de efeitos). Chamar de novo (troca de equipamento) desliga os anteriores.
 */
export function attachSetSfx(mgr: SfxManager, fileOf: (id: number) => string, inst: MoverInstance, equip: string[], enabled: () => boolean = () => true) {
  const tag = equip.find((s) => s.startsWith(GLOW_TAG));
  const level = tag ? Number(tag.slice(GLOW_TAG.length)) : 0;
  const token = {};
  inst.setSfxToken = token;
  const layout = SET_SFX_LAYOUT[level];
  if (!layout) return;
  const body = fileOf(1716 + level), hands = fileOf(1735);
  const sk = inst.tpl.skeleton, nb = sk.bones.length;
  const boneOf = (link: number): number[] => {
    const b = ({ 0: [15], 1: [11], 2: [16], 3: [12], 4: [15, 16], 5: [11, 12], 6: [2], 7: [3], 8: [sk.rHand], 9: [sk.lHand] } as Record<number, number[]>)[link] ?? [link];
    return b.every((i) => i >= 0 && i < nb) ? b : [];
  };
  const a = new Vector3(), b = new Vector3();
  for (const [link, offY, scale, hand] of layout) {
    const file = hand ? hands : body, bones = boneOf(link);
    if (!file || !bones.length) continue;
    const s: [number, number, number] = typeof scale === 'number' ? [scale, scale, scale] : [...scale];
    mgr.playAttached(file, s, () => inst.setSfxToken === token && !!inst.group.parent && enabled(), () => {
      const m0 = inst.boneMatrix(bones[0]);
      if (!m0) return null;
      a.setFromMatrixPosition(m0);
      // 4/5: entre o ombro e o cotovelo (60 %)
      const m1 = bones[1] !== undefined ? inst.boneMatrix(bones[1]) : null;
      if (m1) a.lerp(b.setFromMatrixPosition(m1), 0.6);
      // matriz do corpo deste quadro (a do desenho anterior fica para trás correndo ou caindo e a bola sai do punho)
      inst.modelSpace.updateWorldMatrix(true, false);
      a.applyMatrix4(inst.modelSpace.matrixWorld);
      // posição FlyFF (z invertido); o original desce 0,05 + o deslocamento; place() soma 0,2 de volta
      return [a.x, a.y - 0.05 - offY - 0.2, -a.z];
    });
  }
}
