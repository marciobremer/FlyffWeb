# FlyFF Web Port – World Editor (WebGL / Three.js)

## Objetivo do Projeto

Portar o jogo **Fly For Fun (FlyFF)** para rodar na web usando **WebGL / WebGPU** com **Three.js**.

O primeiro passo deste projeto é criar um **World Editor** idêntico (ou o mais próximo possível) ao World Editor do ATools, porém focado em:

1. Ler e visualizar os mapas do FlyFF (arquivos `.wld`, `.lnd`, etc.)
2. Exportar o mapa em um formato otimizado para uso em um cliente web com Three.js

## Estrutura Esperada do Projeto

```
/
├── atools/                  # Código-fonte do ATools (clonado ou copiado)
│   ├── WorldEditor/         # Foco principal
│   ├── Common/              # Classes compartilhadas (World, Landscape, Object, etc.)
│   ├── ModelEditor/
│   ├── ...
├── maps/                    # Pasta com mapa de exemplo (sem texturas por enquanto)
│   └── [mapa de exemplo]/  # Ex: WdMadrigal ou similar (.wld, .lnd, objetos, .mvr)
├── web-world-editor/        # NOVO: Editor web que será criado
└── README.md                # Este arquivo
```

## Repositórios de Referência

Use estes repositórios como fonte de informação e referência:

| Repositório | Uso |
|-------------|-----|
| [https://github.com/Yothri/ATools](https://github.com/Yothri/ATools) | Código-fonte oficial do ATools (WorldEditor, Common, etc.) |
| [https://github.com/morluto/rea](https://github.com/morluto/rea) | Ferramenta de reverse engineering (útil para analisar o .exe do ATools se necessário) |
| [https://github.com/ed3ath/flyff-web-mmo](https://github.com/ed3ath/flyff-web-mmo) | Referência de projeto web relacionado a FlyFF |
| [https://github.com/Yothri/FlyFF-Landscape-Converter](https://github.com/Yothri/FlyFF-Landscape-Converter) | Ferramenta que gera heightmap a partir de arquivos `.lnd` |

---

## Formatos de Arquivo de Mundo (FlyFF)

### Visão Geral da Estrutura de um Mundo

Um mapa do FlyFF é composto por vários arquivos que trabalham juntos:

| Extensão | Função |
|----------|--------|
| **`.wld`** | Arquivo principal do mundo. Define o tamanho do grid, nome do mundo e referencia os tiles de landscape (`.lnd`). |
| **`.lnd`** | Landscape (terreno). Contém heightmap, restrições de movimento, camadas de textura, objetos estáticos e SFX. |
| **`.rgn`** | Regiões (música, áreas de combate, spawns de itens/mobs, etc.). |
| **`.dyo`** | Dados de NPCs e controles (spawns de NPCs). |
| **`.mvr`** | Movers (modelos de personagens/monstros/objetos animados). |
| **`.txt.txt`** | Nomes / textos associados ao mundo. |
| **`.cnt`** | Configurações de continente (quando presente). |

O World Editor do ATools abre principalmente o **`.wld`**, que por sua vez carrega todos os `.lnd` do grid.

---

### Formato `.wld` (World)

O arquivo `.wld` é o **ponto de entrada** de um mapa.

**O que ele contém (conceitualmente):**
- Nome do mundo / identificador
- Dimensões do grid de landscapes (quantos tiles em X e Y)
- Referências aos arquivos `.lnd` (padrão de nomenclatura)
- Possivelmente informações de continente, skybox, clima, etc.

**Convenção de nomenclatura dos tiles `.lnd`:**
```
{WorldName}{XX}-{YY}.lnd
```
Exemplo para o mapa Madrigal:
```
WdMadrigal00-00.lnd
WdMadrigal00-01.lnd
WdMadrigal01-00.lnd
...
```
Onde `XX` e `YY` são as coordenadas do tile no grid (geralmente formatados com 2 dígitos).

**Tamanho típico de um tile:**
- Cada `.lnd` representa uma área de **128 x 128** unidades de terreno (heightmap de 129 x 129 pontos, pois inclui as bordas).

**Arquivos importantes no código do ATools para entender o `.wld`:**
- `Common/World.h` / `World.cpp` / `World.inl`
- `Common/WorldFile.cpp`
- `Common/World3D.cpp`
- `Common/WorldEnvironment.cpp`

---

### Formato `.lnd` (Landscape) – Detalhado

O arquivo `.lnd` é **binário** e contém quase tudo que forma o terreno visual e lógico de um tile.

#### Estrutura conhecida (baseada em engenharia reversa da comunidade + ATools):

```
DWORD version                          // Versão do formato

IF (version >= 1)
    DWORD offset_x                     // Offset X do tile no mundo
    DWORD offset_y                     // Offset Y do tile no mundo

// === HEIGHTMAP (129 x 129 floats) ===
FOR y = 0 to 128
    FOR x = 0 to 128
        FLOAT height

        // Restrições de movimento embutidas no valor da altura:
        // Se height >= 4000 → Die        (morre ao tocar)
        // Se height >= 3000 → NoMove     (não pode andar)
        // Se height >= 2000 → NoFly      (não pode voar)
        // Se height >= 1000 → NoWalk     (não pode caminhar)
        // Depois de detectar a restrição, subtrai o valor correspondente
        // para obter a altura real do terreno.

// === WATER / CLOUD (16 x 16) ===
FOR y = 0 to 15
    FOR x = 0 to 15
        BYTE waterHeight
        BYTE waterType                 // 0 = None, 1 = Cloud, 2 = Water

IF (version >= 2)
    // 16x16 bytes desconhecidos (possivelmente localização / atributos extras)
    FOR y = 0 to 15
        FOR x = 0 to 15
            BYTE unknown

// === CAMADAS DE TEXTURA ===
BYTE layer_count
FOR cada layer (0 até layer_count-1)
    SHORT tile_id                      // ID da textura / tile
    // Patch visibility (16x16)
    FOR y = 0 to 15
        FOR x = 0 to 15
            DWORD patch_visible
    // Vertex colors / blending (128x128)
    FOR y = 0 to 127
        FOR x = 0 to 127
            BYTE r, g, b, a

// === OBJETOS ESTÁTICOS ===
DWORD object_count
FOR cada objeto (0 até object_count-1)
    DWORD type                         // Deve ser 0 para objetos estáticos
    FLOAT angle                        // Rotação (em radianos ou graus – verificar no código)
    FLOAT axis_x, axis_y, axis_z       // Eixo de rotação (ou quaternion parcial)
    FLOAT position_x, position_y, position_z
    FLOAT scale_x, scale_y, scale_z
    DWORD m_dwType
    DWORD mesh_id                      // ID do modelo (.o3d / mesh)
    DWORD motion
    DWORD AIInterface
    DWORD dwAI2

// === SFX (efeitos especiais) ===
INT sfx_count
FOR cada SFX (0 até sfx_count-1)
    // Estrutura muito similar aos objetos estáticos
    DWORD type                         // Geralmente 3 para SFX
    FLOAT angle
    FLOAT axis_x, axis_y, axis_z
    FLOAT position_x, position_y, position_z
    FLOAT scale_x, scale_y, scale_z
    DWORD m_dwType
    DWORD mesh_id
    DWORD motion
    DWORD AIInterface
    DWORD dwAI2
```

#### Resumo do que cada parte faz:

| Seção | Tamanho / Dados | Uso no Editor Web |
|-------|-----------------|-------------------|
| Heightmap | 129×129 floats | Gerar mesh do terreno (Three.js BufferGeometry) |
| Restrições | Embutidas na altura | Colisão / zonas proibidas (opcional no MVP) |
| Water/Cloud | 16×16 | Água e nuvens baixas (pode ser ignorado no início) |
| Texture layers | Variável | Texturização do terreno (por enquanto placeholder) |
| Objects | Lista de transforms + mesh_id | Posicionar modelos 3D no mapa |
| SFX | Lista similar | Efeitos visuais (pode ser ignorado no MVP) |

#### Observações importantes:

- O heightmap usa **129×129** porque é um grid de 128 células (precisa de n+1 vértices).
- As restrições de movimento (Die, NoMove, NoFly, NoWalk) estão **codificadas no valor da altura**. É preciso subtrair os offsets (1000, 2000, 3000, 4000) para obter a altura real.
- `mesh_id` aponta para modelos que normalmente estão em arquivos `.o3d` (ou referenciados via `mdlObj.inc` / `propObj`).
- No mapa de exemplo atual **não há texturas**, então as camadas de textura podem ser ignoradas ou renderizadas com material sólido.

---

### Arquivos relacionados que também aparecem

- **`.mvr`**: Arquivos de mover (personagens, monstros, objetos animados). Contêm modelo + animações. O World Editor e o Model Editor do ATools lidam com eles.
- **`.rgn`**: Define regiões (música de fundo, se é área de combate, spawns de monstros/itens, etc.).
- **`.dyo`**: Spawns de NPCs e objetos de controle.

No **MVP do World Editor web**, o foco deve ser:
1. Ler o `.wld` para descobrir quantos e quais `.lnd` existem
2. Ler cada `.lnd` e extrair heightmap + lista de objetos
3. Renderizar o terreno + objetos (mesmo sem texturas)
4. Exportar para um formato Three.js-friendly

---

## Instruções para o Claude Code (Passo a Passo)

### Passo 1 – Análise do código-fonte do World Editor (ATUAL)

1. **Acesse a pasta do código-fonte do ATools** (especialmente `WorldEditor/` e `Common/`).
2. **Leia e analise** os seguintes arquivos/classes principais:
   - `WorldEditor` – ponto de entrada e interface do editor
   - `Common/World.h` / `World.cpp` / `World.inl` / `World3D.cpp` / `WorldFile.cpp`
   - `Common/Landscape.h` / `Landscape.cpp`
   - `Common/Object.h` / `Object.cpp` / `Object3D.cpp`
   - `Common/Model.h` / `Model.cpp` / `ModelMng.cpp`
   - Qualquer arquivo relacionado a `.wld`, `.lnd`, `.rgn`, `.dyo`, `.mvr`
3. **Entenda o formato dos arquivos de mapa**:
   - Como o terreno (heightmap / landscape) é armazenado
   - Como objetos estáticos e dinâmicos são posicionados
   - Como movers (`.mvr`) são referenciados
   - Estrutura de regiões, spawns, etc. (mesmo que não implementemos tudo agora)
4. **Abra o mapa de exemplo** que está na pasta `maps/` (ou pasta equivalente do projeto):
   - Atualmente **não possui texturas**
   - Contém alguns **objetos** e arquivos **`.mvr`**
5. Documente internamente (em comentários ou em um arquivo `ANALYSIS.md`):
   - Estrutura dos arquivos encontrados
   - Classes e funções responsáveis por carregar o mapa
   - Como a renderização do terreno e dos objetos é feita no ATools original

### Passo 2 – Criar o World Editor Web (próximo objetivo)

Criar um **World Editor** web com as seguintes características:

- **Tecnologia**: TypeScript + Three.js (WebGL prioritário, WebGPU quando possível)
- **Funcionalidades mínimas (MVP)**:
  - Carregar e visualizar o terreno do mapa de exemplo
  - Carregar e posicionar os objetos existentes no mapa
  - Visualizar movers (`.mvr`) se possível
  - Navegação de câmera similar ao ATools (free-look / orbit)
  - Exportar o mapa para um formato consumível pelo cliente web (ex: JSON + glTF / custom binary otimizado para Three.js)

### Passo 3 – Exportação para Three.js

O editor deve ser capaz de exportar:

- Heightmap / mesh do terreno
- Posição, rotação e escala dos objetos
- Referências aos modelos (mesmo que as texturas ainda não existam)
- Qualquer metadado necessário para o cliente web futuro

Formato de exportação sugerido (pode ser ajustado):

```json
{
  "version": 1,
  "terrain": { ... },
  "objects": [ { "model": "...", "position": [...], "rotation": [...], "scale": [...] } ],
  "movers": [ ... ]
}
```

Ou formato binário + glTF para melhor performance.

### Passo 4 – Objetivo Final (longo prazo)

Portar o cliente completo do FlyFF para a web:

- Renderização com Three.js
- Sistema de login / personagem
- Mundo interativo
- Combate, skills, etc.

Por enquanto o foco **exclusivo** é o **World Editor + exportação de mapa**.

## Regras de Trabalho

- Sempre priorize a análise do código-fonte real do ATools antes de inventar estruturas.
- Mantenha o máximo de compatibilidade possível com os formatos originais do FlyFF.
- Como as texturas ainda não estão presentes, use placeholders (cores sólidas ou materials simples).
- Documente todas as descobertas importantes sobre o formato de arquivos.
- Prefira TypeScript + Three.js para o novo editor.
- Não quebre a estrutura de pastas existente do ATools.

## Status Atual

- [x] Pasta com código-fonte do ATools disponível
- [x] Mapa de exemplo disponível (sem texturas, com objetos e .mvr)
- [x] Análise completa do World Editor original (ver `ANALYSIS.md`)
- [x] World Editor web funcional (MVP em `web-world-editor/`)
- [x] Exportação para Three.js (zip JSON + tiles binários; ver `web-world-editor/README.md`)
- [ ] Cliente web do jogo

---

> **Continuação:** veja `NEXT_STEPS.md` (estado atual, pendências e próximos passos).

**Instrução direta para o Claude Code:**

Comece agora pelo **Passo 1**:

1. Liste e leia os arquivos relevantes do WorldEditor e Common.
2. Identifique como o mapa de exemplo é carregado.
3. Abra/analise o mapa de exemplo presente na pasta.
4. Resuma a estrutura de dados do terreno, objetos e movers.
5. Só depois disso proponha a arquitetura do novo World Editor web.
