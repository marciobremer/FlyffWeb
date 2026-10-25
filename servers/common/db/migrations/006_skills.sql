-- Skills: níveis aprendidos ({ "<id SI_*>": nível }) e pontos livres (m_nSkillPoint). Ao subir de nível ganha
-- ((nível − 1) / 20) + 2 pontos; personagens existentes recebem tudo o que já teriam ganho.
ALTER TABLE characters
  ADD COLUMN skills jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN skill_points integer NOT NULL DEFAULT 0 CHECK (skill_points >= 0);
UPDATE characters c SET skill_points = (SELECT COALESCE(SUM(((lv - 1) / 20) + 2), 0) FROM generate_series(2, c.level) AS lv);
