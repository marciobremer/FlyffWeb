-- Buffs ativos do personagem (Buff Pang, skills): sobrevivem a sair do jogo e a reiniciar o servidor.
-- Lista [{ id: skill, lv, left: ms restantes, dst: [[DST, valor], …] }]; o tempo restante fica parado enquanto está offline.
ALTER TABLE characters ADD COLUMN buffs jsonb NOT NULL DEFAULT '[]'::jsonb;
