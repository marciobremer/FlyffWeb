-- Lista de amigos (Mensageiro, tecla E): a amizade é mútua — aceitar um pedido grava as duas linhas (A→B e B→A), e
-- remover apaga as duas. Personagem apagado leva as linhas junto.
CREATE TABLE friends (
  character_id bigint NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  friend_id    bigint NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (character_id, friend_id),
  CHECK (character_id <> friend_id)
);
CREATE INDEX friends_friend ON friends (friend_id);
