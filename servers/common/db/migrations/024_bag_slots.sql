-- Espaços abertos da bolsa de cada personagem (o painel de GM desbloqueia, até 168 = MAX_INVENTORY do original com __INVENTORY_168).
ALTER TABLE characters ADD COLUMN IF NOT EXISTS bag_slots integer NOT NULL DEFAULT 42 CHECK (bag_slots BETWEEN 42 AND 168);
