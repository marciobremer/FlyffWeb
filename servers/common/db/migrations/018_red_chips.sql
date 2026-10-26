-- Red Chip (II_CHP_RED, 26460) vira um contador do personagem, como o penya: não ocupa mais espaço na bolsa.
-- Os red chips que já estavam na bolsa entram no contador.
ALTER TABLE characters ADD COLUMN red_chips bigint NOT NULL DEFAULT 0 CHECK (red_chips >= 0);

UPDATE characters c SET red_chips = t.n
  FROM (SELECT character_id, sum(count) AS n FROM character_items WHERE item_id = 26460 GROUP BY character_id) t
 WHERE c.id = t.character_id;

DELETE FROM character_items WHERE item_id = 26460;
