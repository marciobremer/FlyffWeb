import { defineConfig, type Plugin } from 'vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resourceMiddleware } from './servers/common/resources';
import { setCharacterInventory } from './servers/character/http';
import { RES_DIR, RES_ROOTS, pageAlias } from './servers/common/config';
import { apiMiddleware } from './servers/api';
import { attachRealtime } from './servers/world/realtime';
import { ServerWorld } from './servers/world/world';
import { MobWorld } from './servers/world/mobs';
import { ItemCatalog } from './servers/common/items';
import { Inventory } from './servers/character/inventory';
import { CombatRules } from './servers/world/combat';
import { DropRules } from './servers/world/drops';
import { ShopCatalog } from './servers/world/shops';
import { SkillCatalog } from './servers/world/skills';

const here = path.dirname(fileURLToPath(import.meta.url));
// Serve a pasta Resource do FlyFF (original/Resource) em /res/* (somente leitura) e uma listagem em /api/list?dir=...

function resourcePlugin(): Plugin {
  return {
    name: 'flyff-resource',
    configureServer(server) {
      // /game/ → client/ (a pasta do cliente), como no servidor do jogo
      server.middlewares.use((req, _res, next) => {
        const u = req.url ?? '/';
        const q = u.indexOf('?'), p = q < 0 ? u : u.slice(0, q);
        const a = pageAlias(p);
        if (a !== p) req.url = a + (q < 0 ? '' : u.slice(q));
        next();
      });
      server.middlewares.use(apiMiddleware()); // /api/login, /api/session, /api/logout (PostgreSQL)
      server.middlewares.use(resourceMiddleware(RES_ROOTS));
      // WebSocket /ws (multiplayer) com os mobs simulados no servidor
      if (server.httpServer) {
        const items = new ItemCatalog(RES_DIR).load();
        const inventory = new Inventory(items);
        setCharacterInventory(inventory);
        attachRealtime(server.httpServer as import('node:http').Server, { mobs: new MobWorld(new ServerWorld(RES_DIR, 'WdMadrigal').load()), inventory, combat: new CombatRules(RES_DIR, items), drops: new DropRules(RES_DIR, items), shops: new ShopCatalog(RES_DIR, items), skills: new SkillCatalog(RES_DIR, items) });
      }
    },
  };
}

// host: true → escuta em todas as interfaces, para outros PCs da rede local abrirem http://<ip-deste-pc>:5173
// páginas: / (início), /editor/ (editor de mapa), /game/ (cliente do jogo)
export default defineConfig({
  plugins: [resourcePlugin()],
  // original/ (Resource, Source…) tem dezenas de milhares de arquivos: fora da vigilância do Vite
  server: { port: 5173, host: true, watch: { ignored: ['**/original/**', '**/htdocs/**', '**/dist/**', '**/_backup_antes_fase1/**'] } },
  build: {
    rollupOptions: {
      input: {
        index: path.resolve(here, 'index.html'),
        editor: path.resolve(here, 'editor/index.html'),
        game: path.resolve(here, 'client/index.html'),
      },
    },
  },
});
