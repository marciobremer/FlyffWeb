-- Loja de itens: categoria (lista a esquerda da loja) e desconto em % sobre o preco.
ALTER TABLE website.shop_items
  ADD COLUMN category text     NOT NULL DEFAULT 'Material',
  ADD COLUMN discount smallint NOT NULL DEFAULT 0 CHECK (discount BETWEEN 0 AND 90);

UPDATE website.shop_items SET category = 'Upgrade'     WHERE symbol LIKE 'II_SYS_SYS_SCR_SMEL%';
UPDATE website.shop_items SET category = 'Awakening'   WHERE symbol LIKE 'II_SYS_SYS_SCR_AWAKE%';
UPDATE website.shop_items SET category = 'Consumíveis' WHERE symbol LIKE 'II_CHR_%';
