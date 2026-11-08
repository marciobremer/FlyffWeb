import { Matrix4, Vector3 } from 'three';
import { SfxBillType, SfxPartType, type SfxPart } from './formats/sfx';
import { GLOW_TAG, isLeftHand, parseLook } from './look';
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
export function attachSetSfx(mgr: SfxManager, fileOf: (id: number) => string, inst: MoverInstance, equip: string[], enabled: () => boolean = () => true,
  hand?: (sym: string) => { file: string; slot: string } | null) {
  const tag = equip.find((s) => s.startsWith(GLOW_TAG));
  const level = tag ? Number(tag.slice(GLOW_TAG.length)) : 0;
  const token = {};
  inst.setSfxToken = token;
  if (hand) attachWeaponSfx(mgr, fileOf, inst, equip, enabled, hand, token);
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
    // ombros e cotovelos (0–5): só os pilares de luz subindo — sem o disco girando no plano do ombro e as manchas grandes de luz,
    // que somavam uma neblina larga no peito (a aura fica fina, em cima dos ombros, como no cliente de referência)
    const slim = link <= 5 && !hand;
    // pilares mais grossos e um pouco mais altos (raio 0,2 → ~0,36; altura 1 → 1,2): a aura fica corpulenta em cima dos ombros
    const sc: [number, number, number] = slim ? [s[0] * SLIM_SCALE[0], s[1] * SLIM_SCALE[1], s[2] * SLIM_SCALE[2]] : s;
    mgr.playAttached(file, sc, () => inst.setSfxToken === token && !!inst.group.parent && enabled(), () => {
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
    }, slim ? SLIM_HIDE : null);
  }
}

/** escala dos pilares de luz dos ombros/cotovelos (largura, altura, profundidade) */
const SLIM_SCALE: [number, number, number] = [1.8, 1.2, 1.8];

/** peças do brilho dos ombros que viram neblina larga: disco no plano do ombro, manchas de luz grandes e o cone alto que some */
const SLIM_HIDE = (p: SfxPart) =>
  p.billType === SfxBillType.Bottom || (p.type === SfxPartType.Particle && (p.particle?.scale[0] ?? 0) >= 1.5) ||
  (p.type === SfxPartType.CustomMesh && Math.max(...p.keys.map((k) => k.scale[1])) >= 3);

/**
 * Brilho da arma (CModelObject::CreateWeaponEffect do original, __NEW_WEAPON_GLOW): dois .sfx presos na arma, que giram com ela —
 * o do enchant (XI_WEA_<TIPO>01 + nível−1) e o do elemento (a mesma base + 5 fogo / 10 água / 15 vento / 20 elétrico / 25 terra +
 * nível−1). Nível do enchant: +3 → 1, +5 → 2, +7 → 3, +9 → 4, +10 → 5. Nível do elemento: 3 → 1, 6 → 2, 11 → 3, 16 → 4, 20 → 5 (o brilho
 * máximo). Vale para a arma da mão direita, a 2ª da Blade e o escudo (que usa o sfx do ioiô, como no original).
 */
const WEAPON_SFX: [RegExp, number, number][] = [
  [/^II_WEA_SWO_/, 1955, 0.1], [/^II_WEA_SWT_/, 1985, 0], [/^II_WEA_AXE_/, 2015, 0.1], [/^II_WEA_AXT_/, 2045, 0.1], [/^II_WEA_YOY_/, 2075, 0],
  [/^II_WEA_KNU_/, 2105, 0.1], [/^II_WEA_CHEE?_/, 2135, 0], [/^II_WEA_STA_/, 2165, 0], [/^II_WEA_BOW_/, 2225, 0], [/^II_WEA_WAN_/, 2315, 0.1],
  [/^II_ARM_ARM_SHI_/, 2075, 0],
];
/** elemento (1 fogo, 2 água, 3 elétrico, 4 vento, 5 terra) → deslocamento do id do sfx */
const ELEMENT_SFX = [0, 5, 10, 20, 15, 25];
const enchantTier = (u: number) => (u >= 10 ? 5 : u >= 9 ? 4 : u >= 7 ? 3 : u >= 5 ? 2 : u >= 3 ? 1 : 0);
const elementTier = (el: number) => (el >= 20 ? 5 : el >= 16 ? 4 : el >= 11 ? 3 : el >= 6 ? 2 : el >= 3 ? 1 : 0);

function attachWeaponSfx(mgr: SfxManager, fileOf: (id: number) => string, inst: MoverInstance, equip: string[], enabled: () => boolean,
  hand: (sym: string) => { file: string; slot: string } | null, token: object) {
  const alive = () => inst.setSfxToken === token && !!inst.group.parent && enabled();
  const world = new Matrix4(), off = new Matrix4();
  for (const s of equip) {
    const { sym, u, e, el } = parseLook(s);
    const kind = WEAPON_SFX.find(([re]) => re.test(sym));
    const h = kind && hand(sym);
    if (!kind || !h) continue;
    const [, base, shift] = kind;
    const ids: number[] = [];
    if (enchantTier(u)) ids.push(base + enchantTier(u) - 1);
    if (e > 0 && e < ELEMENT_SFX.length && elementTier(el)) ids.push(base + ELEMENT_SFX[e] + elementTier(el) - 1);
    if (!ids.length) continue;
    // o referencial do brilho é o da MÃO (m1 do original = m_mLocalRH/LH/Shield × osso), sem a transformação interna da malha da arma
    const slot = isLeftHand(s) && h.slot === 'rh' ? 'lh' : h.slot, sk = inst.tpl.skeleton;
    const bone = slot === 'rh' ? sk.rHand : slot === 'knuckle' ? sk.rArm : slot === 'shield' ? sk.lArm : sk.lHand;
    const loc = slot === 'rh' ? sk.localRH : slot === 'lh' ? sk.localLH : slot === 'shield' ? sk.localShield : sk.localKnuckle;
    if (bone < 0 || !loc) continue;
    const local = new Matrix4().fromArray(loc); // linha-vetor do D3D → coluna do Three (a transposta)
    for (const id of ids) {
      const sfx = fileOf(id);
      if (!sfx) continue;
      mgr.playAttachedPose(sfx, [1, 1, 1], alive, () => {
        const b = inst.boneMatrix(bone);
        if (!b) return null;
        inst.modelSpace.updateWorldMatrix(true, false);
        return world.multiplyMatrices(inst.modelSpace.matrixWorld, b).multiply(local).multiply(off.makeTranslation(shift, 0, 0));
      });
    }
  }
}
