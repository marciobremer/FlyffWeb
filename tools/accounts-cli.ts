import readline from 'node:readline';
import { pool, query } from '../servers/common/db/index';
import { hashPassword } from '../servers/auth/password';
import { ItemCatalog } from '../servers/common/items';
import { RES_DIR } from '../servers/common/config';
import { Inventory, notifyInventory } from '../servers/character/inventory';

/**
 * Administração de contas do jogo web (banco `flyffweb`):
 *   npm run account -- create <usuario> [--authority F|Z]      cria a conta (pede a senha)
 *   npm run account -- set-password <usuario>                  define/troca a senha (vale também para contas importadas)
 *   npm run account -- add-character <usuario> <nome> [--sex male|female] [--slot 0..2]
 *   npm run account -- list
 *   npm run account -- set-authority <usuario> <F|L|M|N|O|P|Z>   F = jogador, Z = administrador (letras entre = níveis de GM)
 *   npm run account -- give-item <personagem> <II_SIMBOLO|id> [--count N]   põe itens na bolsa (online: aparece na hora)
 *   npm run account -- give-penya <personagem> <quantia>
 * A senha é digitada sem eco no terminal (ou vem de ACCOUNT_PASSWORD, para scripts) e só o hash scrypt vai ao banco.
 */
const [cmd, ...rest] = process.argv.slice(2);
const opt = (n: string) => { const i = rest.indexOf(n); return i >= 0 ? rest[i + 1] : undefined; };
const pos = rest.filter((a, i) => !a.startsWith('--') && !(i > 0 && rest[i - 1].startsWith('--')));

function askPassword(prompt: string): Promise<string> {
  if (process.env.ACCOUNT_PASSWORD) return Promise.resolve(process.env.ACCOUNT_PASSWORD);
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const out = rl as unknown as { _writeToOutput: (s: string) => void; output: NodeJS.WriteStream };
    let muted = false;
    out._writeToOutput = (s) => { if (!muted || s.includes(prompt)) out.output.write(s); else if (s === '\r\n' || s === '\n') out.output.write(s); };
    rl.question(prompt, (a) => { rl.close(); process.stdout.write('\n'); resolve(a); });
    muted = true;
  });
}

async function readNewPassword(): Promise<string> {
  const a = await askPassword('Senha: ');
  if (a.length < 6) throw new Error('a senha precisa de pelo menos 6 caracteres');
  if (!process.env.ACCOUNT_PASSWORD && a !== await askPassword('Repita a senha: ')) throw new Error('as senhas não conferem');
  return a;
}

async function main() {
  if (cmd === 'create') {
    const user = pos[0];
    if (!user || !/^[A-Za-z0-9_]{3,32}$/.test(user)) throw new Error('usuário: 3–32 letras, números ou _');
    const authority = (opt('--authority') ?? 'F').toUpperCase().slice(0, 1);
    const hash = hashPassword(await readNewPassword());
    await query('INSERT INTO accounts (username, password_hash, authority) VALUES ($1, $2, $3)', [user, hash, authority]);
    console.log(`Conta ${user} criada (autoridade ${authority}).`);
  } else if (cmd === 'set-password') {
    const user = pos[0];
    if (!user) throw new Error('informe o usuário');
    const hash = hashPassword(await readNewPassword());
    const r = await query('UPDATE accounts SET password_hash = $2 WHERE lower(username) = lower($1)', [user, hash]);
    await query('DELETE FROM remember_tokens WHERE account_id IN (SELECT id FROM accounts WHERE lower(username) = lower($1))', [user]); // contas salvas antigas param de valer
    console.log(r.rowCount ? `Senha de ${user} atualizada.` : `Conta ${user} não encontrada.`);
  } else if (cmd === 'add-character') {
    const [user, name] = pos;
    if (!user || !name || !/^[A-Za-z0-9_]{2,16}$/.test(name)) throw new Error('uso: add-character <usuario> <nome (2–16 letras/números)>');
    const sex = opt('--sex') === 'female' ? 1 : 0;
    const acc = await query<{ id: string }>('SELECT id FROM accounts WHERE lower(username) = lower($1)', [user]);
    if (!acc.rows[0]) throw new Error(`conta ${user} não encontrada`);
    const used = new Set((await query<{ slot: number }>('SELECT slot FROM characters WHERE account_id = $1 AND NOT deleted', [acc.rows[0].id])).rows.map((r) => r.slot));
    const slot = opt('--slot') !== undefined ? Number(opt('--slot')) : [0, 1, 2].find((s) => !used.has(s));
    if (slot === undefined || used.has(slot)) throw new Error('sem slot livre (máximo 3 personagens)');
    await query('INSERT INTO characters (account_id, slot, name, sex) VALUES ($1, $2, $3, $4)', [acc.rows[0].id, slot, name, sex]);
    console.log(`Personagem ${name} criado na conta ${user} (slot ${slot}).`);
  } else if (cmd === 'list') {
    const r = await query<{ username: string; authority: string; web: boolean; legacy: boolean; chars: string | null }>(`
      SELECT a.username, a.authority, a.password_hash IS NOT NULL AS web, a.legacy_password IS NOT NULL AS legacy,
             string_agg(c.name || ' (nv ' || c.level || ')', ', ' ORDER BY c.slot) AS chars
      FROM accounts a LEFT JOIN characters c ON c.account_id = a.id AND NOT c.deleted GROUP BY a.id ORDER BY a.username`);
    for (const a of r.rows) console.log(`${a.username.padEnd(20)} ${a.authority}  senha: ${a.web ? 'web' : a.legacy ? 'só FlyFF (MD5)' : 'nenhuma'}  personagens: ${a.chars ?? '—'}`);
  } else if (cmd === 'set-authority') {
    const [user, level] = pos;
    if (!user || !/^[A-Z]$/.test(level ?? '')) throw new Error('uso: set-authority <usuario> <F|Z>  (F = jogador, Z = administrador)');
    const r = await query('UPDATE accounts SET authority = $2 WHERE lower(username) = lower($1)', [user, level]);
    console.log(r.rowCount ? `Conta ${user} agora é ${level === 'F' ? 'jogador (F)' : level === 'Z' ? 'administrador (Z)' : `GM (${level})`}. Vale na hora para comandos // no chat.` : `Conta ${user} não encontrada.`);
  } else if (cmd === 'give-item' || cmd === 'give-penya') {
    const [name, what] = pos;
    const ch = await query<{ id: string; name: string }>('SELECT id, name FROM characters WHERE lower(name) = lower($1) AND NOT deleted', [name ?? '']);
    if (!ch.rows[0]) throw new Error(`personagem ${name} não encontrado`);
    const id = Number(ch.rows[0].id);
    if (cmd === 'give-penya') {
      const n = Number(what);
      if (!Number.isInteger(n) || n <= 0) throw new Error('uso: give-penya <personagem> <quantia>');
      const r = await query<{ gold: string }>('UPDATE characters SET gold = LEAST(gold + $2, 2100000000) WHERE id = $1 RETURNING gold', [id, n]);
      await notifyInventory(id);
      console.log(`${ch.rows[0].name} agora tem ${Number(r.rows[0].gold).toLocaleString('pt-BR')} penya.`);
    } else {
      const cat = new ItemCatalog(RES_DIR).load();
      const def = /^\d+$/.test(what ?? '') ? cat.byId.get(Number(what)) : cat.bySymbol.get((what ?? '').toUpperCase());
      if (!def) throw new Error(`item ${what} não existe no Spec_Item.txt`);
      const count = Math.max(1, Number(opt('--count') ?? 1) | 0);
      const left = await new Inventory(cat).add(id, def.id, count);
      console.log(`${count - left}× ${def.name} (${def.symbol}) na bolsa de ${ch.rows[0].name}.${left ? ` ${left} não couberam (bolsa cheia).` : ''}`);
    }
  } else {
    console.log('uso: npm run account -- create <usuario> | set-password <usuario> | add-character <usuario> <nome> [--sex female] | list | set-authority <usuario> <F|Z> | give-item <personagem> <II_…> [--count N] | give-penya <personagem> <n>');
  }
}

main().catch((e) => { console.error('Erro:', (e as Error).message); process.exitCode = 1; }).finally(() => pool.end());
