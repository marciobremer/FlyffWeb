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

/**
 * `AegonTeleporter.inc` (Titanium, janela Teleporter): blocos `Teleport { nameList "…" nameHeader "…" nameImage "…" type 0|1|2
 * teleporterWnd 0|1 descrTID TID_… cost N worldID WI_… pos x y z item II_… … }`. type: 0 cidade, 1 coleta, 2 dungeon;
 * teleporterWnd 1 é a janela da Heaven Tower (fica de fora). `desc` aqui é o TID; quem resolve o texto é o servidor.
 */
export interface AegonTeleport { name: string; header: string; image: string; type: number; desc: string; cost: number; world: string; pos: [number, number, number]; items: string[] }
export function parseAegonTeleports(text: string): AegonTeleport[] {
  const src = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  const tok = src.match(/"[^"]*"|[{}]|[^\s{}"]+/g) ?? [];
  const str = (t: string | undefined) => (t ?? '').replace(/^"|"$/g, '');
  const out: AegonTeleport[] = [];
  for (let i = 0; i < tok.length; i++) {
    if (tok[i] !== 'Teleport' || tok[i + 1] !== '{') continue;
    const t: AegonTeleport = { name: '', header: '', image: '', type: 0, desc: '', cost: 0, world: '', pos: [NaN, NaN, NaN], items: [] };
    let wnd = 0;
    for (i += 2; i < tok.length && tok[i] !== '}'; i++) {
      const k = tok[i];
      if (k === 'nameList') t.name = str(tok[++i]);
      else if (k === 'nameHeader') t.header = str(tok[++i]);
      else if (k === 'nameImage') t.image = str(tok[++i]);
      else if (k === 'type') t.type = Number(tok[++i]) || 0;
      else if (k === 'teleporterWnd') wnd = Number(tok[++i]) || 0;
      else if (k === 'descrTID') t.desc = tok[++i];
      else if (k === 'cost') t.cost = Number(tok[++i]) || 0;
      else if (k === 'worldID') t.world = tok[++i];
      else if (k === 'pos') t.pos = [Number(tok[++i]), Number(tok[++i]), Number(tok[++i])];
      else if (k === 'item') t.items.push(tok[++i]);
      else if (k === 'fAngle' || k === 'worldDungeon' || k === 'shortcutTex') i++;
    }
    if (wnd === 0 && t.world && t.pos.every(Number.isFinite)) out.push(t);
  }
  return out;
}
