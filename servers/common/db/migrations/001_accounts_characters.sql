-- Contas e personagens do jogo web. Colunas de jogo explícitas (o que o cliente/servidor web usa) + `legacy` (jsonb) com a linha
-- original do FlyFF (CHARACTER_TBL/INVENTORY_TBL do SQL Server) para campos ainda não modelados (skills, quests, inventário…).

CREATE TABLE accounts (
  id               bigserial PRIMARY KEY,
  username         varchar(32) NOT NULL,
  -- senha do jogo web (scrypt, gerada no primeiro login/cadastro); NULL enquanto só existir a do FlyFF
  password_hash    text,
  -- hash MD5 (32 hex) importado de ACCOUNT_TBL.password; usado só para validar o primeiro login de contas importadas
  legacy_password  varchar(32),
  -- m_chLoginAuthority do FlyFF: F = jogador comum, Z = administrador (outros níveis de GM entre eles)
  authority        char(1) NOT NULL DEFAULT 'F',
  email            varchar(100),
  blocked_until    timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  last_login_at    timestamptz,
  -- origem da importação (ACCOUNT_TBL.account); NULL para contas criadas no jogo web
  legacy_account   varchar(32) UNIQUE
);
CREATE UNIQUE INDEX accounts_username_lower ON accounts (lower(username));

CREATE TABLE characters (
  id               bigserial PRIMARY KEY,
  account_id       bigint NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  slot             smallint NOT NULL CHECK (slot BETWEEN 0 AND 2),
  name             varchar(32) NOT NULL,
  -- aparência (CMover/character.inc): sexo 0 = masculino, 1 = feminino; malhas de cabelo/cabeça; cor do cabelo ARGB (m_dwHairColor)
  sex              smallint NOT NULL DEFAULT 0 CHECK (sex IN (0, 1)),
  hair_mesh        integer NOT NULL DEFAULT 1,
  hair_color       integer NOT NULL DEFAULT 0,
  head_mesh        integer NOT NULL DEFAULT 1,
  job              integer NOT NULL DEFAULT 0,
  level            integer NOT NULL DEFAULT 1,
  exp              bigint NOT NULL DEFAULT 0,
  gold             bigint NOT NULL DEFAULT 0,
  str              integer NOT NULL DEFAULT 15,
  sta              integer NOT NULL DEFAULT 15,
  dex              integer NOT NULL DEFAULT 15,
  int              integer NOT NULL DEFAULT 15,
  hp               integer NOT NULL DEFAULT 0,
  mp               integer NOT NULL DEFAULT 0,
  fp               integer NOT NULL DEFAULT 0,
  -- posição no mundo (coordenadas FlyFF; dwWorldID 1 = WdMadrigal) e ângulo em graus
  world_id         integer NOT NULL DEFAULT 1,
  pos_x            real NOT NULL DEFAULT 6976,
  pos_y            real NOT NULL DEFAULT 100,
  pos_z            real NOT NULL DEFAULT 3327,
  angle            real NOT NULL DEFAULT 0,
  deleted          boolean NOT NULL DEFAULT false,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  last_online_at   timestamptz,
  -- origem da importação (CHARACTER_TBL.m_idPlayer + serverindex) e linha original
  legacy_id        char(7),
  legacy_server    char(2),
  legacy           jsonb,
  UNIQUE (legacy_server, legacy_id)
);
CREATE UNIQUE INDEX characters_name_lower ON characters (lower(name)) WHERE NOT deleted;
CREATE UNIQUE INDEX characters_account_slot ON characters (account_id, slot) WHERE NOT deleted;
CREATE INDEX characters_account ON characters (account_id);
