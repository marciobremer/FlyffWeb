# Projeto Atools — organização do trabalho

## Chats (sessões) master — um por área, sempre em Sonnet
| Chat | Dono de | Pastas |
|---|---|---|
| Master: Login Server | gateway Node.js (WebSocket, API de login) | `servers/api.ts`, `servers/main.ts`, `servers/common/http.ts` |
| Master: Auth Server | contas, senhas, sessões, tokens | `servers/auth/` |
| Master: Database | PostgreSQL, schema, migrações, dumps | `servers/common/db/`, `database/` |
| Master: Game Server | servidor de jogo (hoje TS em `servers/world/`, alvo Rust) | `servers/world/`, `game-server/` (Rust) |
| Master: Admin Panel | painel administrativo | `admin/` |

Cada master só edita a própria área; mudanças de contrato entre áreas (protocolo, schema) são registradas em `docs/ARQUITETURA.md`.

## Regra de modelo
- Os chats ficam em **Sonnet**.
- Tarefa muito complexa (arquitetura nova, concorrência/netcode, migração de linguagem, algoritmo difícil, bug que resistiu a 2 tentativas) → delegar a um subagente com `model: "opus"` (Agent tool) e trazer o resultado de volta ao chat. Não trocar o modelo do chat.

## Arquitetura alvo
```
Internet → Node.js Gateway (WebSocket + Login + API) → Rust Game Server (combate, IA, física, movimento, world tick) → PostgreSQL
```
Detalhes e plano de migração: `docs/ARQUITETURA.md`.
