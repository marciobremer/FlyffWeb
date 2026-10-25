/**
 * Sessões de login (Auth Server): token opaco → conta. Ficam em memória (reiniciar o servidor desloga todos); o mesmo token
 * entra no WebSocket do mundo (`join`). Na fase 2 o Auth passa a emitir um token assinado que o World confere sozinho.
 */
export interface Session { token: string; accountId: number; username: string; authority: string; expires: number }
export const sessions = new Map<string, Session>();
export const SESSION_MS = 12 * 60 * 60 * 1000;

/** Encerra todas as sessões de uma conta (kick/ban pelo painel admin); devolve quantas removeu. */
export function revokeAccount(accountId: number): number {
  let n = 0;
  for (const [t, s] of sessions) if (s.accountId === accountId) { sessions.delete(t); n++; }
  return n;
}

export function sessionFrom(token: string | null): Session | null {
  if (!token) return null;
  const s = sessions.get(token);
  if (!s) return null;
  if (s.expires < Date.now()) { sessions.delete(token); return null; }
  return s;
}
