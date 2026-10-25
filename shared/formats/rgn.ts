/** Retângulo no plano XZ do mundo. */
export interface RectXZ { xMin: number; zMin: number; xMax: number; zMax: number }

export interface Respawn {
  type: number; modelId: number; pos: [number, number, number];
  count: number; time: number; attackCount: number; rect: RectXZ;
  aiState: number; angle: number;
}
export interface Region {
  type: number; modelId: number; pos: [number, number, number]; attributes: number; musicId: number;
  script: string; sound: string; teleportWorld: number; teleportPos: [number, number, number];
  rect: RectXZ; key: string; titleId?: string; descId?: string; title?: string; desc?: string;
}

export function decodeText(buf: ArrayBuffer, fallback = 'utf-8'): string {
  const b = new Uint8Array(buf);
  if (b[0] === 0xff && b[1] === 0xfe) return new TextDecoder('utf-16le').decode(b.subarray(2));
  if (b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) return new TextDecoder('utf-8').decode(b.subarray(3));
  return new TextDecoder(fallback).decode(b);
}

const tokenize = (line: string) => (line.match(/"[^"]*"|\S+/g) ?? []).map((t) => t.replace(/^"|"$/g, ''));

/**
 * `CWorld::_loadRgnFile`. O rect é gravado como (top, left, bottom, right) de um QRect cujo x é o eixo Z do mundo
 * e cujo y é o eixo X (ver `_loadDyoFile`): top→xMin, left→zMin, bottom→xMax, right→zMax.
 */
export function parseRgn(text: string, titles: Map<string, string> = new Map()) {
  const respawns: Respawn[] = [];
  const regions: Region[] = [];
  let cur: Region | null = null;
  let pending: 'title' | 'desc' | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('//')) continue;
    const t = tokenize(line);
    const num = (i: number) => Number(t[i]);
    if (t[0] === 'respawn7') {
      respawns.push({
        type: num(1), modelId: num(2), pos: [num(3), num(4), num(5)], count: num(6), time: num(7), attackCount: num(8),
        rect: { xMin: num(9), zMin: num(10), xMax: num(11), zMax: num(12) }, aiState: num(19), angle: num(20),
      });
      cur = null;
    } else if (t[0] === 'region3') {
      cur = {
        type: num(1), modelId: num(2), pos: [num(3), num(4), num(5)], attributes: Number(t[6]), musicId: num(7),
        script: t[9] ?? '', sound: t[10] ?? '', teleportWorld: num(11), teleportPos: [num(12), num(13), num(14)],
        rect: { xMin: num(15), zMin: num(16), xMax: num(17), zMax: num(18) }, key: t[19] ?? '',
      };
      regions.push(cur);
    } else if (cur && (t[0] === 'title' || t[0] === 'desc')) {
      pending = t[1] === '1' ? t[0] : null;
    } else if (cur && pending && t[0].startsWith('IDS_')) {
      if (pending === 'title') { cur.titleId = t[0]; cur.title = titles.get(t[0]); } else { cur.descId = t[0]; cur.desc = titles.get(t[0]); }
      pending = null;
    }
  }
  return { respawns, regions };
}

/** `wdXxx.txt.txt`: `IDS_...<TAB>texto` */
export function parseTxtTxt(text: string): Map<string, string> {
  const m = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const i = line.indexOf('\t');
    // texto sem tradução vem com a própria chave no lugar (`IDS_X<tab>IDS_X`): fica de fora
    if (i > 0 && line.startsWith('IDS') && !line.slice(i + 1).startsWith('IDS_')) m.set(line.slice(0, i), line.slice(i + 1).replace(/\\n/g, '\n'));
  }
  return m;
}

export interface Continent {
  id: number; name: string; town: boolean; vertices: [number, number, number][];
  /** C_useEnvir: usa iluminação/névoa/céu próprios (CWorld::UpdateContinent) */
  useEnvir: boolean;
  ambient: [number, number, number]; diffuse: [number, number, number];
  fogStart: number; fogEnd: number; weather: number;
  /** "NO" = padrão do jogo */
  sky: string; cloud: string; sun: string; moon: string;
}
/** `.wld.cnt` */
export function parseCnt(text: string): Continent[] {
  const out: Continent[] = [];
  let c: Continent | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const t = tokenize(raw.trim());
    if (!t.length) continue;
    if (t[0] === 'Continent' && t[1] === 'BEGIN') c = { id: 0, name: '', town: false, vertices: [], useEnvir: false, ambient: [0.5, 0.5, 0.5], diffuse: [0, 0, 0], fogStart: 70, fogEnd: 400, weather: 0, sky: 'NO', cloud: 'NO', sun: 'NO', moon: 'NO' };
    else if (t[0] === 'Continent' && t[1] === 'END' && c) { out.push(c); c = null; }
    else if (c && t[0] === 'C_id') c.id = Number(t[1]);
    else if (c && t[0] === 'C_name') c.name = t.slice(1).join(' ');
    else if (c && t[0] === 'TOWN') c.town = t[1] === '1';
    else if (c && t[0] === 'C_useEnvir') c.useEnvir = t[1] === '1';
    else if (c && t[0] === 'C_ambient') c.ambient = [Number(t[1]), Number(t[2]), Number(t[3])];
    else if (c && t[0] === 'C_diffuse') c.diffuse = [Number(t[1]), Number(t[2]), Number(t[3])];
    else if (c && t[0] === 'C_fogstartend') { c.fogStart = Number(t[1]); c.fogEnd = Number(t[2]); }
    else if (c && t[0] === 'C_weather') c.weather = Number(t[1]);
    else if (c && (t[0] === 'C_sky' || t[0] === 'C_cloud' || t[0] === 'C_sun' || t[0] === 'C_moon')) {
      // "C_sky <0|1> <arquivo>": 0 = padrão
      const key = t[0].slice(2) as 'sky' | 'cloud' | 'sun' | 'moon';
      c[key] = t[1] === '1' && t[2] ? t[2] : 'NO';
    } else if (c && t[0] === 'VERTEX') c.vertices.push([Number(t[1]), Number(t[2]), Number(t[3])]);
  }
  return out;
}
