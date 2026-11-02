# ARQUITETURA — migração do Game Server para Rust + interest management por tiles

Dono: Master Game Server. Status: **plano (nenhum código escrito)**. Data: 2026-11-01.
Base: leitura de `servers/world/{realtime,mobs,combat,world,start,main}.ts` + memorando de netcode (subagente Opus).
Números abaixo marcados *(est.)* são estimativas a confirmar com `tools/loadtest.ts`.

## 1. Alvo

```
Navegador ──WS JSON──► Node Gateway (login, API, site, CDN, WS /ws) ──TCP 127.0.0.1──► Rust Game Server (1 thread por mapa)
                                                                                          │ combate · IA · movimento · tick · AOI
                                                                                          └─► PostgreSQL (write-behind)
```
Hoje: `servers/main.ts` já pode virar "portão" (`WORLD_NODE=host:porta`) e repassar `/ws` a um processo de mapa
(`servers/world/main.ts`, `npm run world`), que valida o token em `GET /internal/session`. **Esse ponto de encaixe é
onde o Rust entra** — o cliente não muda.

## 2. Diagnóstico do estado atual (Node)

| Item | Hoje | Problema |
|---|---|---|
| Tick | 100 ms (`TICK_MS`), mobs enviados a cada 200 ms | — |
| Jogadores | `VIEW_RADIUS=150 / KEEP=170 / MAX=100`, grade 100 u, `seen`/`viewers` | `states`, `enter`, `look` já filtrados por `seen` (ok) |
| Mobs | `MobWorld.near(x,z,150,80)` + `Conn.mobs` (conjunto conhecido) | envio ok, **ações não consultam o conjunto** |
| Ações | `playerAttack`/`castSkill` só checam `mobWorld.byId` + distância (`reachOf`; magia 24 u) | aceitam qualquer id de mob em alcance, visível ou não; `pick`, `res`, `pm`, `tradeReq`, `partyInvite`, `friendAdd` idem por id/nome |
| Eventos | `hit`, `mdie`, `skillfx`, `emote`, `emo` via `sendNear` (raio 150 em volta do evento) | receptor pode receber `a`/`d` (ids de jogador) que **não conhece** → cliente cria rótulo/nick de quem não está em `seen` |
| Party | `partyView` envia a todos os membros `name, level, w, x, z` | **vaza nick e posição** do amigo em outro mapa/longe (provável origem do "nick do amigo de Flaris em Saint Morning") |
| Amigos | `friendOn` global (id, on) | sem posição — ok, mas o cliente não deve criar nameplate 3D a partir disso |
| Chat | `broadcast` global com `id`+`name` | ok como chat, mas o `id` não pode alimentar o mundo 3D |
| Invisível | `invisIds` filtra `actorOf` | cobre só alguns tipos de mensagem |

Causas-raiz dos dois bugs:
1. **Nick fora da visão**: o cliente (`client/net.ts`, `party`/`chat`/`hit`) recebe nomes/ids por canais que não passam pela AOI; basta um desses criar/atualizar o rótulo.
2. **Clicar em mob fora do campo de visão**: `atk`/`skill` validam só distância; o conjunto `Conn.mobs` existe mas não é consultado, e o cliente seleciona/mira ids que não deveriam existir nele.

## 3. Decisões de arquitetura

1. **Concorrência**: uma **thread do SO por mapa** (single-writer, sem locks, sem ECS) rodando o loop de tick; tokio só para I/O em volta. Entrada por canal limitado (~8192, drenado no início do tick, máx. 2000/tick); saída por `try_send` em fila por conexão (256 frames) — a simulação **nunca** espera I/O. Sem estado compartilhado entre mapas; troca de mapa = `Transfer{snapshot}` pelo canal. `catch_unwind` por mapa + snapshot a cada 30 s.
2. **Tick** *(est.)*: simulação **20 Hz (50 ms)**, rede **10 Hz** (a cada 2 ticks; hit/morte saem na hora), IA de mob **5 Hz** em fatias (1/4 dos mobs ativos por tick), mobs sem jogador a ≤2 células **dormem**. Orçamento 50 ms, meta p99 < 25 ms; fases: (1) drenar+validar entrada → (2) movimento → (3) IA → (4) combate/buffs/mortes/respawn → (5) drops → (6) atualizar grade/AOI → (7) montar e enviar deltas → (8) eventos de persistência.
3. **Persistência**: tarefa tokio própria (`tokio-postgres`/`sqlx`, 4–8 conexões), write-behind: flush a cada 2 s ou 200 eventos, coalescendo por personagem. Eventos críticos (troca, compra, drop raro) só confirmam ao cliente após o commit. **Um dono por tabela**: no início o **Node continua dono de inventário/lojas/trade/GM/party/guild/amigos**; o Rust faz RPC (`GrantItem`, `GrantExp`, `ConsumeItem`, `PartyOf`). O Rust é dono de posição/HP/MP/FP/exp (já gravados em lote hoje pelo `autosave`).
4. **Transporte Gateway↔Rust**: Node termina o WS do navegador; **uma** conexão TCP loopback multiplexada, quadros `u32` de tamanho + **MessagePack**. O cliente segue em **JSON**: o Rust emite o JSON pronto como `bytes` e o Gateway só repassa (zero parse no caminho quente). Não usar named pipe/gRPC; Rust não fala WS com o navegador (perderia login/rate-limit/CDN).

## 4. Sistema de tiles / interest management

- **Grade uniforme de 64 u** (Madrigal 30×30 tiles de 512 → 240×240 = 57 600 células, `Vec` plano). O tile de 512 u fica só para terreno (`.lnd`).
- **Entrada raio 3 células (7×7 ≈ 448 u), saída raio 4 (9×9)** → histerese de 1 célula (cobre o VIEW 150/KEEP 170 atual). Boss/entidade grande: `aoi_radius_override` (ex.: 6).
- Cada célula: listas separadas de jogadores, mobs e drops (swap-remove). **Interest set** por jogador (`enter`/`leave`/`update` por diff), recalculado ao trocar de célula e a cada 500 ms. Limites: 80 mobs, 60 jogadores, 60 drops (mais próximos primeiro).
- **Regra de ouro**: *o servidor nunca envia nada que referencie um id/nome fora do interest set do receptor.* O nameplate 3D só nasce de `enter`.
- **Eventos de combate** (`hit`, `mdie`, `skillfx`, `emote`, `pdie`) vão para `known(ator) ∪ known(alvo)`; se só o alvo é conhecido, ator anônimo (`src:null`).
- **Invisibilidade**: o invisível **sai** do set dos outros (`leave`), não só some no cliente; mobs o ignoram (já é regra hoje).
- **Fora da AOI (permitido, sem posição/mapa)**: chat global/grito, sussurro, party, guild, amigos, avisos de sistema. Chat "normal" (local) usa AOI.
- **Party/amigos**: lista de UI com `{id, nome, nível, classe, online, hp%}`; **`w/x/z` só se o membro estiver no mesmo mapa e no set; senão `pos:null`**. Mini mapa desenha só quem está no set. Isso elimina o bug do nick.
- **Ações com alvo** (`atk`, `skill`, `pick`, `res`, `tradeReq`, `partyInvite` por clique, `npcMenu`/`shopOpen`): exigir `alvo ∈ interest_set` **e** alcance (+tolerância de rede) **e** estado válido (vivo, mesmo mapa, não invisível). Falha → descarte silencioso + contador `rejects{motivo}` por conta (>30/min → alerta no Admin). Exceção de UX: `actionFail` genérico para `pick`/NPC.
- Longo alcance (magia 24 u, arco) << janela (≥192 u): alvo válido sempre está no set do atacante. Projéteis não são entidades de rede.

## 5. Protocolo Gateway ↔ Rust

Envelope `{v:1, conn:u32, kind:u16, body}`:
`Hello{secret, version}` (1º quadro, bind 127.0.0.1) · `Attach{conn, accountId, charId, ip}` (Gateway já validou o token na Auth) · `Detach{conn}` · `C2S{conn, bytes}` · `S2C{conns|conn, bytes}` · `Rpc{id,…}`/`RpcReply` (inventário/exp no Node) · `Ping`.
- Backpressure: fila > 256 quadros ou 1 MB (`ws.bufferedAmount`) → descartar primeiro `update` de posição; desconectar após 10 s.
- Link cai: Rust segura personagens 30 s (linkdead); Gateway reconecta, reenvia `Attach`, Rust manda snapshot completo (set vazio → tudo vira `enter`).
- Versão: `Hello.version` major incompatível = recusa; campos novos `#[serde(default)]`.
- Mensagens do cliente continuam as de `servers/world/realtime.ts` (cabeçalho do arquivo é a especificação do protocolo atual, JSON `{t:…}`); mudanças de contrato entram aqui.

## 6. Módulos Rust (`game-server/`, workspace Cargo)

| Crate / módulo | Responsabilidade | Origem TS |
|---|---|---|
| `protocol` | tipos serde (MessagePack do link; JSON do cliente), versão | cabeçalho de `realtime.ts` |
| `link` | servidor TCP, handshake, Attach/Detach, backpressure, reconexão | `servers/main.ts` proxy, `internal.ts` |
| `world::map` | thread/loop de tick, fila de entrada/saída, transferência entre mapas | `realtime.ts` (tick), `start.ts` |
| `world::grid` | células 64 u, índice por tipo, movimento entre células | `rebuildGrid`, `nearConns`, `MobWorld.grid` |
| `world::aoi` | interest sets, diffs enter/leave/update, histerese, prioridade, filtro de eventos | `refreshView`, `showTo`, `sendMobs`, `sendNear` |
| `world::terrain` | heightmap + atributos NoWalk/NoMove/NoFly por tile (`.hgt` convertido de `.lnd`) | `world.ts` (`attrAt`, `walkable`) |
| `sim::movement` | validação de movimento (velocidade ×1,15/s, salto, Δy, teleporte só de servidor), anti-speedhack | `moveOk`, `MAX_STEP`, `SPEED_*` |
| `sim::mobs` | spawn por respawn do `.rgn`, patrulha, aggro, leash, respawn, dormir longe | `mobs.ts` |
| `sim::combat` | fórmulas de dano, alcance, intervalo, crítico, exp, morte | `combat.ts`, `playerAttack`, `mobAttack` |
| `sim::skills` / `buffs` | skills, cooldown, buffs com DST | `skills.ts`, buffs de `realtime.ts` |
| `sim::drops` | rolagem de drop, itens no chão, dono 30 s, expiração | `drops.ts`, `pickUp` |
| `rpc` | cliente RPC do Node (inventário, party, exp share, GM) | `Inventory`, `party.ts` |
| `persist` | write-behind em lote (pos/HP/MP/FP/exp) | `savePosition`, `autosave` |
| `metrics` | tempo por fase, filas, rejects, tamanho do set, bytes por tipo → endpoint JSON para o Admin | `stats()` |
| `tools/` | conversor `.lnd`→`.hgt`, replay, verificador de AOI | — |

Dados (mapa `.wld`/`.rgn`/`propMover`/tabelas de combate) são lidos hoje por `shared/formats`; no início o Node exporta JSON/binário ("pacote de mapa") para o Rust consumir, evitando reescrever os parsers de formato FlyFF no dia 1.

## 7. Ordem de migração (strangler, cada passo reversível)

| Fase | Entrega | Critério de saída |
|---|---|---|
| **0 — Fechar vazamentos no Node (já)** | Seleção/ações validadas contra `Conn.mobs`/`seen`; `partyView` sem `w/x/z` fora do set; `hit/mdie/skillfx/emote` filtrados por conhecimento; cliente: nameplate só de `enter`; `friendOn`/chat não criam rótulo 3D | testes de §8 passam no Node; é a **especificação executável** do Rust |
| 1 — Esqueleto Rust | `link` + Hello/Attach/Detach + eco + métricas | loadtest conecta pelo Gateway |
| 2 — Shadow | Node espelha C2S de movimento; Rust calcula grade/AOI e **compara** interest sets | <1 % divergência por 48 h de loadtest |
| 3 — Corte AOI + movimento + mobs por mapa | flag `world.<mapa>.engine = node\|rust`; começar por mapa pequeno/dungeon, **Madrigal por último** | p99 tick <25 ms com 300 bots + 8 k mobs; zero violação do oráculo de AOI |
| 4 — Combate | fórmulas portadas; drops via `GrantItem` RPC | testes de equivalência por seed: mesmo dano que o Node |
| 5 — Skills/buffs e, por último, inventário | troca de dono da tabela, janela de manutenção | 24 h estável, memória plana |

Rollback: voltar a flag do mapa para `node` e reiniciar o mapa (~5 s, personagens salvos e reconectam). Manter o módulo Node 2 semanas após cada corte. Fica no Node de início: login, inventário, lojas, trade, banco, GM/admin, party/guild/amigos, chat global, CDN.

## 8. Como validar

- **Determinismo**: RNG por mapa com seed, relógio = contador de ticks; mesmo log de entrada + seed → mesmo hash de estado após N ticks.
- **Replay**: Gateway grava C2S com tick (arquivo rotativo, ativável); ferramenta `replay` roda offline.
- **Oráculo de AOI no loadtest** (`tools/loadtest.ts` ganha verificador): todo id/nome em qualquer quadro recebido tem de ter chegado antes por `enter` e não ter `leave`. Violação = teste falha.
- **Teste "amigo em Flaris"**: bot A em Flaris, bot B em Saint Morning, amigos e party → B nunca recebe pos/mapa de A, nenhum `enter` de A, party de B com `pos:null`, nenhum nameplate.
- **Teste "clicar mob fora da visão"**: bot guarda id de mob, afasta-se para fora do set, envia `atk/skill/pick` → nenhum `hit`, HP do mob igual, `rejects.not_visible` +1.
- **Histerese**: bot oscilando na borda 60 s → ≤2 pares enter/leave.
- **Carga** *(metas est.)*: 300 bots numa célula (cidade), 300 espalhados, 100 caçando; <8 KB/s por jogador; p50/p99 de tick por fase.
- **Equivalência de combate**: tabela de casos (nível/equip/mob) → dano idêntico Node×Rust com a mesma seed.
- Métricas no Admin: tick por fase, filas, descartes, rejects por motivo, interest set médio/máx, bytes por tipo.

## 9. Riscos

1. Fórmulas de combate divergirem (porte de `combat.ts`/`skills.ts`) → testes por seed antes do corte.
2. Dois donos escrevendo `inventory` → um dono por tabela; RPC até a fase 5.
3. Gateway Node virar gargalo de relay → Rust emite bytes prontos; reavaliar se >30 % CPU.
4. Altura/colisão no servidor depende do pipeline `.lnd`→`.hgt` → começar só com limites de Δy; colisão de objetos fica no cliente.
5. Escopo: `realtime.ts` tem ~2400 linhas; migrar por mapa e por módulo, nunca de uma vez.
6. Conglomerados (cidade com 300 jogadores numa célula) → teto por prioridade e jogadores distantes a 2 Hz.
7. Mudanças em `realtime.ts`/cliente feitas por outros masters durante a migração → contrato de protocolo versionado neste arquivo.

## 10. Pendências / decisões em aberto

- Confirmar no código do cliente (`client/net.ts`, `client/main.ts`, `client/party.ts`) exatamente qual canal cria o nameplate do amigo (hipótese principal: `party`); a fase 0 corrige os candidatos de uma vez.
- Medir baseline do Node (`tools/loadtest.ts`) antes de fixar os números de tick/orçamento.
- Definir com Master Database o esquema de eventos de persistência e quem roda as migrações.
- Definir com Master Login o handshake `Attach` e a migração do `WORLD_NODE` para o link TCP.

## 11. Status da implementação (2026-11-01)

| Item | Estado |
|---|---|
| Fase 0 (Node): ações validadas pelo conjunto visível, party sem posição fora da visão, eventos filtrados | feito; `tools/test-aoi.ts` (6 checks) passa contra servidor local |
| Rust instalado | rustc/cargo 1.99.1 (MSVC), `cargo test` em `game-server/` |
| `game-server/src/grid.rs`, `aoi.rs` | feito, 5 testes |
| `game-server/src/combat.rs` | `player_hits_mob`, `mob_hits_player`, `mob_def`, `exp_for`; **800 casos de equivalência** com o `CombatRules` do Node (`tools/combat-vectors.ts` → `tests/vectors.json` → `tests/equivalence.rs`) |
| `game-server/src/mobs.rs` | patrulha, aggro, perseguição, leash, morte/respawn, invocação, `near()`; mesmo xorshift do Node (posições iniciais idênticas) |
| Benchmark | `cargo run --release --example bench_mobs -- 100`: ~7,1 mil mobs, 100 jogadores → tick médio 0,29 ms (pior 1,5 ms) vs. orçamento de 50 ms |
| Falta | loader do mapa (.rgn/propMover → `Spawn`), terreno (`.hgt`), link TCP com o Gateway, tick/thread por mapa, skills/buffs, PvP, persistência |

### 11.1 Link TCP + tick (2026-11-01, segunda etapa)

- `game-server/src/protocol.rs`: quadros `u32` BE + corpo **JSON** (nesta etapa; trocar por MessagePack só mexe em `encode`/`read_frame`). Mensagens: `hello{secret,version}` → `hello_ok`; `attach{conn,ch}` / `detach{conn}`; `c2s{conn,msg}` / `s2c{conn,msg}` (o `msg` é o protocolo JSON do cliente: `state`, `atk` → `mobs`, `hit`, `mdie`, `pdie`); `stats`.
- `game-server/src/server.rs`: thread de aceite + 2 threads por link (leitura/escrita) + **uma thread de mapa** dona de todo o estado. Tick de 50 ms (20 Hz), visão/rede a cada 2 ticks (10 Hz). `atk` só vale se o mob está no conjunto de visão (AOI) do jogador, vivo, no alcance e fora da espera; recusas contadas em `stats.rejects_*`. Eventos de combate só vão a quem conhece o mob. `mdie` já leva `exp` para o Node aplicar (RPC de recompensa/drop ainda não existe).
- `game-server/src/main.rs`: `game-server --pack data/mappack/WdMadrigal --secret … [--listen 127.0.0.1:9201]` (recusa escutar fora de loopback).
- `tools/export-mappack.ts`: gera `data/mappack/<Mundo>/{pack.json,attrs.bin}` (spawns + propMover + atributos do terreno, 15 MB em Madrigal). O Rust não parseia formatos FlyFF.
- Testes: `cargo test` (15 unitários + 2 de equivalência + 3 de integração TCP); `tools/test-rust-link.ts` contra o binário com **Madrigal real**: 7368 mobs, tick médio 0,37 ms / pior 0,87 ms, 80 mobs vizinhos todos a <460 u, atk em mob longe recusado, atk em mob visível gera `hit`.
- **Ainda falta**: o Node (Gateway) falar com este link (hoje só o cliente de teste fala), `enter/leave` de jogadores no Rust, altura/colisão, skills/buffs/PvP, recompensas/drops via RPC, persistência de HP/posição, e a flag `world.<mapa>.engine`.

### 11.2 Node → Rust ligado atrás de flag (2026-11-01, terceira etapa)

**Divisão atual (modo "Node calcula o dano")**: o **Rust é dono dos mobs** — posição, IA (patrulha, aggro, perseguição, leash), HP, morte, respawn — e da **área de visão de mobs** de cada jogador (tiles de 64 u, histerese 3→4). O **Node continua dono** de jogadores, fórmulas de dano (inclui elemento/raridade/skills), exp/drops, itens, banco e do cliente WebSocket. As fórmulas Rust de `combat.rs` já são equivalentes (800 casos) e podem assumir com `--rust-combat`.

**Como ligar** (padrão = desligado; sem a flag nada muda):
```
npx tsx tools/export-mappack.ts WdMadrigal                       # uma vez (ou quando o mapa mudar)
cd game-server && cargo build --release
game-server\target\release\game-server.exe --pack data\mappack\WdMadrigal --secret SEGREDO --listen 127.0.0.1:9201
GAME_ENGINE=rust GAME_LINK_SECRET=SEGREDO npm start             # opcionais: GAME_ENGINE_WORLD, RUST_LINK_HOST/PORT
```
**Como funciona** (`servers/world/rustlink.ts` + bloco "motor Rust" em `realtime.ts`):
- A cada tick o Node sincroniza: anexa ao Rust quem entra no mundo dele, manda as posições aceitas (`pos`) e o flag "intocável" (morto/invisível); solta quem saiu.
- O `mobs` que o Rust gera (entrou/mudou/saiu) é repassado ao cliente e **é a única fonte de `c.mobs`**, que `atk`/`skill`/`pick` conferem; os `Mob` do Node viram espelho.
- Golpe/skill: o Node calcula e chama `mobs.damage` → `damage` ao Rust, que **reconfere a visão** (recusa e conta em `rejects_not_visible`) e aplica HP/morte. O espelho do Node é otimista.
- IA de mob que golpeia: o Rust manda `mob_attack{char, mob}` e o Node roda o `mobAttack` de sempre.
- **Rollback automático**: link caiu → o Node volta a simular os mobs sozinho a partir do espelho; ao reconectar, o jogador é reanexado e o conjunto de visão recomeça (o cliente recebe a limpeza). Testado derrubando/subindo o Rust.
- `//summon` vai ao Rust; `//clearmobs` (invocados) **ainda não** remove os invocados no Rust.

**Testes ponta a ponta** (servidor Node na 9080 + Rust na 9201): `tools/test-aoi.ts` (6 checks, passa com o Rust no comando), `tools/test-rust-e2e.ts` (jogador real: Rust conhece o jogador; mobs chegam pelo relay; **mob agressivo da IA do Rust golpeia o jogador**; golpe gera `hit`; Rust recebe o dano; `mdie`; tick médio 0,68 ms / pior 1,35 ms com 7368 mobs).

**Limites conhecidos**: um mundo (Madrigal) por processo Rust; falta o terreno com altura/colisão de objetos; o espelho de mobs invocados não entra na grade do Node (só importa no fallback); no fallback os mobs continuam de onde o espelho estava (não do estado interno do Rust); PvP/skills ainda calculados no Node; nenhuma persistência no Rust; Admin Panel ainda não liga/mostra o processo Rust.

### 11.3 Jogadores no Rust: visão e movimento (2026-11-02, quarta etapa)

Com `GAME_ENGINE=rust` a **área de visão de jogadores** e o **fan-out de movimento** passam para o Rust (era o que mais crescia com o número de jogadores):
- O Node manda `pos` (x, y, z, rumo, estado) de quem se mexeu e `flags` (morto, **invisível**, **staff**) a cada tick.
- O Rust mantém dois conjuntos de visão por jogador, **separados** (mobs: até 80; jogadores: até 100), sobre a mesma grade de 64 u (janela de entrada 7×7, saída 9×9). Invisível só aparece para staff.
- Mudanças de visão de jogadores vão ao Node como `see{char, enter[], leave[]}`; o Node responde com o `enter`/`leave` de sempre (PlayerView), mantendo `seen`/`viewers` para `look`, `job`, `level`, `pdie`… (`toWatchers` não mudou).
- O `states` (posição dos que o jogador vê) sai pronto do Rust (`s2c`) e o Node só repassa. `refreshView`, `introduce` e a montagem de `states` do Node ficam desligados para quem está no mundo do Rust (voltam sozinhos se o link cair).

Testes: `cargo test` (4 de integração TCP, incluindo "jogadores só se veem por perto e invisível some para não-staff"); `tools/test-rust-players.ts` (2 jogadores reais: `enter` mútuo, `states` de movimento, GM invisível visto por staff, `leave` ao se afastar; Rust contou see_enter/see_leave/state_updates). `test-aoi.ts` e `test-rust-e2e.ts` seguem passando.

Limites: a visão de jogadores é por janela de células (≈ até 270 u nas diagonais; o Node usava círculo de 150 u); ações entre jogadores (trade, pm, convites por id) ainda não conferem a visão; não foi medido com centenas de bots (próximo: `tools/loadtest.ts` Node × Rust).

### 11.4 Medição Node × Rust com bots (2026-11-02)

`npx tsx tools/bench-engines.ts <node|rust> <bots> <segundos> <espalhar>`: sobe o servidor sozinho (porta 9080), entra com N bots `lt_bot*` no mesmo campo (6744, 2995; espalhados em 300 u, comportamento "walk", 60 s) e mede. Máquina de desenvolvimento (Windows, mesma para bots e servidor — os bots também gastam CPU).

| bots | motor | CPU Node (média/pior) | CPU game-server | lag do event loop p99 | RTT p50 / p95 | recebido pelos bots |
|---|---|---|---|---|---|---|
| 500 | Node | 30 % / 35 % | – | 42 ms | 28 / 45 ms | 19,4 MB/s |
| 500 | Rust | 33 % / 44 % | 17 % | **16 ms** | **6 / 20 ms** | 25,4 MB/s |
| 1000 | Node | 58 % / 64 % | – | 74 ms | 40 / 79 ms | 38,8 MB/s |
| 1000 | Rust | 68 % / 82 % | 35 % | **29 ms** | **18 / 46 ms** | 50,8 MB/s |

Leitura honesta:
- **Latência melhora ~2×** (lag do event loop e RTT p95 caem pela metade), porque o Node deixa de calcular IA/visão/montagem de `states`.
- **A CPU do Node não cai**: o gargalo que sobra é escrever nos WebSockets, e o Rust ainda gasta um núcleo parcial (17–35 %). Somado, o Rust consome mais CPU total; o ganho é tirar a conta de dentro da thread única do Node.
- Os bots recebem ~30 % mais dados no Rust porque os `mobs` saem a 10 Hz (o Node mandava a 5 Hz) e a janela de visão é por células. Ajustável (`send_views` a cada 4 ticks).
- A 1ª versão do caminho Rust (JSON por observador + parse/stringify no Node) era **pior** que o Node (Node a 71 % com 500 bots); o que resolveu foi: texto de cada mob/jogador montado uma vez por envio, quadros "crus" (o Node repassa os bytes), revisão de visão escalonada e espelho dos mobs enviado uma vez por envio.
- O `gap` entre atualizações de posição subiu (≈210 ms p95 contra ≈150 ms): a fase do envio de rede do Rust não está alinhada com os `pos` do Node.

Para ganhar CPU de verdade falta tirar o envio pelos WebSockets de dentro do Node (o Rust falar WebSocket com o navegador — a opção que o memorando deixou para quando o Node virar gargalo).
