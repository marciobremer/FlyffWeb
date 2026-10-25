# ReactioN MMO em Docker

Dois containers: **db** (PostgreSQL 18) e **app** (servidor do jogo + painel admin + site Next.js).

## Ligar

1. Copie `.env.example` para `.env` e troque a senha (`PGPASSWORD`).
2. `docker compose up -d --build` — a primeira vez compila a imagem (alguns minutos).
3. Site: http://localhost:8080/ · Jogo: http://localhost:8080/game/ · Painel: http://127.0.0.1:8090/

O banco começa vazio: as migrações rodam sozinhas a cada início. Crie a conta de administrador pelo site/painel.

| Comando | O que faz |
|---|---|
| `docker compose logs -f app` | acompanha o servidor |
| `docker compose restart app` | reinicia o jogo (o banco continua) |
| `docker compose down` | desliga (os dados do banco ficam no volume `pgdata`) |
| `docker compose down -v` | desliga e **apaga o banco** |

## O que é necessário para rodar

Dentro da imagem (copiado no build — veja `.dockerignore`):

| Pasta/arquivo | Para quê |
|---|---|
| `servers/` | servidor do jogo: login, personagens, mundo, combate, party, guild… |
| `shared/` | código usado pelo servidor e pelo cliente (formatos do FlyFF, mundo 3D) |
| `client/` | o jogo no navegador (compilado para `dist/` no build) |
| `editor/` | editor de mapas (`/editor/`) |
| `admin/` | painel admin (liga o jogo e o site) |
| `htdocs/` | site (Next.js), compilado no build |
| `tools/` | comandos de manutenção (`npm run account …`) |
| `package.json`, `package-lock.json`, `tsconfig.json`, `vite.config.ts`, `index.html` | dependências e build |

Fora da imagem (montados pelo `docker-compose.yml`):

| Pasta | Para quê |
|---|---|
| `Original/` | arquivos do FlyFF (`Resource`, `Client`) — somente leitura |
| `data/` | taxas do servidor, edições do mundo, mensagens do painel, imagens extras (`res-extra`) |

Não são necessários para rodar: `Original_testar/`, `backups/`, `_backup_antes_fase1/`, `node_modules/` (instalado no build), `dist/` e `htdocs/.next` (gerados no build).

## Observações

- O painel só aceita acesso desta máquina (a porta 8090 é mapeada só para 127.0.0.1).
- Num servidor Linux de verdade, os nomes dos arquivos do FlyFF diferenciam maiúsculas de minúsculas; no Docker Desktop do Windows isso não acontece porque a pasta `Original` vem do Windows.
- Para levar para outra máquina: copie a pasta do projeto (sem `node_modules`) com `Original/` e `data/`, crie o `.env` e rode `docker compose up -d --build`.
- Backup do banco do container: `docker compose exec db pg_dump -U flyffweb_app -Fc flyffweb > backup.dump`.
