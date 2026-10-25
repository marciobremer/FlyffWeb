import fs from 'node:fs';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';

/**
 * Middleware (connect/http) que serve os arquivos do FlyFF em `/res/*` (só leitura) e a listagem `/api/list?dir=...`.
 * Usado pelo plugin do Vite (desenvolvimento) e pelo servidor do jogo (`servers/main.ts`).
 *
 * O cliente pede tudo no layout antigo (`Resource/` com os dados e `Resource/Data/` com modelos, texturas, tema, ícones…).
 * Nas versões novas isso vem separado: os dados do servidor em `Resource/` e o cliente desempacotado em `Client/`
 * (`Client/Model`, `Client/Theme`… sem o `Data/`). Por isso cada caminho é procurado em várias pastas, na ordem de `roots`:
 * a primeira que tiver o arquivo vence; `strip` tira o prefixo `Data/` naquela pasta. A listagem junta as pastas.
 */
export interface ResRoot { dir: string; strip?: boolean }

const IMAGE_TYPES: Record<string, string> = { '.cur': 'image/x-icon', '.bmp': 'image/bmp', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg' };

/** hash curto (FNV-1a) do caminho real: o mesmo nome pedido pode vir de pastas diferentes */
const hash = (s: string) => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0; return h; };

export function resourceMiddleware(roots: ResRoot[]) {
  const list = roots.filter((r) => fs.existsSync(r.dir)).map((r) => ({ dir: path.resolve(r.dir), strip: !!r.strip }));
  /** caminhos candidatos (dentro de cada pasta, sem escapar dela) para o caminho pedido */
  const candidates = (rel: string) => {
    const out: string[] = [];
    let clean: string;
    try { clean = decodeURIComponent(rel).replace(/\\/g, '/').replace(/^\/+/, ''); } catch { return out; }
    for (const r of list) {
      const variants = [clean];
      if (r.strip && /^data\//i.test(clean)) variants.unshift(clean.slice(5));
      for (const v of variants) {
        const p = path.resolve(r.dir, '.' + path.sep + v);
        if (p === r.dir || p.startsWith(r.dir + path.sep)) out.push(p);
      }
    }
    return out;
  };
  return (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const url = new URL(req.url ?? '/', 'http://x');
    if (url.pathname === '/api/list') {
      const names = new Map<string, string>();
      for (const p of candidates(url.searchParams.get('dir') ?? '')) {
        try { if (fs.statSync(p).isDirectory()) for (const f of fs.readdirSync(p)) if (!names.has(f.toLowerCase())) names.set(f.toLowerCase(), f); } catch { /* não existe aqui */ }
      }
      if (!names.size) { res.statusCode = 404; res.end('[]'); return; }
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify([...names.values()]));
      return;
    }
    if (url.pathname.startsWith('/res/')) {
      let st: fs.Stats | null = null;
      const p = candidates(url.pathname.slice(5)).find((c) => { try { st = fs.statSync(c); return st.isFile(); } catch { return false; } });
      if (!p || !st) { res.statusCode = 404; res.end('not found'); return; }
      // o navegador guarda, mas confere a cada carga pela versão do arquivo (ETag = caminho + tamanho + data): sem mudança
      // volta só um 304. Com validade fixa (max-age), trocar a pasta Resource deixava o navegador usando os arquivos velhos
      // (mdlObj.inc, define*.h…) por até uma hora — modelos errados ou cubos no lugar.
      const { size, mtimeMs } = st as fs.Stats;
      const etag = `"${hash(p).toString(36)}-${size.toString(36)}-${Math.floor(mtimeMs).toString(36)}"`;
      res.setHeader('etag', etag);
      res.setHeader('cache-control', 'no-cache');
      if (req.headers['if-none-match'] === etag) { res.statusCode = 304; res.end(); return; }
      // imagens usadas direto pelo CSS (cursores .cur, botões .bmp, fundos .png) precisam do tipo certo
      const ext = path.extname(p).toLowerCase();
      res.setHeader('content-type', IMAGE_TYPES[ext] ?? 'application/octet-stream');
      fs.createReadStream(p).pipe(res);
      return;
    }
    next();
  };
}
