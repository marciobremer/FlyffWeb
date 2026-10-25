-- Compatibilidade com o site (htdocs): o site foi feito para os bancos do FlyFF no SQL Server (ACCOUNT_DBF, CHARACTER_01_DBF,
-- LOGGING_01_DBF). Aqui o esquema `legacy` mostra as nossas tabelas (accounts/characters) com os nomes e colunas do FlyFF, para o
-- site ler (e gravar o que precisa: criar conta, trocar senha/e-mail, pontos) sem conhecer o PostgreSQL novo.
-- Nomes de tabelas do site sem sublinhado: o adaptador do site resolve `NewsPosts` → `newsposts`.
ALTER TABLE website.download_links RENAME TO downloadlinks;
ALTER TABLE website.news_posts RENAME TO newsposts;
-- o site grava números (1, 2, 3) em vote_logs.success (era bit/tinyint no SQL Server)
ALTER TABLE website.vote_logs ALTER COLUMN success TYPE smallint USING success::int;

ALTER TABLE accounts   ADD COLUMN cash integer NOT NULL DEFAULT 0, ADD COLUMN votepoint integer NOT NULL DEFAULT 0;
ALTER TABLE characters ADD COLUMN online boolean NOT NULL DEFAULT false;

CREATE SCHEMA IF NOT EXISTS legacy;

CREATE VIEW legacy.account_tbl AS
  SELECT username AS account, COALESCE(legacy_password, '') AS password, ''::text AS realname, 'O'::text AS isuse, 'A'::text AS member, cash, votepoint
  FROM public.accounts;

CREATE FUNCTION legacy.account_tbl_write() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.accounts (username, legacy_password, cash, votepoint) VALUES (NEW.account, NEW.password, COALESCE(NEW.cash, 0), COALESCE(NEW.votepoint, 0));
  ELSE
    -- senha nova do site (MD5 com sal) vale no próximo login; apaga o hash scrypt para o login legado assumir
    IF NEW.password IS DISTINCT FROM OLD.password THEN
      UPDATE public.accounts SET legacy_password = NEW.password, password_hash = NULL WHERE username = OLD.account;
    END IF;
    UPDATE public.accounts SET cash = COALESCE(NEW.cash, 0), votepoint = COALESCE(NEW.votepoint, 0) WHERE username = OLD.account;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER account_tbl_ins INSTEAD OF INSERT ON legacy.account_tbl FOR EACH ROW EXECUTE FUNCTION legacy.account_tbl_write();
CREATE TRIGGER account_tbl_upd INSTEAD OF UPDATE ON legacy.account_tbl FOR EACH ROW EXECUTE FUNCTION legacy.account_tbl_write();

CREATE VIEW legacy.account_tbl_detail AS
  SELECT username AS account, email, created_at AS regdate, authority AS m_chloginauthority, 'A000'::text AS gamecode, 'O'::text AS isuse
  FROM public.accounts;

CREATE FUNCTION legacy.account_tbl_detail_write() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.accounts SET email = NEW.email, authority = COALESCE(NULLIF(NEW.m_chloginauthority, ''), authority) WHERE username = NEW.account;
  ELSE
    UPDATE public.accounts SET email = NEW.email WHERE username = OLD.account;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER account_tbl_detail_ins INSTEAD OF INSERT ON legacy.account_tbl_detail FOR EACH ROW EXECUTE FUNCTION legacy.account_tbl_detail_write();
CREATE TRIGGER account_tbl_detail_upd INSTEAD OF UPDATE ON legacy.account_tbl_detail FOR EACH ROW EXECUTE FUNCTION legacy.account_tbl_detail_write();

CREATE VIEW legacy.character_tbl AS
  SELECT lpad(c.id::text, 7, '0') AS m_idplayer, '01'::text AS serverindex, a.username AS account, c.name AS m_szname, c.name AS name,
         c.job AS m_njob, c.level AS m_nlevel, c.level AS m_nmaximumlevel, c.gold AS m_dwgold, c.gold AS m_nmoney,
         0 AS totalplaytime, CASE WHEN c.online THEN 1 ELSE 0 END AS multiserver, c.created_at AS createtime
  FROM public.characters c JOIN public.accounts a ON a.id = c.account_id
  WHERE NOT c.deleted;

-- ainda não existem no nosso jogo: tabelas vazias com as colunas que o site consulta
CREATE TABLE legacy.guild_tbl (m_idguild char(6) PRIMARY KEY, m_szguild varchar(32));
CREATE TABLE legacy.guild_member_tbl (m_idplayer char(7), m_idguild char(6));
CREATE TABLE legacy.mail_tbl (
  nmail bigint, serverindex char(2), idreceiver char(7), idsender char(7), ngold bigint DEFAULT 0, tmcreate integer, sztitle varchar(128),
  sztext varchar(1024), dwitemid integer, nitemnum integer, senddt timestamp DEFAULT now(), senddt_ timestamp
);
CREATE TABLE legacy.tbltradelog (tradeid bigint, tradedt timestamp);
CREATE TABLE legacy.tbltradedetaillog (tradeid bigint, idplayer char(7));
CREATE TABLE legacy.tbltradeitemlog (tradeid bigint, idplayer char(7), itemindex integer, itemcnt integer);
