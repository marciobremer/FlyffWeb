/** Cargo da conta pela `accounts.authority` do FlyFF: F = jogador, Z = administrador, letras entre elas = GM. */
export type Rank = 'admin' | 'gm';

export function rankOf(authority: string | null | undefined): Rank | undefined {
  if (!authority || authority === 'F') return undefined;
  return authority === 'Z' ? 'admin' : 'gm';
}
