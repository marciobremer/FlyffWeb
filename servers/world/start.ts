import type http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { EXTRA_DIR, RES_DIR, WORLD } from '../common/config';
import { ServerWorld } from './world';
import { ItemCatalog } from '../common/items';
import { Inventory } from '../character/inventory';
import { setCharacterInventory } from '../character/http';
import { CombatRules } from './combat';
import { DropRules } from './drops';
import { ShopCatalog } from './shops';
import { SkillCatalog } from './skills';
import { MobWorld } from './mobs';
import { attachRealtime, type Portal, type RealtimeOptions, type WorldRuntime } from './realtime';
import { instanceRules, worldTable, type WorldInfo } from './dungeons';
import { startRustEngine } from './rustproc';

/** mundos extras que o servidor também carrega (id WI_WORLD_*, define e ponto de chegada do ticket.inc) */
const EXTRA_WORLDS: Record<string, { id: number; define: string; start: [number, number, number] }> = {
  WdKebaras: { id: 2, define: 'WI_WORLD_KEBARAS', start: [1271, 114, 1326] }, // Azria
  WdCisland: { id: 3, define: 'WI_WORLD_CISLAND', start: [2002, 120, 855] }, // Coral Island
  WdRartesia: { id: 4, define: 'WI_WORLD_RARTESIA', start: [1400, 120, 1287] }, // Traseia
  WdDarkRartesia: { id: 5, define: 'WI_WORLD_DARKRARTESIA', start: [1400, 120, 1287] }, // Dark Traseia
};

/**
 * Mapas do projeto (não existem na Resource do FlyFF): `data/res-extra/World/<nome>/l2world.json` = `{ id, define, start }`, ao lado do
 * `<nome>.wld`. Gerados por `npm run l2world` (ver tools/cruma/README.md). O `id` precisa ser único (use 100 ou mais).
 */
function projectWorlds(): Record<string, { id: number; define: string; start: [number, number, number] }> {
  const out: Record<string, { id: number; define: string; start: [number, number, number] }> = {};
  const root = path.join(EXTRA_DIR, 'World');
  let names: string[] = [];
  try { names = fs.readdirSync(root); } catch { return out; }
  for (const name of names) {
    try {
      const j = JSON.parse(fs.readFileSync(path.join(root, name, 'l2world.json'), 'utf8')) as { id?: number; define?: string; start?: number[] };
      if (!Number.isInteger(j.id) || typeof j.define !== 'string' || !Array.isArray(j.start) || j.start.length !== 3) continue;
      out[name] = { id: j.id!, define: j.define, start: [j.start[0], j.start[1], j.start[2]] };
    } catch { /* pasta sem l2world.json */ }
  }
  return out;
}

/**
 * Liga um mundo (um mapa) num servidor HTTP: mobs, regras de combate/drops/lojas/skills, inventário em memória e o
 * WebSocket `/ws`. É o que o `servers/main.ts` faz dentro do processo único e o que `servers/world/main.ts` faz num
 * processo só do mapa. `session` troca a conferência do token de login (processo separado não enxerga a memória do Auth).
 */
export function startWorld(server: http.Server, world = WORLD, extra: Pick<RealtimeOptions, 'resolveSession'> = {}) {
  startRustEngine(world); // GAME_ENGINE=rust: sobe o game-server (ou volta para o Node se faltar algo)
  const sw = new ServerWorld(RES_DIR, world).load();
  const mobs = new MobWorld(sw);
  console.log(`Mundo ${world}: ${mobs.mobs.length} mobs em ${sw.respawns.length} respawns`);
  const items = new ItemCatalog(RES_DIR).load();
  console.log(`Itens: ${items.byId.size} no catálogo`);
  const inventory = new Inventory(items);
  const combat = new CombatRules(RES_DIR, items);
  // velocidade base dos personagens: fSpeed do propMover de MI_MALE / MI_FEMALE
  const fs = (sym: string) => { const id = items.defines.get(sym); return id === undefined ? 0 : sw.moverSpeed.get(id) ?? 0; };
  combat.playerFSpeed = [fs('MI_MALE') || 0.1, fs('MI_FEMALE') || fs('MI_MALE') || 0.1];
  console.log(`Velocidade dos personagens (fSpeed): ${combat.playerFSpeed.join(' / ')}`);
  setCharacterInventory(inventory); // a lista de personagens (login) leva o equipamento para a prévia da seleção
  // Azria e os outros mapas extras: mobs e NPCs próprios (EXTRA_WORLDS=WdKebaras,WdCisland,WdRartesia,WdDarkRartesia — o padrão; vazio para nenhum)
  const extraWorlds: WorldRuntime[] = [];
  const pre = new Map<string, ServerWorld>();
  const mine = projectWorlds();
  for (const name of (process.env.EXTRA_WORLDS ?? ['WdKebaras', 'WdCisland', 'WdRartesia', 'WdDarkRartesia', ...Object.keys(mine)].join(',')).split(',').map((s) => s.trim()).filter(Boolean)) {
    const info = EXTRA_WORLDS[name] ?? mine[name];
    if (!info || name === world) continue;
    try {
      const xw = new ServerWorld(RES_DIR, name).load();
      pre.set(name, xw);
      const xm = new MobWorld(xw);
      console.log(`Mundo ${name}: ${xm.mobs.length} mobs em ${xw.respawns.length} respawns`);
      extraWorlds.push({ name, ...info, mobs: xm, shops: new ShopCatalog(RES_DIR, items, name) });
    } catch (e) { console.warn(`Mundo ${name} não carregou:`, (e as Error).message); }
  }
  // dungeons: as portas são as regiões com teleportWorld dos .rgn; o mapa de destino carrega na primeira vez que alguém entra
  const table = worldTable(RES_DIR), rules = instanceRules(RES_DIR);
  const swCache = new Map<string, ServerWorld>(pre);
  const swOf = (name: string) => { let w = swCache.get(name); if (!w) { w = new ServerWorld(RES_DIR, name).load(); swCache.set(name, w); } return w; };
  const portalsOf = (sw: ServerWorld): Portal[] => sw.regions.filter((g) => g.teleportWorld > 0).flatMap((g) => { const t = table.byId.get(g.teleportWorld); return t ? [{ rect: g.rect, define: t.define, pos: g.teleportPos }] : []; });
  const runtimeOf = (info: WorldInfo, key = info.name): WorldRuntime => {
    const xw = swOf(info.name), portals = portalsOf(xw);
    return { name: key, base: info.name, id: info.id, define: info.define, mobs: new MobWorld(xw), shops: new ShopCatalog(RES_DIR, items, info.name), start: portals[0] ? [...portals[0].pos] : [0, 100, 0], portals };
  };
  swCache.set(world, sw);
  for (const w of extraWorlds) { const xs = swCache.get(w.name); if (xs) w.portals = portalsOf(xs); }
  const loadWorld = (define: string): WorldRuntime | null => {
    const info = table.byDefine.get(define);
    if (!info) return null;
    try { const wr = runtimeOf(info); console.log(`Mundo ${info.name}: ${wr.mobs?.mobs.length ?? 0} mobs (carregado ao entrar)`); return wr; }
    catch (e) { console.warn(`Mundo ${info.name} não carregou:`, (e as Error).message); return null; }
  };
  /** cópia de dungeon de uma party: mobs do .rgn + os monstros do PartyDungeon.lua (SetMonster) */
  const loadInstance = (define: string, key: string): WorldRuntime | null => {
    const info = table.byDefine.get(define);
    if (!info) return null;
    try {
      const wr = runtimeOf(info, key);
      for (const m of rules.get(define)?.monsters ?? []) {
        const id = items.defines.get(m.mover);
        if (id === undefined || !wr.mobs) continue;
        if (wr.mobs.summon(id, m.pos[0], m.pos[2], m.pos[1], 1)) { const mob = wr.mobs.mobs[wr.mobs.mobs.length - 1]; if (m.aggressive) mob.aggressive = true; }
      }
      console.log(`Dungeon ${key}: criada (${wr.mobs?.mobs.length ?? 0} mobs)`);
      return wr;
    } catch (e) { console.warn(`Dungeon ${key} não carregou:`, (e as Error).message); return null; }
  };
  return attachRealtime(server, {
    mainPortals: portalsOf(sw), loadWorld, loadInstance, worldInfo: (k) => (typeof k === 'number' ? table.byId.get(k) : table.byDefine.get(k)), instanceRules: rules,
    worldByName: (n) => [...table.byDefine.values()].find((w) => w.name.toLowerCase() === n.toLowerCase()),
    mainWorld: world, worlds: extraWorlds,
    mobs, inventory, combat, drops: new DropRules(RES_DIR, items),
    shops: new ShopCatalog(RES_DIR, items, world), skills: new SkillCatalog(RES_DIR, items), ...extra,
  });
}

/** Ctrl+C / kill: grava tudo antes de sair (no Windows o painel usa /internal/shutdown) */
export function saveOnSignals(realtime: ReturnType<typeof attachRealtime>) {
  let closing = false;
  for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => {
    if (closing) return;
    closing = true;
    console.log(`${sig}: gravando personagens e saindo…`);
    realtime.shutdown().catch((e) => console.error('desligar:', e)).finally(() => process.exit(0));
  });
}
