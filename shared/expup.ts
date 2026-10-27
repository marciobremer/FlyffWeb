/**
 * Bônus % do enchant (+N) nas armas e armaduras, como o servidor oficial realmente aplica.
 *
 * O `expUpitem` do expTable.inc tem 21 linhas (+0…+20) × 6 colunas (arma, capacete, traje, luva, bota, escudo), mas o
 * array do CProject é `m_aExpUpItem[6][11]` (sem __NEW_ITEM_VARUNA) e o LoadExpTable grava `[coluna][linha]` até a linha 20:
 * a linha 11…20 de uma coluna transborda para a coluna seguinte (+0…+9) e sobrescreve o que estava lá. Resultado: capacete
 * +N usa a linha 11+N da coluna da arma, traje/luva/bota/escudo usam a linha 11+N da coluna anterior (o traje +3 dá 28 %,
 * não 6 %). Só o +10 de cada coluna fica certo. Aqui o mesmo efeito, para os números baterem com o oficial.
 */
export function effectiveExpUp(rows: number[][]): number[][] {
  const flat = new Array<number>(6 * 11).fill(0);
  for (let i = 0; i < rows.length && i <= 20; i++) for (let j = 0; j < 6; j++) { const k = j * 11 + i; if (k < flat.length) flat[k] = rows[i][j] ?? 0; }
  return Array.from({ length: 11 }, (_, o) => Array.from({ length: 6 }, (_, j) => (o === 0 ? 0 : flat[j * 11 + o])));
}

/** expUpitem do expTable.inc (para o cliente, que não lê o arquivo): +0…+20 × arma, capacete, traje, luva, bota, escudo */
export const EXPUP_ROWS: number[][] = [
  [0, 0, 0, 0, 0, 0], [2, 2, 2, 2, 2, 2], [4, 4, 4, 4, 4, 4], [6, 6, 6, 6, 6, 6], [8, 8, 8, 8, 8, 8], [10, 10, 10, 10, 10, 10],
  [13, 12, 12, 12, 12, 12], [16, 14, 14, 14, 14, 14], [19, 16, 16, 16, 16, 16], [21, 18, 18, 18, 18, 18], [24, 20, 20, 20, 20, 20],
  [27, 22, 22, 22, 22, 22], [30, 24, 24, 24, 24, 24], [33, 26, 26, 26, 26, 26], [36, 28, 28, 28, 28, 28], [39, 30, 30, 30, 30, 30],
  [42, 32, 32, 32, 32, 32], [45, 34, 34, 34, 34, 34], [48, 36, 36, 36, 36, 36], [51, 38, 38, 38, 38, 38], [54, 40, 40, 40, 40, 40],
];

/**
 * `Setitem` do expTable.inc: bônus das 4 peças de armadura equipadas pelo menor enchant (+1…+10) —
 * [precisão %, bloqueio %, HP máx. %, magia extra, todos os atributos]
 */
export const SETITEM_ROWS: number[][] = [
  [0, 0, 0, 0, 0], [0, 0, 0, 0, 0], [5, 3, 0, 3, 0], [10, 3, 0, 4, 0], [10, 3, 5, 5, 1],
  [20, 6, 5, 6, 1], [20, 6, 5, 7, 1], [30, 10, 10, 8, 2], [30, 10, 10, 9, 2], [45, 15, 20, 10, 3],
];

/** coluna do expUpitem pelo IK3 (GetExpUpItem): arma 0, capacete 1, traje 2, luva 3, bota 4, escudo 5 */
export const EXPUP_COL = { weapon: 0, helmet: 1, suit: 2, gauntlet: 3, boots: 4, shield: 5 } as const;
