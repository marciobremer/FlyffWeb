@echo off
rem Liga o servidor com o motor NODE (mobs, IA e visao no proprio Node, sem o game-server em Rust).
set "GAME_ENGINE=node"
set "RUST_WS_PORT=0"
call "%~dp0.Iniciar Servidor.bat"
