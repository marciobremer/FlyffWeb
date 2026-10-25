# ANALYSIS.md — Passo 1: análise do ATools e do mapa WdMadrigal

Tudo abaixo foi lido do código real (`ATools-master/Common`, `WorldEditor`) e **validado byte a byte
contra os arquivos em `Resource/`** (scripts em `web-world-editor/tools/`).

## 0. Divergências em relação ao README (corrigir antes do Passo 2)

| README diz | Realidade (código + dados) |
|---|---|
| Pasta `maps/` e `atools/` | Existem `Resource/World/WdMadrigal`, `Resource/Model` e `ATools-master/` |
| `.wld` é o ponto de entrada binário | `.wld` é **texto** (script `chave valor`), só metadados (size 30,30; MPU 4; câmera…). Não lista os `.lnd`: o nome é `{base}{XX}-{YY}.lnd`, XX=x, YY=y |
| Water = `byte height, byte type` | `WaterHeight{byte height; byte texture}` por patch 16×16 (512 B). Tipos vistos nos dados: 0,1,2,6 |
| v≥2: 16×16 bytes "desconhecidos" | São os *land attributes* (256 B, ignorados pelo editor) |
| Layer: `SHORT id`, `DWORD patch_visible`, "128×128 RGBA" | Correto: `u16 textureID`, `int32[256] patchEnable`, `u8[128*128*4]` em **BGRA** (A = alpha de blend da camada, RGB = cor/lightmap compartilhada) |
| Objeto: `type, angle, axis…` | Layout real em §2.3: rot.y, rot.x, (4 bytes ignorados), rot.z, pos, scale… **pos.x/z são multiplicados por 4 (MPU) e somados à origem do land** |
| `mesh_id` → `.o3d` direto | `modelID` indexa tabelas do **projeto** (`mdlObj.inc`, `mdlDyna.inc`, `propMover.txt`, `terrain.inc`) que **NÃO estão em `Resource/`** (ver §6) |
| Altura ≥1000 etc. | Correto (HGT_NOWALK=1000, NOFLY=2000, NOMOVE=3000, DIE=4000) |

## 1. Arquivos de um mundo (`Resource/World/WdMadrigal`)

| Arquivo | Formato | Conteúdo (WdMadrigal) | Loader ATools |
|---|---|---|---|
| `WdMadrigal.wld` | texto | `size 30, 30` · `MPU 4` · `camera` · fog `70/400` · sky/cloud/sun/moon `default` | `CWorld::_loadWldFile` |
| `WdMadrigal00-00.lnd`…`29-29` | binário | **900** arquivos (30×30, todos presentes) | `CLandscape::Load` |
| `WdMadrigal.rgn` | texto **UTF‑16LE** (BOM) | 856 `respawn7` + 130 `region3` | `_loadRgnFile` |
| `WdMadrigal.dyo` | binário | 225 movers + 1 ctrl (spawns "reais" de NPC/ctrl) | `_loadDyoFile` |
| `WdMadrigal.wld.cnt` | texto | continentes (polígonos `VERTEX x y z`, nome, id, env) | `_loadCntFile` |
| `wdMadrigal.txt.txt` | texto UTF‑16LE | `IDS_WDMADRIGAL_WLD_nnnnnn<TAB>texto` (títulos/descrições de regiões) | `_loadTxtTxtFile` |
| `WdMadrigal.pat` | texto | vazio (0 B) — rotas de patrulha | `_loadPatFile` |
| `WdMadrigal*.dds` (249) | textura | **lightmaps/minimapas por tile** (não usados no MVP) | — |

Ordem de carga em `CWorld::Load`: wld → txt.txt → rgn → dyo → wld.cnt → pat. Os `.lnd` são carregados sob
demanda por visibilidade (`_loadLndFiles`, raio = `farPlane/(128*MPU)` = 2 tiles); no editor web podemos carregar todos.

## 2. Formatos binários

Tudo little‑endian. `CFile::Read` é um `memcpy` do struct, então tamanhos = `sizeof` do C++ (x86).

### 2.1 `.wld` (texto)
Tokens case-insensitive: `size w, h` · `indoor` · `ambient 0xAARRGGBB` · `bgColor` · `fly` · `camera x y z a b`
(ângulos em unidades de 60°: `angle.y = -fmod(a,6)*60`, `angle.x = fmod(b,6)*60`) · `revival id "nome"` · `diffuse` ·
`lightDir` · `fogSetting start end density` · `bgm` · `pkmode` · `MPU` · `sky/cloud` (3 nomes) · `sun` · `moon` · `seacloud`.

Constantes: `MAP_SIZE=128`, `NUM_PATCHES_PER_SIDE=16`, `PATCH_SIZE=8`, **MPU=4** → um tile = 128×4 = **512 unidades**;
mundo = 30×512 = 15 360 unidades. Mundo de WdMadrigal tem câmera inicial em (6939, 163, 2969) → tile (13, 5).

### 2.2 `.lnd` (validado nos 900 arquivos: 0 desalinhamentos, `offset final == tamanho`)

```
u32  version                      // 3 em todos os arquivos
[v>=1] i32 tileX, i32 tileY       // coincide com o nome do arquivo (XX=x, YY=y)
f32  height[129*129]              // índice = z*129 + x
{u8 height, u8 texture} water[16*16]   // 512 B
[v>=2] u8 landAttr[256]           // ignorado
u8   layerCount
  repeat layerCount:
    u16 textureID
    i32 patchEnable[256]          // 16x16
    u8  lightmap[128*128*4]       // B,G,R,A  (A = alpha da camada; RGB só vale onde A>0)
u32  objCount;   Object  objs[objCount]
u32  sfxCount;   Object  sfx[sfxCount]
```
Tamanho de exemplo: 4+8+66564+512+256+1+2·(2+1024+65536)+4+4 = 200 477 B ✔ (WdMadrigal00-08.lnd).

**Altura**: valor ≥1000 carrega atributo; `real = h - 1000*k`, `attr = k` (k=1 NoWalk, 2 NoFly, 3 NoMove, 4 Die;
`GetHeight/GetHeightAttribute`, Landscape.cpp:1031). Distribuição em Madrigal (14,9M vértices): 59% NoMove (área fora
do mapa jogável), 32% normal, 2,3% NoWalk, 0,08% NoFly, 3 vértices Die.

**Vértice de mundo** (`CLandscape::_setVertices`): `x = (tileX*128 + i) * MPU`, `y = height`, `z = (tileY*128 + j) * MPU`
(grid 129×129, patches de 8 células, 16×16 patches).

Camadas: 64 `textureID`s distintos nos 900 tiles (0 e 9 dominam). IDs resolvem via `terrain.inc` (ausente).

### 2.3 Objeto (usado em `.lnd` e `.dyo`)  — `CObject::CreateObject(file)` + `CObject::Read`

```
u32 type            // enum OT_*  (lido primeiro, escolhe a classe)
f32 rotY, rotX, <4 bytes ignorados>, rotZ     // graus
f32 pos[3]          // pos.x*=4, pos.z*=4 ao ler  (valor no arquivo está em "células")
f32 scale[3]
u32 m_type          // repete o type (bits 0x10000/0x20000 = flags de invisível, mascarados)
u32 modelID
u32 motion, u32 AIInterface, u32 AI2     // motion só vale p/ mover
```
= 64 bytes para OBJ/SFX/ITEM. **Mover (OT_MOVER=5)** acrescenta 136 B: `char name[64]`, 32 B skip,
`char characterKey[32]`, `u32 belligerence`, 4 B skip. **Ctrl (OT_CTRL=2)**: `u32 version` (0x80000000) + `CtrlElem`
(432 B, `MAX_JOB=32`, validado: 225×(64+136)+(64+4+432)+4 = 45 504 = tamanho do `.dyo`).

Enum de tipos (inferido de `g_root[]` em Object.cpp; a declaração real está em header externo não incluído):
`OT_OBJ=0, OT_ANI=1, OT_CTRL=2, OT_SFX=3, OT_ITEM=4, OT_MOVER=5, OT_REGION=6, OT_SHIP=7, OT_PATH=8`.

No `.lnd`, após `Read`, se `version>=1` a posição é somada à origem do tile: `pos += (tileX*128*MPU, 0, tileY*128*MPU)`.
Verificação: obj em `04-08` com pos arquivo (113,65,123) → mundo (2500, 65, 4588) dentro do tile (4,8) ✔.

Dados: **34 612 objetos estáticos** (todos `type=0`, `m_type=0`) em 900 tiles, **641 modelIDs distintos**
(top: 247×3722, 52×1903, 1031×1710, 47×1340, 154×1141); **472 SFX** (type 3, modelID 0); **0 movers** nos `.lnd`.
`motion=0xFFFFFFFF`, AI=0 em tudo. Escalas variam (ex.: 1,08; 2,27).

### 2.4 Matriz de transformação (Object.cpp `_updateMatrix`)
`TM = Scale(s) · RotationYawPitchRoll(yaw=-rotY°, pitch=-rotX°, roll=rotZ°) · Translation(pos)` (D3DX, **mão esquerda,
Y para cima, linhas‑vetor**). Three.js é mão direita → na exportação: negar Z (ou espelhar X) e inverter winding das faces,
ou aplicar `scale.z = -1` no root e mudar a ordem de rotação (`'YXZ'`).

### 2.5 `.dyo`
Sequência de objetos (§2.3) com `type` ∈ {CTRL, ITEM, MOVER}, terminada por `u32 0xFFFFFFFF`. Após ler, o ATools gera
`m_rect = (pos.z-MPU, pos.x-MPU, 4*MPU, 4*MPU)` (área de movimento) e coloca no mundo. Madrigal: 225 movers + 1 ctrl.

### 2.6 `.rgn` (texto UTF‑16LE, tokens separados por espaço, strings entre aspas)
- `respawn7 type modelID x y z count time attackCount rcTop rcLeft rcBottom rcRight dayMin dayMax hourMin hourMax itemMin itemMax aiState angle patrolIdx patrolCycle control [ctrl extras]`
  (`CSpawnObject::ReadRespawn`). Ex. real: `respawn7 5 20 6922.86 96.45 2953.88 40 20 20 6912 2928 6939 2992 1 30 1 24 1 1 2 0 0 -1 0` → 40 movers do modelID 20 naquela área. Posição já em **unidades de mundo** (não ×4).
- `region3 type modelID x y z attrs music directMusic "script" "sound" teleWorld tx ty tz rcTop rcLeft rcBottom rcRight "key" targetKey item count minLv maxLv quest flag job gender party guild chao` seguido de `title 0|1 {IDS_…}` e `desc 0|1 {IDS_…}` (`CRegion::ReadRegion`). Textos vêm de `txt.txt`.

### 2.7 `.wld.cnt`
Blocos `Continent BEGIN … Continent END` com `TOWN`, `C_id`, `C_name`, `C_use*`, `C_ambient/diffuse/fogstartend/weather/sky/cloud/sun/moon` e N× `VERTEX x y z` (polígono em coords de mundo).

### 2.8 `.o3d` (modelo; `CObject3D::Load`) — validado com `tools/probe_o3d.py`
Parseia até EOF em `Obj_MaCoPrTr02`, `Mvr_MaFlJuria`, `mvr_MaFlBoboku` (v22), `Mvr_InfoPeng`.
```
u8 nameLen; char name[nameLen] ^ 0xCD          // deve bater com o nome do arquivo
i32 version (>=20; 22 acrescenta 2 forces) ; i32 ID
vec3 forces[2 | 4]; f32 scrlU, scrlV; 16 B lixo
Bounds{vec3 min,max}; f32 perSlerp; i32 frameCount; i32 eventCount; vec3 events[eventCount]
i32 hasColl → GMObject colisão
i32 LOD(0/1); i32 boneCount
  [bones>0] mat4 base[n], mat4 baseInv[n]; [frames>0] ReadTM(...) ; i32 sendVS
i32 poolSize; (LOD?3:1) grupos: i32 objCount; cada: u32 type(&0xFFFF; bit31=light), i32 usedBoneCount, i32 usedBones[], i32 ID, i32 parentID, [parent!=-1] i32 parentType, mat4 transform, GMObject, [NORMAL && frames>0] i32 hasFrames + TMAnimation[frames]
[ver>=21] i32 attrCount; MotionAttribute[...]
GMObject: Bounds(24) , i32 opacity,bump,rigid, 28 B, i32 vertexListCount, vertexCount, faceListCount, indexCount,
          vec3 vertexList[], vertices[] (Normal=32 B: p,n,uv | Skin=44 B: p,w1,w2,id1,id2,n,uv), u16 indices[indexCount], u16 IIB[vertexCount],
          i32 hasPhysique→i32[vertexListCount], i32 hasMaterial→(i32 count; {D3DMATERIAL9 68 B, i32 len, char texName[len]}×count),
          i32 blockCount; MaterialBlock{startVertex, primitiveCount, materialID, effect, amount, usedBoneCount, usedBones[28]}×n  (=136 B)
```
Obs.: `indices`+`IIB` indexam `vertexList` via IIB (índice de vértice físico → vértice com normal/uv): reconstruir a malha de render usando `vertices[]` e `indices` já funciona; `IIB` só é necessário p/ skin.
**Modelos de movers**: esqueleto em `.chr` (ver `CSkeleton::Load`: ver≥4, id, boneCount, {len,name,TM,invTM,localTM,parent}, …) e animações em `.ani` (`CMotion::Load`, VER_MOTION=10, bones+frames de `TMAnimation{quat rot; vec3 pos}`). Texturas `.dds` em `Resource/Model/Texture` (existem, ao contrário do README).

## 3. Cadeia de carga/renderização no ATools (resumo)
`CWorld::Load` → `_initialize` (aloca grid de `CLandscape*`, MPU, skybox) → arquivos texto/dyo. Por frame: `_loadLndFiles` (raio de visibilidade) → `_cullObjects`
→ terreno por patch (`CLandPatch`, LOD opcional) com multitextura (1 passe por layer, `lightMap` como alpha/vertex‑color) → água/nuvem por patch → objetos
(`CObject::Cull/Render`, `ModelMng->GetModel`, LOD 0..2 por distância/50) → regiões/spawns como retângulos/boxes. Objetos do `.rgn/.dyo` são associados
ao `CLandscape` cujo retângulo contém `pos` (`_loadLndFile`).

## 4. Estrutura de dados proposta para o editor web (resumo)
`World{ meta, tiles[30×30]{height Float32Array(129²), attr Uint8Array, water, layers[], objects[], sfx[]}, regions[], spawns[], movers[], continents[] }`.

## 5. Inventário dos dados de exemplo
- `Resource/Model`: 5 movers com `.o3d`+`.chr`+`.ani` (Juria, Losha, Marche, Boboku, Lui, InfoPeng) e 1 objeto estático (`Obj_MaCoPrTr02.o3d`) + texturas em `Texture/`.
- Os 641 modelIDs de objeto do mapa **não** podem ser resolvidos para arquivo sem `mdlObj.inc`; só 1 `.o3d` de objeto está presente.

## 6a. Tabelas do projeto (adicionadas em `Resource/`) — validação
- `mdlObj.inc` (UTF-16): `"nome" modelID MODELTYPE_x "" fly MD_x pick scale trans shadow ATEX_x render`; 11 127 entradas (10 798 MESH, 284 ANIMATED_MESH, 45 SFX). Arquivo = `Obj_<nome>.o3d`.
  **Os 641 modelIDs do mapa resolvem 100% (34 612/34 612 objetos).** Ex.: 511→`MaCoPrSkySign01`, 567→`MaTaPrVine-Area`, 21→`MaCoPrTr02`.
  Mas só **1** `.o3d` existe em `Resource/Model` (`Obj_MaCoPrTr02`, id 21); os demais usarão placeholder.
- `Terrain.inc` (UTF-16): `textureID 0 "arquivo.dds" 0 ""`; os 64 textureIDs dos `.lnd` resolvem 64/64 (IDs 0..N direto, sem offset). Os `.dds` de terreno **não estão** no pacote.
- `mdlDyna.inc` (UTF-16, formato por seção `"ctrl" 2 { ... }`, tipo = número da seção), `propMover.txt` (ISO‑8859/coreano, tabulado), `character.inc`, `propItem.txt` também presentes.

## 6. Lacunas / riscos
1. **Resolvido** (ver 6a). Restante: faltam os arquivos `.o3d` de objetos (só `MaCoPrTr02`) e os `.dds` de terreno → placeholders (caixa com bounds desconhecido, cor por hash do nome; terreno por cor da camada).
2. Definição de `OT_*`/`MI_*`/`WI_*` está em header fora de `ATools-master` (inferida de `g_root[]`).
3. Convenção de eixos/handedness (§2.4) precisa de teste visual.
4. Movers do `.rgn` (856 respawns) dependem de `propMover.txt` para nome/modelo; `modelID 20`, etc.
5. `.lnd` com 59% de vértices NoMove: renderizar/exportar considerando atributo para não estourar a escala do terreno (altura real = h−3000).

## 7. Proposta de arquitetura (Passo 2)
`web-world-editor/` (Vite + TypeScript + Three.js):
- `src/formats/` — leitores puros e testáveis: `wld.ts`, `lnd.ts`, `object.ts`, `rgn.ts`, `dyo.ts`, `cnt.ts`, `o3d.ts`, `chr.ts`, `ani.ts`; testes com os arquivos reais.
- `src/world/` — `World`, `Landscape` (Float32Array 129², atributos separados), `ObjectInstance`.
- `src/render/` — terreno (1 `BufferGeometry` por tile, vertex‑color por atributo/camada, `InstancedMesh` por modelID), caixas placeholder, água, regiões/spawns como overlays.
- `src/ui/` — câmera orbit + free‑look (WASD), árvore de camadas/filtros (Obj/Mover/Region/Spawn), painel de propriedades, minimapa.
- `src/export/` — JSON (meta + objetos + regiões) + binário por tile (`heights f32/u16`, `attr u8`) + glTF opcional para modelos.
- Carregamento: `fetch` dos arquivos de `Resource/` via servidor estático; parsing em Web Worker por tile; stream por proximidade da câmera.

## 8. Movers (.o3d skin + .chr + .ani) — validado em Juria, InfoPeng, Rhine, Bill
- **Layout de `SkinVertex` (44 B)**: `p[3f] w1 w2 (2f) blendindices SHORT2 (2×i16, +20 e +22) n[3f] uv[2f]` — a normal começa em +24 (não +20).
  Fonte: decl de `CObject3D::InitStaticDeviceObjects` (`D3DDECLTYPE_SHORT2`, offset 20) + `Resources/Skin.vs` (`v2.x`, `v2.y`).
  **Erro corrigido (2026-10-17)**: lendo os bytes +20/+21 (como UBYTE4) o 2º índice vira o byte alto do 1º (=0), e todo vértice com 2 pesos
  (1,86 mi de 6,2 mi vértices skin; 7 091 objetos) ficava meio preso ao 1º osso da lista — no humano, o pulso direito ia para o antebraço
  esquerdo ("mão em remo"). Teste em `tests/formats.test.ts` (`part_maleHand.o3d`: pares `0/3` e `6/9`).
- **Índices de osso**: `Skin.vs` indexa o array de constantes `c[idx]`, onde cada osso ocupa 3 registradores ⇒ `idx = 3·i`. Osso = `i` (ou `usedBones[i]` quando a lista existe; nos movers ela vem vazia). Apenas 2 pesos (`w1,w2`; soma = 1).
- Matriz de skin (vetor-linha): `v · inverseTM[i] · boneWorld[i]`. No Three (vetor-coluna): `boneWorld · inverseTM`; usar `SkinnedMesh` `bindMode='detached'` + bind identidade e escrever `bone.matrixWorld` à mão.
- `.chr`: `i32 ver(>=4), i32 ID, i32 n, n×{i32 len, name, mat TM, mat inverseTM, mat localTM, i32 parent}, i32 sendVS, 3 mats…`.
- `.ani` (`CMotion::Load`): `i32 ver(>=10), ID, f32 perSlerp, 32 B, i32 bones, i32 frames, [i32 hasPaths → vec3[frames]]`, `n×{name, inverseTM, localTM, parent}`, `i32 aniCount`, por osso `i32 flag` → `1: (quat xyzw + pos)[frames]` | `0: mat TM`; depois atributos e eventos. Pose do frame: `bone = R(slerp)·T(lerp)·bone[parent]` (linha) ⇒ `parent · compose(pos, quat)` (coluna).
- Velocidade: `m_currentFrame += perSlerp` por tick (~60 Hz) ⇒ `frames/s = perSlerp·60`.
- Arquivos: `Mvr_<nome>.o3d/.chr`, animação `Mvr_<nome>_<arquivo>.ani`, onde `<arquivo>` vem do bloco `{ "stand" MTI_STAND … }` de `mdlDyna.inc`.
- Escala do mover = `scale` da linha de `mdlDyna.inc` (`CMover::Init → ResetScale`), não a do arquivo.
- Peças `GMT_NORMAL` com `parentType = bone` (armas/chapéus de NPC) são ancoradas em `boneWorld[parentId] · transform`.
- Nova estrutura de pastas do cliente: modelos em `Resource/Data/Model`, texturas de modelo em `Resource/Data/Model/Texture`, texturas de terreno em `Resource/World/Texture`; `defineObj.h` etc. em `Resource/` resolvem os `MI_*` de `mdlDyna.inc`. O mapa agora é o completo do cliente (58 554 objetos, 388 movers, 1 022 spawns).

## 9. Água, nuvens, skybox e luz (Landscape.cpp / Skybox.cpp / WorldEnvironment.cpp)
- **Água por patch** (`waterTexture`/`waterHeight`, 16×16 por tile): `(tex & 0x03) == 2` → água, lista = `tex >> 2` (blocos `"Water" N { "nome" frames { id 0 "arq.dds" } … }` de `Terrain.inc`; 4 listas em Madrigal); `tex == 1` → nuvem do mar. Quad de `PATCH_SIZE·MPU = 32` unidades, y = `height` (byte), UV 0..3, alpha = TFACTOR 133/255; quadro avança 0,15/tick. Nuvem: quad em y = 0, desenhado em y+40 e y+80 com a textura `seacloud` (ID 10 = `sky_cloud02.dds`) rolando 0,001/0,0015 por tick. Quirk: IDs 500..508 existem em `Water_3` e `Water_4`; o mapa `m_terrains` guarda o último (lava).
- **Terreno**: UV1 `célula·3/8`; UV2 (lightmap) `x·(112/128)/128 + 1/256`; cor da lightmap compartilhada entre camadas (última com alpha>0); 1ª camada de cada patch opaca, demais misturadas por alpha.
- **Skybox**: cúpula r=110, 28 segmentos, faixas 150→0→−20 com alpha 0→1→0 (UV v 0/0,9/1), acompanha só a translação da câmera; nuvens = leque (centro y=100 α=1, borda y=40 α=0) com UV rolando 0,0002/tick; 3 texturas (dia `skybox01_low`, entardecer `skybox02_low`, noite `skybox03`) fundidas por hora: <6h noite, 6h noite→dia, 7–16h dia, 17–18h dia→entardecer, 19h entardecer→noite, ≥20h noite. Sol aditivo 7–17h, lua alpha 20–6h.
- **Luz** (`_setLight`): exterior = `s_light[hora−1]` interpolada com a hora anterior (cor1 = névoa/difusa×1,1; cor2 = ambiente×0,9); direção do sol = `RotationX((h·24·60·0,00015−90+180)°)·(0,0,1)` (praticamente constante: sol a pino); continente com `C_useEnvir` = difusa×1,2 / ambiente×0,8 / dir (0,0.5,0.5), névoa = `C_fogstartend`; indoor = `diffuse/ambient/lightDir` do `.wld`. `UpdateContinent` = teste par/ímpar de raios sobre `VERTEX`.
- **DDS**: além de DXT1/3/5 há R5G6B5/A4R4G4B4, R8G8B8 e A8R8G8B8 (≈1.400 arquivos em Data/Model/Texture e 69 em World/Texture).

## 10. Efeitos .sfx (Sfx.cpp / SfxModel.cpp) — validado nos 1.567 arquivos de Data/SFX (0 bytes sobrando)
```
char[8] "SFX0.1  "|"SFX0.2  "|"SFX0.3  " (ou sem cabeçalho = v0) ; i32 partCount
parte: i32 tipo (1 Bill, 2 Particle, 3 Mesh, 4 CustomMesh) ; i32 len+nome ; [v>=2] i32 len+textureName ;
       [v>=1] u16 texFrame, u16 texLoop, [v>=2] i32 visible ; i32 billType (1 Bill,2 Bottom,3 Pole,4 Normal) ; i32 alphaType (1 Blend, 2 Glow)
       Particle: u16 create,createNum,frameAppear,frameKeep,frameDisappear ; f32 startPosVar,startPosVarY,yLow,yHigh,xzLow,xzHigh ; vec3 accel,scale,scaleSpeed ;
                 [v>=2] vec3 rotation,rotLow,rotHigh ; i32 repeatScal ; [v>=3] i32 repeat ; 6×f32 scalSpeed{X,Y,Z}{Low,High} ; vec3 scaleSpeed2,scaleEnd
       i32 keyCount ; key = u16 frame, vec3 pos, posRotate, scale, rotate, i32 alpha (54 B)
       CustomMesh: i32 pointCount (depois das chaves)
```
- Arquivo: `mdlDyna.inc` seção `"sfx" 3` → nome; se contém `_` o arquivo é `<nome>.sfx`, senão `Sfx_<nome>.sfx`. Texturas em `Data/SFX/Texture` (dds/bmp/png/tga). No mapa: `modelID` do `OT_SFX` (Madrigal usa 25 modelos; todos existem).
- Reprodução: `frame += perSlerp(1)` por tick (~60 Hz); loop quando não há mais chaves nem partículas; `repeat` volta a 60% quando passa de 65% do último quadro. Alfa = `key.alpha` (TFACTOR) × alfa da textura; Glow = blend aditivo. A matriz do bill é `S·Rz(rotate.z)·invView` (billboard), Bottom `S·Rz·Rx(90°)`, Normal `S·YPR(rotate)·YPR(objeto)`; âncora = `pos + (key.pos · YPR(objeto) · YPR(posRotate))·escala`.
- Partículas: `angle` é sorteado em graus mas usado em sin/cos como radianos (bug do original, mantido).

## Colisão com objetos (m_collObj) — 2026-10-17
- O `.o3d` traz, logo após os eventos, `i32 existe` + um GMObject Normal sem cabeçalho de transform: a **malha de colisão**
  (`CObject3D::m_collObj`, que o ATools só desenha). Os vértices estão no espaço do objeto; a malha do mundo sai de `objectMatrix(obj)`.
- Em Flaris praticamente tudo que é sólido tem essa malha (ponte `NewFlbrdg01` 168 tri, praça `NewFlsenCent01` 160, casas, árvores).
  Flores, grama e decoração pequena (`MaCoPrFl*`, `MaCoPrGr07-*`, `hDSUE702`) não têm e, por isso, não colidem.
- Implementado em `shared/collision.ts`: chão = triângulos com |normal.y| ≥ 0,5; parede = os demais. Ainda **não** foi comparado com
  o comportamento exato do cliente (degrau máximo, raio do corpo e não usar a malha visual quando falta `m_collObj` são escolhas nossas).
