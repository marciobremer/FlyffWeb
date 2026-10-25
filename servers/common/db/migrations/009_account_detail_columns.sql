-- O site insere em ACCOUNT_TBL_DETAIL também gamecode, tester, BlockTime, EndTime e WebTime: a view precisa ter essas colunas.
DROP VIEW legacy.account_tbl_detail;
CREATE VIEW legacy.account_tbl_detail AS
  SELECT username AS account, email, created_at AS regdate, authority AS m_chloginauthority, 'A000'::text AS gamecode, '2'::text AS tester,
         '0'::text AS blocktime, '0'::text AS endtime, '0'::text AS webtime, 'O'::text AS isuse
  FROM public.accounts;
CREATE TRIGGER account_tbl_detail_ins INSTEAD OF INSERT ON legacy.account_tbl_detail FOR EACH ROW EXECUTE FUNCTION legacy.account_tbl_detail_write();
CREATE TRIGGER account_tbl_detail_upd INSTEAD OF UPDATE ON legacy.account_tbl_detail FOR EACH ROW EXECUTE FUNCTION legacy.account_tbl_detail_write();
