> **Atenção (2026-10-23):** o projeto foi reorganizado (seção 27). Os caminhos citados nas seções 1–26 (`server/…`, `game/…`, `web-world-editor/…`, `../Resource`) hoje são os da tabela da seção 27.

# NEXT_STEPS.md — contexto e próximos passos (para o Opus 5.5)

Projeto: **FlyFF Web World Editor** — editor/visualizador de mapas do FlyFF em TypeScript + Three.js (`web-world-editor/`),
construído a partir do código do ATools (`ATools-master/`) e de um cliente FlyFF real (`Resource/`). Objetivo final: usar o
mapa como mundo de um jogo web (Three.js) — e, opcionalmente, exportar para Unreal Engine.

Leia antes: `README.md` (instruções originais), `ANALYSIS.md` (formatos, validados contra os arquivos reais) e
`web-world-editor/README.md` (o que o editor faz hoje).

## 1. Como rodar

```bash
cd web-world-editor
npm install
npm run dev          # http://localhost:5173  (serve ../Resource em /res/* e /api/list)
npm test             # valida leitores contra ../Resource (900 tiles, ~58 mil objetos, 1 567 .sfx…)
npm run typecheck
```
`FLYFF_RESOURCE=<pasta> npm run dev` aponta outra pasta `Resource`. O servidor é só um plugin do Vite (`vite.config.ts`).

## 2. Estado atual (tudo testado no navegador)

| Área | Situação | Arquivos |
|---|---|---|
| Formatos | `.wld .lnd .dyo .rgn .wld.cnt .txt.txt`, `mdlObj/mdlDyna/Terrain.inc`, `defineObj.h`, `propMover`, `character.inc`, `.o3d .chr .ani .sfx`, DDS (DXT + sem compressão) | `shared/formats/*`, `shared/dds.ts`, `shared/humans.ts` |
| Terreno | 129×129 por tile, streaming por raio, texturas reais com blend por camada (multi‑passe como o `CLandscape::Render`) | `shared/terrain.ts` |
| Objetos | `InstancedMesh` por modelo, `.o3d` reais + DDS; partes "light" só à noite; entradas SFX de `mdlObj` viram efeitos | `shared/world.ts` (`buildObjects`), `shared/models.ts` |
| Movers/NPC/mobs | skinning por bloco de material (esqueletos >28 ossos), animação de repouso, spawns do `.rgn` com até 4 mobs/respawn, altura no terreno (voadores via `bFlying`) | `shared/movers.ts` |
| Humanos | NPCs `MI_MALE/MI_FEMALE` montados com `Part_*.o3d` + `character.inc`; **personagem jogável** (WASD, pulo, bloqueio NoWalk/NoMove/Die, crossfade de animação) | `shared/humans.ts`, `shared/player.ts` |
| SFX | todas as partes (Bill/Particle/Mesh/CustomMesh), 60 ticks/s | `shared/sfxRuntime.ts`, `shared/formats/sfx.ts` |
| Ambiente | skybox+nuvens+sol/lua, luz por hora/continente, névoa, água animada, nuvens do mar, **sombras** (shadow map que segue a câmera) | `shared/sky.ts`, `shared/water.ts`, `shared/environment.ts` |
| Navegação | lista de teleporte (cidades por ponto de ressurreição, continentes, regiões) | `editor/main.ts` (`buildPlaces`) |
| Exportação | zip: `world.json` + `tiles/*.bin` + modelos `.o3d` usados (formato `flyff-web-world` v1) | `editor/export.ts` |
| **Edição de mundo** (novo) | botão "Entrar no modo edição": seleciona objetos estáticos, move/gira (Y)/escala (TransformControls), Ao chão, Duplicar, Apagar, Desfazer, exporta alterações em JSON | `editor/editor.ts` |

## 3. Pontos que exigem atenção (aprendidos na prática)

1. **Mapa e Resource mudaram durante o projeto**: hoje `Resource/` é a pasta do cliente (modelos em `Data/Model`, texturas de modelo em
   `Data/Model/Texture`, texturas de terreno em `World/Texture`, SFX em `Data/SFX`, céu em `Data/Weather`). O mapa é o servidor real do
   usuário (388 NPCs, 1 022 respawns, 58 554 objetos) e **tem dados "sujos"**: NPCs diferentes sobrepostos (11 pares a <1,5 unidade),
   objetos duplicados na mesma posição. Isso é dado, não bug do editor.
2. **Tabelas `.inc` são irregulares**: nomes sem aspas (`AiBatt MI_AIBATT1 …`), falta de espaço antes de `""`, IDs simbólicos (`MI_*`) que
   precisam de `defineObj.h`. O parser (`formats/inc.ts`) já cobre; se algo "não carrega", confira primeiro a regex.
3. **Convenções**: espaço D3D (mão esquerda, Y para cima). O grupo `root` tem `scale.z = -1`. Matrizes de objeto: `shared/math.ts`
   (`objectMatrix`, helpers `row*` para vetor-linha). Rotação de objeto = `YPR(-rotY, -rotX, rotZ)`.
4. **Skinning**: índice de osso do vértice = registrador de constante (3 por osso) → `idx/3`, resolvido pela lista `usedBones` **do bloco de
   material** (senão do objeto). Sem isso, modelos com muitos ossos quebram (ex.: LPm840, Koneko).
5. **Ferramenta de edição**: ao aplicar patches em Python via heredoc, `\n`/`\r` em regex/strings viram quebras reais. Use arquivo `.py`
   (ferramenta Write) com `chr(92)` ou raw strings, ou a ferramenta Edit.
6. **Humanos**: sem equipamento o personagem fica de roupa íntima (partes padrão). Cabelo/cor (`hairColor`) ainda não é aplicado.

## 4. Ossos do personagem

**Resolvido (2026-10-17)**: a causa era o leitor `.o3d` — os índices de osso do `SkinVertex` são `SHORT2` (2×int16), mas eram lidos
como 2 bytes. O 2º índice saía sempre 0, então os vértices com 2 pesos (pulsos, cotovelos, joelhos, cintura…) ficavam meio presos ao 1º
osso da lista; na mão direita isso puxava o pulso para o antebraço esquerdo. Afetava **todos** os modelos com skin (mobs e NPCs também).
Detalhes em `ANALYSIS.md` §8. Esqueleto/animação já estavam corretos (tm×inverseTm = I, pose simétrica a ≤7°).

Ainda pendente no personagem: (a) **comparar com um print do cliente original** (não foi feito); (b) aplicar `hairColor`; (c) demais
movimentos (ataque, sentar, voar `MTI_FLY*`, nadar), troca de arma e `m_localRH` do `.chr`; (d) em 212 dos 560 `.ani` do male a ordem dos ossos `Bone01–03`/`Bone05–07` (capa) é trocada em relação ao
`.chr` (e alguns usam nomes `bip02_*` do Blender). O editor aplica por índice (não verifiquei se o cliente remapeia por nome); reavaliar se capas parecerem trocadas.

Movimento (2026-10-17): direção corrigida pela convenção do `CMover` — anda com Δ = (sin a, −cos a), gira com `RotationY(−a)`, logo o
modelo olha para −Z local e `heading = atan2(dx, −dz)` (a fórmula antiga acertava W/S mas espelhava A/D). Pulo em 4 fases (GenJump1–4 do
`mdlDyna.inc`): JUMP1 impulso no chão (sai do chão ao terminar), JUMP2 subida, JUMP3 queda (também ao cair de borda), JUMP4 aterrissagem;
`MoverInstance.play(symbol, loop=false)` + `finished` implementam o ANILOOP_1PLAY. A sequência foi conferida no navegador; o tempo de cada
fase **não** foi comparado com o cliente original.

Colisão (2026-10-17): `shared/collision.ts` monta, por tile, uma grade XZ (células de 8) com os triângulos da malha `m_collObj` de cada
objeto. O player usa terreno ∪ chão de objetos (sobe degraus até 0,7), raios de parede no joelho e no peito (raio 0,35), e ignora os
atributos NoWalk/NoMove do terreno quando está sobre um objeto (pontes sobre rio). Spawn de Flaris fixo em (6976, 3327), sobre a praça.
Testado: travessia da ponte (y 99,66 sobre o rio a 94,2), grades bloqueiam, spawn sobre a praça. Pendente: colisão de movers/NPCs,
câmera atravessando paredes, conferir valores com o cliente.

Interface (2026-10-17): "Spawns (.rgn)" começa marcado. No modo personagem, clique (sem arrastar) no terreno/objeto faz o personagem
andar até lá (`Player.moveTo`; marcador amarelo; teclado cancela; desiste se ficar 0,4 s sem se aproximar, ex.: atrás de uma cerca).
Nomes dos NPCs do `.dyo` acima da cabeça (CSS2DRenderer, até 70 unidades da câmera): `SetName` de `character.inc`/`-etc`/`-school`,
com `IDS_*` resolvido por `character*.txt.txt` (os 370 NPCs do WdMadrigal têm nome); sem personagem cai no nome do `propMover`.
Pendente: nomes não são ocultados por paredes.

Mobs (2026-10-17): patrulha ociosa em `MoverManager.patrol` — espera 2–8 s, sorteia um ponto andável (sem NoWalk/NoMove/Die) dentro do
retângulo do respawn do `.rgn` (ou ±10 da origem), anda em MTI_WALK a ½·fSpeed·60 unidades/s (`propMover` col. 44; Aibatt 0,075 →
2,25 u/s), volta a MTI_STAND. Voadores mantêm a altura. Nome do `propMover` sobre a cabeça. **Não** foi comparado com o cliente oficial:
tempos de espera, velocidade de patrulha e raio são aproximações (o `CAIMonster` não está no ATools); mobs não colidem com objetos nem
reagem ao jogador (agressivos/ataque ainda não existem). `moverLevel` (col. 12) já é lido para um futuro "Lv." no nome.

Seleção de alvo (2026-10-17): clique em mob/NPC seleciona (raio nas malhas do mover; se errar, o mover cujo centro projetado está a
≤28 px do clique — mobs pequenos). Esc desmarca; sair do raio de carga também. Anel no chão (vermelho = mob, amarelo = NPC) girando sob o
alvo e nome em amarelo. Janela de alvo no topo com imagens do tema (`Data/Theme/Default`, TGA decodificado em `shared/tga.ts`):
`WndTargetInfornation02.tga` (fundo 272×72), `TargetNum0-9.tga` (nível do propMover no círculo), `Targetgauge01.tga` (HP, 3 fatias de
5 px). O HP fica sempre cheio (ainda não há combate); o anel no chão não usa imagem do cliente (não achei a textura original de seleção).

Cursores (2026-10-17): conjunto `Data/Cursors/CurDefault1` (hotspot 0,0 nos arquivos): `curBase.cur` normal, `curAttack.cur` (espada)
sobre mob, `curNPC.cur` sobre NPC; o servidor de dev entrega `.cur` como `image/x-icon`. Há outros conjuntos (CurDefault…6, CurTitanium,
CurCustom1/2) e não achei no cliente qual é o padrão. Área de clique/hover do mover = círculo projetado do corpo (`tpl.radius` × escala,
mín. 30 px) além do raio na malha — uma checagem por quadro.

Resposta da corrida (2026-10-17): o personagem pré-carrega STAND/WALK/RUN/JUMP1–4 no spawn (`preloadMotions`) e `MoverInstance.play`
troca no mesmo quadro quando o `.ani` já está em memória; mistura do jogador 0,08 s (mobs/NPCs 0,15 s). Medido: 1 quadro (~21 ms) da tecla
até MTI_RUN.

Rede local (2026-10-17): `vite.config.ts` com `server.host: true` — outros PCs abrem `http://192.168.1.135:5173` (ou a porta que o
`npm run dev` mostrar). O Firewall do Windows já tem regra de entrada para `node.exe` (perfil Público, que é o da rede atual). Atenção:
isso expõe a pasta `Resource/` inteira, só leitura, a quem estiver na rede. Testado só pelo IP a partir deste PC.

## 5. Próximos passos sugeridos (ordem de valor)

1. **Salvar de volta** (`CLandscape::Save`, `CWorld::_saveDyoFile/_saveRgnFile` em `ATools-master/Common`): aplicar o JSON de
   `exportEdits` (`editor/editor.ts`) em `.lnd` (v3: reescrever cabeçalho, alturas+atributos, água, camadas com BGRA, listas de objetos
   com `pos/4`, menos a origem do tile) e `.dyo/.rgn`. Escrever testes de *round trip* (ler → salvar → ler → comparar bytes) nos 900 tiles.
2. **Estender o modo edição**: movers do `.dyo`, respawns/regiões (retângulos arrastáveis), SFX, adicionar objeto do catálogo
   (`mdlObj.inc`), pintura de terreno (altura, atributos NoWalk/NoFly/NoMove, camadas/alpha), água.
3. **Exportação para jogo web** (`editor/export.ts` já gera `world.json` + tiles binários): converter modelos para **GLB** (estáticos,
   movers com `.ani` como animações, humanos por partes), texturas DDS → KTX2/WebP, instanciar por modelo; *streaming* de tiles pelo
   `world.json`. Meta: cliente Three.js que carrega só o export (sem `Resource/`).
4. **Gameplay base**: colisão com objetos (`collObj` do `.o3d`, `CObject3D.m_collObj`), câmera 3ª pessoa melhorada, NPC com diálogo
   (`character.inc` `AddMenu`, `m_szDialog`), mobs com IA simples (`propMover.txt`), equipar itens (`II_*` → `Part_*`).
5. **Unreal Engine** (opcional; o 5.8 não foi avaliado — verifique a documentação da versão): partir do mesmo `world.json` + GLB;
   heightmap 16‑bit por tile (Landscape), instâncias (HISM) por modelo, script Python do editor para espalhar atores. A decisão
   Three.js × Unreal deve seguir o objetivo "jogo web".
6. **Qualidade/performance**: LOD de terreno e objetos (`.o3d` tem 3 grupos LOD), *culling* por tile, texturas comprimidas, `MoverManager`
   com orçamento por frame, cascata de sombras, `OffscreenCanvas`/Worker para parsing.
7. Resíduos conhecidos: efeito submerso (`UnderWaterVertex`), clima (`C_weather`), `.sfx` em objetos com `modelType` SFX sem arquivo
   (`sfx_xwater`, `sfx_cyber`), 500 ocasional do servidor de dev para nomes de arquivo com caracteres especiais (investigar).

## 6. Regras de trabalho que o usuário valoriza

* Priorizar o código real do ATools antes de inventar estruturas; manter compatibilidade com formatos originais.
* Verificar no navegador (Browser pane) e dizer com franqueza o que não foi comparado com o cliente original.
* Responder em português; mudanças pequenas e testáveis; documentar descobertas de formato em `ANALYSIS.md`.

## 7. Fase 1 do jogo multiplayer — reorganização (CONCLUÍDA em 2026-10-17)

Objetivo: separar o jogo (cliente + servidor) do editor, mantendo o editor funcionando. Mapa feito lendo `shared/main.ts` (970 linhas):
os outros módulos já são independentes; só o `main.ts` mistura mundo, jogador e editor.

Estrutura alvo (mesmo `package.json` em `web-world-editor/`):
- `shared/`: `formats/`, `math`, `dds`, `tga`, `data`, `models`, `movers`, `humans`, `collision`, `terrain`, `water`, `sky`, `environment`,
  `sfxRuntime`, `player`, `target` + **`world.ts` (classe `WorldView`)** extraída do `main.ts`: renderer/cena/câmera/OrbitControls,
  streaming de tiles (`loadTile`/`disposeTile`/`buildObjects`/`stream`), colisão (`collReady`), `MoverManager` (candidatos de `.dyo`/`.rgn`,
  `variant`/`labelOf`/`speedOf`/`walkable`), ambiente/sombra/céu/água/SFX, `sampleHeight`/`attrAt`, `spawnPlayer`, clique para andar,
  seleção de alvo + `TargetWindow`, cursores, loop de quadros com gancho `onFrame`. O que hoje lê checkboxes vira estado da instância:
  `layers {terrain, objs, sfx, water, sky, movers, spawns, wireframe}`, `radius`, `settings {hour, worldLight, worldFog, shadows, sunTilt}`,
  `playerControl`, `inputBlocked()` (editor em modo edição), callbacks `onStatus`/`onEnvironment`. `handleClick(ev)` → true se selecionou alvo ou moveu.
- `editor/`: `index.html` (o atual), `main.ts` (painel, marcadores/overlays de `.dyo`/`.rgn`/regiões/continentes/grade, `pick` com
  info, `WorldEditor`, locais/teleporte, exportação), `editor.ts`, `export.ts`, `style.css`.
- `game/`: `index.html` + `main.ts` usando `WorldView` com câmera presa ao jogador, spawn automático em Flaris (6976, 3327), sem painel
  de edição; HUD mínimo.
- `server/`: `resources.ts` (middleware `/res` + `/api/list`, hoje dentro do `vite.config.ts`; reaproveitado pelo plugin do Vite) e
  `index.ts` (Node http via `tsx`: serve `dist/` — jogo em `/`, editor em `/editor/` — e `/res`). `npm start`. WebSocket fica na fase 2.
- Vite multipágina (`rollupOptions.input`: `index.html` raiz com links, `editor/index.html`, `game/index.html`); `tests/` passam a importar de `shared/`.

Ordem segura: (1) mover arquivos para `shared/` e `editor/` só trocando imports → typecheck/test/navegador; (2) extrair `WorldView`
e fazer o editor usá-lo → conferir tudo no navegador (spawn, colisão, mobs, alvo, cursores, edição); (3) `game/`; (4) `server/`.
Fase 2: servidor autoritativo dos mobs (patrulha sai do cliente) + jogadores via WebSocket. Fase 3: combate/HP real, chat, contas.

**Feito (2026-10-17)**: estrutura `shared/` `editor/` `game/` `server/` como acima. `WorldView` (`shared/world.ts`) concentra o mundo; o
`editor/main.ts` virou só painel/marcadores/inspeção/edição/locais/exportação; `game/main.ts` tem tela de entrada (nome, sexo, qualidade
alta/baixa — baixa = raio 2, sem sombra, resolução 1×) e spawn em Flaris. `npm run build` gera `dist/` (início, `/game/`, `/editor/`);
`npm start` (`server/index.ts`, porta 8080, rede local) serve `dist/` + `/res` (com `cache-control` de 1 h nos arquivos do cliente).
Estilos de nomes/janela de alvo em `shared/world.css`. Verificado no navegador: editor (spawn, corrida, nomes, modo edição selecionando
objeto, inspeção), jogo no dev (5173) e compilado no servidor (8080) com qualidade alta e baixa; testes e typecheck passam.
Os 404 que aparecem no console são do `/favicon.ico` pedido pelo painel do navegador (as páginas têm ícone vazio).
Pendente: `world.js` compilado tem 624 kB (aviso do Vite; dividir depois), FPS baixo relatado no notebook pela rede (a opção "Baixa" é o
primeiro passo; medir lá). Próximo: fase 2 (WebSocket em `/ws` no `server/index.ts`, jogadores e mobs controlados pelo servidor).

Pé no chão (2026-10-17): a malha `part_maleFoot.o3d` desce até y = −0,049 na pose de bind, então o humano parado afundava ~5 cm.
`loadHumanTemplate` calcula `tpl.lift` = −(menor y das partes) e `MoverInstance` desenha as malhas num grupo `body` erguido por esse valor
(vale para o jogador e os NPCs humanos; mobs não mudam). Medido: parado, sola em +0,000; correndo, a passada do `GenRun.ani` ainda desce
o pé até −0,06 em alguns quadros.

## 8. Fase 2 — banco de dados (decidido em 2026-10-17)
- **Banco novo, separado** do servidor oficial que roda nesta máquina (`MARCIO\SQLEXPRESS`: `ACCOUNT_DBF`, `CHARACTER_01_DBF`,
  `LOGGING_01_DBF`, `RANKING_DBF`): o jogo web não escreve neles.
- Estrutura oficial mapeada (só leitura, autenticação do Windows): `ACCOUNT_TBL(account, password varchar(32), …)`,
  `ACCOUNT_TBL_DETAIL(m_chLoginAuthority, BlockTime, email…)`, `CHARACTER_TBL` (~130 colunas: `m_szName`, `dwWorldID`, `m_vPos_x/y/z`,
  `m_fAngle`, `m_dwSex`, `m_dwHairMesh`, `m_dwHairColor`, `m_dwHeadMesh`, `m_nJob`, `m_nLevel`, HP/MP, `m_dwGold`…), `INVENTORY_TBL`
  (inventário/equipamento em texto). Servem de referência para o esquema novo e para uma importação opcional no futuro.
- Motor: **PostgreSQL 18** (serviço `postgresql-x64-18`, `localhost:5432`). Banco **`flyffweb`** (UTF-8), dono **`flyffweb_app`**
  (login próprio do jogo, senha aleatória). Senhas em `%APPDATA%\postgresql\pgpass.conf` (fora do projeto; nunca no código) — o `psql`
  e o driver `pg` do Node leem esse arquivo sozinhos. `psql`: `C:\Program Files\PostgreSQL8in\psql.exe -h localhost -U flyffweb_app -d flyffweb`.
- O banco `postgres` guarda as tabelas do cliente Unreal (`public.accounts`, `characters`, `items`, `guilds`, `mob_spawns`… — vazias
  em 2026-10-17): **não mexer**. O SQL Server oficial também fica intocado (só leitura, autenticação do Windows).
- **Feito (2026-10-17)**: `server/db/index.ts` (pool `pg`, senha lida do pgpass por código próprio — o suporte embutido do `pg` está
  obsoleto), `migrate.ts` + `migrations/001_accounts_characters.sql`, `import-flyff.ts` (`npm run db:migrate` / `db:import`).
  Tabelas: `accounts` (username único sem diferenciar maiúsculas, `password_hash` scrypt do jogo web — ainda vazio —, `legacy_password`
  = MD5 32-hex do FlyFF, `authority` F…Z, `blocked_until`, `legacy_account`) e `characters` (slot 0–2, nome único entre não apagados,
  aparência, classe/nível/exp/gold/atributos/HP-MP-FP, mundo/posição/ângulo, `legacy` jsonb com CHARACTER_TBL + INVENTORY_TBL/EXT).
  Importados: conta `Marvin7` (Z) e personagem `MikePanqueca` (nível 73, mundo 1). Repetir a importação não duplica; personagens já
  existentes só mudam com `--overwrite`. Atenção: a posição salva dele é (3223, **11**, 3417) — abaixo do terreno; o servidor deve
  assentar o personagem no chão ao entrar.
- Login das contas importadas (pendente, fase 2): o MD5 do FlyFF costuma ser `md5(sal + senha)` com um sal do servidor (não confirmado
  para este servidor). Plano: no primeiro login, conferir com o sal configurado e gravar `password_hash` (scrypt); depois só o hash novo.
- `npm audit` resolvido (2026-10-17): vite 5.4.10 → **6.4.4** (esbuild 0.25), tsx 4.19.2 → 4.23.15 (esbuild 0.28), fflate 0.8.2 →
  0.8.3; `npm audit` = 0 vulnerabilidades. `vite.config.ts` não mudou. Testado: typecheck, test, build, `npm start`, e no Vite 6
  `/editor/` (mundo carrega) e `/game/` (entrada → personagem em Flaris), sem erros no console. O Vite 6 só aceita `Host` que seja
  IP ou localhost: pelo IP da rede funciona (`http://192.168.1.135:5173`), nome desconhecido recebe 403. Para entrar por um nome
  (DNS, túnel tipo ngrok), acrescentar esse nome em `server.allowedHosts` — evitar `allowedHosts: true`, que desfaz a proteção.
  Fica para depois: Vite 8 (troca o bundler para Rolldown).

## 9. Tela de login (2026-10-17)
- `game/`: janela de login montada com peças do tema (`shared/tga.ts` → `themeTiles` junta `WndTile00–11`/`WndEditTile00–08` para
  `border-image`; botões `.bmp` são tiras de 4 estados; `ButtCheck.tga` 6 quadros). Lista "Contas salvas" guarda só nomes de conta
  no `localStorage` (nunca senha). Fundo: `MapLoading_Flaris.png` (tem "Loading..." desenhado) até o mundo carregar, depois Flaris em 3D
  girando (`controls.autoRotate`). Depois do login: 1º personagem da conta (aparência sexo/cabelo/cabeça do banco; posição salva se
  mundo 1 e dentro do mapa, senão Flaris).
- Servidor: `server/api.ts` (`POST /api/login`, `GET /api/session`, `POST /api/logout`; JSON; limite de 8 falhas/IP em 5 min; mesmo custo
  de tempo para conta inexistente; bloqueio por `blocked_until`; sessões em memória 12 h, token Bearer), `server/auth.ts` (scrypt; MD5
  legado com `FLYFF_MD5_SALT`), `server/accounts-cli.ts` (`npm run account -- create|set-password|add-character|list`). Montado no Vite
  (dev) e no `server/index.ts`. `resources.ts` agora devolve `image/bmp|png|jpeg|x-icon` para o CSS.
- Testado no navegador (dev 5173): senha errada recusada; conta de teste `teste` (senha em `server/db/dev-test-account.local.json`) entra
  com o personagem `Tester` em Flaris. API testada também na 8080 (local e pelo IP da rede).
- **Não testado**: login da conta importada `Marvin7` com a senha real — depende do sal MD5 do servidor oficial (padrão `kikugalanet`).
  Se não entrar, `npm run account -- set-password Marvin7` define uma senha do jogo web.
- **2026-10-17 (depois)**: a pedido do usuário o `flyffweb` foi zerado (contas e personagens apagados, inclusive a importação do
  `Marvin7`, cujo login MD5 não funcionou — sal desconhecido; reimportar com `npm run db:import` se quiser). Recriada só a conta `teste`
  (senha nova em `server/db/dev-test-account.local.json`).
- **Seleção e criação de personagem** (`game/`): depois do login vai para "Personagens" (3 vagas; clique seleciona e mostra o personagem
  em 3D no palco de Flaris, girando — `Player.preview`; duplo clique ou Ok entra; Back faz logout) ou, sem personagem, direto para
  "Criar personagem" (nome 2–16 letras/números, sexo, cabelo 1–10, rosto 1–24 com as setas `ButtLeft/ButtRight.tga`; prévia 3D atualiza
  a cada escolha). API `POST /api/characters` (Bearer): valida nome/aparência, 1º slot livre, máx. 3, nome único sem diferenciar
  maiúsculas (409). Botões `.tga` (`ButtOk/Create/Back`) decodificados; ordem dos quadros dos botões corrigida (0 = destaque laranja,
  1 = normal cinza, 2 = pressionado, 3 = desabilitado; setas: 0 normal, 1 destaque).
- Testado no navegador: login `teste` → criação → nome inválido recusado → "Bremer" (feminino, cabelo 3, rosto 2) criado → seleção →
  Entrar → no mundo com o nome em cima. API: nome repetido 409, aparência inválida 400, sem sessão 401.
- Pendente: cor do cabelo (o renderizador ainda não aplica `hairColor`), classe inicial (todos Vagrant, job 0), apagar personagem,
  salvar posição ao sair, usar o token no WebSocket (fase 2).

## 10. Interface do jogo: menu e janela de status (2026-10-17)
- `game/hud.ts` (`GameHud`): botão `ButtMainMenu.tga` (4 quadros 75×12) no canto inferior esquerdo → menu `WndTaskMenu.tga` (192×496)
  com os 22 itens da captura do usuário (Status T … Desconectar, Sair), ícones `Data/Icon/icon_Menu*.dds|png` (DDS A8R8G8B8 decodificado
  em `shared/tga.ts` → `iconImage`) e submenus (Itens especiais, Comunicação, Comunidade, Ajuda). Só **Desconectar** funciona (logout no
  servidor → volta à tela de login, esconde menu/status); o resto fica desabilitado com "em breve". Esc ou clique fora fecha.
- Janela de status `WndStatus1.tga` (192×112): "Nome - Nv. N", retrato e barras HP/MP/FP/Exp em x 101–177 (linhas 27/42/57/73).
  Arrastável (mouse e toque, presa à tela), posição salva no `localStorage` (`flyff.statusPos`). Retrato = `WorldView.portrait()`:
  renderiza o rosto UMA vez numa textura 96×96 fora da tela (sem custo por quadro). A interface só escreve no DOM quando algo muda.
- **Provisório**: máximos de HP/MP/FP (`provisionalMax` em `hud.ts`, fórmula simples por nível) até portarmos as do servidor; Exp 0%.
  A API agora devolve `hp/mp/fp/exp` dos personagens (0 = novo → cheio).
- O tema usado é o `Default` do `Resource` (laranja/branco); a captura do usuário mostra um tema escuro/dourado do cliente dele.
- Testado no navegador (dev 5173): entrar → janela de status com retrato e valores; arrastar e posição salva; menu abre com ícones;
  submenu "Comunidade" abre ao lado; Desconectar volta ao login e apaga o token. FPS não comparado de forma confiável (painel oculto).

## 11. Ajustes visuais (2026-10-17)
- Prévia da seleção/criação: personagem **parado, de frente, corpo inteiro e mais perto** (enquadramento pela altura do modelo,
  deslocado para não ficar atrás da janela); nomes dos NPCs escondidos durante a prévia.
- Fontes maiores: janelas de 11 → 14 px (título 15 px; campos, botões, setas e espaçamentos proporcionais; login 460 px, laterais 330 px),
  menu 13 px, status 12–13 px, nomes sobre as cabeças 14 px, janela do alvo 15 px.
- Logo **ReactioN / MMO** (SVG em `game/index.html`, estilo do logo do Flyff: azul com contorno branco e sombra, estrela no pingo do "i",
  "MMO" cinza espaçado). Fonte Fredoka do Google Fonts (sem internet usa fontes arredondadas do sistema); a estrela é reposicionada
  quando a fonte termina de baixar. Removidos o `logotitanium.png` e a imagem `MapLoading_Flaris.png` do fundo do carregamento
  (agora gradiente escuro até o mundo 3D aparecer).
- Botões `.bmp` do tema: a cor-chave magenta (255,0,255) vira transparente (`keyedImage` em `shared/tga.ts`) — aparecia como borda
  rosa ao aumentar os botões.
- Logo trocado (2026-10-17) pela imagem enviada pelo usuário: `game/logo-reaction.webp` (fundo já transparente; recortada e reduzida a
  760×299, 48 kB). O SVG/estrela foram removidos; o "MMO" embaixo continua em texto (Fredoka, cinza com contorno branco).

## 12. Fase 2 — multiplayer: jogadores se vendo (2026-10-17)
- **Servidor** `server/realtime.ts` (biblioteca `ws`): WebSocket em `/ws` no mesmo servidor HTTP — ligado no Vite (`vite.config.ts`,
  dev 5173) e no `server/index.ts` (8080). Protocolo JSON:
  - cliente → servidor: `{t:'join', token, characterId, p?}` (token do `/api/login`; o servidor confere a sessão e se o personagem é da
    conta) e `{t:'state', p:[x,y,z], h, s}` (posição FlyFF, rumo em graus, estado `stand|walk|run|jump1–4`).
  - servidor → cliente: `{t:'welcome', id, players}`, `{t:'enter', player}`, `{t:'leave', id}`, `{t:'states', list:[[id,x,y,z,h,s]…]}`
    (agrupado, 10×/s, só quem mudou) e `{t:'error', error}` (e fecha).
  - Validação: números de verdade (null/NaN recusados — um `NaN` virava `null`→0 e salvou a Bremer em 0,0,0 no 1º teste), dentro do mapa,
    salto máximo de 60 unidades entre mensagens (teleporte ignorado), estados conhecidos. Mesmo personagem aberto em outro lugar derruba a
    conexão antiga. Ping a cada 15 s derruba conexões mortas. **Posição salva no banco ao sair** (`pos_*`, `angle`, `last_online_at`).
- **Cliente** `game/net.ts`: `NetClient` (conecta ao entrar no mundo, manda o estado no máx. 10×/s e só quando muda, reconecta sozinho com
  espera crescente se a rede cair, aviso no topo) e `RemotePlayers` (modelo humano com aparência do banco, nome em cima, animações
  iguais às do jogador, posição/rumo suavizados a cada quadro; salto > 40 = teletransporta). HUD mostra "N online". Desconectar fecha o
  WebSocket antes do logout. `Player.animState` exposto.
- **Testado**: protocolo com clientes Node (entrar/sair, estados, NaN/teleporte recusados, personagem de outra conta recusado, posição
  salva); no navegador, duas abas (teste/Bremer e teste2/Visitante) com "2 online" e cada um vendo o outro com nome; observador recebeu
  o Visitante correndo e pulando (~10 atualizações/s); 8080 pelo IP da rede.
- Contas de teste: `teste`/`teste` (Bremer, Novato) e `teste2`/`teste2` (Visitante, criado no teste do protocolo).
- **Confirmado pelo usuário (2026-10-17)**: teste em duas máquinas reais (PC + notebook na rede) — as contas se viram.
- **Limites conhecidos**: servidor ainda confia no cliente para colisão/altura (só limita salto); mobs continuam calculados em cada
  cliente (cada um vê a patrulha diferente) — próximo passo é mover a IA dos mobs para o servidor; sem chat; sessões em memória
  (reiniciar o servidor derruba todos).

## 13. Painel admin (2026-10-18)
- `npm run admin` → `server/admin/index.ts` (Node, porta 8090, só 127.0.0.1; abre o navegador no Windows, `--no-open` não abre).
  Interface em `server/admin/public/` (HTML/CSS/JS puro, sem build), no estilo do painel da Unreal do usuário (barra lateral; só
  Dashboard e Account ativos, o resto "em breve").
- **Dashboard**: Iniciar / Parar / Reiniciar / Compilar (`npm run build`) o servidor do jogo; cartões (players online, serviços 2/2,
  conexões WS desde o boot, uptime), gráfico de mensagens/s e jogadores (3 min), cartões do jogo (latência, RAM, uptime, PID, sessões,
  msg/s) e do PostgreSQL (latência, tamanho, contas, personagens), tabela de quem está online e logs (jogo/build/painel).
  `server/admin/game-process.ts` roda o jogo como `node --import tsx server/index.ts` (um processo só; o CLI do tsx deixava um filho órfão
  segurando a porta) com `ADMIN_TOKEN` novo a cada início; recusa iniciar se a porta 8080 estiver ocupada por outro processo.
- **Account** (`server/admin/accounts.ts`): busca por usuário e por personagem (paginada), criar conta (senha opcional, personagem
  opcional, Jogador F / Admin Z), Kick, Banir (1/7/30 dias/permanente, derruba na hora), Desbanir (também pelo nome da conta ou do
  personagem) e Senha.
- Jogo: `server/internal.ts` (`/internal/stats`, `/internal/kick`; só loopback + cabeçalho `x-admin-token`); `realtime.ts` conta conexões e
  mensagens e ganhou `stats()`/`kickAccount()`; `api.ts` ganhou `revokeAccount()` (kick/ban derrubam também a sessão).
- Segurança do painel: escuta só em 127.0.0.1, API exige `x-admin: 1` (sem CORS, outros sites não conseguem) e confere o Host (421 para
  outros nomes — DNS rebinding); `X-Frame-Options: DENY`. Sem login: não abrir na rede.
- Testado: iniciar pelo painel (2/2 serviços, latência 1 ms, 82 MB); jogador simulado aparece online (18 msg/s) no Dashboard e na Account;
  Kick derruba ("Você foi desconectado pelo administrador."); ban recusa o login (403 "Conta bloqueada até…"); desbanir pelo personagem;
  criar conta `teste3`/`teste3` (personagem Terceiro) e trocar senha; validações de senha curta.
- Pendente/ideias: Parar Todos/Iniciar Todos quando houver mais serviços; páginas World/Characters/Mobs; apagar conta; login no painel
  se um dia ele precisar ficar acessível pela rede.

## 14. Mobs no servidor (2026-10-18)
- `server/world.ts` (`ServerWorld`): lê do Resource o `.wld`, os respawns do `.rgn`, `propMover.txt` (velocidade col. 44, voo col. 46,
  com os `#define` dos `define*.h`) e os atributos do terreno dos `.lnd` sob demanda (destinos andáveis). Mesmos leitores do cliente.
- `server/mobs.ts` (`MobWorld`): 960 respawns de mover → **7368 mobs** (o `count` inteiro de cada respawn; o cliente antigo mostrava no
  máximo 4 por respawn), posições iniciais com sorteio determinístico. Mesma patrulha que o cliente fazia (parado 2–8 s, ponto andável no
  retângulo ou ±10 da origem, ½·fSpeed·60 u/s). Grade de 64 unidades para achar os mobs perto de cada jogador. Benchmark: carga 39 ms;
  um passo de simulação ≈ 3 ms para os 7368.
- `server/realtime.ts`: os mobs avançam a cada tick (10×/s); a cada 200 ms cada jogador recebe `{t:'mobs', a, u, d}` com os mobs a até
  150 unidades (no máx. 80): entraram (`[id, modelId, x, z, h, s, y?]`, y só de voadores), mudaram (`[id, x, z, h, s]`) e saíram (`id`).
  Tráfego medido: ~6 KB/s por jogador perto de um respawn cheio. `stats()` mostra `mobs`; o Dashboard do painel também.
- Cliente: `WorldView.serverMobs = true` no jogo (não cria mobs de respawn localmente; o editor continua com a patrulha local);
  `MoverManager.addExternal/moveExternal/removeExternal` (mobs do servidor com o mesmo modelo, nome, seleção, cursor de espada;
  posição/rumo suavizados e assentados no terreno no cliente). `game/net.ts` → `onMobs`/`onReset`.
- Testado: dois clientes no mesmo ponto recebem os mesmos 80 mobs com diferença de posição 0,00; no navegador os Aibatts aparecem com
  nome (52 rótulos no campo de Aibatt), 42–46 fps com 80 mobs e 88 nomes (aba em primeiro plano). Servidor da 8080 compilado e reiniciado
  pelo painel (7368 mobs, 127 MB).
- Os testes moveram Bremer/Visitante para o campo de Aibatt (a posição é salva ao sair); devolvidos a Flaris no banco.
- Pendente: respawn/morte (ainda não há combate), mobs agressivos perseguindo jogadores, colisão dos mobs com objetos no servidor,
  dormir a simulação longe de todos os jogadores (economia de CPU com muitos mapas).

## 15. Correções após o teste em duas máquinas (2026-10-18)
- **Causa de "não nos vemos"**: cada conta estava num servidor diferente — uma na 8080 (painel) e outra na 5173 (servidor de
  desenvolvimento, que também hospeda o multiplayer e os mobs). Cada servidor é um mundo separado; os mobs pareciam iguais porque
  os dois sorteiam as posições iniciais com a mesma semente. O HUD agora mostra `N online · servidor :PORTA`. **Para jogar, usar sempre
  a 8080** (a 5173 é só para desenvolvimento).
- **Boneco parado e sem nome na praça**: `Player.spawn` removia o boneco antigo no começo e criava o novo depois de carregar; dois
  spawns cruzados (Entrar clicado com a prévia ainda carregando) deixavam o 1º órfão. Agora só o último pedido vale (`spawnSeq`) e
  `remove()` cancela um spawn pendente.
- Posição ao deslogar: já era salva (ao fechar o WebSocket). Conferido: a Visitante ficou salva no campo de Aibatt (7024, 3438) quando
  o servidor reiniciou; ao logar de novo o personagem volta para lá.
- Testado na 8080: Bremer (teste) e Terceiro (teste3) no mesmo servidor, "2 online", um vendo o outro com nome; só uma Bremer na cena
  ao clicar Entrar com a prévia carregando.

## 16. Inventário, barra de atalhos e chat (2026-10-18)
- `game/ui.ts`: `GameWindow` genérica com a moldura WndTile00–11 — arrasta pelo título, redimensiona pela borda direita/inferior e
  pelo canto, X fecha (ButtWndExit.tga), traz para frente ao clicar; posição e tamanho salvos no navegador (`flyff.wnd.*`) e sempre
  dentro da tela.
- **Inventário** (tecla **I** ou menu → Inventário): equipamentos no topo do `WndInventory.tga` (14 espaços com nome no hover),
  campo Buscar, grade de slots 32 px que ganha colunas/linhas ao redimensionar — 42 slots abertos, o resto trancado
  (`ButtLock.tga`) —, e penya (0 por enquanto). Ainda sem itens: falta a tabela de inventário no banco e o `propItem`.
- **Barra de atalhos**: `WndNewTASKBAR.tga` embaixo ao centro, slots 1–0 (teclas 1…0 ou clique, efeito `UseSlot.tga`) e barras
  HP/MP/FP à direita. Slots vazios até termos itens/habilidades.
- **Chat**: janela móvel e redimensionável (canto inferior esquerdo de início); Enter abre a caixa / manda, Esc sai. Protocolo novo
  em `server/realtime.ts`: `{ t: 'chat', text }` → todos recebem `{ t: 'chat', id, name, text }`; o servidor limpa caracteres de
  controle, corta em 200 caracteres e limita a 5 mensagens a cada 5 s por conexão. O cliente mostra só texto (sem HTML).
- A dica de teclas foi para o topo (não fica atrás do chat/atalhos); o aviso de conexão desceu um pouco.
- Próximos: itens no banco (inventário/equipados, penya), arrastar item entre slots e para a barra, abas do chat (geral/grupo/
  guilda/sussurro) e canais por distância.

## 17. Itens no banco: inventário, equipados e penya (2026-10-18)
- **Banco** (`server/db/migrations/002_items.sql`): tabela `character_items` (personagem, container 0 = bolsa / 1 = equipado,
  slot, item_id, count). Na bolsa o slot vai de 0 a 41; no equipado o slot é o `PARTS_*` do FlyFF (2 roupa, 4 luvas, 5 botas,
  6 capacete, 8 capa, 9/10 armas, 11 escudo, 12 máscara, 13 montaria, 19 colar, 20/21 anéis, 22/23 brincos, 25 munição).
  `item_id` = número do símbolo II_* (defineItem.h). Penya em `characters.gold`. `characters.starter_given` marca o kit inicial.
- **Catálogo** (`server/items.ts`): lê `Resource/Spec_Item.txt` (cai para `propItem.txt`), nomes de `propItem.txt.txt` e os
  defines; colunas achadas pelo cabeçalho. 13.451 itens. Cada item: nome, ícone (`szIcon`), empilhamento (`dwPackMax`),
  `dwParts`, sexo, nível.
- **Regras no servidor** (`server/inventory.ts`): mover/trocar/empilhar/equipar/desequipar numa transação com as linhas do
  personagem travadas. Confere espaço certo (anel/brinco servem nos dois do par), sexo e nível — o cliente só pede. Um pedido de
  cada vez por conexão.
- **Kit inicial** (na primeira entrada no mundo): Cotton/Cream Suit, Gauntlet e Boots + Wooden Sword equipados; Pike/Silk Helmet
  (nível 2), 20 VitalDrink 100, 5 Antidote, 3 Golden Apple e 1.000 penya. Personagens já existentes também recebem.
- **Protocolo**: `invMove {from:[c,s], to:[c,s]}`, `invUse {c,s}` → `inv` (estado inteiro + definições só dos itens presentes),
  `invError`, e `look {id, eq}` para os outros verem a troca de roupa. `welcome`/`enter` levam `eq` (símbolos equipados).
- **Cliente**: ícones de `Data/Item` (`itemIcon` em shared/tga.ts — DDS sem compressão, DXT1/3/5 decodificado em
  `shared/dxt.ts`, PNG; magenta vira transparente). Arrastar entre slots (bolsa ↔ equipamento), duplo clique equipa/desequipa,
  quantidade no canto, dica com nome/nível, Buscar apaga o que não bate. **O equipamento aparece no modelo 3D** — do próprio
  personagem (`Player.restyle`, sem perder posição/animação) e dos outros jogadores. Com uma suit equipada o `Part_<sexo>Lower`
  não é montado (a roupa cobre o corpo todo; `humanPartNames` em shared/humans.ts) — ele só aparece sem roupa.
  Armas e escudos (sem peça de corpo no mdlDyna) são o `Item_<nome>.o3d` preso ao osso da mão com as matrizes do `.chr`
  (m_mLocalRH, m_mLocalShield, m_mLocalKnuckle, m_mLocalLH — lidas em shared/formats/chr.ts), como CModelObject::Render.
  Osso escolhido pelo símbolo: escudo no antebraço esquerdo (m_nLArmIdx, "L ForeArm"), arco na mão esquerda, o resto na mão direita (arma dupla PARTS_LWEAPON ainda vai na direita).
  Vale também para NPCs com SetEquip de arma.
- **Comandos**: `npm run account -- give-item <personagem> <II_SIMBOLO|id> [--count N]` e
  `npm run account -- give-penya <personagem> <quantia>`. Com o jogador online, aparece **na hora**: o comando faz
  `pg_notify('inventory_changed', id)` e o servidor do jogo, que fica em `LISTEN` numa conexão dedicada (reconecta se cair),
  manda o inventário novo para quem está com aquele personagem (server/realtime.ts).
- Testado na 8080: kit entregue e vestido, capacete recusado no nível 1 ("precisa do nível 2"), desequipar/equipar a espada,
  mover poção de slot, give-item de 1000 poções (completou a pilha de 999 e abriu outra) e give-penya.
- Próximos: usar itens (poção cura HP), arrastar para a barra de atalhos, jogar fora/vender, loja de NPC, drop de mob,
  bônus dos equipamentos nos atributos, abas extras da bolsa.

## 18. Comandos de GM no chat (2026-10-18)
- Mensagem do chat que começa com `//` é comando (server/gm.ts) e não vai para os outros jogadores. A resposta aparece só para
  quem digitou, como aviso do sistema.
- Só funciona em conta com `accounts.authority` diferente de `F` (F = jogador, Z = administrador; as letras entre elas são níveis
  de GM, como no FlyFF). A permissão é conferida no banco a cada comando, então promover/rebaixar vale na hora.
  Promover: `npm run account -- set-authority <usuario> Z` (voltar a jogador: `... F`).
- Comandos (sem nome de personagem o alvo é você; com nome, online ou não):
  - `//set-level [personagem] <nível>` (1–150): grava no banco, zera exp e enche HP/MP/FP; online, o nível muda na hora
    (janela de status e validação de equipamento).
  - `//give-item [personagem] <II_…|id> [quantidade]` e `//give-penya [personagem] <quantia>`: aparecem na bolsa na hora.
  - `//help`.
- Toda execução vai para o log do servidor (`GM <nome> (<autoridade>): …`, visível no painel admin → Logs). Os comandos contam
  no limite de 5 mensagens a cada 5 s.
- Testado na 8080: como `F` recusou; com a conta `teste` promovida a `Z`, `//set-level 9` (Bremer, na hora: "Nv. 9",
  HP 332) e `//set-level Visitante 5` (offline); depois o Roand Shield (nível 9) equipou e apareceu no braço esquerdo.

## 19. Postura de combate por arma e classe (2026-10-18)
- Com arma ou escudo equipado o personagem fica em postura de combate: parado/andando/correndo usam `MTI_STAND_NN`,
  `MTI_WALK_NN`, `MTI_RUN_NN` do mdlDyna.inc (arquivos `AtkStand-NN`, `AtkWalk-NN`, `AtkRun-NN`). O pulo não muda.
- Postura (comentários do próprio mdlDyna): 01 espada · 02 varinha · 03 Assist com cheerstick · 04 machado · 05 cajado ·
  06 Assist com knuckle hammer · 07 Knight (espada/machado de duas mãos) · 08 Blade (duas armas) · 09 Ringmaster (stick) ·
  10 Billposter (knuckle) · 11 Psykeeper (varinha) · 12 Elementor (cajado) · 13 arco · 14 ioiô · 15 besta. Só escudo → 01.
  Classes master/hero/3ª contam como a 2ª classe base.
- Quem decide é o servidor (`Inventory.combatMotion`, usando `dwItemKind3` do Spec_Item e `characters.job`), que manda `mt`
  no `welcome`, no `enter` e no `look` (o `look` agora vai também para o próprio jogador). Os clientes usam
  `shared/motions.ts` (`motionOf(estado, postura)`) no personagem local (`Player.setCombat`) e nos remotos.
- GM: `//set-job [personagem] <classe>` (vagrant, mercenary, acrobat, assist, magician, knight, blade, jester, ranger,
  ringmaster, billposter, psykeeper, elementor… ou o número JOB_*); online, a postura muda na hora.
- Testado na 8080: espada + escudo → postura 01 (espada erguida, escudo à frente); desequipar os dois → postura normal.
- Pendente: alternar combate/normal como no oficial (entra em combate ao atacar e sai depois de um tempo) quando houver
  combate; as animações de ataque (`AtkAtkN-NN`) e de idle de combate (`AtkIdle1/2-NN`).

## 20. Painel de GM (2026-10-18)
- `//gm` no chat abre a janela **Painel de GM** (game/gmpanel.ts) — o servidor só abre para contas GM/admin. Janela móvel e
  redimensionável como as outras. Campo **Alvo** (nick; vazio = você) vale para as duas abas.
  - **Jogador**: ir até o alvo (`//goto`), trazer o alvo (`//summon`), teleporte por coordenada (`//tp x z`), voltar para
    Flaris, nível, classe e penya do alvo.
  - **Itens**: busca no catálogo (nome ou símbolo II_*, filtro por categoria — armas, armaduras, gerais, montarias, cash,
    sistema), com ícones; escolher um item e criar na bolsa do alvo com quantidade, **enchant (+0–10)** e **elemento**
    (fogo, água, elétrico, vento, terra, +0–10). Duplo clique na lista cria direto. Enchant/elemento só em equipamento.
  - Linha de status no rodapé com a resposta do servidor.
- Por baixo, o painel manda os mesmos comandos `//…` pelo chat (mesma permissão, limite e log). Comandos novos:
  `//goto <nick>`, `//summon <nick>`, `//tp <x> <z>`, e `//give-item [nick] <II_…> [qtd] [+N] [elemento+N]`
  (ex.: `//give-item II_WEA_SWO_WOODEN +5 fogo+3`). Busca: mensagem `gmItems {q, k}` → `gmItems {list}` (só GM).
- Teleporte: o servidor atualiza a posição do jogador (para não recusar o "salto") e manda `teleport {p}`; o cliente carrega
  o tile e a colisão de lá, põe o personagem no chão e leva a câmera junto (`WorldView.teleportPlayer`).
- Banco: `003_item_upgrades.sql` — `character_items.upgrade` (0–10), `element` (0–5) e `element_level` (0–10). Item com
  enchant/elemento não empilha. Na bolsa aparece `+N` no canto e uma bolinha com a cor do elemento; a dica mostra
  "Fogo +3" etc.
- Testado na 8080: `//gm` abre; busca "sword" (80 resultados com ícones); Wooden Sword +5 Fogo +3 criada na bolsa; item de
  quest com enchant recusado; teleporte para (7030, 3440) confirmado pelo servidor e de volta para Flaris.
- Ainda não: os efeitos do enchant/elemento nos atributos (falta o sistema de combate), testar ir até/trazer com dois
  jogadores online, lista de jogadores online no painel, kick/ban pelo painel.

## 21. Combate contra mobs — v1 (2026-10-18)
- **Fórmulas portadas do servidor original** (`Source/Source/_Common/MoverAttack.cpp`, `MoverParam.cpp`,
  `WORLDSERVER/AttackArbiter.cpp`) em `server/combat.ts`:
  - acerto (`GetAttackResult`), ataque (`GetHitMinMax`/`GetHitPower`/`GetWeaponATK` com os fatores do `propJob.inc`;
    enchant soma `+N^1.5`), defesa (`CalcDefenseCore`), crítico (DEX/10 × fator da classe → ×2.3), +5 % de ataque do mob por
    nível acima do jogador, HP/MP/FP máximos (`GetMaxOriginHitPoint/ManaPoint/FatiguePoint`).
  - Mob: colunas do `propMover.txt` conferidas com `CProject::LoadPropMover` e dados reais (STR 3, STA 4, DEX 5, INT 6, HR 7,
    ER 8, nível 12, AtkMin/Max 20–21, arma do mob 22, AttackSpeed 33, HP 35, armadura natural 37, exp 62). Itens ganharam
    `dwAbilityMin/Max`, `dwWeaponType`, `dwAttackSpeed` no catálogo.
  - Exp: `expTable.inc` (Aibatt dá 2 de exp; nível 1→2 precisa de 14). Mob 5+ níveis abaixo dá menos (sem exp a 8+ níveis).
- **IA dos mobs** (`server/mobs.ts`): HP de verdade; os `attackCount` primeiros de cada respawn do `.rgn` são agressivos
  (atacam quem chega a 9 unidades); os outros revidam quando apanham (menos os `BELLI_PEACEFUL`). Perseguem correndo,
  golpeiam a cada ~2 s, desistem se o alvo sair da área (+30) e voltam com HP cheio. Morto: corpo some em 3 s e renasce na
  área depois do tempo do `.rgn`.
- **Servidor em tempo real** (`server/realtime.ts`): `{t:'atk', id}` confere alcance e ritmo (intervalo pela velocidade da
  classe e da arma) e calcula o golpe; `hit`, `mdie`, `pdie` vão para quem está perto; `stats` (HP/MP/FP, exp, nível,
  ataque, intervalo) para o próprio jogador. Exp para quem causou mais dano; subir de nível enche o HP e avisa todos.
  Recupera 3 % de HP/MP/FP a cada 3 s fora de combate. Morreu → mobs desistem, renasce em Flaris com metade do HP em 5 s.
  HP/MP/FP/exp/nível salvos ao sair e ao subir de nível.
- **Cliente**: clicar num mob seleciona e ataca (anda até o alcance, vira e golpeia com MTI_ATK1/2 da arma); teclado,
  clique no chão, Esc ou a morte do mob param. Mob toca MTI_DMG1 ao apanhar, MTI_ATK1 ao golpear, MTI_DIE1 ao morrer e
  corre ao perseguir. Números de dano sobem da cabeça (branco no mob, vermelho em você, amarelo e maior no crítico, MISS).
  HP do alvo na janela de alvo; janela de status e barra de atalhos com os valores do servidor.
- Testado na 8080: Bremer (nível 9) contra Aibatt — 34 de dano por golpe, Aibatt revidou (1 de dano), morreu e sumiu; no
  nível 1 a mesma morte deu 14,2857 % de exp (2 de 14).
- Ainda não: drops (itens/penya), skills, poções na barra de atalhos, pontos de atributo ao subir de nível, perda de exp ao
  morrer, grupo (dividir exp), mobs voadores/à distância, colisão dos mobs com objetos, som.

## 22. Drops: itens e penya no chão (2026-10-18)
- **Tabela de drop original** (`server/drops.ts`): `Resource/propMoverEx.inc` (874 mobs) lido como `CProject::LoadPropMoverEx`
  — `Maxitem`, `DropGold(min, max)`, `DropItem(II_…, prob/3e9, enchant, qtd)`, `DropKind(IK3_…)`; tabela `expDropLuck` do
  `expTable.inc`; `dwCorrectionValue` (coluna 61 do propMover) e `dwItemRare` (Spec_Item) no catálogo.
- **Sorteio igual a `CMover::DropItem`** (Source/_Common/mover.cpp): redução pela diferença de nível (jogador − mob ≤1 → 100 %,
  2 → 80 %, ≤4 → 60 % e penya 80 %, ≤7 → 30 %/65 %, mais → 10 %/50 %); DropItem embaralhados, cada um cai se
  `rand(3e9) < prob`, até `Maxitem`; penya `min + rand(max−min)` × taxa, desenhado como II_GOLD_SEED1–4 pela quantia;
  DropKind sorteia um item do tipo com dwItemRare entre nível−5 e nível−2 e um enchant +0–10 pela `expDropLuck`.
  Simulação: Aibatt ~11 penya e 10 % Twinkle Stone; Giant Aibatt solta equipamentos de Vagrant; Demian, armas e armaduras.
- **Chão** (`server/realtime.ts`): itens em volta do corpo, dono = quem levou a exp por 30 s (outros recebem "esse item ainda
  é de quem derrotou o monstro"), somem em 2 min. Clientes recebem `ground {a, d}` (raio 60) junto com os mobs. Mob voador
  manda direto para a bolsa. `{t:'pick', id}` confere distância (4), dono e bolsa cheia; penya vai para `characters.gold`,
  item para a bolsa (com o enchant, se for equipamento) e o inventário atualiza na hora (LISTEN/NOTIFY).
- **Cliente** (`game/ground.ts`): modelo do item (`Item_<nome>.o3d`, a moeda para penya) no terreno, nome flutuando (penya
  em dourado). Clicar no item ou no nome: anda até ele e pega; o chat avisa "Você pegou …".
- Testado na 8080 (Bremer no nível 1 contra Aibatts): penya caiu e foi pego (13, 11, 12), Twinkle Stone caiu, foi pega e
  apareceu na bolsa. Depois voltei a Bremer para o nível 9 em Flaris.
- Ainda não: festa/grupo dividindo drops, filtro de coleta automática, tecla para pegar o item mais perto, efeito/som ao cair,
  itens com opções aleatórias (`GenRandomOptItem`), drop de evento (`propDropEvent.inc`).

## 23. Pontos de atributo e janela de personagem (2026-10-18)
- **Regra original**: ao chegar no nível N ganha `expCharacter[N].dwLPPoint` (coluna GP do `expTable.inc` = 2 por nível;
  `CMover` em Source/_Common/mover.cpp `m_nRemainGP += …`). Banco: `004_stat_points.sql` — `characters.stat_points`;
  personagens existentes receberam 2 × (nível − 1) menos o que já tinham acima de 15.
- **Servidor**: subir de nível por exp soma os pontos (e avisa no chat "Você tem N ponto(s) de atributo (tecla H)");
  `//set-level` recalcula (tudo do nível − o gasto). `{t:'statUp', str, sta, dex, int}` confere a soma ≤ pontos livres,
  aplica, recalcula ataque/defesa/HP/MP/FP máximos e grava. `stats` agora leva STR/STA/DEX/INT, pontos, classe, ataque,
  defesa e crítico.
- **Janela de personagem** (`game/charwnd.ts`, tecla **H** ou menu → Personagem): nome, classe, nível, exp; STR/STA/DEX/INT
  com "+"/"−" (ButtCharPlus/Minus.bmp do tema), pontos livres, Reset (desfaz o que não foi aplicado) e Apply
  (ButtCharApply/Reset.tga); embaixo ataque, defesa, crítico, velocidade e HP/MP/FP. Arrastável/redimensionável.
- Testado na 8080: Bremer (nível 9) com 16 pontos; +3 STR e +2 STA → ataque 40~42 → 53~55, HP 243 → 263, defesa 22 → 24;
  gravado no banco (STR 18, STA 17, 11 pontos livres).
- Ainda não: resetar atributos (pergaminho de reset do original devolve tudo), bônus de atributo dos equipamentos/buffs,
  chance de acerto/esquiva na janela.

## 24. Poções/comidas e barra de atalhos (2026-10-18)
- **Regra original** (`CMover::DoUseItem` / `DoUseItemFood`, Source/_Common/MoverSkill.cpp): itens IK2_POTION, IK2_FOOD e
  IK2_REFRESHER curam pelo `dwDestParam1–3` (DST_HP/MP/FP) com `nAdjParamVal1–3`; se o valor atual já passou de
  `dwAbilityMin`, cura só 30 %; nunca passa do máximo. Espera `dwSkillReady` (mínimo 1 s) por grupo (comida, poção,
  refresher). Ex.: Chocolate Bar +200 HP (espera 2,5 s), VitalDrink 100 +30 FP. Antídoto e outros ainda dizem "ainda não
  pode ser usado" (falta o sistema de estados/veneno).
- **Servidor**: `{t:'use', id}` usa o primeiro monte desse item na bolsa (atalho); duplo clique num item que não é
  equipamento também usa. Gasta 1 (`Inventory.consume`), cura, responde `used {hp, mp, fp, cd}` e o inventário novo.
  Barra: `{t:'bar', slots}` grava em `characters.shortcuts` (migração `005_shortcuts.sql`) e volta `bar` com ícone/nome;
  ao entrar o servidor manda a barra salva.
- **Cliente** (`ActionBar` em game/ui.ts): arraste um item da bolsa para um dos 10 atalhos (ou entre atalhos para trocar);
  botão direito ou arrastar para fora tira. Mostra o ícone, a quantidade na bolsa (cinza com 0) e a espera escurecendo e
  clareando. Teclas 1…0 (segurar repete; o servidor respeita a espera). Cura aparece em número verde (HP), azul (MP) ou
  verde-claro (FP) sobre o personagem.
- Testado na 8080: Chocolate Bar e VitalDrink arrastados para os atalhos 1 e 2 (salvo no banco); apanhando de um Aibatt o
  HP caiu, tecla 1 curou até o máximo e o Chocolate foi de 5 para 4; apertar de novo durante a espera foi ignorado.
- Ainda não: habilidades na barra, várias páginas de barra (F1–F8 do original), estados (veneno, etc.) para o antídoto,
  efeitos visuais/som ao usar (XI_GEN_CURE01).

## 25. Lojas dos NPCs (2026-10-18)
- **Dados do original** (`server/shops.ts`): `character.inc` (+ `-etc`, `-school`) — `AddShopItem(aba, II_…, preço)`,
  `AddVendorSlot(aba, nome)`, `SetName`; nomes `IDS_*` de `character*.txt.txt`. 64 lojas de penya (ex.: Boboku armaduras
  por classe, Marche varinhas/cajados/robes, Lui MP/FP e pílulas, Losha comida). Lojas com `SetVenderType` (fichas: Royal
  Rumble, Achievement, Vote…) respondem "só aceita <moeda> (ainda não disponível)". Posição dos NPCs pelo `.dyo`
  (characterKey) — o servidor só abre/compra/vende a até 12 unidades do NPC.
- **Regras**: compra pelo preço do `AddShopItem` (tira o penya antes, só se tiver; o que não couber na bolsa é devolvido);
  venda a `dwCost / 4` por unidade, mínimo 1 (`CDPSrvr::OnSellItem`). Mensagens `shopOpen`, `buy`, `sell` → `shop`
  (abas com os itens e preços); inventário/penya atualizam na hora.
- **Cliente** (`game/shop.ts`): clicar num NPC anda até ele e pede a loja (NPC sem loja não faz nada); a janela abre com o
  nome do NPC, as abas e a grade de itens (dica com nome, nível e preço) e abre a bolsa junto. Clique escolhe (linha de
  compra com quantidade para os que empilham e o total em vermelho se faltar penya); duplo clique compra 1. Vender:
  arrastar um item da bolsa para a janela e confirmar a quantidade. Fecha ao se afastar mais de 14 do NPC.
- Testado na 8080: Boboku em Flaris — comprou Mythic Helmet por 1.100 (8.270 → 7.170) e vendeu Twinkle Stone por 40.
- Ainda não: lojas de fichas (moedas especiais), recomprar o que vendeu, impostos, NPCs de diálogo/quests (MMI_DIALOG).

## 26. Loja com largura mínima e skills — v1 (2026-10-18)
- **Loja**: a janela nunca fica mais estreita que a fileira de abas (ex.: Boboku com 4 abas abre com 338 px mesmo salva
  com 200, e arrastar a borda não deixa passar disso). `GameWindow.setMinSize`; mínimo padrão 260.
- **Skills — dados do original** (`server/skills.ts`): `propSkill.txt` (colunas pelo cabeçalho) + `propSkillAdd.csv`
  (por nível: dano, MP/FP, espera, alcance) + `defineSkill.h`. Só skills de jogador (JTYPE_BASE/EXPERT/PRO); 144 no total.
  Classe: Vagrant + 1ª + 2ª classe (master/hero contam como a 2ª).
- **Regras portadas**: pontos ao subir de nível `((nível − 1) / 20) + 2`; custo por nível 1 (Vagrant), 2 (1ª classe),
  3 (2ª) — `m_dwVagSP/ExpertSP/ProSP`; aprender valida como `CDPSrvr::OnDoUseSkillPoint` (não desce, não passa do
  máximo, pontos suficientes) + nível pedido (`dwReqDisLV`) + pré-requisitos (`dwReSkill1/2`). Dano corpo a corpo:
  `CMover::GetMeleeSkillPower` — ((arma + habilidade×5 + atributo×valor/10 + nível×atributo/50 − 20) × (16 + nível) / 13),
  menos a defesa de skill do mob (`CalcDefenseNPC`: armadura natural/7 + 1); skill não erra nem dá crítico.
- **Banco**: `006_skills.sql` — `characters.skills` (jsonb { id: nível }) e `skill_points`; personagens existentes
  receberam o total do nível. `//set-level` devolve os pontos (zera as skills).
- **Servidor**: `skillUp {levels}` → `skills {points, levels, list}`; `skill {id, target}` confere aprendida, classe, alcance,
  espera (dwCooldown, mínimo 1,5 s), MP/FP; gasta, calcula, `hit` com `f: 4` e o símbolo da skill; morte/exp/drop como
  no golpe normal. v1: só lançam as skills EXT_MELEEATK (golpes); buffs/magias aparecem e podem ser aprendidas, mas
  avisam "ainda não pode ser lançada".
- **Cliente**: janela de skills (`game/skillwnd.ts`, tecla **K** ou menu → Habilidades): agrupadas por classe, ícone
  (Data/Icon, DXT decodificado), nível/máximo, nível pedido, dica com custo, MP/FP, espera, pré-requisitos e descrição;
  "+" pendente e Aplicar/Desfazer. Arraste o ícone de uma skill aprendida para a barra de atalhos; a tecla lança no mob
  selecionado (anda até o alcance), toca o movimento da skill (MTI_VAG_ONE_CLEANHIT…) e mostra a espera no atalho.
- Testado na 8080: Bremer nível 9 com 16 pontos → Clean Hit 3 + Flurry 1 (sobram 12); Clean Hit na barra, tecla 3 no
  Aibatt: 84 de dano, FP 64 → 59, espera de 1,5 s no atalho.
- Ainda não: buffs/magias/cura (EXT_SELFCHGPARAMET, EXT_MAGICATK…), efeitos visuais das skills (sfx XI_SKILL_*), skills em
  área, combos, mudança de classe no nível 15 (as skills de 1ª classe só aparecem com `//set-job`).

## 27. Reorganização das pastas — fase 1 (2026-10-23)
- A pasta `web-world-editor/` deixou de existir: tudo foi para a raiz `Projeto_Atools/` (package.json, node_modules, dist,
  `Iniciar Servidor.bat`). Os arquivos originais do FlyFF foram para `original/` (Resource, Source, Client, Patcher, ResClient,
  ATools-master). Backup do código de antes em `_backup_antes_fase1/codigo.tar` (pode apagar quando quiser).
- **Mapa dos caminhos antigos → novos**

| antes | agora |
|---|---|
| `web-world-editor/server/index.ts` | `servers/main.ts` |
| `server/api.ts` | `servers/api.ts` (junta) + `servers/auth/{http,sessions}.ts` + `servers/character/http.ts` |
| `server/auth.ts` | `servers/auth/password.ts` |
| `server/admin/accounts.ts` | `servers/auth/accounts.ts` |
| `server/admin/{index,game-process}.ts`, `public/` | `admin/` |
| `server/accounts-cli.ts` | `tools/accounts-cli.ts` |
| `server/db/*` (+ migrações) | `servers/common/db/*` |
| `server/{items,resources}.ts`, `admin/errors.ts` | `servers/common/{items,resources,errors}.ts` |
| `server/inventory.ts` | `servers/character/inventory.ts` |
| `server/{realtime,mobs,world,combat,drops,shops,skills,gm,internal}.ts` | `servers/world/*` |
| `game/` | `client/` (o endereço continua `/game/`) |
| `shared/`, `editor/`, `tests/`, `tools/` | iguais, na raiz |
| `../Resource` | `original/Resource` |

- **Novidades de código**: `servers/common/config.ts` guarda caminhos e portas num lugar só (`ROOT`, `RES_DIR`, `DIST`, `WORLD`,
  portas) e o alias `/game/` → `client/` (`pageAlias`, usado pelo servidor e pelo Vite); `servers/common/http.ts` (send, readJson,
  bearer); o antigo `api.ts` foi separado em rotas do Auth e do Character. O Vite ignora `original/` na vigilância de arquivos.
- `package.json` virou `reaction-mmo`; scripts apontam para os novos caminhos; `.claude/launch.json` e o `.bat` também.
- Testado: `tsc` limpo, `npm test`, `npm run build`, `Iniciar Servidor.bat` (banco + painel + jogo), /, /game/, /editor/, /res,
  login pela API, e no jogo: entrar, teleporte, atributos do servidor, atacar um Aibatt (dano, revide, HP do alvo).
- **Próximas fases**: (2) Auth e Character viram serviços/processos próprios com token assinado que o World confere sozinho;
  (3) World guarda o personagem em memória e grava aos poucos, e um processo por mapa. O passo "mover NPCs no editor e salvar"
  vem depois, já nesta estrutura.

## 28. O site (htdocs) em http://localhost:8080 (2026-10-23)
- **O que é**: `htdocs/` é o site "Reborn-MMO" do fórum RageZone (Next.js 15 + React 19, em francês), pensado para o SQL Server.
  Agora `http://localhost:8080/` mostra ele; `/game/` e `/editor/` continuam sendo o jogo e o editor.
- **Como roda**: o painel admin liga o site junto com o jogo (`admin/site-process.ts`: `next start` em 127.0.0.1:3010, só local;
  compila `npm run build` na pasta htdocs se faltar — a 1ª vez demora). O servidor do jogo repassa para ele tudo que não é do
  jogo (`servers/main.ts`, `proxyToSite`; enquanto o site sobe aparece uma página "iniciando…"). Painel: `/admin/api/site/restart`
  e `/admin/api/site/build`; "Compilar" do painel compila o jogo e depois o site; os logs do site aparecem junto (`site`).
- **API do jogo mudou de prefixo**: `/api/*` → `/gapi/*` (login, session, logout, characters), porque o site tem as rotas
  `/api/login`, `/api/logout`, `/api/characters`… dele. (`/api/list` e `/res` continuam como eram.)
- **Banco**: o `WEBSITE_DBF.bak` foi restaurado no SQL Server como um banco temporário novo (`ZZ_WEBSITE_TMP`), exportado e
  **apagado em seguida** — os bancos oficiais (ACCOUNT_DBF, CHARACTER_01_DBF, LOGGING_01_DBF, RANKING_DBF) não foram tocados.
  Os dados foram para o esquema `website` do PostgreSQL (`007_website.sql` + `npm run db:import-website -- <json>`):
  registered_users (6), topup_items (4), topup_requests (152), vote_logs (44), paypal_cashshop_orders (2), news/newsposts/
  downloadlinks (vazias).
- **Compatibilidade com os bancos do FlyFF** (`008–010`): esquema `legacy` com views que mostram as nossas tabelas com os nomes
  do SQL Server — `account_tbl` (conta, senha MD5 com sal, cash, votepoint), `account_tbl_detail`, `character_tbl`
  (m_szName, m_nJob, m_nLevel, gold, TotalPlayTime em minutos, MultiServer = online, CreateTime) — com gatilhos para o site
  criar conta, trocar senha/e-mail e dar pontos. Vazias por enquanto (o jogo ainda não tem): guild_tbl, guild_member_tbl,
  mail_tbl, tbltradelog e afins. Novas colunas: accounts.cash/votepoint, characters.online/play_minutes (o servidor do jogo
  atualiza `online` ao entrar/sair e soma o tempo de jogo).
- **Adaptador** `htdocs/src/lib/mssql-pg.js`: imita a API do pacote `mssql` por cima do `pg` e converte o T-SQL do site
  (`Banco.dbo.Tabela`, colchetes, TOP, ISNULL, GETDATE, DATEADD/DATEDIFF/FORMAT/CONVERT, OUTER APPLY, OUTPUT INSERTED,
  transações) — o resto do site quase não mudou. A senha do PostgreSQL vem do pgpass, como no resto do projeto.
- **Segurança**: o cookie de sessão do site era `email|data|papel` **sem assinatura** (qualquer um podia se passar por
  administrador). Agora é assinado com HMAC (`SESSION_SECRET`, gerado no `htdocs/.env.local`) e o `src/middleware.js` descarta
  cookies inválidos. Cookie `secure`/domínio vêm de `COOKIE_SECURE`/`COOKIE_DOMAIN` (o original fixava `.rebornmmo.com`).
  A rota de teste `/api/testdb` não lista mais os bancos. O `.env` do pacote traz SMTP/PayPal de terceiros: o `.env.local`
  esvazia o SMTP; configure o seu antes de usar e-mail/pagamentos.
- **Registro sem e-mail**: com `SKIP_EMAIL_VERIFICATION=true` (no `.env.local`) a conta nova já nasce verificada — só para
  desenvolvimento; remova ao configurar o SMTP.
- Testado: home, ranking (personagens reais), download, shops, login/registro/perfil no navegador, criar conta de jogo pelo
  site e entrar com ela no jogo (`/gapi/login`), cookie forjado recusado, dashboard e status do servidor; o jogo continua OK.
- **Pendências do site**: as páginas/rotas que dependem de dados que ainda não existem aqui (guildas, correio, troca, ranking
  de PayPal com recompensa por correio) mostram vazio ou erro; textos e marca são do site original (Reborn-MMO, francês) —
  trocar por ReactioN; downloads e notícias estão vazios (cadastre pelo /admin do site com uma conta de papel `super`:
  `UPDATE website.registered_users SET role = 'super' WHERE email = '…'`).

## 29. Fase 3: personagem na memória e um processo por mapa (2026-10-23)
- **Inventário e penya na memória** (`servers/character/inventory.ts`): ao entrar no mundo o inventário do personagem é lido
  uma vez (`attach`) e fica na memória; mover/equipar/usar/vender/comprar/pegar loot só mexem na memória e marcam o que mudou.
  Um UPDATE agrupado (1 comando SQL com CTE) grava só os slots alterados, ~2 s depois da última ação, ao sair (`detach`) e ao
  desligar. O penya vai como incremento (`gold = gold + delta`), então comandos de GM/site no mesmo personagem não se perdem.
  Falha ao gravar → volta para a fila e tenta de novo. Personagem offline (comandos de GM, `npm run account`) segue gravando
  na hora, numa transação.
- **Mudança de fora** (NOTIFY `inventory_changed`, ex.: CLI): o servidor grava o pendente, relê do banco e manda o inventário
  novo (`reload`). Mudança de dentro (GM, loot) usa `onLocalChange`, sem ida ao banco.
- **Gravação aos poucos dos personagens**: a cada 30 s (`autosave`) grava posição/HP/MP/FP/exp/pontos só de quem mudou.
- **Desligar com segurança**: `POST /internal/shutdown` (o painel chama antes de parar; no Windows `kill` não deixa gravar),
  `SIGINT/SIGTERM` também; grava todos (posição, combate, inventário) e sai. Painel mostra `inventory {cached, pending}` em
  `/internal/stats`.
- **Medido** (`npm run bench`): 8,9 → ~0,2–0,9 consultas ao banco por ação de inventário (124 → 3–13 em 14 ações).
  `npm run test:persist`: move um item, para o jogo na hora (antes da gravação agrupada) e confere no banco.
- **Um processo por mapa**: `servers/world/start.ts` (`startWorld`) liga um mundo num servidor HTTP; `servers/world/main.ts`
  (`npm run world`, vars `WORLD`, `WORLD_PORT`, `GATEWAY_URL`, `ADMIN_TOKEN`) roda só um mapa. O `servers/main.ts` com
  `WORLD_NODE=127.0.0.1:9101` vira o portão (Auth, site, arquivos) e repassa o `/ws` ao mapa; o mapa confere o token de
  login em `GET /internal/session` do portão. Testado: login no portão, join e inventário passando pelo proxy.
- **Ainda falta para vários mapas de verdade**: o cliente escolher o mapa (hoje 1 mapa por servidor), teleporte entre
  processos (gravar, trocar de nó), o painel admin ligar/mostrar os nós, e um nó por mapa dentro do `WORLD_NODE`
  (hoje um só).

## 30. Atributos, equipamentos e dica do item conforme o servidor original (2026-10-23)
Comparado com `original/Source/Source/_Common/MoverAttack.cpp`, `MoverParam.cpp` e `project.cpp`:
- **Pontos de atributo** já eram aplicados (STR entra em GetWeaponATK, STA na defesa/HP, DEX no acerto/crítico); agora o
  `Fighter` guarda `base` (o que o jogador distribuiu e fica salvo) e os totais (base + bônus dos itens).
- **Equipamento agora muda o personagem** (`CombatRules.buildFighter`): defesa das peças com o enchant
  (dwAbility × (1+expUpitem%) + enchant^1.5); bônus DST_* de todos os itens equipados (FOR/VIG/DES/INT, defesa e defesa %,
  ataque %, dano por tipo de arma, precisão/esquiva, HP/MP/FP máx. e %, velocidade de ataque, crítico); multiplicador do
  enchant da arma (expUpitem de `expTable.inc`). Equipar/desequipar recalcula tudo e os máximos de HP/MP/FP.
- **Velocidade de ataque** como `GetAttackSpeed`: A = classe + arma·(4·DEX + nv/8) − 3 → 50/(200−A)/2 + tabela; a janela
  mostra `int(vel·100)/2 %` (42% no nv 15, igual ao cliente original). Intervalo entre golpes = 0,9 s / velocidade
  (a duração real da animação é uma aproximação).
- **Crítico** 1,1–1,4× (1,2–2,0× contra mob de nível menor) em vez de ×2,3; mob causa no mínimo 10% do ataque dele.
- **Dica do item** (`client/itemtip.ts`): nome +enchant, ataque/defesa já com o enchant, velocidade da arma (mesmas faixas do
  original), bônus, elemento, sexo, nível, preço de venda; ao passar o mouse numa peça da bolsa aparece a 2ª caixa
  "[ Equipado ]" com o que está no espaço, para comparar. Janela de personagem: STR (+bônus), vel. de ataque, precisão, esquiva.
- Ainda fora: set de itens, buffs, elementos no dano, bloqueio, classe do item (dwItemJob) na dica, raridade real.

## 31. Editor: mover/adicionar/remover NPCs e salvar o Ambiente (2026-10-23)
- **Não mexe nos arquivos originais**: as edições vão para `data/world-edits/<Mundo>.json` (`shared/worldedits.ts`): NPCs movidos
  (índice no .dyo → posição/rumo), removidos, adicionados, e o `environment` (o que está marcado em "Ambiente").
  API: `GET /gapi/world-edits?world=` (público) e `PUT` (só aceita do próprio computador do servidor, sem `x-forwarded-for`).
- **Editor → painel "NPCs"** (`editor/npcs.ts`): "Editar NPCs" → clicar no NPC mostra o gizmo (Mover/Girar, teclas 1/2), "Ao chão" (G),
  Duplicar (Ctrl+D), Remover (Del), Desfazer (Ctrl+Z); para adicionar escolha um personagem do character.inc na lista (com filtro) e
  "Adicionar na mira da câmera". "Salvar NPCs" grava só a diferença para o .dyo; "Descartar" volta ao salvo. O painel mostra
  movidos/novos/removidos e se falta salvar.
- **Ambiente**: "Salvar ambiente" grava hora, iluminação, sombras, inclinação, névoa, skybox e água como padrão do mundo (o editor já
  abre com eles marcados e o jogo usa o mesmo); "Limpar salvo" remove. Para novos filtros de teste basta somar campos em
  `EnvironmentEdits` (+ `cleanEdits`) e no painel.
- **Quem usa**: `WorldData.load` aplica as edições por cima do .dyo (editor e jogo); o servidor (`ShopCatalog`) também — a distância
  para abrir a loja vale na posição nova do NPC (relê o arquivo sozinho quando ele muda, sem reiniciar). Jogadores já online veem o
  NPC novo ao entrar de novo.
- Limitações: NPC adicionado é humano (personagem do character.inc); monstros/outros modelos e edição de objetos de mapa seguem
  como estavam (modo edição de mundo exporta .json).

## 32. Mudança de classe (2026-10-23)
- Regras do original (`DPSrvr.cpp OnSendJobChange`, `MoverParam.cpp AddExperience`): Vagrant sobe até o nível 15 e a exp fica em 0 até
  escolher uma 1ª classe (Mercenary/Acrobat/Assist/Magician); a 1ª classe vai até o 60 e então escolhe uma das 2 da sua linha
  (Merc → Knight/Blade, Acrobat → Jester/Ranger, Assist → Ringmaster/Billposter, Magician → Psykeeper/Elementor); a 2ª vai até 120.
  `CombatRules.levelCap/jobOptions`.
- Servidor: `{ t: 'jobChange', job }` só vale no nível certo e para a linha certa; grava no banco, refaz atributos/HP/MP (HP máx. da classe),
  postura de combate da arma, skills da classe nova (as da anterior continuam) e avisa todos. `stats` traz `jobOpts`.
- Cliente: `client/jobwnd.ts` abre sozinha quando há escolha (tecla J reabre), com confirmação. Testado por WebSocket: nv 14 recusa,
  nv 15 aceita Acrobat e recusa Knight, classe persiste.
- Falta: skills/itens específicos de cada classe nos mobs/loja, 3ª fase (Master/Hero), troca visual de NPC "mestre de classe".

## 33. Árvore de skills como o original (2026-10-23)
- Janela de skills (`client/skillwnd.ts`): uma aba por classe (retrato do tema Slot*.bmp, preto e branco; a ativa colorida) e, abaixo, a
  árvore do jogo: fundo `Back_*.TGA`/`ImgSkillVagrant.tga` (225×135, ícones cinza e setas) com o ícone colorido por cima das skills
  aprendidas, nas posições exatas de `CWndSkillTreeEx::GetSkillPoint` (extraídas para `shared/skillTreePos.json`, 180 skills de
  todas as classes). Clique mostra nome/nível/pedidos/MP/FP/descrição; "+" ou duplo clique sobe nível (pendente) e Aplicar confirma;
  arrastar skill aprendida vai para a barra de atalhos. Tabelas de classe/fundos em `client/jobs.ts` (também usada pela janela de classe).
- O modelo `Mer.BMP` é a mesma árvore do `Back_Me.TGA`. Testado no navegador com Mercenary (15 skills posicionadas, seleção, duplo clique).
- Ainda sem árvore: 3ª fase (Lord Templar, Storm Blade, etc.: fundos SkillTree*.tga já existem) e skills de Master/Hero.

## 34. SFX das skills (2026-10-23)
- `propSkill.txt` traz 5 efeitos por skill (ids `XI_*`): `dwSfxObj` ao lançar, `dwSfxObj2` projétil, `dwSfxObj3` no alvo ao acertar, `dwSfxObj4`
  que dura no alvo (buffs) e `dwSfxObj5` no lançador ao acertar (como `CCtrl::CreateSkillSfx`). O servidor lê (`SkillDef.sfx`) e manda
  no golpe da skill (`hit.fx = {c, h, s}`) para todos que estão perto; o cliente acha o `.sfx` pelo id (mdlDyna.inc) e toca.
- `SfxManager.play` (shared/sfxRuntime.ts): efeito de uma vez só (acaba sozinho, no máximo 4 s); `WorldView.playSfx(id, pos, rotY)`.
- Hoje só as skills de golpe lançam; ao entrarem as magias/buffs usa-se o mesmo caminho (projétil `dwSfxObj2` e buff `dwSfxObj4` ainda
  não tocam). Efeito sonoro (.wav) das skills não foi feito.

## 35. Buffs e magias (2026-10-23)
- Tipos de skill pelo `dwExeTarget` (`SkillKind`): golpe (37), **magia de ataque** (49: EXT_MAGICATK/SHOT) e **buff/cura** (58: SELFCHGPARAMET,
  ANOTHER(WITH), OBJCHGPARAMET, TROUPE, MAGIC). Dados por nível vêm do `propSkillAdd.csv`: `dwDestParam1/2` + `nAdjParamVal1/2` e `dwSkillTime` (duração).
- **Buff**: vale em quem lança. DST de HP/MP/FP sem duração = cura na hora; com duração vira buff e os DST somam aos atributos de luta como
  os itens equipados (`buildFighter(..., buffs)`): FOR/VIG/DES/INT, ataque %, defesa %, HP/MP/FP máx… (testado: Mental Sign +1 INT e MP máx. subiu).
  Vence pelo tempo (checa a cada 1 s), some ao morrer. Mensagem `buffs` (ícone, nome, nível, ms restantes); `skillfx` mostra os efeitos para quem está perto.
- **Magia de ataque**: alvo = mob selecionado, alcance 24, mesmo cálculo das skills de golpe (`GetMagicSkillPower` ≈ arma + habilidade×5 + atributo × (16+nv)/13,
  atributo = INT pelo `dwReferStat`), espera de 1,5 s. Testado por WebSocket: Fire Boomerang causou 279 de dano.
- **Cliente**: barra de buffs sob a janela de status (`client/buffbar.ts`, ícone + tempo que falta); buff lança direto da barra de atalhos (sem alvo);
  SFX: projétil (`dwSfxObj2`) voa do lançador ao alvo e o impacto toca na chegada; efeito de buff (`dwSfxObj4`) acompanha o personagem enquanto dura.
- Ainda falta: buff em outro jogador (alvo aliado/grupo), debuffs no mob (DST_RESIST_*, lentidão…), ressurreição, tempo de conjuração (`dwCastingTime`),
  resistências elementais no dano, buffs que persistem ao relogar/trocar de mapa, DST de velocidade de movimento.
- (35b) Animação ao lançar: o movimento vem do `dwUseMotion` do propSkill (`SkillDef.motion`, ex.: MTI_ASS_CHEER_CASTING01) e liga na `…02` quando existe
  (`Player.cast`). Buff: toca quando o servidor aceita (`skillUsed`); magia: no lugar do golpe, junto com o pedido; outros jogadores recebem `fx.mo`
  (`RemotePlayers.cast`) e voltam ao estado deles depois.
- (35c) SFX de skill no chão: partes `SFXPARTBILLTYPE_NORMAL` (círculos mágicos, anéis, brilho) agora são desenhadas deitadas (plano XZ, como no original — as texturas de
  círculo têm rotação 0 na chave); antes ficavam em pé como um cartaz atrás do personagem. Vale para todos os efeitos .sfx (skills e os do mapa).
- (32b) Coerência nível × classe × pontos (`reconcilePoints`/`jobForLevel` em realtime.ts): ao entrar no jogo e no `//set-level`, a classe volta para a que o nível permite
  (abaixo de 15 → Vagrant; abaixo de 60 → 1ª classe), skills de classes que o personagem não tem mais são removidas e os pontos de atributo/skill viram
  "o que o nível dá − o que foi gasto" (corrige nível mexido direto no banco, que deixava 0 pontos). Testado: nv 15 Assist → `//set-level 14` = Vagrant com 26 pontos;
  `//set-level 15` = janela de classe com 28 pontos; trocar de classe mantém os 28.
- (35d) INT do Assist: o ataque normal com bastão (Cheerstick) vem de FOR no original (`GetWeaponATK`, WT_MELEE_STICK); INT não entra no ataque físico, só em MP e nas skills que
  referenciam INT (`dwReferStat`). A cura (RT_HEAL) agora soma `(refValue/10)×INT + nível×(INT/50)` ao valor da skill, como em `CMover::ApplyParam`. Duração dos buffs: dwSkillTime + (refValue/10)×atributo + nível×(atributo/50) ms (RT_TIME, 27 buffs).

## 36. Sons (.wav) (2026-10-23)
- **Peso para o servidor**: pequeno. O servidor não toca nada — só entrega arquivos sob demanda (`/snd/<arquivo>`, `servers/common/sounds.ts`): cada cliente baixa
  um som uma vez (cache de 1 ano + ETag → 304 depois), em gzip quando o navegador aceita (o .wav compacta bastante; a versão compactada fica em memória, até 96 MB).
  Os ~1700 .wav (221 MB, média 135 KB) ficam em `original/Client/Data/Music/Sound` (`FLYFF_SOUND` troca) — nada é carregado antes de ser pedido. Se um dia pesar:
  converter para .ogg/.mp3 (ffmpeg) e trocar a extensão na rota, sem mexer no resto.
- **Ids**: `defineSound.h` (SND_* → número) + `Client/sound.inc` (SND_* → arquivo) → `GET /gapi/sounds` { id: arquivo } (1651 sons).
- **Cliente** (`client/audio.ts`): Web Audio; busca + decodifica na 1ª vez e guarda o buffer; volume cai com a distância (70 u); máximo 12 ao mesmo tempo e 60 ms entre repetições do mesmo
  som; volume mestre 0,5 em `localStorage['flyff.volume']` (sem janela de opções ainda). O navegador só libera áudio após um clique/tecla.
- **O que toca**: golpe da arma (`dwSndAttack1` ao bater, `dwSndAttack2` se acertou, do item equipado — vem no `hit` para todos que veem) e skills (`dwSndAttack1` ao lançar,
  `dwSndAttack2` no impacto das magias). Faltam: sons de dano/morte de monstros e do jogador, passos, interface (cliques, abrir janela), música de fundo (.ogg em `Client/Data/Music`).

## 37. Bônus de itens, velocidade e cartas de piercing (2026-10-26)
- **Bônus nos status** (`CombatRules.buildFighter`): além dos DST_* dos itens e dos sets (que já entravam), agora somam:
  joias pelo enchant (`accessory.inc`, `CAccessoryProperty`: item → enchant → DST, vale só a linha do enchant atual) e as cartas
  espetadas na suit (DST de cada carta, como `GetPiercingAvail`). Set conta anel/brinco em qualquer um dos dois espaços (antes só no
  espaço escrito no `propItemEtc.inc`). Ao ligar, o log mostra quantas joias o `accessory.inc` trouxe.
- **Velocidade** (`CombatRules.runSpeed`): fSpeed do propMover de MI_MALE/MI_FEMALE × 60 × (1 + DST_SPEED%) — itens, sets, cartas e buffs.
  O servidor manda em `stats.mv`; o cliente (`Player.runSpeed`) corre nela e anda a ¼ (OBJSTAF_WALK). Antes eram fixos 9 e 4,5 u/s.
  Ainda não comparado com o cliente original; o ¼ do andar é de memória do `CActionMover`, não conferido no código.
- **Piercing**: duplo clique numa carta (IK3_SOCKETCARD) abre o martelinho (cursor animado; carta em laranja, suits com furo livre
  piscando em azul); clicar numa suit da bolsa manda `{ t: 'pierce', card, target }`; o servidor (`Inventory.pierce`) confere que é
  carta, que a suit está na bolsa (equipada não aceita), que tem furo vazio, espeta no 1º furo e gasta 1 carta; resposta `pierced` toca
  a martelada. Esc, botão direito ou clique fora cancelam. A dica da suit lista cada carta com o bônus.
- Falta: chance de falha ao espetar (aqui é sempre sucesso — conferir no `CItemUpgrade::OnPiercing` original), tirar cartas, cartas
  de arma (IK3_SOCKETCARD2), abrir furos por NPC (hoje só `//give-item … furos3` de GM), conferir o formato do `accessory.inc` com o arquivo real.
- **Correções (2026-10-26, depois)**: (a) as cartas **não têm DST no Spec_Item** — o bônus vem dos blocos `Piercing II_* { DST_* valor }`
  do `propItemEtc.inc` (`CProject::LoadPiercingAvail`, 115 cartas; ex.: Volcano HP máx. +7%, Lightning ataque +7%). Agora
  `ItemCatalog.piercing`/`piercingDst` lê esses blocos, o `buildFighter` soma por eles e a dica da carta mostra o bônus. Antes a carta
  espetada não dava nada. (b) DST_SPEED é **por mil** no `GetSpeed` (`__JEFF_11`, ligado no WorldServer e no Neuz): capa +15 = +1,5%
  (antes contava 15%). A base 0,1 × 60 = 6 u/s confere com o original (FRAME_PER_SEC 60, andar = fSpeed/4 no `ActionMoverState.cpp`).
  (c) Janela H: o ataque mostrado aplica DST_ATKPOWER_RATE (como o golpe), e lista a velocidade (% da base) e todos os bônus somados
  (`stats.fx`, de `CombatRules.bonusList`).

## 38. Proteção contra speedhack (2026-10-26)
- **Reserva de deslocamento** (`moveOk` em `servers/world/realtime.ts`): cada `state` gasta a distância no plano XZ de uma reserva que
  enche a 1,25 × a velocidade do servidor (`CombatRules.runSpeed`, a mesma do `stats.mv`; com prancha/vassoura equipada vale o teto
  do voo, 0,33 × 60 ≈ 19,8 u/s, de `Player.updateFly`) e guarda até 3 s (+2 u) — cobre mensagens que chegam juntas depois de um soluço
  da rede. O eixo Y não conta (queda e pulo livres).
- Passou da reserva (ou dos 60 u por mensagem, que antes eram só ignorados): a posição não muda e o servidor manda `teleport` com a
  posição dele — o cliente volta (rubber-band), no máximo 1 vez por segundo, e o log mostra `[speed] nome (#id): passo … puxado de volta`.
- Falta: testar com latência real (soluços > 3 s puxam de volta quem joga limpo); punir reincidente (kick depois de N puxões?);
  conferir o teto do voo com o `fFlightSpeed` das pranchas mais rápidas; checar parede/colisão (teleporte através de obstáculos curtos
  continua passando, só a velocidade é conferida).

## 39. Rodapé do inventário: lixeira, organizar e Red Chip (2026-10-26)
- Rodapé como o do inventário das versões novas (ícones `WndInventoryGarbage.dds` e `WndInventoryAlign.dds` de `Data/Theme/Default`):
  lixeira e organizar à esquerda, penya e Red Chip à direita (`client/ui.ts`, `.inv-foot`).
- **Lixeira**: arrastar um item da bolsa até ela abre a caixinha "Apagar …?" (pilha: com a quantidade); confirmar manda
  `{ t: 'invDrop', s, n }` e o servidor (`Inventory.discard`) apaga e registra `[lixeira] nome (#id) apagou N× item` no log.
  Equipado não vai (avisa para tirar antes). Não volta atrás.
- **Organizar** (duas setas): `{ t: 'invSort' }` → `Inventory.sortBag`: junta pilhas soltas do mesmo item comum e ordena por
  dwItemKind1/2/3, nível e item (enchant/elemento maior primeiro), sem buracos.
- **Red Chip** (II_CHP_RED, 26460) virou contador do personagem, como o penya: coluna `characters.red_chips` (migração 018, que
  também passou os chips que estavam na bolsa para o contador). `Inventory.add` desvia o chip para o contador (drop, compra, GM);
  vai no `inv` como `chips`. Só o red chip: o blue chip continua item.
- Falta: loja que cobra red chip (VENDOR_TYPE_CHIP) ainda não existe — quando existir, cobrar do contador; trade de red chip.
