import pg from 'pg';
import { dbConfig, dbPassword, pool } from './index';
import { runMigrations } from './migrate';
import { DbOpError } from './backup';

/**
 * Instalar o banco do zero (painel admin → Database), o mesmo que o passo 3 do README feito à mão:
 *   1. conecta como superusuário do PostgreSQL (ex.: `postgres`; a senha é pedida na hora e não fica guardada)
 *   2. cria o usuário do jogo (`flyffweb_app`) se não existir, ou acerta a senha dele, com a senha da Conexão (pgpass.conf
 *      ou PGPASSWORD) — assim o servidor sempre consegue entrar
 *   3. cria o banco (`flyffweb`, dono = usuário do jogo, UTF8); se ele já existe, para — para apagar dados use "Zerar"
 *   4. roda todas as migrações (estrutura vazia) e, se pedido, cria a primeira conta (dono do servidor)
 */

/** como está o banco agora: ok, banco não existe, senha/usuário errados ou PostgreSQL fora do ar */
export async function dbHealth(): Promise<{ state: 'ok' | 'missing' | 'auth' | 'offline' | 'error'; message: string }> {
  if (!dbPassword()) return { state: 'auth', message: `A senha do usuário "${dbConfig.user}" não foi encontrada (PGPASSWORD ou pgpass.conf).` };
  try {
    await pool.query('SELECT 1');
    return { state: 'ok', message: 'Banco conectado.' };
  } catch (e) {
    const err = e as { code?: string; message: string };
    if (err.code === '3D000') return { state: 'missing', message: `O banco "${dbConfig.database}" não existe.` };
    if (err.code === '28P01' || err.code === '28000') return { state: 'auth', message: `O usuário "${dbConfig.user}" não existe ou a senha dele está errada.` };
    if (err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND') return { state: 'offline', message: `O PostgreSQL não responde em ${dbConfig.host}:${dbConfig.port}.` };
    return { state: 'error', message: err.message };
  }
}

export interface InstallInput { adminUser: string; adminPassword: string; owner?: { username: string; password: string } }
export interface InstallResult { roleCreated: boolean; migrations: number; ownerId: number | null; steps: string[] }

const quoteId = (s: string) => '"' + s.replace(/"/g, '""') + '"';
const quoteLit = (s: string) => "'" + s.replace(/'/g, "''") + "'";

export async function installDatabase(input: InstallInput, createOwner?: (u: string, p: string) => Promise<number>): Promise<InstallResult> {
  const steps: string[] = [];
  const adminUser = input.adminUser.trim() || 'postgres';
  if (!input.adminPassword) throw new DbOpError('Informe a senha do superusuário do PostgreSQL.');
  const pass = dbPassword();
  if (!pass) throw new DbOpError(`Preencha a senha do usuário "${dbConfig.user}" em Conexão e salve antes de instalar.`);
  const su = new pg.Client({ host: dbConfig.host, port: dbConfig.port, user: adminUser, password: input.adminPassword, database: 'postgres', application_name: 'flyffweb-admin' });
  try { await su.connect(); } catch (e) {
    const err = e as { code?: string; message: string };
    throw new DbOpError(err.code === '28P01' ? `Senha do usuário "${adminUser}" do PostgreSQL incorreta.` : `Não consegui conectar como "${adminUser}": ${err.message}`);
  }
  let roleCreated = false;
  try {
    const me = (await su.query<{ ok: boolean }>('SELECT rolsuper OR rolcreatedb AND rolcreaterole AS ok FROM pg_roles WHERE rolname = current_user')).rows[0];
    if (!me?.ok) throw new DbOpError(`"${adminUser}" não tem permissão para criar usuários e bancos (use o superusuário, normalmente "postgres").`);
    if ((await su.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbConfig.database])).rowCount) {
      throw new DbOpError(`O banco "${dbConfig.database}" já existe. Para deixá-lo vazio use "Zerar o banco"; para instalar do zero, apague-o antes.`);
    }
    // usuário do jogo: cria se faltar; se já existe, acerta a senha dele para a da Conexão (o servidor entra com ela)
    const roleExists = !!(await su.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [dbConfig.user])).rowCount;
    if (!roleExists) {
      await su.query(`CREATE ROLE ${quoteId(dbConfig.user)} LOGIN PASSWORD ${quoteLit(pass)}`);
      roleCreated = true;
      steps.push(`Usuário "${dbConfig.user}" criado.`);
    } else {
      await su.query(`ALTER ROLE ${quoteId(dbConfig.user)} WITH LOGIN PASSWORD ${quoteLit(pass)}`);
      steps.push(`Usuário "${dbConfig.user}" já existia: senha acertada com a da Conexão.`);
    }
    await su.query(`CREATE DATABASE ${quoteId(dbConfig.database)} OWNER ${quoteId(dbConfig.user)} ENCODING 'UTF8' TEMPLATE template0`);
    steps.push(`Banco "${dbConfig.database}" criado.`);
  } finally { await su.end().catch(() => {}); }

  // estrutura: todas as migrações, já conectado como o usuário do jogo
  const migrations = await runMigrations((t) => steps.push(t));
  let ownerId: number | null = null;
  if (input.owner?.username && createOwner) {
    ownerId = await createOwner(input.owner.username, input.owner.password);
    steps.push(`Conta "${input.owner.username}" criada como dono do servidor.`);
  }
  return { roleCreated, migrations, ownerId, steps };
}
