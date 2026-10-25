/**
 * Visual do personagem a partir do que está equipado (o mesmo cálculo no servidor e no cliente):
 * - roupas de cash (PARTS_HAT/CLOTH/GLOVE/BOOTS, 26–29) cobrem a peça normal do mesmo lugar (capacete, roupa, luvas, botas);
 * - "esconder" (as caixinhas do inventário, como m_abHideCoat do original) tira a roupa de cash, o capacete, a capa ou a
 *   máscara do visual sem desequipar — com a roupa de cash escondida, a peça normal volta a aparecer;
 * - o enchant e o elemento seguem no símbolo (`II_X@7.1.5` = +7, elemento 1, nível 5 do elemento) para o brilho das peças:
 *   só quando há algo a mostrar (+3 ou mais, ou elemento); a armadura brilha pelo conjunto (`~glow:N`, setGlowLevel).
 */
export interface LookPiece { s: number; sym: string; u: number; e: number; el: number }

/** peça de cash → peças normais que ela cobre (PARTS_UPPER_BODY também tira o PARTS_LOWER_BODY) */
export const COSTUME_COVERS: Record<number, number[]> = { 26: [6], 27: [2, 3], 28: [4], 29: [5] };
/** espaços que dá para esconder, na ordem dos bits da máscara: capacete, capa, máscara, chapéu/roupa/luvas/botas de cash */
export const HIDEABLE = [6, 8, 12, 26, 27, 28, 29];
export const hideBit = (part: number) => { const i = HIDEABLE.indexOf(part); return i < 0 ? 0 : 1 << i; };
/** enchant a partir do qual a arma brilha */
export const GLOW_FROM = 3;
/** peças do conjunto de armadura: capacete, roupa, luvas, botas */
const ARMOR_SET = [6, 2, 4, 5];
/**
 * Nível do efeito do conjunto (CMover::GetSetItemClient): com as 4 peças equipadas, o MENOR enchant entre elas, até 10;
 * abaixo de +3 não há efeito (0). O efeito em si (sfx_level03…10 presos nos ossos) fica em WorldView.attachSetSfx.
 */
export function setGlowLevel(pieces: LookPiece[]): number {
  const ups = ARMOR_SET.map((s) => pieces.find((p) => p.s === s)?.u ?? -1);
  if (ups.some((u) => u < 0)) return 0;
  const u = Math.min(10, ...ups);
  return u >= 3 ? u : 0;
}
/** marca do efeito do conjunto na lista do visual (`~glow:8` = nível 8); não é item, o modelo ignora */
export const GLOW_TAG = '~glow:';
/** marca do conjunto de movimentos de voo do item montado (`~ride:C` = bike); não é item, o modelo ignora */
export const RIDE_TAG = '~ride:';
/** prefixo da arma da mão esquerda (PARTS_LWEAPON, 2ª arma da Blade): `~lh:II_WEA_SWD_X@7.0.0` — vai na mão esquerda */
export const LEFT_TAG = '~lh:';

/** símbolos para montar o modelo: peças normais primeiro e as de cash por último (a última de cada lugar vence) */
export function lookList(pieces: LookPiece[], hide = 0): string[] {
  const shown = pieces.filter((p) => !(hide & hideBit(p.s)));
  const covered = new Set(shown.flatMap((p) => COSTUME_COVERS[p.s] ?? []));
  // só a arma leva o enchant individual (o brilho da armadura é do conjunto inteiro, abaixo)
  const enc = (p: LookPiece) => (p.s === 9 ? LEFT_TAG : '') + ((p.s === 10 || p.s === 9 || p.s === 11) && (p.u >= GLOW_FROM || p.e > 0) ? `${p.sym}@${p.u}.${p.e}.${p.el}` : p.sym);
  const normal = shown.filter((p) => !COSTUME_COVERS[p.s] && !covered.has(p.s)).map(enc).sort();
  const cash = shown.filter((p) => COSTUME_COVERS[p.s]).map(enc).sort();
  const lv = setGlowLevel(pieces);
  return [...normal, ...cash, ...(lv ? [GLOW_TAG + lv] : [])];
}

/** `II_X@7.1.5` → símbolo e melhorias */
export function parseLook(s: string): { sym: string; u: number; e: number; el: number } {
  if (s.startsWith(LEFT_TAG)) s = s.slice(LEFT_TAG.length);
  const i = s.indexOf('@');
  if (i < 0) return { sym: s, u: 0, e: 0, el: 0 };
  const [u = 0, e = 0, el = 0] = s.slice(i + 1).split('.').map((x) => Number(x) || 0);
  return { sym: s.slice(0, i), u, e, el };
}
export const lookSymbol = (s: string) => { if (s.startsWith(LEFT_TAG)) s = s.slice(LEFT_TAG.length); const i = s.indexOf('@'); return i < 0 ? s : s.slice(0, i); };
/** a peça da lista do visual é a arma da mão esquerda? */
export const isLeftHand = (s: string) => s.startsWith(LEFT_TAG);
