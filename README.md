# ReactioN MMO — FlyFF in your browser, with a Rust game server

A FlyFF server that runs in the **web browser** (Chrome, Edge, Firefox). Everything lives in one project:

- **the game** (3D graphics with Three.js) → `http://localhost:8080/game/`
- **the game server** — login, characters, combat, mobs, party, guild… The "brain" for combat, monster AI and movement is written in **Rust** (much faster: in our bot load test on a single computer it held 1,000 simulated players without lag, while the old Node engine was already degrading at ~450)
- **the admin panel** (start/stop the server, accounts, items, skills, rates, database backup, load test) → `http://127.0.0.1:8090/`
- **the website** (sign-up, shop, ranking) → `http://localhost:8080/`
- **the map editor** (move objects, NPCs, terrain and 3D props; saves straight into the map) → `http://localhost:8080/editor/`

```
Browser ──► Node.js (login, API, website) ──► Rust (combat, AI, movement)
                        │                              │
                        └──────────► PostgreSQL ◄──────┘
```

> **The FlyFF / Titanium MMO game files are NOT included in this repository** (they belong to third parties and are very large).
> You must have them yourself and put them in the right folders — step 4 explains **exactly** where.

---

## Table of contents

1. [What you need](#1-what-you-need)
2. [What is and what is NOT in the repository](#2-what-is-and-what-is-not-in-the-repository)
3. [Install the programs](#3-install-the-programs)
4. [Download the project and add the game files](#4-download-the-project-and-add-the-game-files)
5. [Create the database](#5-create-the-database)
6. [Configure the website](#6-configure-the-website)
7. [Start everything](#7-start-everything)
8. [Create your admin account and play](#8-create-your-admin-account-and-play)
9. [Playing with other people (network / internet)](#9-playing-with-other-people-network--internet)
10. [Troubleshooting](#10-troubleshooting)
11. [Docker (optional)](#11-docker-optional)
12. [Everyday commands, backup and folder map](#12-everyday-commands-backup-and-folder-map)

---

## 1. What you need

| | |
|---|---|
| Computer | Windows 10 or 11 (64-bit), 8 GB RAM or more, and free disk space for the game files (several GB) |
| Internet | to download the programs and the project |
| **Titanium MMO** | the client **and** the `Resource` folder of Titanium MMO (see step 4) — **required** |
| **L2 Giran map** | *optional*: only if you want the extra Giran map (see step 4) |
| Time | about 30–40 minutes the first time (mostly waiting for downloads and the first compilation) |

You do **not** need to know how to program. Every command below can be copied and pasted.

> **How to open the "terminal"** (where you paste commands): press the **Windows** key, type `PowerShell` and press Enter.
> To paste into the terminal, right-click inside the window.

---

## 2. What is and what is NOT in the repository

### Included (downloaded with the project)

| Folder / file | What it is for |
|---|---|
| `servers/` | the Node.js game server: login, characters, world, party, guild, GM commands… |
| `game-server/` | **the Rust engine**: combat, monster AI, movement, world tick |
| `shared/` | code shared by the game, the editor and the server (FlyFF file formats, 3D world, collision) |
| `client/` | the game in the browser |
| `editor/` | the map editor |
| `admin/` | the admin panel |
| `htdocs/` | the website (Next.js) |
| `tools/` | command-line tools (create accounts, load test, build maps…) |
| `database/flyffweb-limpo.dump` | the clean, empty database (full structure + the website shop items) |
| `data/` | server settings (rates), map edits saved by the editor, quests, events, panel messages |
| `docs/` | technical documentation (architecture, protocol) |
| `.Iniciar Servidor.bat` | **starts everything with a double-click** ("Iniciar Servidor" = "Start Server") |
| `Dockerfile`, `docker-compose.yml`, `DOCKER.md` | run in containers (optional) |

### NOT included — you must add them (or the project generates them)

| Folder | What it is | Required? | Where it comes from |
|---|---|---|---|
| **`Original/Resource/`** | The **Resource** folder of **Titanium MMO**: item and monster tables (`propItem.txt`, `propMover.txt`, `defineItem.h`…), the maps (`World/WdMadrigal`…) and the 3D models | **YES — nothing opens without it** | Titanium MMO |
| **`Original/Client/`** | The **installed client** of **Titanium MMO** (`Neuz.exe`, `Data/`, `World/`…): models, textures, icons, sounds | **YES** | Titanium MMO |
| `data/res-extra/Data/` | Complementary interface icons, cursors and themes (`Cursors/`, `Icon/`, `Theme/`) | Recommended: without it some icons, cursors or windows may appear blank | data pack that comes with the forum thread |
| **`data/res-extra/L2/`** and **`data/res-extra/World/`** | The **L2 Giran map**: the 3D models (`L2/`) and the `WdL2Giran` map with its textures (`World/`) | Optional (without them only the Madrigal map exists) | L2 Giran map pack, in the forum thread |
| `htdocs/.env.local` | Passwords and keys for the website | **YES — you create it in step 6** | you |
| `data/l2/`, `tools/cruma/` | Raw Cruma (L2 exporter) material, only used to **rebuild** the Giran map | Not needed to run | — |
| `node_modules/`, `dist/`, `htdocs/.next/`, `game-server/target/`, `data/mappack/` | Generated automatically (installation, compiling the game, the website and the Rust engine, the map pack) | Do nothing | generated for you |
| `backups/` | Database copies containing player accounts | No | — |

---

## 3. Install the programs

Install them **in this order**. In all of them you can keep clicking "Next" and leave the default options, **except where noted**.

### 3.1 Git (with Git LFS)
Download from <https://git-scm.com/download/win> and install. (Git LFS comes bundled.)

### 3.2 Node.js 24 (LTS)
Download version **24 LTS** from <https://nodejs.org> and install. It runs the game, the panel and the website.

### 3.3 PostgreSQL 18
Download from <https://www.postgresql.org/download/windows/> and install version **18**.
- The installer asks for a **password for the `postgres` user**: **write it down** (you need it in step 5).
- Keep port `5432`.

### 3.4 Rust (the server engine)
1. Download **rustup-init.exe** from <https://rustup.rs> and run it.
2. If it warns that the **"Microsoft C++ Build Tools"** (or "Visual Studio Build Tools") are missing, accept installing them: tick **"Desktop development with C++"** and finish. It is a big download; that is normal.
3. When the rustup window shows its options, type `1` and press Enter (default installation).
4. **Close and reopen PowerShell**.

> Rust is what lets the server handle many players. **Without Rust the game still opens**, using the older Node engine (slower) — the server prints `cargo não encontrado … seguindo com o motor Node` ("cargo not found … continuing with the Node engine").

### 3.5 Check that everything works
Open PowerShell and run:

```bash
git --version
node --version
cargo --version
```

Each one must print a version number (Node must start with `v24`). If one says "is not recognized", close and reopen PowerShell; if it persists, reinstall that program.

---

## 4. Download the project and add the game files

### 4.1 Download the project
```bash
git clone https://github.com/marciobremer/FlyffWeb.git C:\Projeto_Atools
cd C:\Projeto_Atools
```
(You can use another folder; just avoid paths with accents or spaces.)

### 4.2 Put Titanium MMO in the `Original` folder (required)
Create the folder `C:\Projeto_Atools\Original` and copy **two folders** from Titanium MMO into it:

```
C:\Projeto_Atools\
└── Original\
    ├── Resource\     ← the "Resource" folder of Titanium MMO
    └── Client\       ← the installed client of Titanium MMO
```

To check it is right, these files and folders **must exist**:

| Path | What it should contain |
|---|---|
| `Original\Resource\propItem.txt` and `Spec_Item.txt` | item table |
| `Original\Resource\propMover.txt` | monster table |
| `Original\Resource\propSkill.txt` and `propSkillAdd.csv` | skills |
| `Original\Resource\defineItem.h`, `mdlObj.inc`, `mdlDyna.inc`, `character.inc` | definitions and models |
| `Original\Resource\World\WdMadrigal\WdMadrigal.wld` | the Madrigal map (with 900 `.lnd` files next to it) |
| `Original\Resource\Data\Model\` | 3D models |
| `Original\Client\Neuz.exe` and `Original\Client\Data\Model\` | the installed client |

> Folder names matter: `Original` with `Resource` and `Client` directly inside — no extra levels.
> (If you prefer to keep the game files elsewhere, you can point to them with the `FLYFF_RESOURCE` and `FLYFF_CLIENT` variables; see section 12.)

### 4.3 Interface add-ons (recommended)
Copy the **`Data`** folder from the pack that comes with the forum thread into **`data\res-extra\`**, so that you end up with `C:\Projeto_Atools\data\res-extra\Data\` containing the `Cursors`, `Icon` and `Theme` subfolders.

### 4.4 L2 Giran map (optional)
The extra Giran map (from Lineage 2) lives in **two folders** inside `data\res-extra\`:

```
C:\Projeto_Atools\data\res-extra\
├── L2\        ← 3D models of the map (.glb files)
└── World\
    ├── WdL2Giran\   ← the map itself (WdL2Giran.wld and the .lnd files)
    └── Texture\     ← map textures
```

If these folders exist, the server registers the map by itself; in the game, a GM goes there with the `//mapa l2` chat command.
If they do not exist, **nothing breaks** — there is just no Giran map.

---

## 5. Create the database

The game stores accounts, characters and items in PostgreSQL. You create **an empty user and an empty database** (only once).

### 5.1 Open PostgreSQL
In PowerShell:

```bash
& "C:\Program Files\PostgreSQL\18\bin\psql.exe" -U postgres
```
Type the `postgres` password (from step 3.3). A `postgres=#` prompt appears.

### 5.2 Create the user and the database
Paste the two lines below, **replacing `YOUR-PASSWORD-HERE` with a password of your choice** (write it down; do not use quotes inside it):

```sql
CREATE ROLE flyffweb_app LOGIN PASSWORD 'YOUR-PASSWORD-HERE';
CREATE DATABASE flyffweb OWNER flyffweb_app ENCODING 'UTF8';
```
Then type `\q` and press Enter to leave.

### 5.3 Store the password for the server (outside the code)
The server reads the password from the PostgreSQL password file. Create the file **`%APPDATA%\postgresql\pgpass.conf`**
(`%APPDATA%` is `C:\Users\YOUR_USER\AppData\Roaming`; create the `postgresql` folder if it does not exist) with **one line**:

```
localhost:5432:flyffweb:flyffweb_app:YOUR-PASSWORD-HERE
```

### 5.4 (Optional) Load the clean database with the website shop items
```bash
& "C:\Program Files\PostgreSQL\18\bin\pg_restore.exe" -h localhost -U flyffweb_app -d flyffweb --no-owner database\flyffweb-limpo.dump
```
If you skip this step, the server creates the whole structure by itself the first time; only the website's shop item list starts empty.

> When the server starts it applies database updates (migrations) by itself. You never edit the tables by hand.

---

## 6. Configure the website

1. Copy `htdocs\.env.example` to `htdocs\.env.local`:
   ```bash
   copy htdocs\.env.example htdocs\.env.local
   ```
2. Generate two random values (run this **twice** and keep both results):
   ```bash
   node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
   ```
3. Open `htdocs\.env.local` in Notepad and fill `SESSION_SECRET=` with the first value and `NEXTAUTH_SECRET=` with the second.
4. If you are going to publish on the internet, replace the `http://localhost:8080` addresses with your own (and use `COOKIE_SECURE=true` with HTTPS).

---

## 7. Start everything

**Double-click `.Iniciar Servidor.bat`** (in the project folder).

The **first time** it does all of this by itself (it can take **10–20 minutes**; do not close the window):

1. installs the game and website libraries (`npm install`);
2. updates the database;
3. compiles the browser game and the **website**;
4. compiles the **Rust engine** (`cargo build --release`) — the slowest part;
5. generates the map pack for Rust (`data\mappack\`);
6. starts the admin panel, the server, Rust and the website.

When it finishes, **the browser opens the admin panel** and, in a new tab, **the game**. Next times it takes only a few seconds.

You know the Rust engine is running when the black window shows lines starting with `[rust]`, for example:
`[rust] mapa WdMadrigal: 7368 mobs em 960 respawns` and `rust-link: conectado` ("connected").

| Address | What it is |
|---|---|
| <http://localhost:8080/> | the website |
| <http://localhost:8080/game/> | **the game** |
| <http://localhost:8080/editor/> | the map editor |
| <http://127.0.0.1:8090/> | the admin panel (only opens on this computer) |

**To stop:** close the black window (or press `Ctrl+C` in it). That stops the panel, the server and Rust.

---

## 8. Create your admin account and play

The database starts empty. Create your account on the **website** (<http://localhost:8080/>, sign-up button) **or** in the terminal:

```bash
npm run account -- create YOUR_USERNAME
```
(it asks for the password). Then make it the **server owner**:

```bash
npm run account -- set-authority YOUR_USERNAME Z
```

> **Z** = owner (black name) · **G** = GM (purple name) · **F** = regular player.

Open <http://localhost:8080/game/>, log in, create a character and play.
With a **Z/G** account, type `//gm` in the chat to open the in-game GM panel and `//help` for the command list.

---

## 9. Playing with other people (network / internet)

- **On the same network (home/LAN):** others open `http://YOUR-PC-IP:8080/game/` (the IP is shown in the black window as "rede local" = "local network"). Windows may ask about the Firewall: **allow it** (private network).
- **Open two ports in the firewall and on your router:** **8080** (website and game) and **8081** (direct connection to the Rust engine). If 8081 is blocked the game **still works**, it just goes through 8080.
- **8090 (the panel) is local only** — never open it to the outside.
- For the real internet, the best setup is a domain with HTTPS in front (a proxy such as Caddy or Nginx); Rust on its own does not do HTTPS.

---

## 10. Troubleshooting

| Symptom | What to do |
|---|---|
| `Node.js nao encontrado` (Node.js not found) | install Node (step 3.2), **close and reopen** the terminal, and run the `.bat` again |
| The `.bat` stops at "Atualizando o banco de dados" (updating the database) with an error | the database does not exist or the password is wrong. Redo steps 5.2 and 5.3 (the `pgpass.conf` password must be the same as in `CREATE ROLE`). The admin panel (**Database** tab) shows the state and can help reinstall |
| `[rust] cargo não encontrado … seguindo com o motor Node` | Rust is not installed, or the terminal was opened before installing it. Do step 3.4 and run the `.bat` again. The game works this way, just with lower performance |
| `[rust] a compilação do game-server falhou` (compilation failed) | almost always the **C++ Build Tools** are missing (step 3.4). Install them and run again. To see the error: `cd game-server` then `cargo build --release` |
| Black game screen or no models | check step 4.2: `Original\Resource` and `Original\Client` with the files from the table |
| Missing icons, cursors or blank windows | put the pack from step 4.3 into `data\res-extra\Data\` |
| "Port 8080 is already in use" | another program (or another copy of the server) is using it. Close it, or change the port before starting: `set GAME_PORT=8085` in the terminal (and use the new port in the addresses) |
| The website is slow or errors on the first run | normal: it compiles (a few minutes). Wait until the game opens |
| I want to go back to the old engine (no Rust) | open the terminal, run `set GAME_ENGINE=node`, then run the `.bat` |
| "The game says `dist/` is missing" | run `npm run build` once |

---

## 11. Docker (optional)

You can bring up database + server + panel + website in containers, without installing Node or PostgreSQL. You only need **Git** and **Docker Desktop**.

1. Download the project and put `Original\` (and, if you have it, `data\res-extra\Data\`) in place as in step 4.
2. Copy `.env.example` to `.env` and change `PGPASSWORD`.
3. Copy `htdocs\.env.example` to `htdocs\.env.local` and fill it in as in step 6.
4. Run `docker compose up -d --build`.
5. Make your account the owner: `docker compose exec app npm run account -- set-authority YOUR_USERNAME Z`.

> **Note:** the Docker image **does not include Rust**. With Docker the server uses the **Node engine** (it works, but with lower performance). To get Rust, use the Windows installation (steps 3–7).

More details (logs, container database backup): [DOCKER.md](DOCKER.md).

---

## 12. Everyday commands, backup and folder map

Run these in PowerShell, inside the project folder.

| Command | What it does |
|---|---|
| `.Iniciar Servidor.bat` | starts everything (database + panel + Rust + game + website) |
| `npm run build` | rebuilds the game and the editor into `dist/` |
| `npm start` | only the game server (port 8080; needs `dist/`) |
| `npm run admin` | only the admin panel (`-- --start-game` starts the game too) |
| `npm run dev` | development mode (port 5173; it is a separate world from 8080) |
| `npm run db:migrate` | applies database updates |
| `npm run account -- <command>` | `create`, `set-password`, `list`, `add-character`, `set-authority`, `give-item`, `give-penya` |
| `npm run l2world -- <tile> <Name>` | rebuilds the L2 map from Cruma exports (only if you have `data/l2`) |
| `npm test` / `npm run typecheck` | tests and code check |

**Useful environment variables** (set them before starting, with `set NAME=value`):

| Variable | Purpose | Default |
|---|---|---|
| `GAME_ENGINE` | `rust` or `node` (the `.bat` already sets `rust`) | `rust` |
| `RUST_WS_PORT` | port for the direct connection to Rust (`0` turns it off) | `8081` |
| `GAME_PORT` / `ADMIN_PORT` | game and panel ports | `8080` / `8090` |
| `FLYFF_RESOURCE` / `FLYFF_CLIENT` | where Titanium MMO's `Resource` and `Client` are | `Original\Resource` / `Original\Client` |
| `PGHOST` `PGPORT` `PGDATABASE` `PGUSER` `PGPASSWORD` | database connection | `localhost` `5432` `flyffweb` `flyffweb_app` (password: `pgpass.conf`) |

**Database backup** (a dump containing player accounts **must not go into a public repository**):

```bash
& "C:\Program Files\PostgreSQL\18\bin\pg_dump.exe" -h localhost -U flyffweb_app -d flyffweb -Fc -f backup.dump
```
The admin panel can also create and restore backups (**Database** tab).

**Folder map:**

```
servers/
  common/      paths and ports, database (db/ + migrations), item catalog, HTTP helpers
  auth/        accounts and login (scrypt passwords, sessions)
  character/   characters and inventory
  world/       real-time world: WebSocket, the Rust bridge, combat, drops, shops, skills, party, guild, GM
  api.ts       HTTP entry point          main.ts  starts everything in one process
game-server/   the Rust engine (combat, AI, movement, tick)
client/        the game in the browser       → /game/
editor/        the map editor                → /editor/
shared/        FlyFF formats (.lnd, .dyo, .o3d…), 3D, collision
admin/         the administration panel      → http://127.0.0.1:8090
htdocs/        the website (Next.js)         → /
tools/         command-line tools
database/      the empty database (dump)
data/          rates, map edits, quests, events; res-extra/ = add-ons (not versioned)
Original/      the Titanium MMO files — NOT versioned (you add them)
```

More technical details: [docs/ARQUITETURA.md](docs/ARQUITETURA.md) (in Portuguese). Project history and next steps: [NEXT_STEPS.md](NEXT_STEPS.md) (in Portuguese).
