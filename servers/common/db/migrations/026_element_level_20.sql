-- O nivel do elemento vai ate +20 no codigo (inventory.ts: clamp(el, 20); GM //give-item), mas a coluna aceitava so ate 10:
-- gravar um item com elemento acima de +10 violava character_items_element_level_check e o inventario nao salvava mais.
ALTER TABLE character_items DROP CONSTRAINT IF EXISTS character_items_element_level_check;
ALTER TABLE character_items ADD CONSTRAINT character_items_element_level_check CHECK (element_level BETWEEN 0 AND 20);
