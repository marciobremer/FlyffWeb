/** Cargo da conta pela `accounts.authority`: F = jogador, Z = dono do servidor (nome preto), G (ou outra letra) = GM (nome roxo). */
export type Rank = 'admin' | 'gm';

export function rankOf(authority: string | null | undefined): Rank | undefined {
  if (!authority || authority === 'F') return undefined;
  return authority === 'Z' ? 'admin' : 'gm';
}
