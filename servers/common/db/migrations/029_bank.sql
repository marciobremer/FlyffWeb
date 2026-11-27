-- Armazém (banco) de cada personagem, como o m_Bank do FlyFF: 42 espaços e penya guardado.
-- Os itens ficam em character_items com container 2 (0 = bolsa, 1 = equipado, 2 = armazém).
ALTER TABLE character_items DROP CONSTRAINT IF EXISTS character_items_container_check;
ALTER TABLE character_items ADD CONSTRAINT character_items_container_check CHECK (container IN (0, 1, 2));

ALTER TABLE characters ADD COLUMN IF NOT EXISTS bank_gold bigint NOT NULL DEFAULT 0 CHECK (bank_gold >= 0);
