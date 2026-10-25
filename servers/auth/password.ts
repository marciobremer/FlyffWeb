import crypto from 'node:crypto';

/**
 * Senhas do jogo web: scrypt (N=2^15, r=8, p=1) com sal aleatório, guardado como `scrypt$N$r$p$sal$hash` (base64).
 * Contas importadas do FlyFF trazem só o MD5 do servidor oficial (`md5(sal + senha)`, 32 hex) em `legacy_password`;
 * ele vale apenas para o primeiro login, que grava o hash scrypt.
 */
const N = 1 << 15, R = 8, P = 1, KEYLEN = 32;

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(password.normalize('NFC'), salt, KEYLEN, { N, r: R, p: P, maxmem: 64 * 1024 * 1024 });
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [alg, n, r, p, salt, hash] = stored.split('$');
  if (alg !== 'scrypt' || !salt || !hash) return false;
  const want = Buffer.from(hash, 'base64');
  const key = crypto.scryptSync(password.normalize('NFC'), Buffer.from(salt, 'base64'), want.length, { N: Number(n), r: Number(r), p: Number(p), maxmem: 64 * 1024 * 1024 });
  return crypto.timingSafeEqual(key, want);
}

/**
 * MD5 do FlyFF: o cliente envia `md5(sal + senha)` em hex e o banco guarda esse valor. O sal costuma ser "kikugalanet"
 * (FlyFF original); servidores privados podem trocar — ajuste com FLYFF_MD5_SALT (vazio = MD5 da senha pura).
 */
export const LEGACY_SALT = process.env.FLYFF_MD5_SALT ?? 'kikugalanet';

export function verifyLegacyPassword(password: string, legacyHex: string): boolean {
  const got = crypto.createHash('md5').update(LEGACY_SALT + password, 'latin1').digest();
  const want = Buffer.from(legacyHex.trim(), 'hex');
  return want.length === got.length && crypto.timingSafeEqual(got, want);
}

/** token de sessão opaco (256 bits) */
export const newToken = () => crypto.randomBytes(32).toString('base64url');
