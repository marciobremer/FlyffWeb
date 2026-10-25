export interface WldInfo {
  width: number; height: number; mpu: number; indoor: boolean; fly: boolean;
  ambient: number; diffuse: number; bgColor: number;
  camera: { pos: [number, number, number]; yaw: number; pitch: number };
  fog: { start: number; end: number; density: number };
  lightDir: [number, number, number];
  bgm: number; pkmode: number; revival: { id: number; place: string };
  sky: string[]; cloud: string[]; sun: string; moon: string; seacloud: string;
}

/** `CWorld::_loadWldFile` — arquivo de texto "chave valor". */
export function parseWld(text: string): WldInfo {
  const w: WldInfo = {
    width: 0, height: 0, mpu: 4, indoor: false, fly: true, ambient: 0x808080, diffuse: 0, bgColor: 0xffe0e0ff,
    camera: { pos: [0, 200, 0], yaw: 0, pitch: 0 }, fog: { start: 70, end: 400, density: 0 }, lightDir: [0, 0, 0],
    bgm: 0, pkmode: 0, revival: { id: 0, place: '' }, sky: [], cloud: [], sun: 'default', moon: 'default', seacloud: 'default',
  };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\/\/.*$/, '').trim();
    if (!line) continue;
    const toks = line.match(/"[^"]*"|[^\s,]+/g) ?? [];
    const key = (toks[0] ?? "").toLowerCase();
    const a = toks.slice(1).map((t) => t.replace(/^"|"$/g, ''));
    const n = (i: number) => Number(a[i]);
    switch (key) {
      case 'size': w.width = n(0); w.height = n(1); break;
      case 'indoor': w.indoor = n(0) !== 0; break;
      case 'fly': w.fly = n(0) !== 0; break;
      case 'ambient': w.ambient = Number(a[0]); break;
      case 'diffuse': w.diffuse = Number(a[0]); break;
      case 'bgcolor': w.bgColor = Number(a[0]); break;
      case 'mpu': w.mpu = n(0); break;
      case 'bgm': w.bgm = n(0); break;
      case 'pkmode': w.pkmode = n(0); break;
      case 'revival': w.revival = { id: n(0), place: a[1] ?? '' }; break;
      case 'lightdir': w.lightDir = [n(0), n(1), n(2)]; break;
      case 'fogsetting': w.fog = { start: n(0), end: n(1), density: n(2) }; break;
      case 'camera': w.camera = { pos: [n(0), n(1), n(2)], yaw: -(n(3) % 6) * 60, pitch: (n(4) % 6) * 60 }; break;
      case 'sky': w.sky = a; break;
      case 'cloud': w.cloud = a; break;
      case 'sun': w.sun = a[0]; break;
      case 'moon': w.moon = a[0]; break;
      case 'seacloud': w.seacloud = a[0]; break;
    }
  }
  return w;
}

export const tileFileName = (base: string, x: number, y: number) =>
  `${base}${String(x).padStart(2, '0')}-${String(y).padStart(2, '0')}.lnd`;
