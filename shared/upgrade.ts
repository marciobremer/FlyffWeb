/**
 * Limites de melhoria por tipo de item (o mesmo cálculo no servidor e no painel de GM), pelo espaço PARTS_* do item:
 * - enchant: joias (colar 19, anéis 20–21, brincos 22–23) vão até +20; armas e armaduras até +10;
 * - piercing: a suit (PARTS_UPPER_BODY 2) abre até 4 espaços para cartas (m_piercing do FlyFF).
 */
export const JEWEL_PARTS = new Set([19, 20, 21, 22, 23]);
export const SUIT_PART = 2;
export const MAX_PIERCING = 4;

/** maior enchant que o item aceita (0 = não é equipamento) */
export const maxUpgrade = (parts: number) => (parts < 0 ? 0 : JEWEL_PARTS.has(parts) ? 20 : 10);
/** quantos espaços de piercing o item pode ter */
export const maxPiercing = (parts: number) => (parts === SUIT_PART ? MAX_PIERCING : 0);
