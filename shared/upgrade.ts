/**
 * Limites de melhoria por tipo de item (o mesmo cálculo no servidor e no painel de GM), pelo espaço PARTS_* do item:
 * - enchant: joias (colar 19, anéis 20–21, brincos 22–23) vão até +20; armas e armaduras até +10;
 * - piercing: a suit (PARTS_UPPER_BODY 2) abre até 4 espaços para cartas (m_piercing do FlyFF).
 */
export const JEWEL_PARTS = new Set([19, 20, 21, 22, 23]);
export const SUIT_PART = 2;
export const MAX_PIERCING = 4;

/** equipamento de Cash Shop (dwItemKind2 9, 10 e 32: roupas/conjuntos de cash): visual apenas, não aceita upgrade, elemento nem piercing */
export const CASH_KIND2 = [9, 10, 32];
export const isCashEquip = (kind2: number | undefined) => kind2 !== undefined && CASH_KIND2.includes(kind2);

/** maior enchant que o item aceita (0 = não é equipamento nem aceita: cash) */
export const maxUpgrade = (parts: number, kind2?: number) => (parts < 0 || isCashEquip(kind2) ? 0 : JEWEL_PARTS.has(parts) ? 20 : 10);
/** quantos espaços de piercing o item pode ter */
export const maxPiercing = (parts: number, kind2?: number) => (parts === SUIT_PART && !isCashEquip(kind2) ? MAX_PIERCING : 0);
/** aceita elemento (só equipamento que não é de cash) */
export const acceptsElement = (parts: number, kind2?: number) => parts >= 0 && !isCashEquip(kind2);
