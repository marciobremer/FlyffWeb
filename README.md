# ReactioN MMO — FlyFF no navegador

Cliente (Three.js), servidor multiplayer, painel admin e site (Next.js), tudo lendo os arquivos originais do FlyFF.

> **Ponto de backup de 2026-10-25.** Banco zerado (sem contas, personagens ou inventários) e pronto para um novo início.
> Este README mostra como restaurar o projeto inteiro do zero, em Windows (sem Docker) ou em qualquer máquina com Docker.

---

## 1. O que está (e o que NÃO está) neste repositório

| Está aqui | Para quê |
|---|---|
| `servers/` | servidor do jogo: login, personagens, mundo, combate, party, guild, amigos… |
| `shared/` | código comum a cliente, editor e servidor (formatos do FlyFF, mundo 3D, colisão) |
| `client/` | o jogo no navegador → `/game/` |
| `editor/` | editor de mundo → `/editor/` |
| `admin/` | painel admin (liga o jogo e o site, contas, logs, anúncios) |
| `htdocs/` | site (Next.js) → `/` |
| `tools/`, `tests/`, `docs/` | linha de comando (`npm run account`), testes, documentação |
| `data/` | taxas do servidor, edições do mundo, anúncios do painel, nomes dos itens |
| `database/flyffweb-limpo.dump` | banco limpo: estrutura completa + 9 itens da loja do site |
| `Dockerfile`, `docker-compose.yml`, `.env.example`, `DOCKER.md` | rodar tudo em containers |
| `Iniciar Servidor.bat` | liga tudo no Windows com dois cliques |

**Não está aqui** (o repositório é público): guarde estas pastas por conta própria (HD externo, Google Drive…) e copie para dentro do projeto na restauração.

| Pasta | Por que ficou de fora | Necessária? |
|---|---|---|
| `Original/` (`Resource`, `Client`, …) | arquivos do FlyFF: vários GB e com direitos autorais | **Sim**: sem ela o jogo não abre |
| `data/res-extra/Data/` | ícones, cursores e temas extraídos do cliente do FlyFF | **Sim**: inventário e cursores usam |
| `htdocs/.env`, `htdocs/.env.local`, `.env` | senhas e chaves | recrie a partir dos `.env.example` |
| `backups/` | dump do banco antigo, com contas de jogadores | não |
| `node_modules/`, `dist/`, `htdocs/.next/` | gerados pelo `npm install` / build | não |

---

## 2. Programas necessários

| Programa | Versão usada | Download | Para quê |
|---|---|---|---|
| **Git** | 2.54 | https://git-scm.com/download/win | baixar este repositório |
| **Node.js** (vem com o npm) | **24.15** (npm 11.12) — use a linha 24 LTS | https://nodejs.org | rodar o jogo, o painel e o site |
| **PostgreSQL** | **18.3** | https://www.postgresql.org/download/windows/ | banco de dados (só no modo sem Docker) |
| **Docker Desktop** *(opcional)* | 29.8 | https://www.docker.com/products/docker-desktop/ | rodar tudo em containers (dispensa Node e PostgreSQL) |
| Navegador moderno | Chrome / Edge / Firefox atuais | — | jogar (precisa de WebGL) |

As bibliotecas (three.js 0.170, Vite 6, TypeScript 5, tsx 4, pg 8, ws 8, Next.js do site) são instaladas sozinhas pelo `npm install`, nas versões travadas em `package-lock.json`.

---

## 3. Restaurar no Windows (sem Docker)

### 3.1 Baixar o projeto e colocar os arquivos do FlyFF

```bash
git clone https://github.com/marciobremer/FlyffWeb.git C:\Projeto_Atools
```

Depois copie para dentro de `C:\Projeto_Atools`:
- a pasta `Original\` (com `Resource\` e `Client\` dentro);
- a pasta `data\res-extra\Data\`.

### 3.2 Criar o banco no PostgreSQL

Instale o PostgreSQL 18 (anote a senha do usuário `postgres` que o instalador pede). Abra o **SQL Shell (psql)** ou rode:

```bash
"C:\Program Files\PostgreSQL\18\bin\psql.exe" -U postgres
```

e dentro dele (troque a senha):

```sql
CREATE ROLE flyffweb_app LOGIN PASSWORD 'SUA-SENHA-AQUI';
CREATE DATABASE flyffweb OWNER flyffweb_app ENCODING 'UTF8';
\q
```

### 3.3 Guardar a senha do banco (fora do código)

O servidor lê a senha de `PGPASSWORD` ou do arquivo de senhas do PostgreSQL. Crie o arquivo
`%APPDATA%\postgresql\pgpass.conf` (crie a pasta `postgresql` se não existir) com a linha:

```
localhost:5432:flyffweb:flyffweb_app:SUA-SENHA-AQUI
```

### 3.4 Restaurar o banco limpo

```bash
"C:\Program Files\PostgreSQL\18\bin\pg_restore.exe" -h localhost -U flyffweb_app -d flyffweb --no-owner database\flyffweb-limpo.dump
```

(Se pular este passo, o `npm run db:migrate` cria a estrutura sozinho; só a lista de itens da loja do site fica vazia.)

### 3.5 Configurar o site

Copie `htdocs\.env.example` para `htdocs\.env.local` e preencha `SESSION_SECRET` com um valor aleatório:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

### 3.6 Ligar

Dê dois cliques em **`Iniciar Servidor.bat`**. Na primeira vez ele instala as dependências e compila o site, o que leva alguns minutos.
Ele aplica as migrações do banco e liga o painel, o site e o jogo:

| Endereço | O que é |
|---|---|
| http://localhost:8080/ | site |
| http://localhost:8080/game/ | jogo |
| http://127.0.0.1:8090/ | painel admin (só abre nesta máquina) |

Se o jogo disser que falta o `dist/`, rode `npm run build` uma vez.

### 3.7 Criar a conta de administrador

O banco começa vazio. Crie a sua conta pelo site (ou `npm run account -- create SEU_USUARIO`) e dê poder de administrador:

```bash
npm run account -- set-authority SEU_USUARIO Z
```

---

## 4. Restaurar com Docker (qualquer máquina)

Precisa só de **Git** e **Docker Desktop**.

1. `git clone https://github.com/marciobremer/FlyffWeb.git` e copie `Original/` e `data/res-extra/Data/` para dentro, como no passo 3.1.
2. Copie `.env.example` para `.env` e troque `PGPASSWORD`.
3. Copie `htdocs/.env.example` para `htdocs/.env.local` e preencha `SESSION_SECRET` (passo 3.5).
4. Ligue:
   ```bash
   docker compose up -d --build
   ```
5. (Opcional) restaure os itens da loja do site:
   ```bash
   docker compose exec -T db pg_restore -U flyffweb_app -d flyffweb --no-owner --data-only -n website -t topup_items < database/flyffweb-limpo.dump
   ```
6. Crie a conta de administrador:
   ```bash
   docker compose exec app npm run account -- set-authority SEU_USUARIO Z
   ```

Mesmos endereços da tabela do passo 3.6. Mais detalhes (logs, desligar, backup do banco do container) em [DOCKER.md](DOCKER.md).
O Docker usa as portas 8080/8090: desligue o servidor do Windows antes, ou troque `GAME_PORT`/`ADMIN_PORT` no `.env`.

---

## 5. Fazer um novo backup do banco

Sem Docker:

```bash
"C:\Program Files\PostgreSQL\18\bin\pg_dump.exe" -h localhost -U flyffweb_app -d flyffweb -Fc -f backup.dump
```

Com Docker:

```bash
docker compose exec db pg_dump -U flyffweb_app -Fc flyffweb > backup.dump
```

Um dump com contas de jogadores **não deve ir para este repositório público**.

---

## 6. Comandos do dia a dia

| comando | o que faz |
|---|---|
| `Iniciar Servidor.bat` | liga tudo (banco + painel + jogo + site) |
| `npm run build` | compila cliente e editor para `dist/` |
| `npm start` | só o servidor do jogo (porta 8080; precisa do `dist/`) |
| `npm run dev` | modo desenvolvimento do Vite (5173) — é um mundo separado do 8080 |
| `npm run admin` | só o painel admin (`-- --start-game` liga o jogo junto) |
| `npm run db:migrate` | aplica migrações novas do banco (`servers/common/db/migrations`) |
| `npm run account -- <comando>` | `create`, `set-password`, `list`, `add-character`, `set-authority`, `give-item`, `give-penya` |
| `npm test` | testes dos formatos |

Variáveis de ambiente: `FLYFF_RESOURCE` (padrão `original/Resource`), `FLYFF_CLIENT`, `PGHOST`/`PGPORT`/`PGDATABASE`/`PGUSER`/`PGPASSWORD`, `GAME_PORT`, `ADMIN_PORT`.
O histórico do que foi feito e os próximos passos estão em `NEXT_STEPS.md`.

## 7. Pastas

```
servers/
  common/      config (caminhos/portas), banco PostgreSQL (db/ + migrações), catálogo de itens, /res, utilidades HTTP
  auth/        contas e login: senha (scrypt), sessões, rotas /api/login, /api/session, /api/logout
  character/   personagens (lista/criação) e inventário (itens, equipamento, penya)
  world/       mundo em tempo real: WebSocket, mobs, combate, drops, lojas, skills, party, guild, comandos de GM
  api.ts       porta de entrada HTTP
  main.ts      sobe tudo num processo só
client/        o jogo no navegador (login, HUD, janelas)            → /game/
editor/        o editor de mundo                                    → /editor/
shared/        formatos do FlyFF (.lnd, .dyo, .o3d…), 3D, colisão
admin/         painel de administração
htdocs/        o site (Next.js)                                     → /
tools/         ferramentas de linha de comando
database/      dump do banco limpo
Original/      arquivos originais do FlyFF — NÃO versionado (copiar à parte)
```
