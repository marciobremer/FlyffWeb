import type http from 'node:http';
import { RES_DIR, RES_ROOTS } from './common/config';
import { ItemCatalog } from './common/items';
import { itemIconPng } from './common/icons';

/** Dados públicos de itens para a loja do site: `/shop-icons/<arquivo>.dds` (PNG) e `/shop-catalog?q=nome` ou `?id=n`. */
let catalog: ItemCatalog | null = null;

export function shopCatalog(req: http.IncomingMessage, res: http.ServerResponse): boolean {
  const url = new URL(req.url ?? '/', 'http://x');
  if (url.pathname.startsWith('/shop-icons/')) {
    const png = itemIconPng(RES_ROOTS, decodeURIComponent(url.pathname.slice('/shop-icons/'.length)));
    if (!png) { res.statusCode = 404; res.end(); return true; }
    res.setHeader('content-type', 'image/png');
    res.setHeader('cache-control', 'public, max-age=86400');
    res.end(png);
    return true;
  }
  if (url.pathname !== '/shop-catalog') return false;
  catalog ??= new ItemCatalog(RES_DIR).load();
  const id = Number(url.searchParams.get('id') ?? 0);
  const q = (url.searchParams.get('q') ?? '').trim().toLowerCase();
  const found = id
    ? [catalog.byId.get(id)]
    : q.length < 2 ? [] : [...catalog.byId.values()].filter((d) => d.name !== d.symbol && (d.name.toLowerCase().includes(q) || d.symbol.toLowerCase().includes(q))).slice(0, 30);
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(found.flatMap((d) => (d ? [{ id: d.id, symbol: d.symbol, name: d.name, icon: d.icon, description: d.desc ?? '' }] : []))));
  return true;
}
