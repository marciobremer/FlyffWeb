# Graph Report - FlyffWeb  (2026-10-26)

## Corpus Check
- 249 files · ~240,202 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 20 file(s) not represented in the graph (top: (none) 7, .css 5, .bat 3)

## Summary
- 2653 nodes · 6212 edges · 136 communities (84 shown, 52 thin omitted)
- Extraction: 94% EXTRACTED · 6% INFERRED · 0% AMBIGUOUS · INFERRED: 387 edges (avg confidence: 0.87)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `59cfbebd`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- client/main.ts
- sfxRuntime.ts
- Player
- admin/index.ts
- data.ts
- inventory.ts
- editor/main.ts
- humans.ts
- NetClient
- package.json
- movers.ts
- htdocs/package.json
- mssql-pg.js
- servers/main.ts
- realtime.ts
- connectToDatabase
- cashshop-payments.js
- MobWorld
- bindUi
- gameAccount.js
- items.ts
- tga.ts
- auth/http.ts
- start.ts
- net.ts
- app
- WorldEditor
- CombatRules
- MoverManager
- WorldView
- .raw
- client/party.ts
- ActionBar
- .load
- next
- Combat
- paypal-ranking.js
- enter
- NpcEditor
- lucide-react
- attachRealtime
- gmpanel.ts
- terrain.ts
- GmPanel
- ANALYSIS.md — Passo 1: análise do ATools e do mapa WdMadrigal
- api
- ui.ts
- InventoryWindow
- NEXT_STEPS.md — contexto e próximos passos (para o Opus 5.5)
- FriendsWindow
- RemotePlayers
- 3. Restaurar no Windows (sem Docker)
- FlyFF Web Port – World Editor (WebGL / Three.js)
- collision.ts
- admin.js
- drops.ts
- query
- SkillWindow
- react
- ranking/page.js
- topup/[id]/route.js
- import-flyff.ts
- GameWindow
- charwnd.ts
- .open
- world/combat.ts
- emailUtils.js
- vercel.json
- client/teleport.ts
- TradeWindow
- admin/paypal-ranking/page.js
- shops/page.js
- react-data-table-component
- dds.ts
- GameProcess
- runGmCommand
- BuffBar
- ShopWindow
- FlyFF Web (editor de mapa + cliente do jogo)
- motionOf
- .updateFly
- compilerOptions
- GuildWindow
- 7. Fase 1 do jogo multiplayer — reorganização (CONCLUÍDA em 2026-10-17)
- api.ts
- .loadTile
- probe_o3d.py
- GameAudio
- skillFx
- scripts
- ItemCatalog
- session-start.sh
- next-auth
- 008_legacy_views.sql
- NpcMenu
- vote-pingback/route.js
- WaterSystem
- Announcer
- .onReset
- VersionWatcher
- topup/route.js
- Admin role
- characters
- rideToggle
- compilerOptions
- next.config.js
- postcss.config.mjs
- TargetWindow
- game-process.ts
- 007_website.sql
- shared/world.ts
- SkillCatalog
- SiteProcess
- MotionWindow
- JobWindow
- playerClick
- create_topup_items_table.sql
- 012_website_shop.sql
- create_topup_requests_table.sql
- react-toastify
- app/paypal-ranking/page.js
- middleware.js
- 35. Buffs e magias (2026-10-23)
- 4. Ossos do personagem

## God Nodes (most connected - your core abstractions)
1. `WorldView` - 95 edges
2. `NetClient` - 94 edges
3. `attachRealtime()` - 82 edges
4. `connectToDatabase()` - 58 edges
5. `next` - 57 edges
6. `MoverInstance` - 50 edges
7. `GameWindow` - 42 edges
8. `Inventory` - 42 edges
9. `CombatRules` - 40 edges
10. `MoverManager` - 40 edges

## Surprising Connections (you probably didn't know these)
- `16. Inventário, barra de atalhos e chat (2026-10-18)` --references--> `GameWindow`  [INFERRED]
  NEXT_STEPS.md → client/ui.ts
- `Passo 1 – Análise do código-fonte do World Editor (ATUAL)` --references--> `WorldEditor`  [INFERRED]
  docs/README-inicial.md → editor/editor.ts
- `7. Proposta de arquitetura (Passo 2)` --references--> `Landscape`  [INFERRED]
  docs/ANALYSIS.md → shared/formats/lnd.ts
- `3. Pontos que exigem atenção (aprendidos na prática)` --references--> `objectMatrix()`  [INFERRED]
  NEXT_STEPS.md → shared/math.ts
- `11. Ajustes visuais (2026-10-17)` --references--> `keyedImage()`  [INFERRED]
  NEXT_STEPS.md → shared/tga.ts

## Import Cycles
- None detected.

## Communities (136 total, 52 thin omitted)

### Community 0 - "client/main.ts"
Cohesion: 0.03
Nodes (75): Account, actionBar, announcer, api(), audio, backToLogin(), boot, bootEl (+67 more)

### Community 1 - "sfxRuntime.ts"
Cohesion: 0.06
Nodes (45): PreviewSfx, parseSfx(), sampleKey(), Sfx, SfxAlphaType, Blend, Glow, SfxBillType (+37 more)

### Community 3 - "admin/index.ts"
Cohesion: 0.13
Nodes (18): ann, ANN_FILE, AnnLoop, bootedAt, game, PUBLIC, send(), server (+10 more)

### Community 4 - "data.ts"
Cohesion: 0.07
Nodes (43): MotionEntry, DEFINE_FILES, ServerWorld, DEFINE_FILES, fetchBuf(), fetchList(), WorldData, parseDyo() (+35 more)

### Community 5 - "inventory.ts"
Cohesion: 0.08
Nodes (20): BAG, BAG_SLOTS, baseJob(), Cached, Ctx, dualWieldable(), EQUIP, Inventory (+12 more)

### Community 6 - "editor/main.ts"
Cohesion: 0.11
Nodes (26): applyOverlayVisibility(), buildOverlays(), buildPlaces(), checked(), clearOverlays(), envFromPanel(), filterFromPanel(), filterLabels() (+18 more)

### Community 7 - "humans.ts"
Cohesion: 0.06
Nodes (40): InventoryPreview, Remote, applyEnchantGlow(), BLUE, drawSize, ELEMENT_COLOR, Emitter, EnchantGlow (+32 more)

### Community 9 - "package.json"
Cohesion: 0.05
Nodes (45): dependencies, fflate@^0.8.3, pg@^8.23.1, three@^0.170.0, ws@^8.22.0, devDependencies, tsx@^4.23.15, @types/node@^22.20.5 (+37 more)

### Community 10 - "movers.ts"
Cohesion: 0.07
Nodes (32): Bone, Motion, MotionFrame, parseAni(), parseChr(), R, Skeleton, O3dPart (+24 more)

### Community 11 - "htdocs/package.json"
Cohesion: 0.07
Nodes (41): dependencies, bcrypt@^6.0.0, critters@^0.0.23, crypto-js@^4.2.0, framer-motion@^12.9.4, lucide-react@^0.507.0, msnodesqlv8@^4.5.0, mssql@^11.0.1 (+33 more)

### Community 12 - "mssql-pg.js"
Cohesion: 0.07
Nodes (22): bindParams(), caseMap(), cfg, closeParen(), DB_SCHEMA, FORMAT_TOKENS, getPgPool(), getPool() (+14 more)

### Community 13 - "servers/main.ts"
Cohesion: 0.09
Nodes (30): 27. Reorganização das pastas — fase 1 (2026-10-23), 28. O site (htdocs) em http://localhost:8080 (2026-10-23), setCharacterInventory(), ADMIN_PORT, ANNOUNCE_MAX, DIST, GAME_PORT, pageAlias() (+22 more)

### Community 14 - "realtime.ts"
Cohesion: 0.09
Nodes (19): INVENTORY_CHANNEL, InvState, TRADE_SLOTS, TradeOffer, EXP_TABLE, MAX_PARTYLEVEL, Party, PARTY_MAX (+11 more)

### Community 15 - "connectToDatabase"
Cohesion: 0.09
Nodes (22): dynamic, GET(), DELETE(), PUT(), GET(), POST(), POST(), rateLimitStore (+14 more)

### Community 16 - "cashshop-payments.js"
Cohesion: 0.15
Nodes (33): dynamic, POST(), runtime, dynamic, POST(), runtime, dynamic, POST() (+25 more)

### Community 17 - "MobWorld"
Cohesion: 0.12
Nodes (9): cellOf(), CORPSE_MS, isBoss(), Mob, MOB_ATTACK_RANGE, MobHooks, MobState, MobWorld (+1 more)

### Community 18 - "bindUi"
Cohesion: 0.14
Nodes (18): download(), bindUi(), doExport(), editor, envInfo(), openWorld(), putEdits(), renderNpcList() (+10 more)

### Community 19 - "gameAccount.js"
Cohesion: 0.13
Nodes (27): cookie@^1.0.2, dynamic, GET(), POST(), POST(), GET(), dynamic, GET() (+19 more)

### Community 20 - "items.ts"
Cohesion: 0.12
Nodes (24): EXTRA_DIR, DEFINE_FILES, PAIR, SetDef, SPEC_COLUMNS, nameTable, DIR, editsMtime() (+16 more)

### Community 21 - "tga.ts"
Cohesion: 0.16
Nodes (13): MenuItem, StatusInfo, 9. Tela de login (2026-10-17), decodeDxt(), TargetInfo, decodeTga(), iconImage(), icons (+5 more)

### Community 22 - "auth/http.ts"
Cohesion: 0.17
Nodes (24): 13. Painel admin (2026-10-18), authRoute(), failures, hashToken(), login(), loginRemembered(), startSession(), LEGACY_SALT (+16 more)

### Community 23 - "start.ts"
Cohesion: 0.13
Nodes (13): 31. Editor: mover/adicionar/remover NPCs e salvar o Ambiente (2026-10-23), Session, WORLD, PORT, realtime, server, RealtimeOptions, WorldRuntime (+5 more)

### Community 24 - "net.ts"
Cohesion: 0.13
Nodes (14): QueuedSkill, three, ModelEntry, modelFileName(), getPlaceholderGeometry(), ModelLibrary, ModelPart, placeholderGeo (+6 more)

### Community 25 - "app"
Cohesion: 0.06
Nodes (30): build, depends_on, environment, ports, restart, volumes, condition, environment (+22 more)

### Community 26 - "WorldEditor"
Cohesion: 0.12
Nodes (5): EditContext, WorldEditor, fmt(), pick(), 5. Próximos passos sugeridos (ordem de valor)

### Community 27 - "CombatRules"
Cohesion: 0.14
Nodes (3): CombatRules, rand(), MoverProp

### Community 31 - "client/party.ts"
Cohesion: 0.11
Nodes (10): icon(), PartyListRow, PartyListWindow, PartyMember, partyTime(), PartyView, PartyWindow, SKILLS (+2 more)

### Community 32 - "ActionBar"
Cohesion: 0.11
Nodes (3): ActionBar, ChatWindow, 24. Poções/comidas e barra de atalhos (2026-10-18)

### Community 34 - "next"
Cohesion: 0.13
Nodes (11): dynamic, geistMono, geistSans, metadata, RootLayout(), NewsDetailPage(), ClientLayout(), Navbar() (+3 more)

### Community 36 - "paypal-ranking.js"
Cohesion: 0.17
Nodes (23): dynamic, POST(), runtime, dynamic, GET(), runtime, dynamic, GET() (+15 more)

### Community 37 - "enter"
Cohesion: 0.13
Nodes (12): GameHud, provisionalMax(), enter(), hideMaskOf(), openWorld(), renderSlots(), saySelect, showPreview() (+4 more)

### Community 38 - "NpcEditor"
Cohesion: 0.15
Nodes (3): applyQuality(), NpcEditor, WithSrc

### Community 39 - "lucide-react"
Cohesion: 0.12
Nodes (5): sweetalert2@^11.6.13, UserPanelPage(), DashboardCards(), lucide-react, sweetalert2

### Community 40 - "attachRealtime"
Cohesion: 0.07
Nodes (59): rates, partyExpShares(), attachRealtime(), addExp(), autosave(), buffsMsg(), castSkill(), changeJob() (+51 more)

### Community 41 - "gmpanel.ts"
Cohesion: 0.12
Nodes (22): ELEMENT_KEYS, JOBS, KINDS, box(), DST, EXPUP_ARMOR, EXPUP_WEAPON, fxText() (+14 more)

### Community 42 - "terrain.ts"
Cohesion: 0.13
Nodes (17): allPatches, ATTR_COLORS, baseAttributes(), buildTerrain(), buildVertexColorMesh(), ColorMode, disposeTerrain(), fillColors() (+9 more)

### Community 43 - "GmPanel"
Cohesion: 0.23
Nodes (6): btn(), el(), field(), GmPanel, num(), select()

### Community 44 - "ANALYSIS.md — Passo 1: análise do ATools e do mapa WdMadrigal"
Cohesion: 0.09
Nodes (22): 0. Divergências em relação ao README (corrigir antes do Passo 2), 10. Efeitos .sfx (Sfx.cpp / SfxModel.cpp) — validado nos 1.567 arquivos de Data/SFX (0 bytes sobrando), 1. Arquivos de um mundo (`Resource/World/WdMadrigal`), 2.1 `.wld` (texto), 2.2 `.lnd` (validado nos 900 arquivos: 0 desalinhamentos, `offset final == tamanho`), 2.3 Objeto (usado em `.lnd` e `.dyo`)  — `CObject::CreateObject(file)` + `CObject::Read`, 2.4 Matriz de transformação (Object.cpp `_updateMatrix`), 2.5 `.dyo` (+14 more)

### Community 45 - "api"
Cohesion: 0.22
Nodes (16): annState(), annTick(), api(), readJson(), saveAnn(), AccountRow, banAccount(), createAccount() (+8 more)

### Community 46 - "ui.ts"
Cohesion: 0.13
Nodes (18): ItemView, DragItem, ShopView, TradeItem, TradeSide, TradeView, BarItem, ELEMENT_NAMES (+10 more)

### Community 47 - "InventoryWindow"
Cohesion: 0.13
Nodes (4): setTipLookup(), InventoryWindow, keyOf(), hideBit()

### Community 48 - "NEXT_STEPS.md — contexto e próximos passos (para o Opus 5.5)"
Cohesion: 0.09
Nodes (19): 11. Ajustes visuais (2026-10-17), 12. Fase 2 — multiplayer: jogadores se vendo (2026-10-17), 16. Inventário, barra de atalhos e chat (2026-10-18), 18. Comandos de GM no chat (2026-10-18), 19. Postura de combate por arma e classe (2026-10-18), 1. Como rodar, 21. Combate contra mobs — v1 (2026-10-18), 22. Drops: itens e penya no chão (2026-10-18) (+11 more)

### Community 51 - "3. Restaurar no Windows (sem Docker)"
Cohesion: 0.10
Nodes (19): Ligar, O que é necessário para rodar, Observações, ReactioN MMO em Docker, 1. O que está (e o que NÃO está) neste repositório, 2. Programas necessários, 3.1 Baixar o projeto e colocar os arquivos do FlyFF, 3.2 Criar o banco no PostgreSQL (+11 more)

### Community 52 - "FlyFF Web Port – World Editor (WebGL / Three.js)"
Cohesion: 0.10
Nodes (19): Arquivos relacionados que também aparecem, Estrutura conhecida (baseada em engenharia reversa da comunidade + ATools):, Estrutura Esperada do Projeto, FlyFF Web Port – World Editor (WebGL / Three.js), Formato `.lnd` (Landscape) – Detalhado, Formato `.wld` (World), Formatos de Arquivo de Mundo (FlyFF), Instruções para o Claude Code (Passo a Passo) (+11 more)

### Community 53 - "collision.ts"
Cohesion: 0.13
Nodes (15): build(), cellKey(), CollisionWorld, e1, e2, heightOnTri(), pv, qv (+7 more)

### Community 54 - "admin.js"
Cohesion: 0.22
Nodes (17): acc, action(), annRender(), annSetSlot(), annSlots, api(), drawChart(), esc() (+9 more)

### Community 55 - "drops.ts"
Cohesion: 0.20
Nodes (8): Drop, DropRules, DropSet, DropTable, GROUND_MS, MonsterDrops, OWNER_MS, rand()

### Community 56 - "query"
Cohesion: 0.13
Nodes (19): notifyInventory(), cfg, dbCounters, pgpassLookup(), pool, query(), transaction(), askPassword() (+11 more)

### Community 57 - "SkillWindow"
Cohesion: 0.27
Nodes (3): runActionSlot(), SkillWindow, keyedImage()

### Community 58 - "react"
Cohesion: 0.16
Nodes (8): HomePage(), ACCENT_COLORS, Classes(), ROLE_TIPS, Footer(), ParticlesBackground(), ServerStats(), react

### Community 59 - "ranking/page.js"
Cohesion: 0.20
Nodes (13): createRequest(), dynamic, GET(), revalidate, jobFilters, RankingPage(), AccountLists(), formatPlayTime() (+5 more)

### Community 60 - "topup/[id]/route.js"
Cohesion: 0.18
Nodes (11): DELETE(), GET(), POST(), checkAdmin(), DELETE(), dynamic, getRouteId(), normalizePointType() (+3 more)

### Community 61 - "import-flyff.ts"
Cohesion: 0.14
Nodes (14): ACCOUNT_DB, accounts, args, blockDate(), CHAR_DB, characters, DRY, LegacyAccount (+6 more)

### Community 62 - "GameWindow"
Cohesion: 0.12
Nodes (9): friendRequestPrompt(), FriendView, GuildMember, GuildView, JOBS, TREE_BG, POSITIONS, SkillView (+1 more)

### Community 63 - "charwnd.ts"
Cohesion: 0.29
Nodes (6): CharacterWindow, imgBtn(), JOB_NAMES, Stat, STATS, PlayerStats

### Community 64 - ".open"
Cohesion: 0.14
Nodes (4): fetchRanking(), PostFx, defaultShadow(), ShadowSettings

### Community 65 - "world/combat.ts"
Cohesion: 0.21
Nodes (9): 30. Atributos, equipamentos e dica do item conforme o servidor original (2026-10-23), fitsPart(), ItemDef, Equipped, Fighter, HitResult, JobProp, Stats (+1 more)

### Community 66 - "emailUtils.js"
Cohesion: 0.27
Nodes (9): generateTemporaryPassword(), POST(), POST(), GET(), createTransporter(), generateVerificationToken(), sendTemporaryPasswordEmail(), sendVerificationEmail() (+1 more)

### Community 67 - "vercel.json"
Cohesion: 0.14
Nodes (13): buildCommand, builds, development, main, env, NEXT_PUBLIC_API_URL, git, deploymentEnabled (+5 more)

### Community 68 - "client/teleport.ts"
Cohesion: 0.29
Nodes (5): TeleportWindow, TYPE_NAME, parseTeleports(), TeleportDest, TeleportType

### Community 69 - "TradeWindow"
Cohesion: 0.20
Nodes (4): hideItemTip(), moveItemTip(), showItemTip(), TradeWindow

### Community 70 - "admin/paypal-ranking/page.js"
Cohesion: 0.29
Nodes (8): AdminPayPalRankingPage(), creditReward(), firstDayOfMonth(), formatAmount(), formatNumber(), rankBadge(), safeString(), todayInput()

### Community 71 - "shops/page.js"
Cohesion: 0.40
Nodes (11): formatPrice(), getImageUrl(), getPointBadgeClasses(), getPointLabel(), getPointType(), ItemMall(), captureOrder(), handleBuy() (+3 more)

### Community 72 - "react-data-table-component"
Cohesion: 0.16
Nodes (8): dayjs@^1.11.13, react-data-table-component@^7.7.0, GCashDonationsPage(), TableSkeleton(), TableSkeleton(), TradeLogsPage(), dayjs, react-data-table-component

### Community 73 - "dds.ts"
Cohesion: 0.11
Nodes (20): bitsOf(), ctz(), loadDds(), parseDds(), parser, computeEnvironment(), Environment, findContinent() (+12 more)

### Community 74 - "GameProcess"
Cohesion: 0.19
Nodes (5): GameProcess, autoStart(), onlineAccounts(), shutdown(), site

### Community 75 - "runGmCommand"
Cohesion: 0.15
Nodes (11): ELEMENT_NAMES, ELEMENTS, findTarget(), gmAuthority(), GmContext, GmTarget, HELP, isInt() (+3 more)

### Community 78 - "FlyFF Web (editor de mapa + cliente do jogo)"
Cohesion: 0.18
Nodes (10): Banco de dados (PostgreSQL `flyffweb`), Contas e login, Coordenadas, Estrutura, FlyFF Web (editor de mapa + cliente do jogo), Formato de exportação (`flyff-web-world` v1), Limitações conhecidas, O que faz (MVP) (+2 more)

### Community 79 - "motionOf"
Cohesion: 0.17
Nodes (9): 17. Itens no banco: inventário, equipados e penya (2026-10-18), BASE, motionOf(), motionsFor(), MotionState, nn(), getMotion(), motionReady() (+1 more)

### Community 81 - "compilerOptions"
Cohesion: 0.18
Nodes (10): compilerOptions, lib, module, moduleResolution, noEmit, skipLibCheck, strict, target (+2 more)

### Community 84 - "api.ts"
Cohesion: 0.15
Nodes (19): apiMiddleware(), entryCache, fromThisMachine(), gameEntry(), BootEntry, BootManifest, bootTotal(), dataVersion() (+11 more)

### Community 85 - ".loadTile"
Cohesion: 0.22
Nodes (4): 20. Painel de GM (2026-10-18), humanKey(), isHumanEntry(), key()

### Community 86 - "probe_o3d.py"
Cohesion: 0.24
Nodes (3): gm(), parse(), R

### Community 89 - "scripts"
Cohesion: 0.15
Nodes (12): devDependencies, javascript-obfuscator@^4.1.1, tailwindcss@^4, @tailwindcss/postcss@^4, scripts, build, dev, lint (+4 more)

### Community 92 - "next-auth"
Cohesion: 0.25
Nodes (3): next-auth@^4.24.11, handler, next-auth

### Community 93 - "008_legacy_views.sql"
Cohesion: 0.13
Nodes (19): account_tbl_detail_ins, account_tbl_detail_upd, account_tbl_ins, account_tbl_upd, legacy.account_tbl, legacy.account_tbl_detail, legacy.account_tbl_detail_write(), legacy.account_tbl_write() (+11 more)

### Community 95 - "vote-pingback/route.js"
Cohesion: 0.48
Nodes (6): ERROR_LOG_FILE, GET(), logPingbackAccess(), logPingbackError(), POST(), processEntry()

### Community 100 - "topup/route.js"
Cohesion: 0.53
Nodes (5): dynamic, GET(), getAdminUser(), normalizePointType(), POST()

### Community 101 - "Admin role"
Cohesion: 0.40
Nodes (4): Admin role, How it works, legionflyff, Set an admin user

### Community 102 - "characters"
Cohesion: 0.15
Nodes (17): accounts, accounts_username_lower, characters, characters_account, characters_account_slot, characters_name_lower, character_items, remember_tokens (+9 more)

### Community 111 - "game-process.ts"
Cohesion: 0.28
Nodes (4): GameStats, GameStatus, LogLine, SiteStatus

### Community 112 - "007_website.sql"
Cohesion: 0.17
Nodes (17): idx_topup_items_category, idx_vote_logs_account, idx_vote_logs_ip_address, idx_vote_logs_vote_time, ix_paypal_cashshop_orders_character_name, ix_topup_requests_created_at, ix_topup_requests_status, ix_topup_requests_streamer_code (+9 more)

### Community 113 - "shared/world.ts"
Cohesion: 0.08
Nodes (40): GroundRow, Item, InvMessage, PlayerView, Action, EditableTile, flip, Snap (+32 more)

### Community 132 - "middleware.js"
Cohesion: 0.67
Nodes (3): config, middleware(), validSession()

## Knowledge Gaps
- **9 isolated node(s):** `Bill`, `Particle`, `CustomMesh`, `Bill`, `Bottom` (+4 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 697 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **52 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `next` connect `next` to `emailUtils.js`, `paypal-ranking.js`, `topup/route.js`, `admin/paypal-ranking/page.js`, `lucide-react`, `middleware.js`, `htdocs/package.json`, `connectToDatabase`, `cashshop-payments.js`, `next-auth`, `gameAccount.js`, `react`, `ranking/page.js`, `topup/[id]/route.js`, `vote-pingback/route.js`?**
  _High betweenness centrality (0.111) - this node is a cross-community bridge._
- **Are the 2 inferred relationships involving `WorldView` (e.g. with `Estrutura` and `7. Fase 1 do jogo multiplayer — reorganização (CONCLUÍDA em 2026-10-17)`) actually correct?**
  _`WorldView` has 2 INFERRED edges - model-reasoned connections that need verification._
- **What connects `Bill`, `Particle`, `CustomMesh` to the rest of the system?**
  _9 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `client/main.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.032407407407407406 - nodes in this community are weakly interconnected._
- **Why does `WorldView` connect `WorldView` to `client/main.ts`, `sfxRuntime.ts`, `Player`, `data.ts`, `editor/main.ts`, `humans.ts`, `bindUi`, `net.ts`, `MoverManager`, `Combat`, `enter`, `NpcEditor`, `terrain.ts`, `RemotePlayers`, `.open`, `dds.ts`, `FlyFF Web (editor de mapa + cliente do jogo)`, `7. Fase 1 do jogo multiplayer — reorganização (CONCLUÍDA em 2026-10-17)`, `.loadTile`, `skillFx`, `TargetWindow`, `shared/world.ts`, `playerClick`?**
  _High betweenness centrality (0.104) - this node is a cross-community bridge._
- **Are the 3 inferred relationships involving `attachRealtime()` (e.g. with `.activeSkills()` and `.expNext()`) actually correct?**
  _`attachRealtime()` has 3 INFERRED edges - model-reasoned connections that need verification._
- **Should `sfxRuntime.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.06315789473684211 - nodes in this community are weakly interconnected._