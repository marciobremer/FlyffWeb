-- Joias (anel, brinco, colar) vão até +20 no FlyFF; armas e armaduras continuam até +10 (regra no servidor).
ALTER TABLE character_items DROP CONSTRAINT IF EXISTS character_items_upgrade_check;
ALTER TABLE character_items ADD CONSTRAINT character_items_upgrade_check CHECK (upgrade BETWEEN 0 AND 20);
-- Piercing da suit (m_piercing do FlyFF): um número por espaço aberto (até 4) = o item da carta encaixada, 0 = vazio.
ALTER TABLE character_items ADD COLUMN piercing jsonb NOT NULL DEFAULT '[]'::jsonb;
