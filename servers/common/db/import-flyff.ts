import { execFileSync } from 'node:child_process';
import { pool, transaction } from './index';

/**
 * Importa contas e personagens do servidor FlyFF oficial (SQL Server, só leitura) para o banco do jogo web (PostgreSQL).
 *
 *   npm run db:import -- [--dry-run] [--overwrite] [--server MARCIO\SQLEXPRESS] [--account-db ACCOUNT_DBF] [--char-db CHARACTER_01_DBF]
 *
 * - Lê pelo `sqlcmd` com autenticação do Windows (-E): nenhuma senha de banco no código; nada é escrito no SQL Server.
 * - Contas: casadas por `legacy_account` (ACCOUNT_TBL.account); atualiza hash MD5 legado, autoridade, email e bloqueio
 *   (não mexe em `password_hash`, a senha do jogo web).
 * - Personagens: casados por (`legacy_server`, `legacy_id`); por padrão só insere os que ainda não existem — progresso feito no
 *   jogo web não é sobrescrito. `--overwrite` atualiza os campos de jogo a partir do FlyFF.
 * - `legacy` guarda a linha completa de CHARACTER_TBL + INVENTORY_TBL/INVENTORY_EXT_TBL (skills, quests, inventário…).
 */
const args = process.argv.slice(2);
const flag = (n: string) => args.includes(n);
const opt = (n: string, def: string) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] ? args[i + 1] : def; };
const DRY = flag('--dry-run'), OVERWRITE = flag('--overwrite');
const SERVER = opt('--server', 'MARCIO\\SQLEXPRESS');
const ACCOUNT_DB = opt('--account-db', 'ACCOUNT_DBF');
const CHAR_DB = opt('--char-db', 'CHARACTER_01_DBF');

/** Roda uma consulta no SQL Server e devolve as linhas, cada uma serializada pelo próprio SQL Server com FOR JSON. */
function mssqlRows<T>(db: string, selectJsonPerRow: string): T[] {
  const sql = `SET NOCOUNT ON; ${selectJsonPerRow}`;
  // -y 0: sem truncar colunas longas; -f 65001: saída UTF-8; cada linha útil começa com o marcador JSONROW:
  const out = execFileSync('sqlcmd', ['-S', SERVER, '-E', '-d', db, '-b', '-y', '0', '-f', '65001', '-Q', sql], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  return out.split(/\r?\n/).filter((l) => l.startsWith('JSONROW:')).map((l) => JSON.parse(l.slice(8)) as T);
}

interface LegacyAccount { account: string; password: string | null; authority: string | null; email: string | null; regdate: string | null; BlockTime: string | null }
type LegacyChar = Record<string, unknown> & { m_idPlayer: string; serverindex: string; account: string; m_szName: string; playerslot: number };

const accounts = mssqlRows<LegacyAccount>(ACCOUNT_DB, `
  SELECT 'JSONROW:' + (SELECT a.account, a.password, d.m_chLoginAuthority AS authority, d.email, d.regdate, d.BlockTime
                       FOR JSON PATH, WITHOUT_ARRAY_WRAPPER, INCLUDE_NULL_VALUES)
  FROM ACCOUNT_TBL a LEFT JOIN ACCOUNT_TBL_DETAIL d ON d.account = a.account`);

const characters = mssqlRows<LegacyChar>(CHAR_DB, `
  SELECT 'JSONROW:' + (SELECT c.*, i.m_Inventory, i.m_apIndex, i.m_adwEquipment, i.m_dwObjIndex,
                              x.m_extInventory, x.m_InventoryPiercing, x.szInventoryPet
                       FOR JSON PATH, WITHOUT_ARRAY_WRAPPER, INCLUDE_NULL_VALUES)
  FROM CHARACTER_TBL c
  LEFT JOIN INVENTORY_TBL i ON i.m_idPlayer = c.m_idPlayer AND i.serverindex = c.serverindex
  LEFT JOIN INVENTORY_EXT_TBL x ON x.m_idPlayer = c.m_idPlayer AND x.serverindex = c.serverindex`);

/** BlockTime do FlyFF: 'YYYYMMDD' (char 8) → data; vazio/inválido → null */
function blockDate(s: string | null): Date | null {
  const m = s?.trim().match(/^(\d{4})(\d{2})(\d{2})$/);
  return m ? new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00`) : null;
}
const num = (v: unknown, def = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : def);
/** m_nLastOnline: segundos Unix quando plausível */
const unixDate = (v: unknown) => { const n = num(v, 0); return n > 946684800 && n < 4102444800 ? new Date(n * 1000) : null; };

async function main() {
  console.log(`SQL Server ${SERVER}: ${accounts.length} conta(s) em ${ACCOUNT_DB}, ${characters.length} personagem(ns) em ${CHAR_DB}.`);
  if (DRY) {
    for (const a of accounts) console.log(`  conta ${a.account} (autoridade ${a.authority ?? '?'})`);
    for (const c of characters) console.log(`  personagem ${c.m_szName} [${c.serverindex}/${c.m_idPlayer}] conta ${c.account} slot ${c.playerslot} nível ${c.m_nLevel}`);
    console.log('--dry-run: nada foi gravado.');
    return;
  }
  const stats = { accounts: 0, inserted: 0, updated: 0, skipped: 0, failed: 0 };
  await transaction(async (db) => {
    const accountId = new Map<string, number>();
    for (const a of accounts) {
      const r = await db.query<{ id: number }>(`
        INSERT INTO accounts (username, legacy_password, authority, email, blocked_until, created_at, legacy_account)
        VALUES ($1, $2, $3, $4, $5, COALESCE($6::timestamptz, now()), $1)
        ON CONFLICT (legacy_account) DO UPDATE SET legacy_password = EXCLUDED.legacy_password, authority = EXCLUDED.authority,
          email = EXCLUDED.email, blocked_until = EXCLUDED.blocked_until
        RETURNING id`,
      [a.account.trim(), a.password?.trim() || null, (a.authority ?? 'F').trim() || 'F', a.email?.trim() || null, blockDate(a.BlockTime), a.regdate]);
      accountId.set(a.account.trim().toLowerCase(), r.rows[0].id);
      stats.accounts++;
    }
    for (const c of characters) {
      const acc = accountId.get(String(c.account).trim().toLowerCase());
      const name = String(c.m_szName).trim();
      if (!acc) { console.warn(`  pulado ${name}: conta ${c.account} não encontrada em ${ACCOUNT_DB}`); stats.failed++; continue; }
      const deleted = num(c.m_nDeleted) !== 0 || String(c.isblock ?? '').trim() === 'D';
      const values = [
        acc, num(c.playerslot), name, num(c.m_dwSex) === 1 ? 1 : 0, num(c.m_dwHairMesh, 1), num(c.m_dwHairColor), num(c.m_dwHeadMesh, 1),
        num(c.m_nJob), num(c.m_nLevel, 1), num(c.m_nExp1), num(c.m_dwGold), num(c.m_nStr, 15), num(c.m_nSta, 15), num(c.m_nDex, 15), num(c.m_nInt, 15),
        num(c.m_nHitPoint), num(c.m_nManaPoint), num(c.m_nFatiguePoint), num(c.dwWorldID, 1), num(c.m_vPos_x), num(c.m_vPos_y), num(c.m_vPos_z), num(c.m_fAngle),
        deleted, c.CreateTime ?? null, unixDate(c.m_nLastOnline), String(c.m_idPlayer).trim(), String(c.serverindex).trim(), JSON.stringify(c),
      ];
      const set = `account_id = EXCLUDED.account_id, slot = EXCLUDED.slot, name = EXCLUDED.name, sex = EXCLUDED.sex, hair_mesh = EXCLUDED.hair_mesh,
        hair_color = EXCLUDED.hair_color, head_mesh = EXCLUDED.head_mesh, job = EXCLUDED.job, level = EXCLUDED.level, exp = EXCLUDED.exp, gold = EXCLUDED.gold,
        str = EXCLUDED.str, sta = EXCLUDED.sta, dex = EXCLUDED.dex, int = EXCLUDED.int, hp = EXCLUDED.hp, mp = EXCLUDED.mp, fp = EXCLUDED.fp,
        world_id = EXCLUDED.world_id, pos_x = EXCLUDED.pos_x, pos_y = EXCLUDED.pos_y, pos_z = EXCLUDED.pos_z, angle = EXCLUDED.angle,
        deleted = EXCLUDED.deleted, last_online_at = EXCLUDED.last_online_at, legacy = EXCLUDED.legacy, updated_at = now()`;
      try {
        await db.query('SAVEPOINT c');
        const r = await db.query<{ inserted: boolean }>(`
          INSERT INTO characters (account_id, slot, name, sex, hair_mesh, hair_color, head_mesh, job, level, exp, gold, str, sta, dex, int,
            hp, mp, fp, world_id, pos_x, pos_y, pos_z, angle, deleted, created_at, last_online_at, legacy_id, legacy_server, legacy)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24, COALESCE($25::timestamptz, now()), $26, $27, $28, $29::jsonb)
          ON CONFLICT (legacy_server, legacy_id) DO ${OVERWRITE ? `UPDATE SET ${set}` : 'NOTHING'}
          RETURNING (xmax = 0) AS inserted`, values);
        await db.query('RELEASE SAVEPOINT c');
        if (!r.rows.length) stats.skipped++;
        else if (r.rows[0].inserted) stats.inserted++;
        else stats.updated++;
      } catch (e) {
        await db.query('ROLLBACK TO SAVEPOINT c');
        console.warn(`  falhou ${name}: ${(e as Error).message}`);
        stats.failed++;
      }
    }
  });
  console.log(`Contas: ${stats.accounts} gravadas · Personagens: ${stats.inserted} novos, ${stats.updated} atualizados, ${stats.skipped} já existiam (use --overwrite), ${stats.failed} com erro.`);
}

main().catch((e) => { console.error('Falha na importação:', e.message); process.exitCode = 1; }).finally(() => pool.end());
