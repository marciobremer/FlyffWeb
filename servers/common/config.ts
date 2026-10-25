import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Caminhos e portas do projeto num lugar só (antes cada arquivo calculava o seu).
 *   ROOT          raiz do projeto (a pasta que tem package.json)
 *   RES_DIR       pasta Resource do FlyFF (somente leitura) — padrão `original/Resource`; FLYFF_RESOURCE troca
 *                 (caminho absoluto, ou relativo à raiz)
 *   DIST          versão compilada do cliente/editor (`npm run build`)
 *   WORLD         mundo carregado pelo servidor
 *   GAME_PORT     porta do servidor do jogo; ADMIN_PORT a do painel
 */
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const RES_DIR = path.resolve(ROOT, process.env.FLYFF_RESOURCE ?? 'original/Resource');
export const DIST = path.join(ROOT, 'dist');
/**
 * Cliente desempacotado das versões novas (`Client/Model`, `Client/Theme`, `Client/Sound`…: o que antes ficava em
 * `Resource/Data`); FLYFF_CLIENT troca. E `data/res-extra`: arquivos do projeto que o cliente usa e a versão instalada não
 * tem (imagens de interface, cursores), no mesmo layout de `/res`.
 */
export const CLIENT_DIR = path.resolve(ROOT, process.env.FLYFF_CLIENT ?? 'original/Client');
export const EXTRA_DIR = path.join(ROOT, 'data', 'res-extra');
/** onde `/res/*` procura, na ordem (servers/common/resources.ts) */
export const RES_ROOTS = [{ dir: RES_DIR }, { dir: CLIENT_DIR, strip: true }, { dir: EXTRA_DIR }];
/** .wav do cliente (somente leitura): `Client/Sound` nas versões novas, `Client/Data/Music/Sound` nas antigas; FLYFF_SOUND troca */
export const SOUND_DIR = path.resolve(ROOT, process.env.FLYFF_SOUND
  ?? (fs.existsSync(path.join(CLIENT_DIR, 'Sound')) ? path.join(CLIENT_DIR, 'Sound') : 'original/Client/Data/Music/Sound'));
export const WORLD = process.env.WORLD ?? 'WdMadrigal';
export const GAME_PORT = Number(process.env.PORT ?? process.env.GAME_PORT ?? 8080);
export const ADMIN_PORT = Number(process.env.ADMIN_PORT ?? 8090);
/** tamanho máximo do anúncio do painel (letreiro para todos os jogadores) */
export const ANNOUNCE_MAX = 200;
/** o site (Next.js em htdocs): pasta e porta interna (só 127.0.0.1); o servidor do jogo mostra o site em `/` */
export const SITE_DIR = path.join(ROOT, 'htdocs');
export const SITE_PORT = Number(process.env.SITE_PORT ?? 3010);

/**
 * As páginas do cliente moram em `client/` (e o editor em `editor/`), mas os endereços continuam `/game/` e `/editor/`.
 * Reescreve o caminho do pedido: `/game/...` → `/client/...`.
 */
export const pageAlias = (pathname: string) => (pathname === '/game' || pathname.startsWith('/game/') ? '/client' + pathname.slice(5) : pathname);
