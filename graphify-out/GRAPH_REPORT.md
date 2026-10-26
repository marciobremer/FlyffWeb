# Graph Report - Projeto_Atools  (2026-10-26)

## Corpus Check
- 249 files · ~240,474 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 21 file(s) not represented in the graph (top: (none) 8, .css 5, .bat 3)

## Summary
- 2654 nodes · 6216 edges · 131 communities (85 shown, 46 thin omitted)
- Extraction: 94% EXTRACTED · 6% INFERRED · 0% AMBIGUOUS · INFERRED: 390 edges (avg confidence: 0.87)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `9ab0b720`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- client/main.ts
- sfxRuntime.ts
- shared/worldedits.ts
- internal.ts
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
- PartyManager
- connectToDatabase
- cashshop-payments.js
- MobWorld
- bindUi
- gameAccount.js
- items.ts
- tga.ts
- auth/http.ts
- ShopCatalog
- net.ts
- app
- WorldEditor
- CombatRules
- MoverManager
- WorldView
- .raw
- client/party.ts
- ActionBar
- castSkill
- next
- Combat
- paypal-ranking.js
- enter
- NpcEditor
- lucide-react
- attachRealtime
- gmpanel.ts
- terrain.ts
- refreshFighter
- ANALYSIS.md — Passo 1: análise do ATools e do mapa WdMadrigal
- api
- ui.ts
- InventoryWindow
- saveCombat
- FriendsWindow
- RemotePlayers
- 3. Restaurar no Windows (sem Docker)
- ChatWindow
- collision.ts
- admin.js
- realtime.ts
- db/index.ts
- SkillWindow
- react
- ranking/page.js
- topup/[id]/route.js
- import-flyff.ts
- GameWindow
- charwnd.ts
- .frame
- test-persist.ts
- emailUtils.js
- vercel.json
- client/teleport.ts
- LookPiece
- admin/paypal-ranking/page.js
- shops/page.js
- react-data-table-component
- dds.ts
- admin/index.ts
- runGmCommand
- BuffBar
- FlyFF Web (editor de mapa + cliente do jogo)
- net.ts
- Player
- compilerOptions
- GuildWindow
- .open
- api.ts
- .constructor
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
- JobWindow
- playerClick
- create_topup_items_table.sql
- 012_website_shop.sql
- create_topup_requests_table.sql
- react-toastify
- app/paypal-ranking/page.js
- middleware.js
- .setModel
- join

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
- `27. Reorganização das pastas — fase 1 (2026-10-23)` --references--> `pageAlias()`  [INFERRED]
  NEXT_STEPS.md → servers/common/config.ts
- `7. Proposta de arquitetura (Passo 2)` --references--> `Landscape`  [INFERRED]
  docs/ANALYSIS.md → shared/formats/lnd.ts
- `3. Pontos que exigem atenção (aprendidos na prática)` --references--> `objectMatrix()`  [INFERRED]
  NEXT_STEPS.md → shared/math.ts

## Import Cycles
- None detected.

## Communities (131 total, 46 thin omitted)

### Community 0 - "client/main.ts"
Cohesion: 0.03
Nodes (80): Account, actionBar, announcer, api(), audio, backToLogin(), boot, bootEl (+72 more)

### Community 1 - "sfxRuntime.ts"
Cohesion: 0.06
Nodes (45): PreviewSfx, parseSfx(), sampleKey(), Sfx, SfxAlphaType, Blend, Glow, SfxBillType (+37 more)

### Community 2 - "shared/worldedits.ts"
Cohesion: 0.17
Nodes (11): defaultFilter(), EnvironmentEdits, FilterSettings, NpcAdded, NpcMove, SCREEN_FILTERS, ScreenFilter, SHADOW_AREA (+3 more)

### Community 3 - "internal.ts"
Cohesion: 0.31
Nodes (7): 13. Painel admin (2026-10-18), revokeAccount(), SESSION_MS, sessions, ANNOUNCE_MAX, dbCounters, internalMiddleware()

### Community 4 - "data.ts"
Cohesion: 0.08
Nodes (30): 31. Editor: mover/adicionar/remover NPCs e salvar o Ambiente (2026-10-23), DEFINE_FILES, ServerWorld, parseDefines(), parseModelTable(), parseTerrain(), parseWaterLists(), SECTION (+22 more)

### Community 5 - "inventory.ts"
Cohesion: 0.06
Nodes (28): BAG, BAG_SLOTS, baseJob(), Cached, Ctx, dualWieldable(), EQUIP, Inventory (+20 more)

### Community 6 - "editor/main.ts"
Cohesion: 0.10
Nodes (30): applyOverlayVisibility(), buildOverlays(), buildPlaces(), checked(), clearOverlays(), envFromPanel(), filterFromPanel(), filterLabels() (+22 more)

### Community 7 - "humans.ts"
Cohesion: 0.07
Nodes (34): 17. Itens no banco: inventário, equipados e penya (2026-10-18), BLUE, drawSize, ELEMENT_COLOR, Emitter, EnchantGlow, ORB_COLOR, PART_WEIGHT (+26 more)

### Community 9 - "package.json"
Cohesion: 0.05
Nodes (45): dependencies, fflate@^0.8.3, pg@^8.23.1, three@^0.170.0, ws@^8.22.0, devDependencies, tsx@^4.23.15, @types/node@^22.20.5 (+37 more)

### Community 10 - "movers.ts"
Cohesion: 0.06
Nodes (33): Bone, Motion, MotionFrame, parseAni(), parseChr(), R, Skeleton, O3dPart (+25 more)

### Community 11 - "htdocs/package.json"
Cohesion: 0.07
Nodes (41): dependencies, bcrypt@^6.0.0, critters@^0.0.23, crypto-js@^4.2.0, framer-motion@^12.9.4, lucide-react@^0.507.0, msnodesqlv8@^4.5.0, mssql@^11.0.1 (+33 more)

### Community 12 - "mssql-pg.js"
Cohesion: 0.07
Nodes (22): bindParams(), caseMap(), cfg, closeParen(), DB_SCHEMA, FORMAT_TOKENS, getPgPool(), getPool() (+14 more)

### Community 13 - "servers/main.ts"
Cohesion: 0.07
Nodes (42): 28. O site (htdocs) em http://localhost:8080 (2026-10-23), setCharacterInventory(), BootEntry, BootManifest, FILE, CLIENT_DIR, GAME_PORT, pageAlias() (+34 more)

### Community 15 - "connectToDatabase"
Cohesion: 0.09
Nodes (22): dynamic, GET(), DELETE(), PUT(), GET(), POST(), POST(), rateLimitStore (+14 more)

### Community 16 - "cashshop-payments.js"
Cohesion: 0.15
Nodes (33): dynamic, POST(), runtime, dynamic, POST(), runtime, dynamic, POST() (+25 more)

### Community 17 - "MobWorld"
Cohesion: 0.11
Nodes (9): cellOf(), CORPSE_MS, isBoss(), Mob, MOB_ATTACK_RANGE, MobHooks, MobState, MobWorld (+1 more)

### Community 18 - "bindUi"
Cohesion: 0.18
Nodes (14): download(), bindUi(), doExport(), editor, envInfo(), openWorld(), putEdits(), renderNpcList() (+6 more)

### Community 19 - "gameAccount.js"
Cohesion: 0.13
Nodes (27): cookie@^1.0.2, dynamic, GET(), POST(), POST(), GET(), dynamic, GET() (+19 more)

### Community 20 - "items.ts"
Cohesion: 0.11
Nodes (23): EXTRA_DIR, DEFINE_FILES, fitsPart(), ItemDef, PAIR, SetDef, SPEC_COLUMNS, nameTable (+15 more)

### Community 21 - "tga.ts"
Cohesion: 0.11
Nodes (27): BuffView, MenuItem, StatusInfo, MotionEntry, fetchBuf(), fetchList(), bitsOf(), ctz() (+19 more)

### Community 22 - "auth/http.ts"
Cohesion: 0.23
Nodes (19): authRoute(), failures, hashToken(), login(), loginRemembered(), startSession(), LEGACY_SALT, newToken() (+11 more)

### Community 23 - "ShopCatalog"
Cohesion: 0.31
Nodes (3): WorldRuntime, ShopCatalog, parseDyo()

### Community 24 - "net.ts"
Cohesion: 0.16
Nodes (8): ModelEntry, modelFileName(), getPlaceholderGeometry(), ModelLibrary, ModelPart, placeholderGeo, placeholderMaterial(), placeholderMats

### Community 25 - "app"
Cohesion: 0.06
Nodes (30): build, depends_on, environment, ports, restart, volumes, condition, environment (+22 more)

### Community 26 - "WorldEditor"
Cohesion: 0.12
Nodes (5): EditContext, WorldEditor, fmt(), pick(), 5. Próximos passos sugeridos (ordem de valor)

### Community 27 - "CombatRules"
Cohesion: 0.06
Nodes (24): 11. Ajustes visuais (2026-10-17), 15. Correções após o teste em duas máquinas (2026-10-18), 16. Inventário, barra de atalhos e chat (2026-10-18), 18. Comandos de GM no chat (2026-10-18), 19. Postura de combate por arma e classe (2026-10-18), 1. Como rodar, 21. Combate contra mobs — v1 (2026-10-18), 22. Drops: itens e penya no chão (2026-10-18) (+16 more)

### Community 28 - "MoverManager"
Cohesion: 0.09
Nodes (6): Remote, 7. Fase 1 do jogo multiplayer — reorganização (CONCLUÍDA em 2026-10-17), objectMatrix(), mobMotion(), MoverInstance, MoverManager

### Community 31 - "client/party.ts"
Cohesion: 0.11
Nodes (9): icon(), PartyListRow, PartyListWindow, PartyMember, partyTime(), PartyView, PartyWindow, SKILLS (+1 more)

### Community 33 - "castSkill"
Cohesion: 0.31
Nodes (9): partyExpShares(), castSkill(), dropLoot(), leaveParty(), partyMsg(), playerAttack(), pushParty(), rewardKill() (+1 more)

### Community 34 - "next"
Cohesion: 0.13
Nodes (11): dynamic, geistMono, geistSans, metadata, RootLayout(), NewsDetailPage(), ClientLayout(), Navbar() (+3 more)

### Community 36 - "paypal-ranking.js"
Cohesion: 0.17
Nodes (23): dynamic, POST(), runtime, dynamic, GET(), runtime, dynamic, GET() (+15 more)

### Community 37 - "enter"
Cohesion: 0.10
Nodes (8): GameHud, provisionalMax(), enter(), MotionWindow, 10. Interface do jogo: menu e janela de status (2026-10-17), 8. Fase 2 — banco de dados (decidido em 2026-10-17), lookList(), setGlowLevel()

### Community 39 - "lucide-react"
Cohesion: 0.12
Nodes (5): sweetalert2@^11.6.13, UserPanelPage(), DashboardCards(), lucide-react, sweetalert2

### Community 40 - "attachRealtime"
Cohesion: 0.12
Nodes (23): attachRealtime(), changeWorld(), friendMsg(), giveLoot(), guildMsg(), guildView(), killPlayer(), mobAttack() (+15 more)

### Community 41 - "gmpanel.ts"
Cohesion: 0.05
Nodes (40): btn(), el(), ELEMENT_KEYS, field(), GmPanel, JOBS, KINDS, num() (+32 more)

### Community 42 - "terrain.ts"
Cohesion: 0.13
Nodes (17): allPatches, ATTR_COLORS, baseAttributes(), buildTerrain(), buildVertexColorMesh(), ColorMode, disposeTerrain(), fillColors() (+9 more)

### Community 43 - "refreshFighter"
Cohesion: 0.36
Nodes (8): buffsMsg(), expireBuffs(), fighterFrom(), npcBuff(), refreshFighter(), removeBuff(), saveBuffs(), statsMsg()

### Community 44 - "ANALYSIS.md — Passo 1: análise do ATools e do mapa WdMadrigal"
Cohesion: 0.05
Nodes (41): 0. Divergências em relação ao README (corrigir antes do Passo 2), 10. Efeitos .sfx (Sfx.cpp / SfxModel.cpp) — validado nos 1.567 arquivos de Data/SFX (0 bytes sobrando), 1. Arquivos de um mundo (`Resource/World/WdMadrigal`), 2.1 `.wld` (texto), 2.2 `.lnd` (validado nos 900 arquivos: 0 desalinhamentos, `offset final == tamanho`), 2.3 Objeto (usado em `.lnd` e `.dyo`)  — `CObject::CreateObject(file)` + `CObject::Read`, 2.4 Matriz de transformação (Object.cpp `_updateMatrix`), 2.5 `.dyo` (+33 more)

### Community 45 - "api"
Cohesion: 0.32
Nodes (11): AccountRow, banAccount(), createAccount(), like(), listAccounts(), setPassword(), unbanAccount(), unbanByName() (+3 more)

### Community 46 - "ui.ts"
Cohesion: 0.11
Nodes (18): friendRequestPrompt(), FriendView, GuildMember, GuildView, JOBS, TREE_BG, POSITIONS, SkillView (+10 more)

### Community 47 - "InventoryWindow"
Cohesion: 0.13
Nodes (4): setTipLookup(), InventoryWindow, keyOf(), hideBit()

### Community 48 - "saveCombat"
Cohesion: 0.22
Nodes (11): 29. Fase 3: personagem na memória e um processo por mapa (2026-10-23), addExp(), autosave(), changeJob(), recalcMax(), saveCombat(), savePosition(), shutdown() (+3 more)

### Community 51 - "3. Restaurar no Windows (sem Docker)"
Cohesion: 0.10
Nodes (19): Ligar, O que é necessário para rodar, Observações, ReactioN MMO em Docker, 1. O que está (e o que NÃO está) neste repositório, 2. Programas necessários, 3.1 Baixar o projeto e colocar os arquivos do FlyFF, 3.2 Criar o banco no PostgreSQL (+11 more)

### Community 53 - "collision.ts"
Cohesion: 0.09
Nodes (19): 20. Painel de GM (2026-10-18), build(), cellKey(), CollisionWorld, e1, e2, heightOnTri(), pv (+11 more)

### Community 54 - "admin.js"
Cohesion: 0.22
Nodes (17): acc, action(), annRender(), annSetSlot(), annSlots, api(), drawChart(), esc() (+9 more)

### Community 55 - "realtime.ts"
Cohesion: 0.07
Nodes (32): Session, cached, cleanRates(), DEFAULT_RATES, KEYS, RATE_MAX, RATE_MIN, rates (+24 more)

### Community 56 - "db/index.ts"
Cohesion: 0.27
Nodes (8): cfg, pgpassLookup(), pool, transaction(), dir, main(), main(), TABLES

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
Cohesion: 0.20
Nodes (3): DragItem, ShopView, GameWindow

### Community 63 - "charwnd.ts"
Cohesion: 0.29
Nodes (6): CharacterWindow, imgBtn(), JOB_NAMES, Stat, STATS, PlayerStats

### Community 65 - "test-persist.ts"
Cohesion: 0.60
Nodes (4): main(), post(), sleep(), [user = 'teste', pass = 'teste', charName = 'Bremer']

### Community 66 - "emailUtils.js"
Cohesion: 0.27
Nodes (9): generateTemporaryPassword(), POST(), POST(), GET(), createTransporter(), generateVerificationToken(), sendTemporaryPasswordEmail(), sendVerificationEmail() (+1 more)

### Community 67 - "vercel.json"
Cohesion: 0.14
Nodes (13): buildCommand, builds, development, main, env, NEXT_PUBLIC_API_URL, git, deploymentEnabled (+5 more)

### Community 68 - "client/teleport.ts"
Cohesion: 0.29
Nodes (5): TeleportWindow, TYPE_NAME, parseTeleports(), TeleportDest, TeleportType

### Community 69 - "LookPiece"
Cohesion: 0.50
Nodes (3): CharacterInfo, CharacterInfo, LookPiece

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
Cohesion: 0.17
Nodes (12): computeEnvironment(), Environment, findContinent(), hexRgb(), S_LIGHT, skyBlend(), Continent, WldInfo (+4 more)

### Community 74 - "admin/index.ts"
Cohesion: 0.10
Nodes (23): GameProcess, ann, ANN_FILE, AnnLoop, annState(), annTick(), api(), autoStart() (+15 more)

### Community 75 - "runGmCommand"
Cohesion: 0.15
Nodes (11): ELEMENT_NAMES, ELEMENTS, findTarget(), gmAuthority(), GmContext, GmTarget, HELP, isInt() (+3 more)

### Community 78 - "FlyFF Web (editor de mapa + cliente do jogo)"
Cohesion: 0.18
Nodes (10): Banco de dados (PostgreSQL `flyffweb`), Contas e login, Coordenadas, Estrutura, FlyFF Web (editor de mapa + cliente do jogo), Formato de exportação (`flyff-web-world` v1), Limitações conhecidas, O que faz (MVP) (+2 more)

### Community 79 - "net.ts"
Cohesion: 0.15
Nodes (19): GroundRow, Item, InvMessage, PlayerView, three, applyEnchantGlow(), OT, BASE (+11 more)

### Community 80 - "Player"
Cohesion: 0.09
Nodes (6): 4. Ossos do personagem, 9. Tela de login (2026-10-17), getMotion(), motionReady(), Player, PlayerWorld

### Community 81 - "compilerOptions"
Cohesion: 0.18
Nodes (10): compilerOptions, lib, module, moduleResolution, noEmit, skipLibCheck, strict, target (+2 more)

### Community 84 - "api.ts"
Cohesion: 0.22
Nodes (17): apiMiddleware(), entryCache, fromThisMachine(), gameEntry(), bootTotal(), dataVersion(), load(), saveBootManifest() (+9 more)

### Community 85 - ".constructor"
Cohesion: 0.22
Nodes (3): applyQuality(), defaultShadow(), ShadowSettings

### Community 86 - "probe_o3d.py"
Cohesion: 0.24
Nodes (3): gm(), parse(), R

### Community 89 - "scripts"
Cohesion: 0.15
Nodes (12): devDependencies, javascript-obfuscator@^4.1.1, tailwindcss@^4, @tailwindcss/postcss@^4, scripts, build, dev, lint (+4 more)

### Community 90 - "ItemCatalog"
Cohesion: 0.23
Nodes (5): ItemCatalog, askPassword(), [cmd, ...rest], pos, readNewPassword()

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
Cohesion: 0.15
Nodes (5): GameStats, GameStatus, LogLine, SiteProcess, SiteStatus

### Community 112 - "007_website.sql"
Cohesion: 0.17
Nodes (17): idx_topup_items_category, idx_vote_logs_account, idx_vote_logs_ip_address, idx_vote_logs_vote_time, ix_paypal_cashshop_orders_character_name, ix_topup_requests_created_at, ix_topup_requests_status, ix_topup_requests_streamer_code (+9 more)

### Community 113 - "shared/world.ts"
Cohesion: 0.09
Nodes (33): QueuedSkill, Action, EditableTile, flip, Snap, encodeTile(), exportWorld(), objRow() (+25 more)

### Community 132 - "middleware.js"
Cohesion: 0.67
Nodes (3): config, middleware(), validSession()

### Community 134 - "join"
Cohesion: 0.20
Nodes (10): 35. Buffs e magias (2026-10-23), cleanBar(), jobForLevel(), join(), loadBuffs(), loadFriends(), loadGuildOf(), reconcilePoints() (+2 more)

## Knowledge Gaps
- **9 isolated node(s):** `Bill`, `Particle`, `CustomMesh`, `Bill`, `Bottom` (+4 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 697 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **46 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `next` connect `next` to `emailUtils.js`, `paypal-ranking.js`, `topup/route.js`, `admin/paypal-ranking/page.js`, `lucide-react`, `middleware.js`, `htdocs/package.json`, `connectToDatabase`, `cashshop-payments.js`, `next-auth`, `gameAccount.js`, `react`, `ranking/page.js`, `topup/[id]/route.js`, `vote-pingback/route.js`?**
  _High betweenness centrality (0.111) - this node is a cross-community bridge._
- **Are the 2 inferred relationships involving `WorldView` (e.g. with `Estrutura` and `7. Fase 1 do jogo multiplayer — reorganização (CONCLUÍDA em 2026-10-17)`) actually correct?**
  _`WorldView` has 2 INFERRED edges - model-reasoned connections that need verification._
- **What connects `Bill`, `Particle`, `CustomMesh` to the rest of the system?**
  _9 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `client/main.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.03261160117615611 - nodes in this community are weakly interconnected._
- **Why does `WorldView` connect `WorldView` to `client/main.ts`, `sfxRuntime.ts`, `editor/main.ts`, `bindUi`, `net.ts`, `MoverManager`, `Combat`, `enter`, `NpcEditor`, `terrain.ts`, `RemotePlayers`, `collision.ts`, `.frame`, `dds.ts`, `FlyFF Web (editor de mapa + cliente do jogo)`, `net.ts`, `Player`, `.open`, `.constructor`, `skillFx`, `TargetWindow`, `shared/world.ts`, `playerClick`?**
  _High betweenness centrality (0.104) - this node is a cross-community bridge._
- **Are the 3 inferred relationships involving `attachRealtime()` (e.g. with `.activeSkills()` and `.expNext()`) actually correct?**
  _`attachRealtime()` has 3 INFERRED edges - model-reasoned connections that need verification._
- **Should `sfxRuntime.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.06315789473684211 - nodes in this community are weakly interconnected._