/**
 * Contagem dos downloads de recursos (/res, /api/list…) para a tela de carregamento: quantos pedidos começaram, quantos
 * terminaram e quantos bytes chegaram. Todos os fetch de arquivos do jogo passam por `trackedFetch`.
 */
/** `urls`: o que já foi pedido (a tela de carregamento grava a lista do primeiro carregamento completo — servers/common/bootmanifest.ts) */
export const netStats = { started: 0, done: 0, bytes: 0, urls: [] as string[] };

export async function trackedFetch(url: string, init?: RequestInit): Promise<Response> {
  netStats.started++;
  if (netStats.urls.length < 20000) netStats.urls.push(url);
  try { return await fetch(url, init); } finally { netStats.done++; }
}

/** corpo como ArrayBuffer, somando os bytes */
export async function trackedBuffer(r: Response): Promise<ArrayBuffer> {
  const b = await r.arrayBuffer();
  netStats.bytes += b.byteLength;
  return b;
}
