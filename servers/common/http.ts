import type { IncomingMessage, ServerResponse } from 'node:http';

/** Utilidades HTTP/JSON dos serviços (Auth, Character e as rotas internas). */
export function send(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(body));
}

export async function readJson(req: IncomingMessage, limit = 4096): Promise<Record<string, unknown>> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > limit) throw new Error('corpo grande demais');
    chunks.push(c as Buffer);
  }
  const v = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  return v && typeof v === 'object' ? v : {};
}

/** token do cabeçalho `Authorization: Bearer <token>` */
export const bearer = (req: IncomingMessage) => /^Bearer\s+(\S+)$/.exec(req.headers.authorization ?? '')?.[1] ?? null;
