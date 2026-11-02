import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './config';

/**
 * Arquivos do jogo por CDN (opcional). Sem configurar nada o cliente pede `/res/…` e `/snd/…` ao próprio servidor do jogo,
 * como sempre. Com uma CDN ("pull": Cloudflare, Bunny, CloudFront…), o cliente pede tudo a ela em endereços com versão
 *   <url>/cdn/<versão>/res/<arquivo>     arquivos do FlyFF (mesmo caminho de /res)
 *   <url>/cdn/<versão>/list/<pasta>      listagem de pasta (a mesma de /api/list?dir=)
 *   <url>/cdn/<versão>/snd/<arquivo>     sons
 * e a CDN busca cada arquivo UMA vez na origem (o servidor de arquivos `npm run assets`, de preferência em outra máquina,
 * ou o próprio servidor do jogo) e guarda para sempre: com a versão no endereço, a resposta pode ter cache de 1 ano.
 * Trocou arquivos em Original/ ou data/res-extra? Gere uma versão nova (painel → World → CDN), senão a CDN e os navegadores
 * continuam com os antigos.
 *
 * Configuração em data/cdn.json ({ url, version, ws }), editada pelo painel e relida sozinha; as variáveis de ambiente
 * ASSET_URL, ASSET_VERSION e WORLD_WS_URL têm prioridade (Docker / várias máquinas).
 *   ws: endereço do WebSocket do mundo (ex.: wss://mundo.meujogo.com/ws) quando o World Server roda em outra máquina e os
 *       jogadores se conectam direto a ele; vazio = o mesmo endereço da página.
 */
export interface CdnConfig { url: string; version: string; ws: string }
export const CDN_FILE = path.join(ROOT, 'data', 'cdn.json');

let cache: { mtime: number; cfg: CdnConfig } | null = null;

export function cdnConfig(): CdnConfig {
  let mtime = 0;
  try { mtime = fs.statSync(CDN_FILE).mtimeMs; } catch { /* sem arquivo */ }
  if (!cache || cache.mtime !== mtime) {
    let j: Partial<CdnConfig> = {};
    try { j = JSON.parse(fs.readFileSync(CDN_FILE, 'utf8')); } catch { /* padrão */ }
    cache = { mtime, cfg: { url: String(j.url ?? ''), version: String(j.version ?? '') || 'v1', ws: String(j.ws ?? '') } };
  }
  const env = process.env;
  return {
    url: (env.ASSET_URL ?? cache.cfg.url).trim().replace(/\/+$/, ''),
    version: (env.ASSET_VERSION ?? cache.cfg.version).trim() || 'v1',
    ws: (env.WORLD_WS_URL ?? cache.cfg.ws).trim(),
  };
}

/** quais campos vêm do ambiente (o painel mostra travados) */
export const cdnEnvFixed = () => ({ url: process.env.ASSET_URL !== undefined, version: process.env.ASSET_VERSION !== undefined, ws: process.env.WORLD_WS_URL !== undefined });

export function saveCdnConfig(input: Partial<CdnConfig>): CdnConfig {
  const cur = cdnConfig();
  const url = String(input.url ?? cur.url).trim().replace(/\/+$/, '');
  const ws = String(input.ws ?? cur.ws).trim();
  const version = String(input.version ?? cur.version).trim();
  if (url && !/^https?:\/\/[\w.-]+(:\d+)?(\/[\w./-]*)?$/.test(url)) throw new Error('Endereço da CDN inválido (ex.: https://cdn.meujogo.com).');
  if (ws && !/^wss?:\/\/[\w.-]+(:\d+)?\/[\w./-]*$/.test(ws)) throw new Error('Endereço do WebSocket inválido (ex.: wss://mundo.meujogo.com/ws).');
  if (!/^[\w-]{1,32}$/.test(version)) throw new Error('Versão: letras, números, - e _ (até 32).');
  fs.mkdirSync(path.dirname(CDN_FILE), { recursive: true });
  fs.writeFileSync(CDN_FILE, JSON.stringify({ url, version, ws }, null, 2));
  return cdnConfig();
}

/** versão nova (data e hora): a CDN e os navegadores passam a buscar tudo de novo */
export const newCdnVersion = () => saveCdnConfig({ version: 'v' + new Date().toISOString().replace(/\D/g, '').slice(0, 12) });

/** endereços que a página do jogo/editor usa (vai embutido no HTML: o cliente já sabe antes de baixar qualquer coisa) */
export function clientAssets() {
  const c = cdnConfig();
  if (!c.url) return { res: '/res/', snd: '/snd/', list: '', ws: c.ws };
  const base = `${c.url}/cdn/${encodeURIComponent(c.version)}`;
  return { res: base + '/res/', snd: base + '/snd/', list: base + '/list/', ws: c.ws };
}

/** `/cdn/<versão>/<tipo>/<resto>` → partes (null se não é um endereço da CDN) */
export function parseCdnPath(pathname: string): { version: string; kind: 'res' | 'list' | 'snd'; rest: string } | null {
  const m = /^\/cdn\/([\w-]{1,32})\/(res|list|snd)\/(.*)$/.exec(pathname);
  return m ? { version: m[1], kind: m[2] as 'res' | 'list' | 'snd', rest: m[3] } : null;
}

/**
 * Cabeçalhos de uma resposta da CDN: qualquer site pode ler (o jogo está em outro domínio) e, se a versão pedida é a atual,
 * cache de 1 ano. Versão antiga/errada: não guarda (senão a CDN ficaria com arquivos novos num endereço de versão velha).
 */
export function cdnHeaders(res: import('node:http').ServerResponse, version: string) {
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('cache-control', version === cdnConfig().version ? 'public, max-age=31536000, immutable' : 'no-cache');
}
