# Graph Report - FlyffWeb  (2026-10-26)

## Corpus Check
- 247 files · ~237,989 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 20 file(s) not represented in the graph (top: (none) 7, .css 5, .bat 3)

## Summary
- 2631 nodes · 6159 edges · 130 communities (82 shown, 48 thin omitted)
- Extraction: 94% EXTRACTED · 6% INFERRED · 0% AMBIGUOUS · INFERRED: 384 edges (avg confidence: 0.87)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `d7d5854a`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- client/main.ts
- sfxRuntime.ts
- MoverInstance
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
- models.ts
- app
- WorldEditor
- CombatRules
- MoverManager
- WorldView
- .raw
- client/party.ts
- ActionBar
- net.ts
- next
- Combat
- paypal-ranking.js
- enter
- NpcEditor
- admin/page.js
- attachRealtime
- gmpanel.ts
- terrain.ts
- GmPanel
- ANALYSIS.md — Passo 1: análise do ATools e do mapa WdMadrigal
- runGmCommand
- ui.ts
- InventoryWindow
- NEXT_STEPS.md — contexto e próximos passos (para o Opus 5.5)
- FriendsWindow
- RemotePlayers
- 3. Restaurar no Windows (sem Docker)
- FlyFF Web Port – World Editor (WebGL / Three.js)
- collision.ts
- admin.js
- parseO3d
- db/index.ts
- SkillWindow
- react
- ranking/page.js
- topup/[id]/route.js
- import-flyff.ts
- GameWindow
- charwnd.ts
- .open
- setNpcMode
- emailUtils.js
- vercel.json
- client/teleport.ts
- TradeWindow
- admin/paypal-ranking/page.js
- shops/page.js
- refreshFighter
- Sky
- scripts
- query
- BuffBar
- ShopWindow
- FlyFF Web (editor de mapa + cliente do jogo)
- join
- castSkill
- compilerOptions
- GuildWindow
- 7. Fase 1 do jogo multiplayer — reorganização (CONCLUÍDA em 2026-10-17)
- TargetWindow
- .loadTile
- probe_o3d.py
- GameAudio
- skillFx
- MotionWindow
- PartyManager
- playerClick
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
- enter
- ItemCatalog
- 007_website.sql
- shared/worldedits.ts
- SkillCatalog
- login/route.js
- stats/route.js
- JobWindow
- .invalidate
- create_topup_items_table.sql
- 012_website_shop.sql
- create_topup_requests_table.sql

## God Nodes (most connected - your core abstractions)
1. `WorldView` - 95 edges
2. `NetClient` - 92 edges
3. `attachRealtime()` - 82 edges
4. `connectToDatabase()` - 58 edges
5. `next` - 57 edges
6. `MoverInstance` - 50 edges
7. `GameWindow` - 42 edges
8. `Inventory` - 41 edges
9. `MoverManager` - 40 edges
10. `CombatRules` - 39 edges

## Surprising Connections (you probably didn't know these)
- `Passo 1 – Análise do código-fonte do World Editor (ATUAL)` --references--> `WorldEditor`  [INFERRED]
  docs/README-inicial.md → editor/editor.ts
- `35. Buffs e magias (2026-10-23)` --references--> `SkillKind`  [INFERRED]
  NEXT_STEPS.md → servers/world/skills.ts
- `7. Proposta de arquitetura (Passo 2)` --references--> `Landscape`  [INFERRED]
  docs/ANALYSIS.md → shared/formats/lnd.ts
- `3. Pontos que exigem atenção (aprendidos na prática)` --references--> `objectMatrix()`  [INFERRED]
  NEXT_STEPS.md → shared/math.ts
- `11. Ajustes visuais (2026-10-17)` --references--> `keyedImage()`  [INFERRED]
  NEXT_STEPS.md → shared/tga.ts

## Import Cycles
- None detected.

## Communities (130 total, 48 thin omitted)

### Community 0 - "client/main.ts"
Cohesion: 0.03
Nodes (74): Account, actionBar, announcer, api(), audio, backToLogin(), boot, bootEl (+66 more)

### Community 1 - "sfxRuntime.ts"
Cohesion: 0.08
Nodes (34): parseSfx(), sampleKey(), Sfx, SfxAlphaType, Blend, Glow, SfxBillType, Bill (+26 more)

### Community 2 - "MoverInstance"
Cohesion: 0.06
Nodes (17): InventoryPreview, 4. Ossos do personagem, applyEnchantGlow(), Sex, BASE, motionOf(), motionsFor(), MotionState (+9 more)

### Community 3 - "admin/index.ts"
Cohesion: 0.07
Nodes (37): GameProcess, GameStats, GameStatus, LogLine, ann, ANN_FILE, AnnLoop, annState() (+29 more)

### Community 4 - "data.ts"
Cohesion: 0.07
Nodes (44): MotionEntry, DEFINE_FILES, DEFINE_FILES, fetchBuf(), fetchList(), WorldData, loadDds(), parser (+36 more)

### Community 5 - "inventory.ts"
Cohesion: 0.08
Nodes (23): 19. Postura de combate por arma e classe (2026-10-18), 24. Poções/comidas e barra de atalhos (2026-10-18), BAG, BAG_SLOTS, baseJob(), Cached, Ctx, dualWieldable() (+15 more)

### Community 6 - "editor/main.ts"
Cohesion: 0.08
Nodes (37): Action, EditableTile, flip, Snap, encodeTile(), exportWorld(), objRow(), r3() (+29 more)

### Community 7 - "humans.ts"
Cohesion: 0.06
Nodes (36): 17. Itens no banco: inventário, equipados e penya (2026-10-18), BLUE, drawSize, ELEMENT_COLOR, Emitter, EnchantGlow, ORB_COLOR, PART_WEIGHT (+28 more)

### Community 9 - "package.json"
Cohesion: 0.05
Nodes (45): dependencies, fflate@^0.8.3, pg@^8.23.1, three@^0.170.0, ws@^8.22.0, devDependencies, tsx@^4.23.15, @types/node@^22.20.5 (+37 more)

### Community 10 - "movers.ts"
Cohesion: 0.09
Nodes (24): QueuedSkill, Motion, Skeleton, O3dPart, RectXZ, bfP, bfQ, bfS (+16 more)

### Community 11 - "htdocs/package.json"
Cohesion: 0.05
Nodes (51): dependencies, bcrypt@^6.0.0, cookie@^1.0.2, critters@^0.0.23, crypto-js@^4.2.0, framer-motion@^12.9.4, lucide-react@^0.507.0, msnodesqlv8@^4.5.0 (+43 more)

### Community 12 - "mssql-pg.js"
Cohesion: 0.07
Nodes (22): bindParams(), caseMap(), cfg, closeParen(), DB_SCHEMA, FORMAT_TOKENS, getPgPool(), getPool() (+14 more)

### Community 13 - "servers/main.ts"
Cohesion: 0.07
Nodes (39): 27. Reorganização das pastas — fase 1 (2026-10-23), setCharacterInventory(), BootEntry, BootManifest, dataVersion(), FILE, load(), saveBootManifest() (+31 more)

### Community 14 - "realtime.ts"
Cohesion: 0.07
Nodes (35): Session, InvState, TradeOffer, ROOT, cached, cleanRates(), DEFAULT_RATES, KEYS (+27 more)

### Community 15 - "connectToDatabase"
Cohesion: 0.09
Nodes (22): dynamic, GET(), DELETE(), PUT(), GET(), POST(), POST(), rateLimitStore (+14 more)

### Community 16 - "cashshop-payments.js"
Cohesion: 0.15
Nodes (33): dynamic, POST(), runtime, dynamic, POST(), runtime, dynamic, POST() (+25 more)

### Community 17 - "MobWorld"
Cohesion: 0.10
Nodes (9): cellOf(), CORPSE_MS, isBoss(), MOB_ATTACK_RANGE, MobHooks, MobState, MobWorld, rng() (+1 more)

### Community 18 - "bindUi"
Cohesion: 0.23
Nodes (11): download(), bindUi(), doExport(), envInfo(), openWorld(), putEdits(), renderNpcList(), renderPlaces() (+3 more)

### Community 19 - "gameAccount.js"
Cohesion: 0.21
Nodes (18): dynamic, GET(), POST(), dynamic, GET(), POST(), POST(), checkPassword() (+10 more)

### Community 20 - "items.ts"
Cohesion: 0.09
Nodes (35): EXTRA_DIR, DEFINE_FILES, EQUIP_PARTS, fitsPart(), ItemDef, PAIR, SetDef, SPEC_COLUMNS (+27 more)

### Community 21 - "tga.ts"
Cohesion: 0.12
Nodes (20): BuffView, MenuItem, StatusInfo, 9. Tela de login (2026-10-17), bitsOf(), ctz(), parseDds(), decodeDxt() (+12 more)

### Community 22 - "auth/http.ts"
Cohesion: 0.14
Nodes (30): apiMiddleware(), entryCache, fromThisMachine(), gameEntry(), authRoute(), failures, hashToken(), login() (+22 more)

### Community 23 - "start.ts"
Cohesion: 0.17
Nodes (9): WORLD, PORT, realtime, server, WorldRuntime, ShopCatalog, EXTRA_WORLDS, saveOnSignals() (+1 more)

### Community 24 - "models.ts"
Cohesion: 0.10
Nodes (17): ModelEntry, modelFileName(), O3d, SfxPart, getPlaceholderGeometry(), LoadedModel, ModelLibrary, ModelPart (+9 more)

### Community 25 - "app"
Cohesion: 0.06
Nodes (30): build, depends_on, environment, ports, restart, volumes, condition, environment (+22 more)

### Community 26 - "WorldEditor"
Cohesion: 0.12
Nodes (5): EditContext, WorldEditor, fmt(), pick(), 5. Próximos passos sugeridos (ordem de valor)

### Community 27 - "CombatRules"
Cohesion: 0.12
Nodes (5): 30. Atributos, equipamentos e dica do item conforme o servidor original (2026-10-23), CombatRules, rand(), Mob, MoverProp

### Community 31 - "client/party.ts"
Cohesion: 0.11
Nodes (9): icon(), PartyListRow, PartyListWindow, PartyMember, partyTime(), PartyView, PartyWindow, SKILLS (+1 more)

### Community 33 - "net.ts"
Cohesion: 0.14
Nodes (19): GroundRow, Item, InvMessage, PlayerView, Remote, Action, flip, Pose (+11 more)

### Community 34 - "next"
Cohesion: 0.09
Nodes (14): dynamic, geistMono, geistSans, metadata, RootLayout(), NewsDetailPage(), ClientLayout(), Navbar() (+6 more)

### Community 36 - "paypal-ranking.js"
Cohesion: 0.17
Nodes (23): dynamic, POST(), runtime, dynamic, GET(), runtime, dynamic, GET() (+15 more)

### Community 40 - "attachRealtime"
Cohesion: 0.13
Nodes (21): attachRealtime(), friendMsg(), guildMsg(), guildView(), leaveParty(), partyMsg(), pushGuild(), pushInventory() (+13 more)

### Community 41 - "gmpanel.ts"
Cohesion: 0.16
Nodes (19): ELEMENT_KEYS, JOBS, KINDS, box(), DST, EXPUP_ARMOR, EXPUP_WEAPON, fxText() (+11 more)

### Community 42 - "terrain.ts"
Cohesion: 0.11
Nodes (24): computeEnvironment(), Environment, findContinent(), hexRgb(), S_LIGHT, allPatches, ATTR_COLORS, baseAttributes() (+16 more)

### Community 43 - "GmPanel"
Cohesion: 0.23
Nodes (6): btn(), el(), field(), GmPanel, num(), select()

### Community 44 - "ANALYSIS.md — Passo 1: análise do ATools e do mapa WdMadrigal"
Cohesion: 0.09
Nodes (22): 0. Divergências em relação ao README (corrigir antes do Passo 2), 10. Efeitos .sfx (Sfx.cpp / SfxModel.cpp) — validado nos 1.567 arquivos de Data/SFX (0 bytes sobrando), 1. Arquivos de um mundo (`Resource/World/WdMadrigal`), 2.1 `.wld` (texto), 2.2 `.lnd` (validado nos 900 arquivos: 0 desalinhamentos, `offset final == tamanho`), 2.3 Objeto (usado em `.lnd` e `.dyo`)  — `CObject::CreateObject(file)` + `CObject::Read`, 2.4 Matriz de transformação (Object.cpp `_updateMatrix`), 2.5 `.dyo` (+14 more)

### Community 45 - "runGmCommand"
Cohesion: 0.12
Nodes (16): ELEMENT_NAMES, ELEMENTS, findTarget(), gmAuthority(), GmContext, GmTarget, HELP, isInt() (+8 more)

### Community 46 - "ui.ts"
Cohesion: 0.13
Nodes (18): ItemView, DragItem, ShopView, TradeItem, TradeSide, TradeView, BarItem, ELEMENT_NAMES (+10 more)

### Community 47 - "InventoryWindow"
Cohesion: 0.19
Nodes (3): InventoryWindow, keyOf(), hideBit()

### Community 48 - "NEXT_STEPS.md — contexto e próximos passos (para o Opus 5.5)"
Cohesion: 0.10
Nodes (19): 11. Ajustes visuais (2026-10-17), 13. Painel admin (2026-10-18), 15. Correções após o teste em duas máquinas (2026-10-18), 18. Comandos de GM no chat (2026-10-18), 1. Como rodar, 20. Painel de GM (2026-10-18), 21. Combate contra mobs — v1 (2026-10-18), 22. Drops: itens e penya no chão (2026-10-18) (+11 more)

### Community 51 - "3. Restaurar no Windows (sem Docker)"
Cohesion: 0.10
Nodes (19): Ligar, O que é necessário para rodar, Observações, ReactioN MMO em Docker, 1. O que está (e o que NÃO está) neste repositório, 2. Programas necessários, 3.1 Baixar o projeto e colocar os arquivos do FlyFF, 3.2 Criar o banco no PostgreSQL (+11 more)

### Community 52 - "FlyFF Web Port – World Editor (WebGL / Three.js)"
Cohesion: 0.10
Nodes (19): Arquivos relacionados que também aparecem, Estrutura conhecida (baseada em engenharia reversa da comunidade + ATools):, Estrutura Esperada do Projeto, FlyFF Web Port – World Editor (WebGL / Three.js), Formato `.lnd` (Landscape) – Detalhado, Formato `.wld` (World), Formatos de Arquivo de Mundo (FlyFF), Instruções para o Claude Code (Passo a Passo) (+11 more)

### Community 53 - "collision.ts"
Cohesion: 0.14
Nodes (14): build(), cellKey(), CollisionWorld, e1, e2, heightOnTri(), pv, qv (+6 more)

### Community 54 - "admin.js"
Cohesion: 0.22
Nodes (17): acc, action(), annRender(), annSetSlot(), annSlots, api(), drawChart(), esc() (+9 more)

### Community 55 - "parseO3d"
Cohesion: 0.15
Nodes (10): Bone, MotionFrame, parseAni(), parseChr(), R, parseO3d(), Reader, readGM() (+2 more)

### Community 56 - "db/index.ts"
Cohesion: 0.22
Nodes (8): cfg, pgpassLookup(), pool, transaction(), dir, main(), main(), TABLES

### Community 57 - "SkillWindow"
Cohesion: 0.27
Nodes (3): runActionSlot(), SkillWindow, keyedImage()

### Community 58 - "react"
Cohesion: 0.07
Nodes (19): dayjs@^1.11.13, react-data-table-component@^7.7.0, HomePage(), PayPalRankingPage(), rankBadge(), GCashDonationsPage(), TableSkeleton(), TableSkeleton() (+11 more)

### Community 59 - "ranking/page.js"
Cohesion: 0.24
Nodes (10): UserPanelPage(), jobFilters, RankingPage(), AccountLists(), DashboardCards(), formatPlayTime(), getJobColor(), getJobImage() (+2 more)

### Community 60 - "topup/[id]/route.js"
Cohesion: 0.18
Nodes (11): DELETE(), GET(), POST(), checkAdmin(), DELETE(), dynamic, getRouteId(), normalizePointType() (+3 more)

### Community 61 - "import-flyff.ts"
Cohesion: 0.14
Nodes (14): ACCOUNT_DB, accounts, args, blockDate(), CHAR_DB, characters, DRY, LegacyAccount (+6 more)

### Community 62 - "GameWindow"
Cohesion: 0.11
Nodes (11): friendRequestPrompt(), FriendView, GuildMember, GuildView, JOBS, TREE_BG, POSITIONS, SkillView (+3 more)

### Community 63 - "charwnd.ts"
Cohesion: 0.29
Nodes (6): CharacterWindow, imgBtn(), JOB_NAMES, Stat, STATS, PlayerStats

### Community 64 - ".open"
Cohesion: 0.12
Nodes (5): PreviewSfx, PostFx, SfxLibrary, defaultShadow(), ShadowSettings

### Community 65 - "setNpcMode"
Cohesion: 0.16
Nodes (12): applyOverlayVisibility(), checked(), envFromPanel(), filterFromPanel(), setEditMode(), setNpcMode(), shadowFromPanel(), shadowToPanel() (+4 more)

### Community 66 - "emailUtils.js"
Cohesion: 0.27
Nodes (9): generateTemporaryPassword(), POST(), POST(), GET(), createTransporter(), generateVerificationToken(), sendTemporaryPasswordEmail(), sendVerificationEmail() (+1 more)

### Community 67 - "vercel.json"
Cohesion: 0.14
Nodes (13): buildCommand, builds, development, main, env, NEXT_PUBLIC_API_URL, git, deploymentEnabled (+5 more)

### Community 68 - "client/teleport.ts"
Cohesion: 0.29
Nodes (5): TeleportWindow, TYPE_NAME, parseTeleports(), TeleportDest, TeleportType

### Community 70 - "admin/paypal-ranking/page.js"
Cohesion: 0.24
Nodes (9): AdminPayPalRankingPage(), creditReward(), fetchRanking(), firstDayOfMonth(), formatAmount(), formatNumber(), rankBadge(), safeString() (+1 more)

### Community 71 - "shops/page.js"
Cohesion: 0.40
Nodes (11): formatPrice(), getImageUrl(), getPointBadgeClasses(), getPointLabel(), getPointType(), ItemMall(), captureOrder(), handleBuy() (+3 more)

### Community 72 - "refreshFighter"
Cohesion: 0.27
Nodes (10): buffsMsg(), expireBuffs(), fighterFrom(), killPlayer(), mobAttack(), npcBuff(), refreshFighter(), removeBuff() (+2 more)

### Community 73 - "Sky"
Cohesion: 0.26
Nodes (3): cloudGeometry(), domeGeometry(), Sky

### Community 74 - "scripts"
Cohesion: 0.40
Nodes (5): scripts, build, dev, lint, start

### Community 75 - "query"
Cohesion: 0.19
Nodes (16): query(), addExp(), autosave(), changeJob(), changeWorld(), recalcMax(), saveBuffs(), saveCombat() (+8 more)

### Community 78 - "FlyFF Web (editor de mapa + cliente do jogo)"
Cohesion: 0.18
Nodes (10): Banco de dados (PostgreSQL `flyffweb`), Contas e login, Coordenadas, Estrutura, FlyFF Web (editor de mapa + cliente do jogo), Formato de exportação (`flyff-web-world` v1), Limitações conhecidas, O que faz (MVP) (+2 more)

### Community 79 - "join"
Cohesion: 0.22
Nodes (10): 35. Buffs e magias (2026-10-23), cleanBar(), jobForLevel(), join(), loadBuffs(), loadFriends(), loadGuildOf(), reconcilePoints() (+2 more)

### Community 80 - "castSkill"
Cohesion: 0.32
Nodes (8): partyExpShares(), castSkill(), dropLoot(), giveLoot(), pickUp(), playerAttack(), rewardKill(), reachOf()

### Community 81 - "compilerOptions"
Cohesion: 0.18
Nodes (10): compilerOptions, lib, module, moduleResolution, noEmit, skipLibCheck, strict, target (+2 more)

### Community 85 - ".loadTile"
Cohesion: 0.27
Nodes (3): editor, spawnPlayer(), key()

### Community 86 - "probe_o3d.py"
Cohesion: 0.24
Nodes (3): gm(), parse(), R

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

### Community 110 - "enter"
Cohesion: 0.13
Nodes (14): provisionalMax(), enter(), hideMaskOf(), openWorld(), renderPickers(), renderSlots(), sayCreate, saySelect (+6 more)

### Community 111 - "ItemCatalog"
Cohesion: 0.16
Nodes (8): notifyInventory(), ItemCatalog, askPassword(), [cmd, ...rest], main(), opt(), pos, readNewPassword()

### Community 112 - "007_website.sql"
Cohesion: 0.17
Nodes (17): idx_topup_items_category, idx_vote_logs_account, idx_vote_logs_ip_address, idx_vote_logs_vote_time, ix_paypal_cashshop_orders_character_name, ix_topup_requests_created_at, ix_topup_requests_status, ix_topup_requests_streamer_code (+9 more)

### Community 113 - "shared/worldedits.ts"
Cohesion: 0.15
Nodes (13): 31. Editor: mover/adicionar/remover NPCs e salvar o Ambiente (2026-10-23), defaultFilter(), applyNpcEdits(), EnvironmentEdits, FilterSettings, NpcAdded, NpcMove, SCREEN_FILTERS (+5 more)

### Community 115 - "login/route.js"
Cohesion: 0.38
Nodes (8): POST(), GET(), cookieOptions(), secret(), SESSION_COOKIE, SESSION_MAX_AGE, signSession(), cookie

### Community 116 - "stats/route.js"
Cohesion: 0.40
Nodes (5): createRequest(), dynamic, GET(), revalidate, jobMapping

## Knowledge Gaps
- **9 isolated node(s):** `Bill`, `Particle`, `CustomMesh`, `Bill`, `Bottom` (+4 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 693 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **48 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `next` connect `next` to `emailUtils.js`, `paypal-ranking.js`, `topup/route.js`, `admin/paypal-ranking/page.js`, `admin/page.js`, `htdocs/package.json`, `connectToDatabase`, `cashshop-payments.js`, `next-auth`, `gameAccount.js`, `stats/route.js`, `login/route.js`, `react`, `ranking/page.js`, `topup/[id]/route.js`, `vote-pingback/route.js`?**
  _High betweenness centrality (0.105) - this node is a cross-community bridge._
- **Are the 2 inferred relationships involving `WorldView` (e.g. with `Estrutura` and `7. Fase 1 do jogo multiplayer — reorganização (CONCLUÍDA em 2026-10-17)`) actually correct?**
  _`WorldView` has 2 INFERRED edges - model-reasoned connections that need verification._
- **What connects `Bill`, `Particle`, `CustomMesh` to the rest of the system?**
  _9 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `client/main.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.031616982836495035 - nodes in this community are weakly interconnected._
- **Why does `WorldView` connect `WorldView` to `client/main.ts`, `sfxRuntime.ts`, `MoverInstance`, `data.ts`, `editor/main.ts`, `movers.ts`, `bindUi`, `models.ts`, `MoverManager`, `net.ts`, `Combat`, `NpcEditor`, `terrain.ts`, `RemotePlayers`, `.open`, `setNpcMode`, `Sky`, `FlyFF Web (editor de mapa + cliente do jogo)`, `7. Fase 1 do jogo multiplayer — reorganização (CONCLUÍDA em 2026-10-17)`, `TargetWindow`, `.loadTile`, `skillFx`, `playerClick`, `enter`, `.invalidate`?**
  _High betweenness centrality (0.080) - this node is a cross-community bridge._
- **Are the 3 inferred relationships involving `attachRealtime()` (e.g. with `.activeSkills()` and `.expNext()`) actually correct?**
  _`attachRealtime()` has 3 INFERRED edges - model-reasoned connections that need verification._
- **Should `sfxRuntime.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.07832080200501253 - nodes in this community are weakly interconnected._