-- Melhorias do item: enchant (+0 a +10, m_nAbilityOption no FlyFF) e elemento (0 nenhum, 1 fogo, 2 água, 3 elétrico,
-- 4 vento, 5 terra — SAI79::ePropType) com o nível do elemento (+0 a +10, m_nResistAbilityOption).
ALTER TABLE character_items
  ADD COLUMN upgrade       smallint NOT NULL DEFAULT 0 CHECK (upgrade BETWEEN 0 AND 10),
  ADD COLUMN element       smallint NOT NULL DEFAULT 0 CHECK (element BETWEEN 0 AND 5),
  ADD COLUMN element_level smallint NOT NULL DEFAULT 0 CHECK (element_level BETWEEN 0 AND 10);
