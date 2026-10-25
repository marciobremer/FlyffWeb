import type { IncomingMessage, ServerResponse } from 'node:http';
import { query } from '../common/db/index';
import { bearer, readJson, send } from '../common/http';
import { sessionFrom } from '../auth/sessions';
import type { Inventory, InvItem } from './inventory';
import type { LookPiece } from '../../shared/look';

/**
 * Character Server — HTTP: lista e criação de personagens da conta logada.
 *   POST /gapi/characters { name, sex, hair, head } (Bearer) → { character, characters } — cria no 1º slot livre (máx. 3)
 * (a persistência do inventário, atributos e skills fica em `inventory.ts` e no World por enquanto — fase 2 separa)
 */
export interface CharacterInfo {
  id: number; slot: number; name: string; sex: number; hairMesh: number; hairColor: number; headMesh: number;
  job: number; level: number; worldId: number; pos: [number, number, number]; angle: number;
  /** valores atuais salvos (0 = personagem novo, ainda sem combate: o cliente mostra cheio) */
  hp: number; mp: number; fp: number; exp: number;
  /** o que está equipado (para a prévia da seleção ficar igual ao jogo) e a postura da arma (MTI_STAND_NN) */
  equip: LookPiece[]; mt: number;
}

/** inventário (catálogo de itens + postura da arma), passado por quem sobe o mundo — sem ele a lista vem sem equipamento */
let inventory: Inventory | null = null;
export function setCharacterInventory(inv: Inventory | null) { inventory = inv; }

export async function charactersOf(accountId: number): Promise<CharacterInfo[]> {
  const r = await query<{ id: string; slot: number; name: string; sex: number; hair_mesh: number; hair_color: number; head_mesh: number; job: number; level: number; world_id: number; pos_x: number; pos_y: number; pos_z: number; angle: number; hp: number; mp: number; fp: number; exp: string }>(
    `SELECT id, slot, name, sex, hair_mesh, hair_color, head_mesh, job, level, world_id, pos_x, pos_y, pos_z, angle, hp, mp, fp, exp
     FROM characters WHERE account_id = $1 AND NOT deleted ORDER BY slot`, [accountId]);
  // equipamento de todos de uma vez (container 1 = equipado)
  const eq = new Map<number, InvItem[]>();
  if (inventory && r.rows.length) {
    const it = await query<{ character_id: string; slot: number; item_id: number; upgrade: number; element: number; element_level: number }>(
      'SELECT character_id, slot, item_id, upgrade, element, element_level FROM character_items WHERE container = 1 AND character_id = ANY($1::bigint[])', [r.rows.map((c) => c.id)]);
    for (const x of it.rows) {
      const list = eq.get(Number(x.character_id)) ?? [];
      list.push({ c: 1, s: x.slot, id: x.item_id, n: 1, u: x.upgrade, e: x.element, el: x.element_level });
      eq.set(Number(x.character_id), list);
    }
  }
  return r.rows.map((c) => {
    const items = eq.get(Number(c.id)) ?? [];
    const equip: LookPiece[] = [];
    for (const i of items) { const sym = inventory?.catalog.byId.get(i.id)?.symbol; if (sym) equip.push({ s: i.s, sym, u: i.u, e: i.e, el: i.el }); }
    return {
      id: Number(c.id), slot: c.slot, name: c.name, sex: c.sex, hairMesh: c.hair_mesh, hairColor: c.hair_color, headMesh: c.head_mesh,
      job: c.job, level: c.level, worldId: c.world_id, pos: [c.pos_x, c.pos_y, c.pos_z] as [number, number, number], angle: c.angle,
      hp: c.hp, mp: c.mp, fp: c.fp, exp: Number(c.exp),
      equip, mt: inventory ? inventory.combatMotion({ gold: 0, items }, c.job) : 0,
    };
  });
}

/** limites da criação: malhas Part_<sexo>Hair01–10 e Part_<sexo>Head01–24 existentes no cliente */
export const CREATE_LIMITS = { hair: 10, head: 24, nameMin: 2, nameMax: 16 };
const NAME_RE = /^[A-Za-z0-9]+$/;

async function createCharacter(req: IncomingMessage, res: ServerResponse) {
  const s = sessionFrom(bearer(req));
  if (!s) return send(res, 401, { error: 'Sessão expirada. Entre novamente.' });
  let body: Record<string, unknown>;
  try { body = await readJson(req); } catch { return send(res, 400, { error: 'Requisição inválida.' }); }
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const sex = body.sex === 1 ? 1 : 0;
  const hair = Number(body.hair), head = Number(body.head);
  if (name.length < CREATE_LIMITS.nameMin || name.length > CREATE_LIMITS.nameMax || !NAME_RE.test(name)) {
    return send(res, 400, { error: `Nome: ${CREATE_LIMITS.nameMin} a ${CREATE_LIMITS.nameMax} letras ou números, sem espaços.` });
  }
  if (!Number.isInteger(hair) || hair < 1 || hair > CREATE_LIMITS.hair || !Number.isInteger(head) || head < 1 || head > CREATE_LIMITS.head) {
    return send(res, 400, { error: 'Aparência inválida.' });
  }
  const used = new Set((await query<{ slot: number }>('SELECT slot FROM characters WHERE account_id = $1 AND NOT deleted', [s.accountId])).rows.map((r) => r.slot));
  const slot = [0, 1, 2].find((x) => !used.has(x));
  if (slot === undefined) return send(res, 409, { error: 'Você já tem 3 personagens.' });
  try {
    await query('INSERT INTO characters (account_id, slot, name, sex, hair_mesh, head_mesh) VALUES ($1, $2, $3, $4, $5, $6)', [s.accountId, slot, name, sex, hair, head]);
  } catch (e) {
    const pgErr = e as { code?: string; constraint?: string };
    if (pgErr.code === '23505') return send(res, 409, { error: pgErr.constraint === 'characters_name_lower' ? 'Esse nome já está em uso.' : 'Tente de novo.' });
    throw e;
  }
  const characters = await charactersOf(s.accountId);
  send(res, 201, { character: characters.find((c) => c.slot === slot), characters });
}

/** rotas do Character Server; devolve false se a rota não é dele */
/**
 * GET /gapi/parts-ignore → { head: II_*[], hair: II_*[] }: itens que, equipados, escondem a peça base do personagem
 * (dwBasePartsIgnore, MoverRender.cpp): PARTS_HEAD esconde cabeça e cabelo; PARTS_HAIR só o cabelo (chapéus/cabelos de cash)
 */
let partsIgnore: { head: string[]; hair: string[] } | null = null;
function partsIgnoreList() {
  if (partsIgnore || !inventory) return partsIgnore ?? { head: [], hair: [] };
  const c = inventory.catalog, HEAD = c.defines.get('PARTS_HEAD') ?? 0, HAIR = c.defines.get('PARTS_HAIR') ?? 1;
  const out = { head: [] as string[], hair: [] as string[] };
  for (const d of c.byId.values()) { if (d.ignorePart === HEAD) out.head.push(d.symbol); else if (d.ignorePart === HAIR) out.hair.push(d.symbol); }
  return (partsIgnore = out);
}

export async function characterRoute(req: IncomingMessage, res: ServerResponse, path: string): Promise<boolean> {
  if (path === '/gapi/characters' && req.method === 'POST') { await createCharacter(req, res); return true; }
  if (path === '/gapi/parts-ignore' && req.method === 'GET') { res.setHeader('cache-control', 'no-cache'); send(res, 200, partsIgnoreList()); return true; }
  return false;
}
