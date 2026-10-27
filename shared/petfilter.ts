/**
 * Filtro do pet coletor (Titanium __SYS_PETFILTER, defineFilter.h + CUser::ShouldPickUp). Marcar uma opção = o pet NÃO pega
 * aquilo. Lista branca: pega sempre (se o item puder ser pego). Lista negra: nunca pega. Raridade mínima de arma e de armadura.
 */
export const FILTER = {
  HPFOOD: 1, MPFOOD: 2, FPFOOD: 4, BWEAPON: 8, GWEAPON: 16, BSET: 32, GSET: 64, NECKLACE: 128, EARRING: 256, RING: 512, EGG: 1024,
  SUNSTONE: 2048, MOONSTONE: 4096, QUESTITEM: 8192, ELECARDS: 16384, CARD4P: 32768, CARD7P: 65536, BPIECARD: 131072, APIECARD: 262144,
  MALE: 524288, FEMALE: 1048576, OTHER_WEAP: 2097152, OTHER_ARM: 4194304, ULT_WEAP: 8388608, JEWELS: 16777216, CRAFT_MAT: 33554432,
} as const;

/** o que o jogador escolheu: bits FILTER, raridade mínima (-1 = desligado) de arma e armadura e as listas (ids de item) */
export interface PetFilter { bits: number; wr: number; ar: number; white: number[]; black: number[] }
export const emptyPetFilter = (): PetFilter => ({ bits: 0, wr: -1, ar: -1, white: [], black: [] });

/** confere o que veio do cliente / do banco */
export function cleanPetFilter(v: unknown): PetFilter {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const ids = (a: unknown) => (Array.isArray(a) ? [...new Set(a.map(Number).filter((n) => Number.isInteger(n) && n > 0))].slice(0, 200) : []);
  const r = (n: unknown) => { const x = Math.floor(Number(n)); return x >= 0 && x <= 5 ? x : -1; };
  return { bits: Math.max(0, Math.floor(Number(o.bits)) || 0) >>> 0, wr: r(o.wr), ar: r(o.ar), white: ids(o.white), black: ids(o.black) };
}

/** a janela (aba Filtros), na ordem do original: [título, [rótulo, bit][]] */
export const FILTER_GROUPS: [string, [string, number][]][] = [
  ['Arma', [['Azul (comum)', FILTER.BWEAPON], ['Verde (unique)', FILTER.GWEAPON], ['Ultimate', FILTER.ULT_WEAP], ['Outras classes', FILTER.OTHER_WEAP]]],
  ['Armadura', [['Peças masculinas', FILTER.MALE], ['Peças femininas', FILTER.FEMALE], ['Set azul', FILTER.BSET], ['Set verde', FILTER.GSET], ['Outras classes', FILTER.OTHER_ARM]]],
  ['Diversos', [['Materiais de craft', FILTER.CRAFT_MAT], ['Ovo', FILTER.EGG], ['Sunstone', FILTER.SUNSTONE], ['Moonstone', FILTER.MOONSTONE], ['Itens de quest', FILTER.QUESTITEM], ['Joias', FILTER.JEWELS]]],
  ['Comida', [['Comida de HP', FILTER.HPFOOD], ['Comida de MP', FILTER.MPFOOD], ['Comida de FP', FILTER.FPFOOD]]],
  ['Acessórios', [['Colar', FILTER.NECKLACE], ['Brinco', FILTER.EARRING], ['Anel', FILTER.RING]]],
  ['Cartas', [['Elemento', FILTER.ELECARDS], ['(4%)', FILTER.CARD4P], ['(7%)', FILTER.CARD7P], ['(B)', FILTER.BPIECARD], ['(A)', FILTER.APIECARD]]],
];
/** raridades da arma (WeaponRarity.inc) para "pegar só a partir de" */
export const RARITY_NAMES = ['Common', 'Precious', 'Rare', 'Epic', 'Legendary', 'Mystique'];
