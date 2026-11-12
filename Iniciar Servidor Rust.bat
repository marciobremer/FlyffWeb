@echo off
rem Liga o servidor com o motor RUST (game-server/), com o WebSocket do jogo direto no Rust (porta 8081).
set "GAME_ENGINE=rust"
if not defined RUST_WS_PORT set "RUST_WS_PORT=8081"
call "%~dp0.Iniciar Servidor.bat"
