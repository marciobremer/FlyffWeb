/**
 * `ZckTeleporteur.inc` (CZckTeleporteur::LoadScript): destinos do teleporte (janela Teleporter, tecla V).
 *   TELEPORT_CASE <mundo WI_*> <x> <y> <z> <TYPE_CITY|TYPE_ZONE|TYPE_DUNGEON> "nome" "imagem.png" "descrição" { itens… }
 * O índice (`key`) é a ordem no arquivo: é ele que o cliente manda ao pedir o teleporte (PACKETTYPE_ZCK_TELEPORTEUR).
 * Os itens do bloco são só mostrados na janela (o que se encontra ali).
 */
export type TeleportType = 'city' | 'zone' | 'dungeon';
export interface TeleportDest { key: number; world: string; pos: [number, number, number]; type: TeleportType; name: string; image: string; desc: string; items: string[] }

export function parseTeleports(text: string): TeleportDest[] {
  const src = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  const tok = src.match(/"[^"]*"|[{}]|[^\s{}"]+/g) ?? [];
  const str = (t: string | undefined) => (t ?? '').replace(/^"|"$/g, '');
  const out: TeleportDest[] = [];
  for (let i = 0; i < tok.length; i++) {
    if (tok[i] !== 'TELEPORT_CASE') continue;
    const [world, x, y, z, type, name, image, desc] = tok.slice(i + 1, i + 9);
    i += 9;
    if (tok[i] !== '{') continue;
    const items: string[] = [];
    for (i++; i < tok.length && tok[i] !== '}'; i++) items.push(tok[i]);
    const pos: [number, number, number] = [Number(x), Number(y), Number(z)];
    if (!pos.every(Number.isFinite)) continue;
    out.push({ key: out.length, world, pos, type: type === 'TYPE_ZONE' ? 'zone' : type === 'TYPE_DUNGEON' ? 'dungeon' : 'city', name: str(name), image: str(image), desc: str(desc), items });
  }
  return out;
}
