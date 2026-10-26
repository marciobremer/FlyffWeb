-- Upgrade (CItemUpgrade / CUltimateWeapon):
--   upgrade_tries = falhas seguidas no nível atual (m_nUpgradeTries, o "fail stack" do UpgradeSuccess.inc: depois de N falhas o
--                   próximo upgrade é garantido; volta a 0 ao subir)
--   gems          = joias engastadas na arma ultimate (UltimatePiercing): um item de joia por espaço aberto, 0 = vazio
ALTER TABLE character_items ADD COLUMN upgrade_tries integer NOT NULL DEFAULT 0 CHECK (upgrade_tries >= 0);
ALTER TABLE character_items ADD COLUMN gems jsonb NOT NULL DEFAULT '[]';
