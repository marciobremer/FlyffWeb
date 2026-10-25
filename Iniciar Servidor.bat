@echo off
rem ReactioN MMO - liga o painel admin e o servidor do jogo com dois cliques.
rem Painel: http://127.0.0.1:8090   Site: http://localhost:8080/   Jogo: http://localhost:8080/game/
rem Fechar esta janela (ou Ctrl+C) desliga o painel e o servidor do jogo.
title ReactioN MMO - Servidor
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js nao encontrado. Instale em https://nodejs.org e tente de novo.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo Instalando dependencias, so na primeira vez...
  call npm install
  if errorlevel 1 goto erro
)

if exist "htdocs\package.json" if not exist "htdocs\node_modules" (
  echo Instalando as dependencias do site, so na primeira vez...
  pushd htdocs
  call npm install
  popd
)

echo Atualizando o banco de dados, se houver migracoes novas...
call npm run db:migrate
if errorlevel 1 goto erro

echo.
echo Iniciando o painel admin e o servidor do jogo...
echo (o navegador abre o painel; site em http://localhost:8080/ e jogo em http://localhost:8080/game/)
echo (a primeira vez compila o site, o que demora alguns minutos)
echo.
node --import tsx admin/index.ts --start-game
goto fim

:erro
echo.
echo Algo deu errado. Veja as mensagens acima.

:fim
pause
