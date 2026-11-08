-- Experiência de craft do personagem (AegonCrafting.inc: 25 níveis pela experiência acumulada).
ALTER TABLE characters ADD COLUMN IF NOT EXISTS crafting_exp integer NOT NULL DEFAULT 0;
