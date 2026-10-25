-- Itens dos personagens: bolsa (container 0, slots 0..41 por enquanto) e equipados (container 1, slot = PARTS_* do FlyFF).
-- item_id = número do símbolo II_* (defineItem.h); dados do item (nome, ícone, empilhamento) vêm do Spec_Item.txt no servidor.
-- O penya continua em characters.gold.

CREATE TABLE character_items (
  character_id     bigint NOT NULL REFERENCES characters (id) ON DELETE CASCADE,
  container        smallint NOT NULL CHECK (container IN (0, 1)),
  slot             smallint NOT NULL CHECK (slot >= 0),
  item_id          integer NOT NULL,
  count            integer NOT NULL DEFAULT 1 CHECK (count > 0),
  created_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (character_id, container, slot)
);

-- kit inicial (roupa de Vagrant, espada de madeira, poções e penya) já entregue? — dado na primeira entrada no mundo
ALTER TABLE characters ADD COLUMN starter_given boolean NOT NULL DEFAULT false;
