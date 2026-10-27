// Banner do ".Iniciar Servidor.bat": o nome do servidor grande, em azul, para achar a janela fácil entre as outras.
// JavaScript puro (sem tsx) para aparecer na hora; o Node liga as cores ANSI do console do Windows sozinho.
const FONT = {
  R: ['████▄ ', '█   █ ', '████▀ ', '█  ▀▄ ', '█   █ '],
  E: ['█████ ', '█     ', '████  ', '█     ', '█████ '],
  A: [' ▄█▄  ', '█   █ ', '█████ ', '█   █ ', '█   █ '],
  C: [' ▄███ ', '█     ', '█     ', '█     ', ' ▀███ '],
  T: ['█████ ', '  █   ', '  █   ', '  █   ', '  █   '],
  I: ['███ ', ' █  ', ' █  ', ' █  ', '███ '],
  O: [' ▄██▄ ', '█   █ ', '█   █ ', '█   █ ', ' ▀██▀ '],
  N: ['█   █ ', '██  █ ', '█ █ █ ', '█  ██ ', '█   █ '],
};
const word = 'REACTION';
const color = process.stdout.isTTY ? (c, s) => `\x1b[${c}m${s}\x1b[0m` : (_c, s) => s;
// azul em degradê de cima para baixo (claro → escuro)
const shades = ['38;5;117', '38;5;75', '38;5;69', '38;5;33', '38;5;27'];
const rows = FONT.R.map((_, r) => [...word].map((ch) => FONT[ch][r]).join('').slice(0, -1));
const width = rows[0].length + 4;
const line = '─'.repeat(width);
console.log('');
console.log(color('38;5;33', ` ┌${line}┐`));
rows.forEach((r, i) => console.log(color('38;5;33', ' │') + '  ' + color(`1;${shades[i]}`, r) + '  ' + color('38;5;33', '│')));
console.log(color('38;5;33', ` └${line}┘`));
console.log(color('1;38;5;75', '  ReactioN MMO') + color('38;5;245', ' · servidor do jogo · painel admin'));
const port = process.env.GAME_PORT || '8080';
console.log(color('38;5;245', `  Painel http://127.0.0.1:${process.env.ADMIN_PORT || '8090'}  ·  Jogo http://localhost:${port}/game/  ·  Site http://localhost:${port}/`));
console.log(color('38;5;240', '  Fechar esta janela desliga o painel e o servidor do jogo.'));
console.log('');
