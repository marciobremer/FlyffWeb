import type http from 'node:http';
import { ItemCatalog, type ItemDef } from '../servers/common/items';
import { RES_DIR, RES_ROOTS } from '../servers/common/config';
import { itemIconPng } from '../servers/common/icons';
import { readItemsCustom, writeItemsCustom, type ItemPatch, type NewItem } from '../servers/common/items-custom';
import { AdminError } from '../servers/auth/accounts';

/**
 * Aba Items do painel admin: lista/busca todos os itens (ícone, nome, descrição, ID), e edita, cria e remove itens.
 * As mudanças ficam em data/items-custom.json (por cima do Spec_Item.txt, que não é mexido); o servidor do jogo pega ao reiniciar.
 *   GET    /items?q=&k1=&parts=&grade=&custom=&page=&size=   lista
 *   GET    /items/meta                                      listas para os campos (PARTS_*, IK*, DST_*, JOB_*…)
 *   GET    /items/<id>                                      item editável + como era no Spec_Item
 *   PUT    /items/<id>                                      grava os campos (só o que difere do original)
 *   POST   /items                                           item novo (símbolo II_*, opcional: copiar de outro)
 *   DELETE /items/<id>                                      remove (novo: apaga de vez; original: esconde do jogo)
 *   POST   /items/<id>/restore                              desfaz edição/remoção (volta ao Spec_Item)
 *   GET    /admin/icons/<arquivo>                           ícone em PNG (sem cabeçalho: é só imagem)
 */
let catalog: ItemCatalog | null = null;
const cat = () => (catalog ??= new ItemCatalog(RES_DIR).load());

const EDIT_FIELDS = ['name', 'desc', 'icon', 'parts', 'kind1', 'kind2', 'kind3', 'sex', 'job', 'level', 'abilityMin', 'abilityMax', 'attackSpeed',
  'packMax', 'cost', 'grade', 'handed', 'weaponType', 'element', 'ignorePart', 'shopAble', 'fx', 'look'] as const;
type Editable = Required<Pick<ItemPatch, 'name' | 'icon' | 'parts' | 'kind1' | 'kind2' | 'kind3' | 'sex' | 'job' | 'level' | 'abilityMin' | 'abilityMax' | 'attackSpeed' | 'packMax' | 'cost' | 'grade' | 'handed' | 'weaponType' | 'element' | 'ignorePart' | 'shopAble' | 'fx'>> & { desc: string; look: string };

function editable(d: ItemDef): Editable & { id: number; symbol: string } {
  return {
    id: d.id, symbol: d.symbol, name: d.name, desc: d.desc ?? '', icon: d.icon, parts: d.parts, kind1: d.kind1, kind2: d.kind2, kind3: d.kind3,
    sex: d.sex, job: d.job, level: d.level, abilityMin: d.abilityMin, abilityMax: d.abilityMax, attackSpeed: d.attackSpeed, packMax: d.packMax,
    cost: d.cost, grade: d.grade, handed: d.handed, weaponType: d.weaponType, element: d.element, ignorePart: d.ignorePart, shopAble: d.shopAble,
    fx: d.dest.map((k, i) => [k, d.adj[i]] as [number, number]).filter(([k]) => k > 0), look: d.look ?? '',
  };
}

/** só os campos que mudaram em relação ao item original */
function diff(orig: Editable, next: Editable): ItemPatch {
  const p: Record<string, unknown> = {};
  for (const k of EDIT_FIELDS) if (JSON.stringify(orig[k]) !== JSON.stringify(next[k])) p[k] = next[k];
  return p as ItemPatch;
}

/** campos vindos do painel, conferidos e com os tipos certos */
function cleanPatch(b: Record<string, unknown>): Editable {
  const num = (k: string, def = 0) => { const v = Number(b[k]); return Number.isFinite(v) ? v : def; };
  const str = (k: string, max: number) => String(b[k] ?? '').slice(0, max);
  const fx = Array.isArray(b.fx) ? (b.fx as unknown[]).map((x) => (Array.isArray(x) ? [Math.floor(Number(x[0])), Math.round(Number(x[1]))] as [number, number] : null))
    .filter((x): x is [number, number] => !!x && x[0] > 0 && Number.isFinite(x[1])).slice(0, 6) : [];
  const name = str('name', 64).trim();
  if (!name) throw new AdminError('O item precisa de um nome.');
  const look = str('look', 64).trim().toUpperCase();
  if (look && !cat().bySymbol.has(look)) throw new AdminError(`Visual: ${look} não existe.`);
  return {
    name, desc: str('desc', 400), icon: str('icon', 64).trim(), parts: num('parts', -1), kind1: num('kind1'), kind2: num('kind2'), kind3: num('kind3'),
    sex: num('sex', -1), job: num('job', -1), level: Math.max(0, num('level', 1)), abilityMin: num('abilityMin'), abilityMax: num('abilityMax'),
    attackSpeed: num('attackSpeed'), packMax: Math.max(1, Math.floor(num('packMax', 1))), cost: Math.max(0, num('cost')), grade: num('grade', 100),
    handed: num('handed', 1), weaponType: num('weaponType'), element: num('element'), ignorePart: num('ignorePart', -1), shopAble: num('shopAble', -1), fx, look,
  };
}

const save = (fn: (c: ReturnType<typeof readItemsCustom>) => void) => { const c = readItemsCustom(); fn(c); writeItemsCustom(c); cat().applyCustom(c); };

/** listas de nomes para os campos do formulário (dos #define dos .h) */
function meta() {
  const byPrefix = (re: RegExp) => [...cat().defines].filter(([k]) => re.test(k)).map(([k, v]) => [v, k] as [number, string]).sort((a, b) => a[0] - b[0]);
  return {
    parts: byPrefix(/^PARTS_/), ik1: byPrefix(/^IK1_/), ik2: byPrefix(/^IK2_/), ik3: byPrefix(/^IK3_/), dst: byPrefix(/^DST_/), job: byPrefix(/^JOB_/),
    wt: byPrefix(/^WT_/), grade: byPrefix(/^ITEM_GRADE_/),
    sex: [[-1, 'Qualquer'], [0, 'Masculino'], [1, 'Feminino']], element: [[0, 'Nenhum'], [1, 'Fogo'], [2, 'Água'], [3, 'Elétrico'], [4, 'Vento'], [5, 'Terra']],
    handed: [[1, 'Uma mão'], [2, 'Duas mãos']],
  };
}

const status = (id: number) => { const c = cat().customIds; return c.added.has(id) ? 'novo' : c.edited.has(id) ? 'editado' : c.removed.has(id) ? 'removido' : ''; };

export function itemIcon(res: http.ServerResponse, file: string) {
  const png = itemIconPng(RES_ROOTS, decodeURIComponent(file));
  if (!png) { res.statusCode = 404; res.end(); return; }
  res.setHeader('content-type', 'image/png');
  res.setHeader('cache-control', 'max-age=86400');
  res.end(png);
}

/** rotas /items*; devolve false se não é uma delas */
export async function itemsApi(p: string, m: string, url: URL, readJson: () => Promise<Record<string, unknown>>, send: (status: number, body: unknown) => void): Promise<boolean> {
  if (!p.startsWith('/items')) return false;
  const c = cat();
  if (p === '/items/meta' && m === 'GET') { send(200, meta()); return true; }
  if (p === '/items' && m === 'GET') {
    const q = (url.searchParams.get('q') ?? '').trim().toLowerCase();
    const k1 = url.searchParams.get('k1'), parts = url.searchParams.get('parts'), grade = url.searchParams.get('grade'), custom = url.searchParams.get('custom');
    const size = Math.min(200, Math.max(10, Number(url.searchParams.get('size')) || 50)), page = Math.max(1, Number(url.searchParams.get('page')) || 1);
    const qn = /^\d+$/.test(q) ? Number(q) : null;
    let list: ItemDef[] = [...c.byId.values()];
    // removidos continuam na lista do painel (para poder desfazer), marcados
    if (custom === 'removed' || custom === 'any') for (const id of c.customIds.removed) { const o = c.original.get(id); if (o) list.push(o); }
    list = list.filter((d) => {
      if (q && !(qn !== null ? d.id === qn || d.symbol.toLowerCase().includes(q) : d.name.toLowerCase().includes(q) || d.symbol.toLowerCase().includes(q))) return false;
      if (k1 && d.kind1 !== Number(k1)) return false;
      if (parts && d.parts !== Number(parts)) return false;
      if (grade && d.grade !== Number(grade)) return false;
      if (custom === 'any' && !status(d.id)) return false;
      if (custom === 'removed' && status(d.id) !== 'removido') return false;
      return true;
    }).sort((a, b) => (qn !== null ? Number(b.id === qn) - Number(a.id === qn) : 0) || a.id - b.id);
    send(200, {
      total: list.length, page, size,
      rows: list.slice((page - 1) * size, page * size).map((d) => ({ id: d.id, symbol: d.symbol, name: d.name, icon: d.icon, desc: d.desc ?? '', kind1: d.kind1, kind2: d.kind2, kind3: d.kind3, parts: d.parts, level: d.level, grade: d.grade, sex: d.sex, job: d.job, status: status(d.id) })),
    });
    return true;
  }
  if (p === '/items' && m === 'POST') {
    const b = await readJson();
    const symbol = String(b.symbol ?? '').trim().toUpperCase();
    if (!/^II_[A-Z0-9_]{2,60}$/.test(symbol)) throw new AdminError('Símbolo: II_ seguido de letras, números e _ (ex.: II_ARM_M_L2_DRACONIC_SUIT).');
    if (c.bySymbol.has(symbol) || c.original.has(c.defines.get(symbol) ?? -1)) throw new AdminError(`${symbol} já existe.`);
    const base = String(b.base ?? '').trim().toUpperCase();
    if (base && !c.bySymbol.has(base)) throw new AdminError(`Copiar de: ${base} não existe.`);
    const id = Math.max(...c.original.keys(), ...c.byId.keys()) + 1;
    const src = base ? editable(c.bySymbol.get(base)!) : null;
    const fields = cleanPatch({ ...(src ?? {}), name: String(b.name ?? '') || src?.name || symbol, ...(b.fields as Record<string, unknown> ?? {}) });
    const item: NewItem = { id, symbol, ...(base ? { base } : {}), ...fields, ...(base && !fields.look ? { look: base } : {}) };
    save((x) => { x.added.push(item); });
    send(201, { id });
    return true;
  }
  const one = /^\/items\/(\d+)(\/restore)?$/.exec(p);
  if (!one) return false;
  const id = Number(one[1]);
  if (one[2] && m === 'POST') {
    save((x) => { delete x.edits[id]; x.removed = x.removed.filter((r) => r !== id); });
    send(200, { ok: true });
    return true;
  }
  if (m === 'GET') {
    const d = c.byId.get(id) ?? c.original.get(id);
    if (!d) throw new AdminError('Item não encontrado.');
    const o = c.original.get(id);
    send(200, { item: editable(d), original: o ? editable(o) : null, status: status(id) });
    return true;
  }
  if (m === 'PUT') {
    const next = cleanPatch(await readJson());
    if (c.customIds.added.has(id)) save((x) => { const i = x.added.findIndex((a) => a.id === id); if (i >= 0) x.added[i] = { ...x.added[i], ...next }; });
    else {
      const o = c.original.get(id);
      if (!o) throw new AdminError('Item não encontrado.');
      const patch = diff(editable(o), next);
      save((x) => { if (Object.keys(patch).length) x.edits[id] = patch; else delete x.edits[id]; });
    }
    send(200, { ok: true, status: status(id) });
    return true;
  }
  if (m === 'DELETE') {
    if (c.customIds.added.has(id)) save((x) => { x.added = x.added.filter((a) => a.id !== id); });
    else if (c.original.has(id)) save((x) => { delete x.edits[id]; if (!x.removed.includes(id)) x.removed.push(id); });
    else throw new AdminError('Item não encontrado.');
    send(200, { ok: true });
    return true;
  }
  return false;
}
