-- Guilds (como no original: o líder de uma party cria a guild e os membros online da party entram junto). Um personagem
-- fica em no máximo uma guild. Cargos: 0 mestre, 1 kingpin, 2 captain, 3 supporter, 4 rookie (GUD_* do cliente).
CREATE TABLE guilds (
  id          bigserial PRIMARY KEY,
  name        varchar(16) NOT NULL,
  master_id   bigint NOT NULL REFERENCES characters(id),
  level       integer NOT NULL DEFAULT 1,
  notice      text NOT NULL DEFAULT '',
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX guilds_name_lower ON guilds (lower(name));

CREATE TABLE guild_members (
  character_id bigint PRIMARY KEY REFERENCES characters(id) ON DELETE CASCADE,
  guild_id     bigint NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  rank         smallint NOT NULL DEFAULT 4,
  joined_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX guild_members_guild ON guild_members (guild_id);

-- o site (ranking e status) lê as tabelas do servidor antigo: agora elas mostram as guilds de verdade
DROP TABLE legacy.guild_member_tbl;
DROP TABLE legacy.guild_tbl;
CREATE VIEW legacy.guild_tbl AS
  SELECT lpad(g.id::text, 6, '0') AS m_idguild, g.name AS m_szguild FROM guilds g;
CREATE VIEW legacy.guild_member_tbl AS
  SELECT lpad(m.character_id::text, 7, '0') AS m_idplayer, lpad(m.guild_id::text, 6, '0') AS m_idguild FROM guild_members m;
