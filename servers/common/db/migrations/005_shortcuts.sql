-- Barra de atalhos (teclas 1–0): lista de 10 posições, cada uma null ou {"k":"item","id":<item_id>}.
ALTER TABLE characters ADD COLUMN shortcuts jsonb NOT NULL DEFAULT '[]'::jsonb;
