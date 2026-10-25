-- Pontos de atributo livres (m_nRemainGP do FlyFF): ganha a coluna GP do expTable.inc a cada nível (2 por nível) e gasta
-- em STR/STA/DEX/INT na janela de personagem. Personagens existentes: tudo o que já ganharam menos o que já gastaram
-- (atributos acima de 15).
ALTER TABLE characters ADD COLUMN stat_points integer NOT NULL DEFAULT 0 CHECK (stat_points >= 0);
UPDATE characters SET stat_points = GREATEST(0, 2 * (level - 1) - ((str - 15) + (sta - 15) + (dex - 15) + ("int" - 15)));
