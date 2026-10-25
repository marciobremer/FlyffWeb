import { applyNpcEdits, cleanEdits, emptyEdits, type WorldEdits } from './worldedits';
import { parseWld, tileFileName, type WldInfo } from './formats/wld';
import { parseLnd, type Landscape } from './formats/lnd';
import { parseDyo } from './formats/dyo';
import { decodeText, parseCnt, parseRgn, parseTxtTxt, type Continent, type Region, type Respawn } from './formats/rgn';
import { parseDefines, parseModelTable, parseTerrain, parseWaterLists, type ModelEntry } from './formats/inc';
import { OT, type WorldObject } from './formats/types';
import { parseCharacters, type CharacterDef } from './humans';
import { trackedBuffer, trackedFetch } from './netstats';

export async function fetchBuf(url: string): Promise<ArrayBuffer | null> {
  try {
    const r = await trackedFetch(url);
    return r.ok ? await trackedBuffer(r) : null;
  } catch { return null; }
}
async function fetchList(dir: string): Promise<string[]> {
  try { const r = await trackedFetch('/api/list?dir=' + encodeURIComponent(dir)); return r.ok ? await r.json() : []; } catch { return []; }
}

/** Arquivos de cabeçalho (#define MI_xxx) usados para resolver IDs simbólicos de mdlDyna.inc, se existirem. */
const DEFINE_FILES = ['defineObj.h', 'define.h', 'defineNeuz.h', 'defineItem.h', 'defineWorld.h'];

export class WorldData {
  wld!: WldInfo;
  name = '';
  tileFiles = new Set<string>(); // minúsculas
  objModels = new Map<number, ModelEntry>();
  dynaModels = new Map<string, ModelEntry>(); // `${type}:${id}`
  terrainTextures = new Map<number, string>();
  modelFiles = new Set<string>(); // Resource/Model, minúsculas
  textureFiles = new Set<string>(); // Resource/Data/Model/Texture, minúsculas
  terrainFiles = new Set<string>(); // Resource/World/Texture, minúsculas
  weatherFiles = new Set<string>(); // Resource/Data/Weather, minúsculas
  sfxFiles = new Set<string>(); // Resource/Data/SFX, minúsculas
  sfxTextureFiles = new Set<string>(); // Resource/Data/SFX/Texture, minúsculas
  waterLists: number[][] = [];
  /** NPCs com as edições aplicadas (o que aparece) e os do .dyo original; `edits` = o que o editor salvou */
  movers: WorldObject[] = [];
  moversOriginal: WorldObject[] = [];
  edits: WorldEdits = emptyEdits('');
  respawns: Respawn[] = [];
  regions: Region[] = [];
  continents: Continent[] = [];
  /** modelID do mover → nome exibido (propMover.txt + propMover.txt.txt) */
  moverNames = new Map<number, string>();
  /** modelIDs de movers com bFlying = 1 em propMover.txt (coluna 46) */
  flyingMovers = new Set<number>();
  /** propMover: fSpeed (unidades por tick de 1/60 s) e dwLevel por modelID */
  moverSpeed = new Map<number, number>();
  moverLevel = new Map<number, number>();
  /** boss (dwClass RANK_BOSS/RANK_MIDBOSS/RANK_SUPER): nome vermelho, agressivos */
  bossMovers = new Set<number>();
  /** símbolo MI_* de cada mover (painel de GM) e se é monstro (dwAI AII_MONSTER…, não NPC) */
  moverSymbols = new Map<number, string>();
  monsterMovers = new Set<number>();
  /** itens (II_*) que, equipados, escondem a cabeça (e o cabelo) / só o cabelo — dwBasePartsIgnore (/gapi/parts-ignore) */
  hidesHead = new Set<string>();
  hidesHair = new Set<string>();
  /** character.inc: aparência dos NPCs humanos (chave em minúsculas) */
  characters = new Map<string, CharacterDef>();
  defines = new Map<string, number>();

  static async load(name: string, onStatus: (s: string) => void = () => {}): Promise<WorldData> {
    const d = new WorldData();
    d.name = name;
    const W = `/res/World/${name}/${name}`;
    onStatus('Lendo .wld…');
    const wldBuf = await fetchBuf(W + '.wld');
    if (!wldBuf) throw new Error(`Não achei ${name}.wld em Resource/World/${name}`);
    d.wld = parseWld(decodeText(wldBuf));

    const [files, models, texs, terr, weather, sfx, sfxTex] = await Promise.all([fetchList('World/' + name), fetchList('Data/Model'), fetchList('Data/Model/Texture'), fetchList('World/Texture'), fetchList('Data/Weather'), fetchList('Data/SFX'), fetchList('Data/SFX/Texture')]);
    d.sfxFiles = new Set(sfx.map((f) => f.toLowerCase()));
    d.sfxTextureFiles = new Set(sfxTex.map((f) => f.toLowerCase()));
    d.weatherFiles = new Set(weather.map((f) => f.toLowerCase()));
    d.terrainFiles = new Set(terr.map((f) => f.toLowerCase()));
    d.tileFiles = new Set(files.map((f) => f.toLowerCase()));
    d.modelFiles = new Set(models.map((f) => f.toLowerCase()));
    d.textureFiles = new Set(texs.map((f) => f.toLowerCase()));

    onStatus('Lendo tabelas de modelos…');
    const defines = new Map<string, number>();
    await Promise.all(DEFINE_FILES.map(async (f) => { const b = await fetchBuf('/res/' + f); if (b) parseDefines(decodeText(b, 'windows-1252'), defines); }));
    d.defines = defines;
    const objInc = await fetchBuf('/res/mdlObj.inc');
    if (objInc) for (const e of parseModelTable(decodeText(objInc), OT.OBJ, defines)) d.objModels.set(e.id, e);
    const dynaInc = await fetchBuf('/res/mdlDyna.inc');
    if (dynaInc) for (const e of parseModelTable(decodeText(dynaInc), OT.OBJ, defines)) d.dynaModels.set(`${e.type}:${e.id}`, e);
    const terInc = await fetchBuf('/res/Terrain.inc');
    if (terInc) { const tt = decodeText(terInc); d.terrainTextures = parseTerrain(tt); d.waterLists = parseWaterLists(tt); }

    // nomes de outra versão pelo símbolo (servers/common/names.ts — inglês por cima do francês do servidor novo)
    const nb = await fetchBuf('/res/names-en.json');
    let nt: { movers?: Record<string, string>; npcs?: Record<string, string> } = {};
    try { if (nb) nt = JSON.parse(new TextDecoder().decode(nb)); } catch { /* sem a tabela */ }
    // NPCs: character.inc + -etc + -school; nomes `IDS_*` resolvidos pelas tabelas character*.txt.txt
    for (const base of ['character', 'character-etc', 'character-school']) {
      const [inc, txt] = await Promise.all([fetchBuf(`/res/${base}.inc`), fetchBuf(`/res/${base}.txt.txt`)]);
      if (!inc) continue;
      const ids = txt ? parseTxtTxt(decodeText(txt, 'windows-1252')) : new Map<string, string>();
      for (const [k, c] of parseCharacters(decodeText(inc, 'windows-1252'))) {
        if (c.name?.startsWith('IDS_')) c.name = ids.get(c.name) ?? undefined;
        if (nt.npcs?.[k]) c.name = nt.npcs[k];
        if (!d.characters.has(k)) d.characters.set(k, c);
      }
    }
    const pm = await fetchBuf('/res/propMover.txt'), pmt = await fetchBuf('/res/propMover.txt.txt');
    if (pm && pmt) {
      const ids = parseTxtTxt(decodeText(pmt, 'windows-1252'));
      for (const line of new TextDecoder('windows-1252').decode(pm).split(/\r?\n/)) {
        const c = line.split('\t');
        const id = defines.get(c[0]?.trim());
        const name = nt.movers?.[c[0]?.trim()] ?? ids.get(c[1]?.trim());
        if (id !== undefined && name) d.moverNames.set(id, name);
        if (id !== undefined && c[46] && c[46].trim() !== '0' && c[46].trim() !== '=') d.flyingMovers.add(id);
        const sp = Number(c[44]), lv = Number(c[12]);
        if (id !== undefined && sp > 0) d.moverSpeed.set(id, sp);
        if (id !== undefined && lv > 0) d.moverLevel.set(id, lv);
        if (id !== undefined) {
          const rank = c[15]?.trim() ?? '', ai = c[2]?.trim() ?? '';
          if (rank === 'RANK_BOSS' || rank === 'RANK_MIDBOSS' || rank === 'RANK_SUPER') d.bossMovers.add(id);
          d.moverSymbols.set(id, c[0].trim());
          if (/^AII_/.test(ai) && ai !== 'AII_NONE' && !/NPC|GUARD|CITIZEN|PET|EGG/.test(ai) && rank !== 'RANK_CITIZEN' && rank !== 'RANK_GUARD' && lv > 0) d.monsterMovers.add(id);
        }
      }
    }

    onStatus('Lendo regiões, spawns e movers…');
    const txt = await fetchBuf(W + '.txt.txt') ?? await fetchBuf(`/res/World/${name}/wd${name.slice(2)}.txt.txt`);
    const titles = txt ? parseTxtTxt(decodeText(txt, 'windows-1252')) : new Map<string, string>();
    const rgn = await fetchBuf(W + '.rgn');
    if (rgn) { const r = parseRgn(decodeText(rgn), titles); d.respawns = r.respawns; d.regions = r.regions; }
    const dyo = await fetchBuf(W + '.dyo');
    if (dyo) d.moversOriginal = parseDyo(dyo, d.wld.mpu).filter((o) => o.type === OT.MOVER);
    // edições do editor (NPCs movidos/novos/apagados + Ambiente) por cima do .dyo
    try {
      const r = await fetch(`/gapi/world-edits?world=${encodeURIComponent(name)}`);
      if (r.ok) d.edits = cleanEdits(await r.json(), name);
    } catch { /* sem servidor de edições: usa o mundo original */ }
    d.movers = applyNpcEdits(d.moversOriginal, d.edits.npcs);
    // itens que escondem a cabeça/o cabelo ao equipar (dwBasePartsIgnore do Spec_Item, servido pelo jogo)
    try {
      const r = await fetch('/gapi/parts-ignore');
      if (r.ok) { const j = await r.json() as { head?: string[]; hair?: string[] }; d.hidesHead = new Set(j.head ?? []); d.hidesHair = new Set(j.hair ?? []); }
    } catch { /* sem servidor: cabelo sempre aparece */ }
    const cnt = await fetchBuf(W + '.wld.cnt');
    if (cnt) d.continents = parseCnt(decodeText(cnt));
    return d;
  }

  hasTile(x: number, y: number) { return this.tileFiles.has(tileFileName(this.name, x, y).toLowerCase()); }

  async loadTile(x: number, y: number): Promise<Landscape | null> {
    if (!this.hasTile(x, y)) return null;
    const buf = await fetchBuf(`/res/World/${this.name}/${tileFileName(this.name, x, y)}`);
    return buf ? parseLnd(buf, x, y, this.wld.mpu) : null;
  }

  /** Entrada de modelo para um objeto (objetos estáticos usam mdlObj.inc; o resto mdlDyna.inc). */
  modelFor(type: number, id: number): ModelEntry | undefined {
    return type === OT.OBJ ? this.objModels.get(id) : this.dynaModels.get(`${type}:${id}`);
  }
}
