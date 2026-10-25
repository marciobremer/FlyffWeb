-- Loja do site (Cash Shop / PayPal), como no WEBSITE_DBF do SQL Server.
-- O site grava e compara 0/1 nessas colunas (eram bit no SQL Server): `ISNULL(is_on_sale, 0)`, `credited = 0`… — viram smallint,
-- como já foi feito com vote_logs.success.
ALTER TABLE website.topup_items ALTER COLUMN is_on_sale DROP DEFAULT;
ALTER TABLE website.topup_items ALTER COLUMN is_on_sale TYPE smallint USING is_on_sale::int;
ALTER TABLE website.topup_items ALTER COLUMN is_on_sale SET DEFAULT 0;
-- pacotes "excluídos" no admin ficam com is_active = 0 (o site nunca apaga)
ALTER TABLE website.topup_items ADD COLUMN is_active smallint NOT NULL DEFAULT 1;

ALTER TABLE website.paypal_cashshop_orders ALTER COLUMN credited DROP DEFAULT;
ALTER TABLE website.paypal_cashshop_orders ALTER COLUMN credited TYPE smallint USING credited::int;
ALTER TABLE website.paypal_cashshop_orders ALTER COLUMN credited SET DEFAULT 0;

-- recompensas do ranking PayPal já entregues (uma por posição e período)
CREATE TABLE website.paypal_ranking_rewards (
  id                     serial PRIMARY KEY,
  period_key             varchar(80) NOT NULL,
  period_label           varchar(100) NOT NULL,
  period_start           timestamp,
  period_end_exclusive   timestamp,
  rank_position          integer NOT NULL,
  character_name         varchar(32) NOT NULL,
  character_id           varchar(32),
  total_amount_at_credit numeric(18,2) NOT NULL DEFAULT 0,
  total_points_at_credit bigint NOT NULL DEFAULT 0,
  total_orders_at_credit bigint NOT NULL DEFAULT 0,
  item_id                integer NOT NULL,
  item_count             integer NOT NULL DEFAULT 1,
  status                 varchar(30) NOT NULL DEFAULT 'credited',
  mail_inserted          smallint NOT NULL DEFAULT 0,
  credited_by_email      varchar(255),
  credited_at            timestamp NOT NULL DEFAULT now(),
  notes                  varchar(500)
);
CREATE INDEX idx_paypal_ranking_rewards_period ON website.paypal_ranking_rewards (period_key, rank_position);
