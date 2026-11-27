-- Loja de itens do site: o jogador gasta os pontos da conta (accounts.cash / accounts.votepoint) e o servidor do jogo entrega o item
-- no personagem (servers/world/shopdelivery.ts). O site nunca escreve no inventario: so deixa o pedido em shop_purchases.
CREATE TABLE website.shop_items (
  id          serial PRIMARY KEY,
  item_id     integer NOT NULL,
  symbol      text    NOT NULL,
  name        text    NOT NULL,
  description text    NOT NULL DEFAULT '',
  icon        text    NOT NULL DEFAULT '',
  quantity    integer NOT NULL DEFAULT 1 CHECK (quantity BETWEEN 1 AND 999),
  price       integer NOT NULL DEFAULT 0 CHECK (price >= 0),
  currency    text    NOT NULL DEFAULT 'cash' CHECK (currency IN ('cash', 'vote')),
  is_active   smallint NOT NULL DEFAULT 0,
  created_at  timestamp NOT NULL DEFAULT now()
);

CREATE TABLE website.shop_purchases (
  id           serial PRIMARY KEY,
  account_id   bigint  NOT NULL,
  character_id bigint  NOT NULL,
  item_id      integer NOT NULL,
  name         text    NOT NULL,
  quantity     integer NOT NULL,
  pending      integer NOT NULL CHECK (pending >= 0),
  price        integer NOT NULL,
  currency     text    NOT NULL,
  created_at   timestamp NOT NULL DEFAULT now(),
  delivered_at timestamp
);
CREATE INDEX shop_purchases_pending ON website.shop_purchases (character_id) WHERE pending > 0;

-- itens de melhoria para comecar: entram desativados e sem preco (o dono define no painel do site)
INSERT INTO website.shop_items (item_id, symbol, name, description, icon) VALUES
  (10464, 'II_SYS_SYS_SCR_SMELPROT', 'Scroll of SProtect', 'Evita perder o equipamento se o upgrade (ou o upgrade de elemento) falhar.', 'Itm_SysSysScrSmePro.dds'),
  (10488, 'II_SYS_SYS_SCR_SMELPROT3', 'Scroll of XProtect', 'Protege a arma Unique da destruição na conversão e no upgrade Ultimate.', 'Itm_SysSysScrSmelprot3.dds'),
  (26473, 'II_SYS_SYS_SCR_SMELPROT4', 'Scroll of AProtect', 'Evita perder o acessório quando o upgrade falha.', 'Itm_SysSysScrSmelprot4.dds'),
  (10468, 'II_SYS_SYS_SCR_SMELTING', 'Scroll of Smelting', 'Aumenta em 10% a chance de upgrade.', 'Itm_SysSysScrSmelti.dds'),
  (10489, 'II_SYS_SYS_SCR_SMELTING2', 'Scroll of Smelting (Elements)', 'Aumenta em 10% a chance de upgrade de elemento (até +10).', 'Itm_SysSysScrSmelti2.dds'),
  (10270, 'II_CHR_SYS_SCR_UPCUTSTONE', 'Upcut Stone', 'Aumenta o ataque em 20% por 30 minutos.', 'Itm_ChrSysScrUpcut.dds'),
  (26461, 'II_SYS_SYS_SCR_AWAKE', 'Scroll of Awakening', 'Desperta atributos ocultos em armas, armaduras e escudos (podem sair atributos negativos).', 'Itm_SysSysScrAwake.dds'),
  (26462, 'II_SYS_SYS_SCR_AWAKECANCEL', 'Scroll of Reversion', 'Remove o despertar para poder despertar de novo.', 'Itm_SysSysScrAwakeCancel.dds'),
  (2035, 'II_GEN_MAT_ORICHALCUM01', 'Sunstone', 'Pedra do upgrade comum, de +1 a +10.', 'Itm_GenMatOrichalcum01.dds'),
  (2036, 'II_GEN_MAT_MOONSTONE', 'Moonstone', 'Pedra para furar suits, melhorar joias e remover gemas de armas.', 'Itm_GenMatMoonstone.dds');
