-- Correio entre personagens (Post Box do FlyFF): uma pilha de item e penya por carta. O item fica aqui (e não em
-- character_items) porque o destinatário quase sempre está fora do jogo; ao receber, a coluna volta a ficar vazia.
CREATE TABLE IF NOT EXISTS character_mail (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  recipient_id bigint NOT NULL REFERENCES characters (id) ON DELETE CASCADE,
  sender_id    bigint REFERENCES characters (id) ON DELETE SET NULL,
  sender_name  text NOT NULL,
  title        text NOT NULL,
  body         text NOT NULL DEFAULT '',
  item         jsonb,
  gold         bigint NOT NULL DEFAULT 0 CHECK (gold >= 0),
  read         boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS character_mail_recipient ON character_mail (recipient_id, id);
