# ReactioN MMO — FlyFF no navegador, com servidor em Rust

Um servidor de FlyFF que roda no **navegador** (Chrome, Edge, Firefox). Tudo em um projeto só:

- **o jogo** (gráficos em 3D com Three.js) → `http://localhost:8080/game/`
- **o servidor do jogo** — login, personagens, combate, mobs, party, guild… O "cérebro" do combate, da IA dos monstros e do movimento é escrito em **Rust** (bem mais rápido: no teste de carga com bots, no mesmo computador, aguentou 1.000 jogadores sem engasgar, enquanto o motor antigo em Node já degradava com ~450)
- **o painel admin** (liga/desliga o servidor, contas, itens, skills, taxas, backup do banco, teste de carga) → `http://127.0.0.1:8090/`
- **o site** (cadastro, loja, ranking) → `http://localhost:8080/`
- **o editor de mapas** (mover objetos, NPCs, terreno, props 3D; salva direto no mapa) → `http://localhost:8080/editor/`

```
Navegador ──► Node.js (login, API, site)  ──► Rust (combate, IA, movimento)
                         │                              │
                         └──────────► PostgreSQL ◄──────┘
```

> **Os arquivos do jogo FlyFF/Titanium MMO NÃO vêm neste repositório** (são de terceiros e muito grandes).
> Você precisa tê-los e colocá-los nas pastas certas — o passo 4 explica **exatamente** onde.

---

## Índice

1. [O que você precisa ter](#1-o-que-você-precisa-ter)
2. [O que está e o que NÃO está no repositório](#2-o-que-está-e-o-que-não-está-no-repositório)
3. [Instalar os programas](#3-instalar-os-programas)
4. [Baixar o projeto e colocar os arquivos do jogo](#4-baixar-o-projeto-e-colocar-os-arquivos-do-jogo)
5. [Criar o banco de dados](#5-criar-o-banco-de-dados)
6. [Configurar o site](#6-configurar-o-site)
7. [Ligar tudo](#7-ligar-tudo)
8. [Criar a sua conta de administrador e jogar](#8-criar-a-sua-conta-de-administrador-e-jogar)
9. [Jogar com outras pessoas (rede/internet)](#9-jogar-com-outras-pessoas-redeinternet)
10. [Deu problema?](#10-deu-problema)
11. [Docker (opcional)](#11-docker-opcional)
12. [Comandos do dia a dia, backup e pastas](#12-comandos-do-dia-a-dia-backup-e-pastas)

---

## 1. O que você precisa ter

| | |
|---|---|
| Computador | Windows 10 ou 11 (64 bits), 8 GB de RAM ou mais, e espaço livre para os arquivos do jogo (vários GB) |
| Internet | para baixar os programas e o projeto |
| **Titanium MMO** | o cliente **e** a pasta `Resource` do Titanium MMO (veja o passo 4) — **obrigatório** |
| **Mapa L2 Giran** | *opcional*: só se você quer o mapa extra de Giran (veja o passo 4) |
| Tempo | uns 30–40 minutos na primeira vez (a maior parte é esperar downloads e a primeira compilação) |

Você **não** precisa saber programar. Todos os comandos abaixo são para copiar e colar.

> **Como abrir o "terminal"** (onde se cola os comandos): aperte a tecla **Windows**, digite `PowerShell` e aperte Enter.
> Para colar no terminal: clique com o botão direito dentro da janela.

---

## 2. O que está e o que NÃO está no repositório

### Está aqui (baixado junto com o projeto)

| Pasta / arquivo | Para quê |
|---|---|
| `servers/` | servidor do jogo em Node.js: login, personagens, mundo, party, guild, comandos de GM… |
| `game-server/` | **o motor em Rust**: combate, IA dos monstros, movimento, tick do mundo |
| `shared/` | código usado pelo jogo, pelo editor e pelo servidor (formatos do FlyFF, mundo 3D, colisão) |
| `client/` | o jogo no navegador |
| `editor/` | o editor de mapas |
| `admin/` | o painel admin |
| `htdocs/` | o site (Next.js) |
| `tools/` | ferramentas de linha de comando (criar conta, teste de carga, gerar mapas…) |
| `database/flyffweb-limpo.dump` | o banco de dados vazio e pronto (estrutura completa + itens da loja do site) |
| `data/` | configurações do servidor (taxas), edições do mapa salvas pelo editor, missões, eventos, mensagens do painel |
| `docs/` | documentação técnica (arquitetura, protocolo) |
| `.Iniciar Servidor.bat` | **liga tudo com dois cliques** |
| `Dockerfile`, `docker-compose.yml`, `DOCKER.md` | rodar em containers (opcional) |

### NÃO está aqui — você precisa colocar (ou o projeto gera sozinho)

| Pasta | O que é | Precisa? | De onde vem |
|---|---|---|---|
| **`Original/Resource/`** | A pasta **Resource** do **Titanium MMO**: tabelas de itens e monstros (`propItem.txt`, `propMover.txt`, `defineItem.h`…), os mapas (`World/WdMadrigal`…) e os modelos 3D | **SIM — sem ela nada abre** | Titanium MMO |
| **`Original/Client/`** | O **cliente instalado** do **Titanium MMO** (`Neuz.exe`, `Data/`, `World/`…): modelos, texturas, ícones, sons | **SIM** | Titanium MMO |
| `data/res-extra/Data/` | Ícones, cursores e temas de interface complementares (`Cursors/`, `Icon/`, `Theme/`) | Recomendado: sem ela alguns ícones, cursores ou janelas podem aparecer em branco | pacote que acompanha o tópico do fórum |
| **`data/res-extra/L2/`** e **`data/res-extra/World/`** | O **mapa L2 Giran**: os modelos 3D (`L2/`) e o mapa `WdL2Giran` com as texturas (`World/`) | Opcional (sem eles só o mapa Madrigal existe) | pacote do mapa L2 Giran, no tópico do fórum |
| `htdocs/.env.local` | Senhas e chaves do site | **SIM — você cria no passo 6** | você mesmo |
| `data/l2/`, `tools/cruma/` | Material bruto do Cruma (exportador do L2), usado só para **recriar** o mapa Giran | Não precisa para rodar | — |
| `node_modules/`, `dist/`, `htdocs/.next/`, `game-server/target/`, `data/mappack/` | Gerados automaticamente (instalação, compilação do jogo, do site e do Rust, pacote do mapa) | Não faça nada | gerados sozinhos |
| `backups/` | Cópias de banco com contas de jogadores | Não | — |

---

## 3. Instalar os programas

Instale **nesta ordem**. Em todos, pode ir clicando em "Next/Avançar" e deixar as opções padrão, **exceto onde estiver avisado**.

### 3.1 Git (com Git LFS)
Baixe em <https://git-scm.com/download/win> e instale. (O Git LFS já vem junto.)

### 3.2 Node.js 24 (LTS)
Baixe em <https://nodejs.org> a versão **24 LTS** e instale. É ele que roda o jogo, o painel e o site.

### 3.3 PostgreSQL 18
Baixe em <https://www.postgresql.org/download/windows/> e instale a versão **18**.
- O instalador pede uma **senha para o usuário `postgres`**: **anote essa senha** (você usa no passo 5).
- Deixe a porta `5432`.

### 3.4 Rust (o motor do servidor)
1. Baixe o **rustup-init.exe** em <https://rustup.rs> e execute.
2. Se ele avisar que falta o **"Microsoft C++ Build Tools"** (ou "Visual Studio Build Tools"), aceite instalar: marque **"Desenvolvimento para desktop com C++"** e conclua. É um download grande; é normal.
3. Quando a janela do rustup mostrar as opções, digite `1` e Enter (instalação padrão).
4. **Feche e abra o PowerShell de novo**.

> O Rust é o que faz o servidor aguentar muita gente. **Sem Rust o jogo ainda abre**, usando o motor antigo em Node (mais lento) — o servidor avisa `cargo não encontrado … seguindo com o motor Node`.

### 3.5 Conferir se deu certo
Abra o PowerShell e rode:

```bash
git --version
node --version
cargo --version
```

Cada um deve mostrar um número de versão (o Node deve começar com `v24`). Se algum disser "não é reconhecido", feche e abra o PowerShell de novo; se continuar, reinstale esse programa.

---

## 4. Baixar o projeto e colocar os arquivos do jogo

### 4.1 Baixar o projeto
```bash
git clone https://github.com/marciobremer/FlyffWeb.git C:\Projeto_Atools
cd C:\Projeto_Atools
```
(Pode ser outra pasta; só evite caminhos com acentos ou espaços.)

### 4.2 Colocar o Titanium MMO na pasta `Original` (obrigatório)
Crie a pasta `C:\Projeto_Atools\Original` e copie para dentro dela **duas pastas** do Titanium MMO:

```
C:\Projeto_Atools\
└── Original\
    ├── Resource\     ← a pasta "Resource" do Titanium MMO
    └── Client\       ← o cliente instalado do Titanium MMO
```

Para conferir que está certo, estes arquivos e pastas **precisam existir**:

| Caminho | O que deve ter |
|---|---|
| `Original\Resource\propItem.txt` e `Spec_Item.txt` | tabela de itens |
| `Original\Resource\propMover.txt` | tabela de monstros |
| `Original\Resource\propSkill.txt` e `propSkillAdd.csv` | skills |
| `Original\Resource\defineItem.h`, `mdlObj.inc`, `mdlDyna.inc`, `character.inc` | definições e modelos |
| `Original\Resource\World\WdMadrigal\WdMadrigal.wld` | o mapa Madrigal (e 900 arquivos `.lnd` ao lado dele) |
| `Original\Resource\Data\Model\` | modelos 3D |
| `Original\Client\Neuz.exe` e `Original\Client\Data\Model\` | o cliente instalado |

> Os nomes das pastas importam. `Original` com `Resource` e `Client` dentro — nem mais, nem menos níveis.
> (Se preferir guardar o jogo em outro lugar, dá para apontar com as variáveis `FLYFF_RESOURCE` e `FLYFF_CLIENT`; veja a seção 12.)

### 4.3 Complemento de interface (recomendado)
Copie a pasta **`Data`** do pacote que acompanha o tópico do fórum para dentro de **`data\res-extra\`**, ficando `C:\Projeto_Atools\data\res-extra\Data\` com as subpastas `Cursors`, `Icon` e `Theme`.

### 4.4 Mapa L2 Giran (opcional)
O mapa extra de Giran (do Lineage 2) fica em **duas pastas** dentro de `data\res-extra\`:

```
C:\Projeto_Atools\data\res-extra\
├── L2\        ← modelos 3D do mapa (arquivos .glb)
└── World\
    ├── WdL2Giran\   ← o mapa em si (WdL2Giran.wld e os .lnd)
    └── Texture\     ← texturas do mapa
```

Se essas pastas existirem, o servidor registra o mapa sozinho; dentro do jogo, quem é GM vai até lá com o comando `//mapa l2`.
Se não existirem, **nada quebra** — só não há o mapa Giran.

---

## 5. Criar o banco de dados

O jogo guarda contas, personagens e itens no PostgreSQL. Você cria **um usuário e um banco vazios** (uma vez só).

### 5.1 Entrar no PostgreSQL
No PowerShell:

```bash
& "C:\Program Files\PostgreSQL\18\bin\psql.exe" -U postgres
```
Digite a senha do `postgres` (a do passo 3.3). Vai aparecer um prompt `postgres=#`.

### 5.2 Criar usuário e banco
Cole as duas linhas abaixo, **trocando `SUA-SENHA-AQUI` por uma senha à sua escolha** (anote; não use aspas dentro dela):

```sql
CREATE ROLE flyffweb_app LOGIN PASSWORD 'SUA-SENHA-AQUI';
CREATE DATABASE flyffweb OWNER flyffweb_app ENCODING 'UTF8';
```
Depois digite `\q` e Enter para sair.

### 5.3 Guardar a senha para o servidor (fora do código)
O servidor lê a senha do arquivo de senhas do PostgreSQL. Crie o arquivo **`%APPDATA%\postgresql\pgpass.conf`**
(`%APPDATA%` é `C:\Users\SEU_USUARIO\AppData\Roaming`; crie a pasta `postgresql` se não existir) com **uma linha**:

```
localhost:5432:flyffweb:flyffweb_app:SUA-SENHA-AQUI
```

### 5.4 (Opcional) Carregar o banco limpo com os itens da loja do site
```bash
& "C:\Program Files\PostgreSQL\18\bin\pg_restore.exe" -h localhost -U flyffweb_app -d flyffweb --no-owner database\flyffweb-limpo.dump
```
Se você pular este passo, o servidor cria toda a estrutura sozinho na primeira vez; só a lista de itens da loja do site começa vazia.

> Quando o servidor liga, ele aplica sozinho as atualizações do banco (migrações). Você nunca mexe nas tabelas à mão.

---

## 6. Configurar o site

1. Copie o arquivo `htdocs\.env.example` para `htdocs\.env.local`:
   ```bash
   copy htdocs\.env.example htdocs\.env.local
   ```
2. Gere dois valores aleatórios (rode **duas vezes** e guarde os resultados):
   ```bash
   node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
   ```
3. Abra `htdocs\.env.local` no Bloco de Notas e preencha `SESSION_SECRET=` com o primeiro valor e `NEXTAUTH_SECRET=` com o segundo.
4. Se for publicar na internet, troque os endereços `http://localhost:8080` pelo seu endereço (e use `COOKIE_SECURE=true` com HTTPS).

---

## 7. Ligar tudo

Dê **dois cliques** em **`.Iniciar Servidor.bat`** (na pasta do projeto).

Na **primeira vez** ele faz sozinho tudo isto (pode levar **10–20 minutos**; não feche a janela):

1. instala as bibliotecas do jogo e do site (`npm install`);
2. atualiza o banco de dados;
3. compila o jogo no navegador e o **site**;
4. compila o **motor em Rust** (`cargo build --release`) — a parte mais demorada;
5. gera o pacote do mapa para o Rust (`data\mappack\`);
6. liga o painel admin, o servidor, o Rust e o site.

Quando terminar, **o navegador abre o painel admin** e, numa aba nova, **o jogo**. Nas próximas vezes leva só alguns segundos.

Você sabe que o motor Rust está no ar quando a janela preta mostra linhas começando com `[rust]`, por exemplo:
`[rust] mapa WdMadrigal: 7368 mobs em 960 respawns` e `rust-link: conectado`.

| Endereço | O que é |
|---|---|
| <http://localhost:8080/> | o site |
| <http://localhost:8080/game/> | **o jogo** |
| <http://localhost:8080/editor/> | o editor de mapas |
| <http://127.0.0.1:8090/> | o painel admin (só abre neste computador) |

**Para desligar:** feche a janela preta (ou aperte `Ctrl+C` nela). Isso desliga o painel, o servidor e o Rust.

---

## 8. Criar a sua conta de administrador e jogar

O banco começa vazio. Crie a sua conta pelo **site** (<http://localhost:8080/>, botão de cadastro) **ou** pelo terminal:

```bash
npm run account -- create SEU_USUARIO
```
(ele pede a senha). Depois torne-a **dona do servidor**:

```bash
npm run account -- set-authority SEU_USUARIO Z
```

> **Z** = dono (nick preto) · **G** = GM (nick roxo) · **F** = jogador comum.

Abra <http://localhost:8080/game/>, entre com a conta, crie um personagem e jogue.
Com a conta **Z/G**, digite `//gm` no chat para abrir o painel de GM dentro do jogo e `//help` para a lista de comandos.

---

## 9. Jogar com outras pessoas (rede/internet)

- **Na mesma rede (casa/LAN):** os outros abrem `http://IP-DO-SEU-PC:8080/game/` (o IP aparece na janela preta como "rede local"). O Windows pode perguntar sobre o Firewall: **permita** (rede privada).
- **Libere duas portas no firewall e no roteador:** **8080** (site e jogo) e **8081** (conexão direta com o motor Rust). Se a 8081 estiver bloqueada o jogo **funciona do mesmo jeito**, só passa pela 8080.
- A **8090 (painel) é só local**, nunca abra para fora.
- Para a internet de verdade, o ideal é um domínio com HTTPS na frente (proxy como o Caddy ou o Nginx); o Rust, sozinho, não faz HTTPS.

---

## 10. Deu problema?

| Sintoma | O que fazer |
|---|---|
| `Node.js nao encontrado` | instale o Node (passo 3.2) e **feche/abra** o terminal; rode o `.bat` de novo |
| O `.bat` para em "Atualizando o banco de dados" com erro | o banco não existe ou a senha está errada. Refaça os passos 5.2 e 5.3 (a senha do `pgpass.conf` tem que ser a mesma do `CREATE ROLE`). O painel admin (aba **Database**) mostra o estado e ajuda a reinstalar |
| `[rust] cargo não encontrado … seguindo com o motor Node` | o Rust não está instalado ou o terminal foi aberto antes dele. Faça o passo 3.4 e rode o `.bat` de novo. O jogo funciona assim, só com menos desempenho |
| `[rust] a compilação do game-server falhou` | quase sempre falta o **C++ Build Tools** (passo 3.4). Instale e rode de novo. Para ver o erro: `cd game-server` e `cargo build --release` |
| Tela do jogo preta ou sem modelos | confira o passo 4.2: `Original\Resource` e `Original\Client` com os arquivos da tabela |
| Faltam ícones, cursores ou janelas em branco | coloque o pacote do passo 4.3 em `data\res-extra\Data\` |
| "A porta 8080 já está em uso" | outro programa (ou outra cópia do servidor) usa a porta. Feche-o, ou troque a porta antes de ligar: `set GAME_PORT=8085` no terminal (e use a nova porta nos endereços) |
| O site demora ou dá erro na primeira vez | normal: ele compila (alguns minutos). Espere o jogo aparecer |
| Quero voltar ao motor antigo (sem Rust) | abra o terminal, rode `set GAME_ENGINE=node` e depois o `.bat` |
| "O jogo diz que falta o `dist/`" | rode `npm run build` uma vez |

---

## 11. Docker (opcional)

Dá para subir banco + servidor + painel + site em containers, sem instalar Node nem PostgreSQL. Precisa só de **Git** e **Docker Desktop**.

1. Baixe o projeto e coloque `Original\` (e, se tiver, `data\res-extra\Data\`) como no passo 4.
2. Copie `.env.example` para `.env` e troque `PGPASSWORD`.
3. Copie `htdocs\.env.example` para `htdocs\.env.local` e preencha como no passo 6.
4. Rode `docker compose up -d --build`.
5. Torne a sua conta dona: `docker compose exec app npm run account -- set-authority SEU_USUARIO Z`.

> **Atenção:** a imagem Docker **não inclui o Rust**. No Docker o servidor usa o **motor Node** (funciona, mas com menos desempenho). Para ter o Rust, use a instalação no Windows (passos 3–7).

Mais detalhes (logs, backup do banco do container): [DOCKER.md](DOCKER.md).

---

## 12. Comandos do dia a dia, backup e pastas

Rode no PowerShell, dentro da pasta do projeto.

| Comando | O que faz |
|---|---|
| `.Iniciar Servidor.bat` | liga tudo (banco + painel + Rust + jogo + site) |
| `npm run build` | recompila o jogo e o editor para `dist/` |
| `npm start` | só o servidor do jogo (porta 8080; precisa do `dist/`) |
| `npm run admin` | só o painel admin (`-- --start-game` liga o jogo junto) |
| `npm run dev` | modo de desenvolvimento (porta 5173; é um mundo separado do 8080) |
| `npm run db:migrate` | aplica as atualizações do banco |
| `npm run account -- <comando>` | `create`, `set-password`, `list`, `add-character`, `set-authority`, `give-item`, `give-penya` |
| `npm run l2world -- <tile> <Nome>` | recria o mapa L2 a partir das exportações do Cruma (só quem tem `data/l2`) |
| `npm test` / `npm run typecheck` | testes e verificação do código |

**Variáveis de ambiente úteis** (defina antes de ligar, com `set NOME=valor`):

| Variável | Para quê | Padrão |
|---|---|---|
| `GAME_ENGINE` | `rust` ou `node` (o `.bat` já define `rust`) | `rust` |
| `RUST_WS_PORT` | porta da conexão direta com o Rust (`0` desliga) | `8081` |
| `GAME_PORT` / `ADMIN_PORT` | portas do jogo e do painel | `8080` / `8090` |
| `FLYFF_RESOURCE` / `FLYFF_CLIENT` | onde estão `Resource` e `Client` do Titanium MMO | `Original\Resource` / `Original\Client` |
| `PGHOST` `PGPORT` `PGDATABASE` `PGUSER` `PGPASSWORD` | conexão com o banco | `localhost` `5432` `flyffweb` `flyffweb_app` (senha: `pgpass.conf`) |

**Backup do banco** (um dump com contas de jogadores **não deve ir para um repositório público**):

```bash
& "C:\Program Files\PostgreSQL\18\bin\pg_dump.exe" -h localhost -U flyffweb_app -d flyffweb -Fc -f backup.dump
```
O painel admin também faz e restaura backups (aba **Database**).

**Mapa das pastas:**

```
servers/
  common/      caminhos e portas, banco (db/ + migrações), catálogo de itens, utilidades HTTP
  auth/        contas e login (senha com scrypt, sessões)
  character/   personagens e inventário
  world/       mundo em tempo real: WebSocket, ponte com o Rust, combate, drops, lojas, skills, party, guild, GM
  api.ts       porta de entrada HTTP     main.ts  sobe tudo num processo só
game-server/   o motor em Rust (combate, IA, movimento, tick)
client/        o jogo no navegador         → /game/
editor/        o editor de mapas           → /editor/
shared/        formatos do FlyFF (.lnd, .dyo, .o3d…), 3D, colisão
admin/         o painel de administração   → http://127.0.0.1:8090
htdocs/        o site (Next.js)            → /
tools/         ferramentas de linha de comando
database/      o banco vazio (dump)
data/          taxas, edições do mapa, missões, eventos; res-extra/ = complementos (não versionados)
Original/      os arquivos do Titanium MMO — NÃO versionado (você coloca)
```

Mais detalhes técnicos: [docs/ARQUITETURA.md](docs/ARQUITETURA.md). O histórico do que foi feito e o que falta: [NEXT_STEPS.md](NEXT_STEPS.md).
