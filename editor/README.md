# FlyFF Web (editor de mapa + cliente do jogo)

TypeScript + Three.js + Vite para mapas do FlyFF. Formatos baseados no código do ATools — ver `../ANALYSIS.md`.
A pasta ainda se chama `web-world-editor`, mas agora contém o editor, o cliente do jogo e o servidor.

## Estrutura

| Pasta | Conteúdo |
|---|---|
| `shared/` | código usado por editor e jogo: leitores de formato (`formats/`), modelos, movers, humanos, colisão, terreno, água, céu, SFX, personagem e **`world.ts` (`WorldView`)**, que monta o mundo (tiles, NPCs/mobs, ambiente, personagem, clique para andar, alvo, cursores) |
| `editor/` | editor de mapa: painel, marcadores de `.dyo`/`.rgn`, inspeção, modo edição (`editor.ts`), locais e exportação (`export.ts`) |
| `game/` | cliente do jogo: tela de entrada (nome/sexo/qualidade) e spawn em Flaris, sem ferramentas de edição |
| `server/` | `resources.ts` (serve `../Resource` em `/res` — usado também pelo Vite), `index.ts` (servidor do jogo), `api.ts`/`auth.ts` (login e personagens), `realtime.ts` (WebSocket `/ws`: jogadores se vendo), `internal.ts` (rotas internas para o painel), `admin/` (painel admin) e `db/` (PostgreSQL) |
| `tests/` | valida os leitores contra `../Resource` |

## Rodar

```bash
npm install
npm run dev        # http://localhost:5173  →  /game/ (jogo) e /editor/ (editor)
npm test           # valida os leitores contra ../Resource (900 tiles, ~58 mil objetos…)
npm run typecheck
npm run build      # gera dist/ (início, jogo e editor)
npm start          # servidor do jogo: http://localhost:8080/game/ (serve dist/ + /res; PORT opcional)
```

### Painel admin

```bash
npm run admin        # http://127.0.0.1:8090 (abre o navegador; Ctrl+C fecha o painel e para o servidor do jogo iniciado por ele)
```

Dashboard: iniciar / parar / reiniciar / compilar o servidor do jogo (porta 8080), jogadores online, conexões e mensagens do WebSocket
(gráfico), latência/RAM/uptime do jogo, estado do banco e logs. Account: buscar por usuário ou personagem, criar conta (com personagem
opcional), kick, banir (1/7/30 dias ou permanente — desconecta na hora), desbanir (também pelo nome) e trocar senha. Só escuta na própria
máquina, sem login — não exponha na rede.

### Banco de dados (PostgreSQL `flyffweb`)

```bash
npm run db:migrate                 # aplica server/db/migrations/*.sql ainda não aplicadas
npm run db:import -- --dry-run     # mostra o que viria do SQL Server do FlyFF (sem gravar)
npm run db:import                  # importa contas e personagens novos (repetir não duplica)
npm run db:import -- --overwrite   # também atualiza personagens já importados com os dados do FlyFF
```

Conexão: `localhost:5432`, banco `flyffweb`, usuário `flyffweb_app` (mude com `PGHOST`/`PGPORT`/`PGDATABASE`/`PGUSER`). A senha vem de
`PGPASSWORD` ou do `pgpass.conf` do PostgreSQL (`%APPDATA%\postgresql\pgpass.conf`) — nunca do código. A importação lê o SQL Server
oficial só com `sqlcmd -E` (autenticação do Windows; opções `--server`, `--account-db`, `--char-db`) e não escreve nele.

### Contas e login

O jogo (`/game/`) abre com a tela de login (janela no estilo do cliente: `WndTile*`, `WndEditTile*`, `ButtLogin/Quit/SaveLogin/Load/Delete.bmp`,
`ButtCheck.tga`, `logotitanium.png`, `MapLoading_Flaris.png` enquanto carrega e depois Flaris em 3D ao fundo). A conta é conferida em
`POST /api/login` contra o `flyffweb`. Depois: **seleção de personagem** (3 vagas; o escolhido aparece em 3D) ou, se a conta não tem
personagem, **criação** (nome, sexo, cabelo 1–10, rosto 1–24, prévia 3D girando; `POST /api/characters`). Entra na posição salva (mundo 1)
ou em Flaris.

```bash
npm run account -- create <usuario>                 # cria conta (pede a senha sem eco)
npm run account -- set-password <usuario>           # define/troca a senha (ex.: contas importadas do FlyFF)
npm run account -- add-character <usuario> <nome> [--sex female]
npm run account -- list
```

Senhas: scrypt com sal aleatório. Contas importadas guardam o MD5 do FlyFF e o 1º login confere `md5(sal + senha)` com o sal de
`FLYFF_MD5_SALT` (padrão `kikugalanet`, do FlyFF original) e grava o hash novo. Sessões ficam em memória (12 h). Conta de teste
local: `server/db/dev-test-account.local.json`.

Os dois servidores escutam na rede local (outro PC abre `http://<ip-deste-pc>:5173/game/` ou `:8080/game/`) e expõem
`../Resource` em `/res/*` (somente leitura) e `/api/list?dir=…`. Para outra pasta: `FLYFF_RESOURCE=D:\Cliente\Resource npm run dev`.

Arquivos lidos de `Resource/`: `World/<Mapa>/*` (`.wld .lnd .rgn .dyo .wld.cnt .txt.txt`), `mdlObj.inc`, `mdlDyna.inc`, `Terrain.inc`,
`Data/Model/*.o3d|.chr|.ani` + `Data/Model/Texture/*.dds`, `propMover.txt(.txt)`, `character*.inc/.txt.txt`, `Data/Theme/Default/*.tga`,
`Data/Cursors/CurDefault1/*.cur` e, se existirem, `defineObj.h`/`define.h` (resolvem os `MI_*` simbólicos de `mdlDyna.inc`).

## O que faz (MVP)

- Terreno 129×129 por tile, carregado por proximidade da câmera (raio ajustável). Modo padrão "Texturas reais": uma passada por camada como o `CLandscape::Render` original (UV `célula·3/8`, alpha e cor da lightmap 128², primeira camada de cada patch opaca) com `World/Texture/*.dds`; também há modos por cor de camada, atributo (NoWalk/NoFly/NoMove/Die) e altura.
- Objetos estáticos (`InstancedMesh` por modelo). Modelos que têm `.o3d` em `Resource/Model` são renderizados com malha e textura DDS; os demais viram caixa colorida (placeholder por `modelID`).
- Movers (`.dyo` e respawns do `.rgn`) com malha skinned (`.o3d` + esqueleto `.chr`), textura DDS e animação de repouso (`.ani`, MTI_STAND/IDLE1); instanciados por proximidade da câmera (máx. 120 num raio de 900) para manter fps. Nomes vindos de `propMover.txt`.
- Ambiente: skybox (cúpula + nuvens + sol/lua, `Data/Weather`) com fusão dia/entardecer/noite pelo controle de hora; iluminação por hora (`s_light`) ou do continente (`C_useEnvir` em `.wld.cnt`, detectado por polígono sob a câmera, com céu/névoa próprios) ou do `.wld` em mapas indoor; névoa do mundo opcional.
- **Modo edição de mundo** (botão no menu): seleciona objetos estáticos, move/gira/escala com gizmo (teclas 1/2/3), G ao chão, Ctrl+D duplica, Del apaga, Ctrl+Z desfaz e "Exportar alterações" gera um JSON (`flyff-world-edits`). Gravar em `.lnd` é o próximo passo.
- Humanos (`MI_MALE`/`MI_FEMALE`): NPCs com aparência de `character.inc` (SetFigure/SetEquip → `Part_*.o3d` sobre `mvr_male/female.chr`) e personagem jogável (painel *Personagem*: male/female, cabelo e cabeça 01): WASD move relativo à câmera (Alt anda), Espaço pula, anima parado/andar/correr/pular (`GenStand/Walk/Run/Jump1`), anda sobre a altura do terreno e é bloqueado por NoWalk/NoMove/Die do `.lnd`; sem colisão com objetos ainda.
- Efeitos `.sfx` reais (`shared/sfxRuntime.ts`): partes Bill/Pole/Bottom/Normal, Particle (simulação do `CSfxModel::_nextFrame`), Mesh e CustomMesh, animação de textura por quadros, blend/glow, 60 ticks/s, instanciados por proximidade (80 num raio de 650). Só os SFX sem arquivo viram losango amarelo.
- Locais para teleporte: cidades (pontos de ressurreição `flaris`, `saintmorning`, `darkon`…), continentes e regiões nomeadas, com filtro.
- Sombras em tempo real do sol (shadow map ortográfico 4096² que segue a câmera, PCF suave): objetos e movers projetam e recebem; o terreno (shader próprio) amostra o mesmo mapa. Controles "Sombras" e "Inclinação do sol" (o sol original é quase vertical; 0° = original).
- Água animada (listas `Water` de `Terrain.inc`, 133/255 de opacidade) e nuvens do mar por tile.
- Spawns e regiões do `.rgn`, continentes do `.wld.cnt`, SFX e grade de tiles (marcadores/overlays).
- Câmera orbit + voo (WASD/QE, Shift acelera), clique seleciona e mostra nome/modelID/pos/rot/escala.
- Exportação `.zip` (tiles carregados ou mapa completo).

## Coordenadas

Tudo fica no espaço original do FlyFF (Direct3D: mão esquerda, Y para cima, 1 tile = 128 células × MPU 4 = 512 unidades).
O Three.js é mão direita, então o grupo raiz usa `scale.z = -1` (o renderer inverte o winding sozinho). Matriz de objeto: `S · Rz(roll)·Rx(pitch)·Ry(yaw) · T`
em convenção vetor-linha, com `yaw = -rotY`, `pitch = -rotX`, `roll = rotZ` (graus) — `shared/math.ts`.

## Formato de exportação (`flyff-web-world` v1)

```
world.json            meta, ambiente, models{id→{name,file,mesh}}, tiles[{x,y,terrain,objects,sfx}], movers, spawns, regions, continents, terrainTextures
tiles/XX-YY.bin       u32 'FTIL'(0x4C495446) · u16 version=1 · u16 x · u16 y · u16 layerCount
                      f32 heights[129*129] (índice z*129+x) · u8 attrs[129*129] · u8 waterHeight[256] · u8 waterType[256]
                      layerCount × { u16 textureId · u8 alpha[128*128] }
models/*.o3d, models/Texture/*.dds   somente os modelos usados que existem em Resource/Data/Model
```
`objects[]`/`sfx[]` são linhas `[modelId, px,py,pz, rotX,rotY,rotZ(graus), sx,sy,sz]`.

## Limitações conhecidas

- Terreno sem normal-map nem LOD (sombras só de objetos/movers sobre o terreno, sem auto-sombra do relevo); iluminação simplificada (o mundo usa luz de `lightDir`/continente no original). Cores sem gamma (como o D3D fixo). DDS sem compressão (R5G6B5, R8G8B8, A8R8G8B8…) é decodificado em `shared/dds.ts`.
- Movers sem `.o3d`/`.chr` em `Data/Model` ficam como marcadores. Só a animação de repouso é tocada; peças de personagem (`MI_MALE/FEMALE`, equipamentos) não.
- Efeito de tela submerso, clima/chuva (`C_weather`), sombras, outras animações de movers (andar/atacar) e edição/gravação de mapas ainda não implementados.
- `.sfx` não é lido.
