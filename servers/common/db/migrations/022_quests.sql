-- Quests do personagem (data/quests.json define as quests; aqui só o andamento).
-- { "<id da quest>": { "s": 1 aceita | 2 concluída, "k": { "<MI_*>": abates }, "n": vezes concluída, "at": aceita em (ms) } }
ALTER TABLE characters ADD COLUMN quests jsonb NOT NULL DEFAULT '{}'::jsonb;
