-- "Contas salvas" do login: em vez da senha, o navegador guarda um token de lembrar de longa duração. Aqui fica só o hash
-- (SHA-256) do token; apagar a conta salva, trocar a senha ou passar da validade invalida.
CREATE TABLE remember_tokens (
  id           bigserial PRIMARY KEY,
  account_id   bigint NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  token_hash   text NOT NULL UNIQUE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL
);
CREATE INDEX remember_tokens_account ON remember_tokens (account_id);
