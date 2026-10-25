-- Itens de tempo (ticket de Azria e afins): quando foi ativado ele ganha uma validade; vencido fica no inventário, cinza,
-- sem poder usar. NULL = nunca ativado (ou item sem tempo).
ALTER TABLE character_items ADD COLUMN expires_at timestamptz;
