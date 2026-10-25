-- Site (htdocs, Next.js): tabelas do banco WEBSITE_DBF do SQL Server, agora no esquema `website` do PostgreSQL.
-- Nomes em minúsculas (snake_case); o adaptador do site (htdocs/src/lib/db.js) devolve as colunas com a caixa original.
CREATE SCHEMA IF NOT EXISTS website;

CREATE TABLE website.registered_users (
  id                 serial PRIMARY KEY,
  email              varchar(100) NOT NULL UNIQUE,
  password_hash      varchar(64) NOT NULL,
  pin_hash           varchar(64) NOT NULL,
  is_verified        boolean DEFAULT false,
  is_active          boolean DEFAULT true,
  created_at         timestamp DEFAULT now(),
  updated_at         timestamp DEFAULT now(),
  role               varchar(20) NOT NULL DEFAULT 'user',
  verification_token varchar(255),
  email_verified     boolean DEFAULT false,
  token_expires_at   timestamp
);

CREATE TABLE website.download_links (
  id         serial PRIMARY KEY,
  name       varchar(200) NOT NULL,
  url        text NOT NULL,
  size       varchar(100) NOT NULL,
  created_at timestamp DEFAULT now(),
  icon_type  varchar(100) NOT NULL DEFAULT 'default'
);

CREATE TABLE website.news (
  id         serial PRIMARY KEY,
  title      varchar(255) NOT NULL,
  content    text NOT NULL,
  image_url  varchar(1000),
  created_at timestamp DEFAULT now()
);

CREATE TABLE website.news_posts (
  id         serial PRIMARY KEY,
  title      varchar(255),
  content    text,
  image_url  varchar(1000),
  created_at timestamp DEFAULT now()
);

CREATE TABLE website.topup_items (
  id              serial PRIMARY KEY,
  name            varchar(255) NOT NULL,
  description     text,
  price           numeric(18,2) NOT NULL,
  points          integer NOT NULL,
  category        varchar(100) NOT NULL,
  is_on_sale      boolean NOT NULL DEFAULT false,
  sale_percentage integer NOT NULL DEFAULT 0,
  image_url       text,
  created_at      timestamp DEFAULT now(),
  updated_at      timestamp DEFAULT now(),
  points_type     varchar(40) NOT NULL DEFAULT 'donate'
);
CREATE INDEX idx_topup_items_category ON website.topup_items (category);

CREATE TABLE website.topup_requests (
  id                serial PRIMARY KEY,
  user_id           integer NOT NULL,
  item_id           integer NOT NULL,
  username          varchar(255) NOT NULL,
  amount            numeric(18,2) NOT NULL,
  points            integer NOT NULL,
  attachment_url    varchar(255) NOT NULL,
  status            varchar(40) NOT NULL DEFAULT 'pending',
  created_at        timestamp NOT NULL DEFAULT now(),
  updated_at        timestamp NOT NULL DEFAULT now(),
  processed_at      timestamp,
  processed_by      integer,
  notes             text,
  streamer_code     varchar(200),
  flyff_account     varchar(64),
  points_type       varchar(10),
  credited_at       timestamp,
  credited_by_email varchar(255)
);
CREATE INDEX ix_topup_requests_created_at ON website.topup_requests (created_at);
CREATE INDEX ix_topup_requests_status ON website.topup_requests (status);
CREATE INDEX ix_topup_requests_streamer_code ON website.topup_requests (streamer_code);
CREATE INDEX ix_topup_requests_user_id ON website.topup_requests (user_id);

CREATE TABLE website.vote_logs (
  id         serial PRIMARY KEY,
  account    varchar(100) NOT NULL,
  site       varchar(100) NOT NULL,
  vote_time  timestamp NOT NULL DEFAULT now(),
  ip_address varchar(45) NOT NULL,
  success    boolean NOT NULL,
  reason     varchar(255)
);
CREATE INDEX idx_vote_logs_account ON website.vote_logs (account);
CREATE INDEX idx_vote_logs_ip_address ON website.vote_logs (ip_address);
CREATE INDEX idx_vote_logs_vote_time ON website.vote_logs (vote_time);

CREATE TABLE website.paypal_cashshop_orders (
  id                    serial PRIMARY KEY,
  website_user_email    varchar(255),
  character_name        varchar(32) NOT NULL,
  character_id          bigint,
  flyff_account         varchar(100) NOT NULL,
  item_id               integer NOT NULL,
  item_name             varchar(255) NOT NULL,
  points                integer NOT NULL,
  points_type           varchar(40) NOT NULL,
  amount                numeric(18,2) NOT NULL,
  currency              varchar(20) NOT NULL DEFAULT 'EUR',
  paypal_order_id       varchar(200) UNIQUE,
  paypal_capture_id     varchar(200) UNIQUE,
  paypal_payer_email    varchar(255),
  status                varchar(60) NOT NULL DEFAULT 'created',
  credited              boolean NOT NULL DEFAULT false,
  failure_reason        varchar(2000),
  paypal_create_payload text,
  paypal_capture_payload text,
  created_at            timestamp NOT NULL DEFAULT now(),
  paid_at               timestamp,
  credited_at           timestamp,
  updated_at            timestamp
);
CREATE INDEX ix_paypal_cashshop_orders_character_name ON website.paypal_cashshop_orders (character_name);
