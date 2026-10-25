# ReactioN MMO — servidor do jogo + painel admin + site (Next.js) numa imagem só.
# Os arquivos do FlyFF (pasta Original) e a pasta data ficam FORA da imagem: são montados pelo docker-compose.yml.

# ---------- compilação ----------
FROM node:24-bookworm AS build
# ferramentas para os módulos nativos do site (bcrypt, msnodesqlv8)
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ unixodbc-dev && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

# dependências primeiro (camada em cache enquanto os package*.json não mudam)
COPY package.json package-lock.json ./
RUN npm ci
COPY htdocs/package.json htdocs/package-lock.json htdocs/
# mssql/msnodesqlv8 (SQL Server do Windows) não são usados — o site fala com o PostgreSQL por src/lib/mssql-pg.js — e o
# msnodesqlv8 não compila no Linux: saem antes de instalar
RUN cd htdocs && npm pkg delete dependencies.msnodesqlv8 dependencies.mssql && npm install --no-audit --no-fund

# código e build: cliente do jogo (dist/) e site (htdocs/.next)
COPY . .
RUN npx vite build
RUN cd htdocs && npm run build

# ---------- execução ----------
FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends unixodbc && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    ADMIN_HOST=0.0.0.0 \
    FLYFF_RESOURCE=original/Resource \
    FLYFF_CLIENT=original/Client
# 8080 = site (/) e jogo (/game/) · 8090 = painel admin
EXPOSE 8080 8090
# aplica as migrações do banco e liga o painel, que liga o servidor do jogo e o site
CMD ["sh", "-c", "npm run db:migrate && node --import tsx admin/index.ts --start-game --no-open"]
