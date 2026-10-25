-- Tempo de jogo acumulado (minutos): somado ao sair do mundo; o site usa em ranking ("TotalPlayTime" do FlyFF, em minutos).
ALTER TABLE characters ADD COLUMN play_minutes integer NOT NULL DEFAULT 0;
CREATE OR REPLACE VIEW legacy.character_tbl AS
  SELECT lpad(c.id::text, 7, '0') AS m_idplayer, '01'::text AS serverindex, a.username AS account, c.name AS m_szname, c.name AS name,
         c.job AS m_njob, c.level AS m_nlevel, c.level AS m_nmaximumlevel, c.gold AS m_dwgold, c.gold AS m_nmoney,
         c.play_minutes AS totalplaytime, CASE WHEN c.online THEN 1 ELSE 0 END AS multiserver, c.created_at AS createtime
  FROM public.characters c JOIN public.accounts a ON a.id = c.account_id
  WHERE NOT c.deleted;
