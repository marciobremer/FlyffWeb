-- Filtro do pet coletor (janela Pet Filter, tecla U): bits do que NÃO pegar, raridade mínima de arma/armadura e as listas
-- branca/negra de ids (shared/petfilter.ts). Por personagem, como o __AEGON_DB_PETFILTER do Titanium.
ALTER TABLE characters ADD COLUMN pet_filter jsonb NOT NULL DEFAULT '{}';
