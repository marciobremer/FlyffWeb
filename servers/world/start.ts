import type http from 'node:http';
import { RES_DIR, WORLD } from '../common/config';
import { ServerWorld } from './world';
import { ItemCatalog } from '../common/items';
import { Inventory } from '../character/inventory';
import { setCharacterInventory } from '../character/http';
import { CombatRules } from './combat';
import { DropRules } from './drops';
import { ShopCatalog } from './shops';
import { SkillCatalog } from './skills';
import { MobWorld } from './mobs';
import { attachRealtime, type RealtimeOptions, type WorldRuntime } from './realtime';

/** mundos extras que o servidor também carrega (id WI_WORLD_*, define e ponto de chegada do ticket.inc) */
const EXTRA_WORLDS: Record<string, { id: number; define: string; start: [number, number, number] }> = {
  WdKebaras: { id: 2, define: 'WI_WORLD_KEBARAS', start: [1271, 114, 1326] }, // Azria
};

/**
 * Liga um mundo (um mapa) num servidor HTTP: mobs, regras de combate/drops/lojas/skills, inventário em memória e o
 * WebSocket `/ws`. É o que o `servers/main.ts` faz dentro do processo único e o que `servers/world/main.ts` faz num
 * processo só do mapa. `session` troca a conferência do token de login (processo separado não enxerga a memória do Auth).
 */
export function startWorld(server: http.Server, world = WORLD, extra: Pick<RealtimeOptions, 'resolveSession'> = {}) {
  const sw = new ServerWorld(RES_DIR, world).load();
  const mobs = new MobWorld(sw);
  console.log(`Mundo ${world}: ${mobs.mobs.length} mobs em ${sw.respawns.length} respawns`);
  const items = new ItemCatalog(RES_DIR).load();
  console.log(`Itens: ${items.byId.size} no catálogo`);
  const inventory = new Inventory(items);
  setCharacterInventory(inventory); // a lista de personagens (login) leva o equipamento para a prévia da seleção
  // Azria e os outros mapas extras: mobs e NPCs próprios (EXTRA_WORLDS=WdKebaras,… ou vazio para nenhum)
  const extraWorlds: WorldRuntime[] = [];
  for (const name of (process.env.EXTRA_WORLDS ?? 'WdKebaras').split(',').map((s) => s.trim()).filter(Boolean)) {
    const info = EXTRA_WORLDS[name];
    if (!info || name === world) continue;
    try {
      const xw = new ServerWorld(RES_DIR, name).load();
      const xm = new MobWorld(xw);
      console.log(`Mundo ${name}: ${xm.mobs.length} mobs em ${xw.respawns.length} respawns`);
      extraWorlds.push({ name, ...info, mobs: xm, shops: new ShopCatalog(RES_DIR, items, name) });
    } catch (e) { console.warn(`Mundo ${name} não carregou:`, (e as Error).message); }
  }
  return attachRealtime(server, {
    mainWorld: world, worlds: extraWorlds,
    mobs, inventory, combat: new CombatRules(RES_DIR, items), drops: new DropRules(RES_DIR, items),
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
