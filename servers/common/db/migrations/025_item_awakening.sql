-- Despertar (Scroll of Awakening / Blessing of the Goddess, randomoption.inc): até 3 opções aleatórias por item, guardadas como
-- uma lista plana [DST, valor, DST, valor, …] (valor negativo = penalidade); '[]' = sem despertar.
ALTER TABLE character_items ADD COLUMN IF NOT EXISTS awakening jsonb NOT NULL DEFAULT '[]';
