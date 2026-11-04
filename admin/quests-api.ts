import fs from 'node:fs';
import path from 'node:path';
import { EXTRA_DIR, RES_DIR } from '../servers/common/config';
import { QUESTS_FILE } from '../servers/world/quests';
import { loadEdits } from '../servers/common/worldedits';
import { applyNpcEdits } from '../shared/worldedits';
import { parseDyo } from '../shared/formats/dyo';
import { nameTable } from '../servers/common/names';
import { cat } from './items-api';
import { AdminError } from '../servers/auth/accounts';

/**
 * Aba Quests do painel: edita `data/quests.json` (o formato está no cabeçalho de servers/world/quests.ts; o jogo relê o
 * arquivo sozinho) e ajuda a achar o ID (characterKey) dos NPCs. Os campos que o formulário não tem (kill, reward.items…)
 * ficam como estão ao editar uma quest.
 */
type Raw = Record<string, unknown>;

function readFileQuests(): Raw[] {
  try { const j = JSON.parse(fs.readFileSync(QUESTS_FILE, 'utf8')) as { quests?: Raw[] }; return Array.isArray(j.quests) ? j.quests : []; } catch { return []; }
}
function writeFileQuests(list: Raw[]) {
  fs.mkdirSync(path.dirname(QUESTS_FILE), { recursive: true });
  const tmp = QUESTS_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify({ quests: list }, null, 2) + '\n');
  fs.renameSync(tmp, QUESTS_FILE);
}

/** a lista da tela, com o nome de cada item pedido */
function reply() {
  const c = cat();
  const quests = readFileQuests().map((q) => ({
    ...q,
    needNames: (Array.isArray(q.need) ? (q.need as Raw[]) : []).map((g) => c.bySymbol.get(String(g.item))?.name ?? '?'),
  }));
  return { quests };
}

const str = (v: unknown, max: number) => String(v ?? '').replace(/\r/g, '').trim().slice(0, max);
const int = (v: unknown, d: number, lo: number, hi: number) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.floor(n))) : d; };

/** valida o que o formulário mandou e junta com o que já havia da quest */
function build(b: Raw, old: Raw | undefined): Raw {
  const c = cat();
  const name = str(b.name, 60);
  const npc = str(b.npc, 64);
  if (!name) throw new AdminError('Dê um título à quest.');
  if (!npc) throw new AdminError('Informe o ID do NPC (characterKey).');
  let id = str(b.id, 40) || name.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '').toLowerCase().slice(0, 40);
  if (!/^[A-Za-z0-9_]{1,40}$/.test(id)) throw new AdminError('ID da quest inválido (letras, números e _).');
  const need = (Array.isArray(b.need) ? (b.need as Raw[]) : []).map((g) => {
    const item = str(g.item, 80);
    if (!c.bySymbol.has(item)) throw new AdminError(`O item "${item}" não existe (use o símbolo II_…, a busca ajuda).`);
    return { item, count: int(g.count, 1, 1, 9999) };
  });
  const kill = Array.isArray(old?.kill) ? (old!.kill as unknown[]) : [];
  if (!need.length && !kill.length) throw new AdminError('Peça pelo menos um item.');
  const drops = (Array.isArray(b.drops) ? (b.drops as Raw[]) : []).map((g) => {
    const item = str(g.item, 80), mob = str(g.mob, 60) || '*';
    if (!c.bySymbol.has(item)) throw new AdminError(`Item do farm "${item}" não existe.`);
    if (mob !== '*' && !c.defines.has(mob)) throw new AdminError(`O monstro "${mob}" não existe (use o símbolo MI_… ou *).`);
    return { item, mob, chance: Math.min(100, Math.max(0, Number(g.chance) || 100)), ...(str(g.world, 40) ? { world: str(g.world, 40) } : {}), ...(g.near && typeof g.near === 'object' && str((g.near as Raw).point, 40) ? { near: { point: str((g.near as Raw).point, 40), radius: int((g.near as Raw).radius, 60, 1, 5000) } } : {}) };
  });
  const r = (b.reward ?? {}) as Raw;
  const reward: Raw = { ...((old?.reward as Raw) ?? {}), exp: int(r.exp, 0, 0, 1e9), penya: int(r.penya, 0, 0, 1e9) };
  if (str(r.teleportWorld, 40)) reward.teleport = { world: str(r.teleportWorld, 40), ...(str(r.teleportPoint, 40) ? { point: str(r.teleportPoint, 40) } : {}) }; else delete reward.teleport;
  if (str(r.event, 40)) reward.event = str(r.event, 40); else delete reward.event;
  const party = b.partyMin !== undefined && int(b.partyMin, 0, 0, 8) >= 2 ? { min: int(b.partyMin, 2, 2, 8), leaderOnly: b.leaderOnly !== false } : undefined;
  const out: Raw = {
    ...(old ?? {}), id, enabled: b.enabled !== false, name, npc, minLevel: int(b.minLevel, 1, 1, 999), repeatable: !!b.repeatable,
    text: { offer: str(b.offer, 1500), progress: str(b.progress, 800), done: str(b.done, 800) },
    need, drops, reward,
  };
  if (party) out.party = party; else delete out.party;
  if (!drops.length) delete out.drops;
  return out;
}

const mapsWithNpcs = (): string[] => {
  const out = new Set<string>();
  for (const root of [path.join(RES_DIR, 'World'), path.join(EXTRA_DIR, 'World')]) {
    try { for (const n of fs.readdirSync(root)) if (/^[A-Za-z0-9_]+$/.test(n) && (fs.existsSync(path.join(root, n, `${n}.dyo`)) || fs.existsSync(path.join(root, n, 'l2world.json')))) out.add(n); } catch { /* pasta ausente */ }
  }
  return [...out].sort();
};

/** NPCs de um mapa (o .dyo original com as edições do editor), com nome e posição */
function npcsOf(world: string, q: string, limit = 400) {
  const names = nameTable()?.npcs ?? {};
  let dyo: ReturnType<typeof parseDyo> = [];
  for (const root of [path.join(RES_DIR, 'World'), path.join(EXTRA_DIR, 'World')]) {
    const f = path.join(root, world, `${world}.dyo`);
    if (fs.existsSync(f)) { try { const b = fs.readFileSync(f); dyo = parseDyo(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer); } catch { /* .dyo de outro formato: fica só com os NPCs do editor */ } break; }
  }
  const all = applyNpcEdits(dyo, loadEdits(world).npcs).filter((o) => o.characterKey);
  return all
    .map((o) => ({ map: world, key: o.characterKey!.trim(), name: names[o.characterKey!.trim().toLowerCase()] || o.name || '', x: Math.round(o.pos[0]), y: Math.round(o.pos[1]), z: Math.round(o.pos[2]) }))
    .filter((n) => !q || `${n.key} ${n.name}`.toLowerCase().includes(q))
    .sort((a, b) => a.key.localeCompare(b.key))
    .slice(0, limit);
}

export async function questsApi(p: string, m: string, url: URL, readJson: () => Promise<Record<string, unknown>>, send: (status: number, body: unknown) => void): Promise<boolean> {
  if (p === '/quests' && m === 'GET') { send(200, reply()); return true; }
  if (p === '/quests' && m === 'PUT') {
    const b = await readJson();
    const list = readFileQuests();
    const was = str(b.originalId, 40);
    const at = list.findIndex((q) => q.id === (was || str(b.id, 40)));
    const q = build(b, at >= 0 ? list[at] : undefined);
    const dup = list.findIndex((x) => x.id === q.id);
    if (dup >= 0 && dup !== at) throw new AdminError(`Já existe uma quest com o ID "${String(q.id)}".`);
    if (at >= 0) list[at] = q; else list.push(q);
    writeFileQuests(list);
    send(200, reply());
    return true;
  }
  if (p === '/quests/delete' && m === 'POST') {
    const id = str((await readJson()).id, 40);
    writeFileQuests(readFileQuests().filter((q) => q.id !== id));
    send(200, reply());
    return true;
  }
  // achar o ID (characterKey) dos NPCs: os de um mapa (com a posição) ou todos os do jogo (para pôr no mapa pelo editor)
  if (p === '/npcs' && m === 'GET') {
    const q = (url.searchParams.get('q') ?? '').trim().toLowerCase();
    const world = url.searchParams.get('world') ?? '';
    if (world === 'all') {
      const list = mapsWithNpcs().flatMap((w) => npcsOf(w, q, 5000)).sort((a, b) => a.key.localeCompare(b.key) || a.map.localeCompare(b.map));
      send(200, { maps: mapsWithNpcs(), total: list.length, list: list.slice(0, 3000) });
      return true;
    }
    if (world && world !== '*') {
      if (!mapsWithNpcs().includes(world)) throw new AdminError('Mapa desconhecido.');
      send(200, { maps: mapsWithNpcs(), list: npcsOf(world, q, 3000) });
      return true;
    }
    const names = nameTable()?.npcs ?? {};
    send(200, { maps: mapsWithNpcs(), list: Object.entries(names).filter(([k, n]) => !q || `${k} ${n}`.toLowerCase().includes(q)).sort(([a], [b]) => a.localeCompare(b)).slice(0, 3000).map(([key, name]) => ({ key, name })) });
    return true;
  }
  return false;
}
