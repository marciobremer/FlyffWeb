import { resImage, themeDds } from '../shared/tga';
import { tileFileName } from '../shared/formats/wld';
import { decodeText } from '../shared/formats/rgn';
import { GameWindow } from './ui';

/**
 * Mini mapa (tecla N, CWndNavigator) e mapa grande (tecla M, CWndMapEx).
 *
 * Mini mapa: cada pedaço de terreno (512×512) tem a sua imagem de cima ao lado do .lnd (`WdMadrigal01-04.dds`, 256×256 —
 * o m_texMiniMap do CLandscape); os pedaços em volta do personagem são desenhados com o norte (+z) para cima, como o
 * original (linha = altura − z − 1). Pontos: NPC amarelo, mob vermelho, jogador branco, party verde; o personagem é a seta.
 *
 * Mapa grande: as figuras do propMapComboBoxData.inc (`WORLD_Flaris.dds`… em Data/Theme/Default, 1280×960) com o
 * retângulo do mundo que cada uma cobre (SetRealPositionRect x1, z1, x2, z2): x → (x − x1)/(x2 − x1), z → (z2 − z)/(z2 − z1).
 * Abre na menor região que tem o personagem; a lista troca de figura. Mundo sem figura (Kebaras, Azria…): monta o mapa com
 * as imagens dos pedaços de terreno.
 */

export interface MapDot { x: number; z: number; kind: 'npc' | 'mob' | 'player' | 'party'; name?: string }
export interface MapView {
  /** mundo (nome do .wld), quantos pedaços de terreno em x e z e quais existem */
  world: string; landW: number; landH: number; hasTile: (x: number, z: number) => boolean;
  /** tamanho de um pedaço em unidades do mundo (128 × mpu) */
  tileSize: number;
  x: number; z: number; heading: number; dots: MapDot[];
}

const COLORS: Record<MapDot['kind'], string> = { npc: '#ffd23a', mob: '#ff4a3d', player: '#ffffff', party: '#5cff6a' };

/** imagens já decodificadas (data URL → <img>); null = não existe */
const images = new Map<string, HTMLImageElement | null>();
const loading = new Set<string>();
function image(path: string, load: (p: string) => Promise<string | null> = resImage): HTMLImageElement | null {
  const got = images.get(path);
  if (got !== undefined) return got;
  if (!loading.has(path)) {
    loading.add(path);
    void load(path).then((url) => {
      if (!url) { images.set(path, null); return; }
      const img = new Image();
      img.onload = () => images.set(path, img);
      img.onerror = () => images.set(path, null);
      img.src = url;
    });
  }
  return null;
}

/** seta do personagem: aponta para onde ele anda (heading 0 = −z, para baixo no mapa) */
function drawArrow(ctx: CanvasRenderingContext2D, x: number, y: number, heading: number, size: number) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(((180 - heading) * Math.PI) / 180);
  ctx.beginPath();
  ctx.moveTo(0, -size);
  ctx.lineTo(size * 0.7, size * 0.75);
  ctx.lineTo(0, size * 0.35);
  ctx.lineTo(-size * 0.7, size * 0.75);
  ctx.closePath();
  ctx.fillStyle = '#ffe14d';
  ctx.strokeStyle = '#3a1d00';
  ctx.lineWidth = 1.5;
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function drawDot(ctx: CanvasRenderingContext2D, x: number, y: number, kind: MapDot['kind'], r: number) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = COLORS[kind];
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgb(0 0 0 / .7)';
  ctx.stroke();
}

/** canvas que acompanha o tamanho do elemento (com a densidade de pixels da tela) */
function fitCanvas(c: HTMLCanvasElement) {
  const r = c.getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio || 1);
  const w = Math.max(1, Math.round(r.width * dpr)), h = Math.max(1, Math.round(r.height * dpr));
  if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  return { w: r.width, h: r.height, dpr };
}

// ---------- mini mapa ----------
/** pixels por unidade do mundo; a imagem de um pedaço tem 0,5 (256 px para 512 unidades) */
const ZOOMS = [0.18, 0.3, 0.5, 0.8, 1.2];

export class MiniMap extends GameWindow {
  private canvas = document.createElement('canvas');
  private coords = document.createElement('div');
  private zoom = 2;
  private last = 0;

  constructor(parent: HTMLElement) {
    super(parent, { id: 'navWnd', title: 'Navegador', store: 'flyff.wnd.navigator', initial: { x: -8, y: 8, w: 196, h: 222 }, min: { w: 150, h: 170 } });
    this.body.classList.add('nav');
    this.canvas.className = 'nav-canvas';
    this.canvas.setAttribute('role', 'img');
    this.canvas.setAttribute('aria-label', 'Mini mapa');
    const zoom = (d: number, label: string, sym: string) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `nav-zoom ${d > 0 ? 'in' : 'out'}`;
      b.textContent = sym;
      b.title = label;
      b.setAttribute('aria-label', label);
      b.addEventListener('click', () => { this.zoom = Math.max(0, Math.min(ZOOMS.length - 1, this.zoom + d)); this.last = 0; });
      return b;
    };
    this.coords.className = 'nav-coords';
    this.canvas.addEventListener('wheel', (e) => { e.preventDefault(); this.zoom = Math.max(0, Math.min(ZOOMS.length - 1, this.zoom + (e.deltaY < 0 ? 1 : -1))); this.last = 0; }, { passive: false });
    this.body.append(this.canvas, zoom(1, 'Aproximar', '+'), zoom(-1, 'Afastar', '−'), this.coords);
  }

  /** desenha (no máximo ~12 vezes por segundo; chamado a cada quadro) */
  draw(v: MapView | null) {
    if (!this.visible || !v) return;
    const now = performance.now();
    if (now - this.last < 80) return;
    this.last = now;
    const { w, h, dpr } = fitCanvas(this.canvas);
    const ctx = this.canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#1c2a1c';
    ctx.fillRect(0, 0, w, h);
    const s = ZOOMS[this.zoom], cx = w / 2, cy = h / 2;
    // tela: x → cx + (x − px)·s; z → cy − (z − pz)·s (norte para cima)
    const sx = (x: number) => cx + (x - v.x) * s, sy = (z: number) => cy - (z - v.z) * s;
    const T = v.tileSize;
    const x0 = Math.floor((v.x - cx / s) / T), x1 = Math.floor((v.x + cx / s) / T);
    const z0 = Math.floor((v.z - cy / s) / T), z1 = Math.floor((v.z + cy / s) / T);
    ctx.imageSmoothingEnabled = s < 0.5;
    for (let tz = z0; tz <= z1; tz++) {
      for (let tx = x0; tx <= x1; tx++) {
        if (tx < 0 || tz < 0 || tx >= v.landW || tz >= v.landH || !v.hasTile(tx, tz)) continue;
        const img = image(`World/${v.world}/${tileFileName(v.world, tx, tz).replace(/\.lnd$/i, '.dds')}`);
        // +1 px: sem linhas entre os pedaços ao arredondar
        if (img) ctx.drawImage(img, sx(tx * T), sy((tz + 1) * T), T * s + 1, T * s + 1);
      }
    }
    for (const d of v.dots) {
      const x = sx(d.x), y = sy(d.z);
      if (x < -4 || y < -4 || x > w + 4 || y > h + 4) continue;
      drawDot(ctx, x, y, d.kind, d.kind === 'mob' ? 2 : 2.6);
    }
    drawArrow(ctx, cx, cy, v.heading, 7);
    this.coords.textContent = `${Math.round(v.x)}, ${Math.round(v.z)}`;
  }
}

// ---------- mapa grande ----------
interface MapPicture { key: string; title: string; file: string; rect: [number, number, number, number]; parent: string }

/** figuras do propMapComboBoxData.inc (só as que têm imagem e retângulo) com os nomes do .txt.txt */
let pictures: Promise<MapPicture[]> | null = null;
function loadPictures(): Promise<MapPicture[]> {
  pictures ??= (async () => {
    const get = async (f: string) => { try { const r = await fetch('/res/' + f); return r.ok ? decodeText(await r.arrayBuffer()) : ''; } catch { return ''; } };
    const [inc, txt] = await Promise.all([get('propMapComboBoxData.inc'), get('propMapComboBoxData.txt.txt')]);
    const names = new Map<string, string>();
    for (const line of txt.split(/\r?\n/)) { const i = line.indexOf('\t'); if (i > 0) names.set(line.slice(0, i).trim(), line.slice(i + 1).trim()); }
    const out: MapPicture[] = [];
    for (const m of inc.matchAll(/(MCD_\w+)\s*\{([^}]*)\}/g)) {
      const body = m[2];
      const file = /SetPictureFile\(\s*"([^"]+)"/.exec(body)?.[1];
      const rect = /SetRealPositionRect\(\s*(-?\d+)\s*,\s*(-?\d+)\s*,\s*(-?\d+)\s*,\s*(-?\d+)/.exec(body);
      if (!file || !rect) continue;
      const ids = /SetTitle\(\s*(\w+)/.exec(body)?.[1] ?? '';
      out.push({ key: m[1], title: names.get(ids) || m[1].replace(/^MCD_/, ''), file, rect: [Number(rect[1]), Number(rect[2]), Number(rect[3]), Number(rect[4])], parent: /SetParentID\(\s*(\w+)/.exec(body)?.[1] ?? '' });
    }
    return out;
  })();
  return pictures;
}

/** figuras de cada mundo: o propMapComboBoxData só traz o mapa do continente (WdMadrigal) — mundo, regiões e cidades */
const WORLD_PARENTS: Record<string, string[]> = { wdmadrigal: ['MCD_WORLD', 'MCD_REGION', 'MCD_TOWN'] };
const TERRAIN = '__terrain';

export class WorldMap extends GameWindow {
  private canvas = document.createElement('canvas');
  private select = document.createElement('select');
  private list: MapPicture[] = [];
  private world = '';
  /** o jogador escolheu uma figura na lista (senão segue a região onde ele está) */
  private manual = false;
  private last = 0;

  constructor(parent: HTMLElement) {
    super(parent, { id: 'mapWnd', title: 'Mapa', store: 'flyff.wnd.worldmap', initial: { x: 140, y: 110, w: 760, h: 600 }, min: { w: 360, h: 320 } });
    this.body.classList.add('wmap');
    this.select.className = 'gm-in wmap-select';
    this.select.setAttribute('aria-label', 'Escolher mapa');
    this.select.addEventListener('change', () => { this.manual = true; this.last = 0; });
    this.select.addEventListener('keydown', (e) => e.stopPropagation());
    this.canvas.className = 'wmap-canvas';
    this.canvas.setAttribute('role', 'img');
    this.canvas.setAttribute('aria-label', 'Mapa do mundo');
    this.body.append(this.select, this.canvas);
  }

  /** ao abrir, volta a seguir a região do personagem */
  open() { this.manual = false; this.last = 0; this.show(); }

  private async setWorld(world: string) {
    this.world = world;
    const all = await loadPictures();
    const parents = WORLD_PARENTS[world.toLowerCase()];
    this.list = parents ? all.filter((p) => parents.includes(p.parent)) : [];
    this.select.replaceChildren();
    const group = (label: string, parent: string) => {
      const items = this.list.filter((p) => p.parent === parent);
      if (!items.length) return;
      const g = document.createElement('optgroup');
      g.label = label;
      for (const p of items) { const o = document.createElement('option'); o.value = p.key; o.textContent = p.title; g.appendChild(o); }
      this.select.appendChild(g);
    };
    group('Mundo', 'MCD_WORLD'); group('Regiões', 'MCD_REGION'); group('Cidades', 'MCD_TOWN');
    const t = document.createElement('option');
    t.value = TERRAIN;
    t.textContent = 'Terreno (vista de cima)';
    this.select.appendChild(t);
    this.manual = false;
    this.last = 0;
  }

  draw(v: MapView | null) {
    if (!this.visible || !v) return;
    if (v.world !== this.world) { void this.setWorld(v.world); return; }
    const now = performance.now();
    if (now - this.last < 100) return;
    this.last = now;
    // segue a menor figura que tem o personagem (região/cidade); fora de todas, o mapa do mundo ou o terreno
    if (!this.manual) {
      const inside = this.list.filter((p) => v.x >= p.rect[0] && v.x <= p.rect[2] && v.z >= p.rect[1] && v.z <= p.rect[3] && p.parent !== 'MCD_TOWN');
      inside.sort((a, b) => (a.rect[2] - a.rect[0]) * (a.rect[3] - a.rect[1]) - (b.rect[2] - b.rect[0]) * (b.rect[3] - b.rect[1]));
      const want = inside[0]?.key ?? TERRAIN;
      if (this.select.value !== want) this.select.value = want;
    }
    const { w, h, dpr } = fitCanvas(this.canvas);
    const ctx = this.canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#0d1a24';
    ctx.fillRect(0, 0, w, h);
    const pic = this.list.find((p) => p.key === this.select.value);
    // área do mundo mostrada e a caixa (com a proporção certa) onde ela cabe na janela
    let area: [number, number, number, number];
    let aspect: number;
    if (pic) { area = pic.rect; aspect = 1280 / 960; } else { area = [0, 0, v.landW * v.tileSize, v.landH * v.tileSize]; aspect = v.landW / v.landH; }
    const bw = Math.min(w, h * aspect), bh = bw / aspect, bx = (w - bw) / 2, by = (h - bh) / 2;
    const [ax1, az1, ax2, az2] = area;
    const px = (x: number) => bx + ((x - ax1) / (ax2 - ax1)) * bw, py = (z: number) => by + ((az2 - z) / (az2 - az1)) * bh;
    if (pic) {
      const img = image(pic.file, themeDds);
      if (img) ctx.drawImage(img, bx, by, bw, bh);
      else this.loadingText(ctx, w, h);
    } else {
      // sem figura: monta com as imagens dos pedaços de terreno
      const T = v.tileSize;
      ctx.imageSmoothingEnabled = true;
      for (let tz = 0; tz < v.landH; tz++) for (let tx = 0; tx < v.landW; tx++) {
        if (!v.hasTile(tx, tz)) continue;
        const img = image(`World/${v.world}/${tileFileName(v.world, tx, tz).replace(/\.lnd$/i, '.dds')}`);
        if (img) ctx.drawImage(img, px(tx * T), py((tz + 1) * T), (T / (ax2 - ax1)) * bw + 1, (T / (az2 - az1)) * bh + 1);
      }
    }
    // jogadores e party (NPC e mob ficam só no mini mapa, como o original)
    for (const d of v.dots) if (d.kind === 'player' || d.kind === 'party') drawDot(ctx, px(d.x), py(d.z), d.kind, 3.5);
    const mx = px(v.x), my = py(v.z);
    if (mx >= bx && mx <= bx + bw && my >= by && my <= by + bh) drawArrow(ctx, mx, my, v.heading, 10);
  }

  private loadingText(ctx: CanvasRenderingContext2D, w: number, h: number) {
    ctx.fillStyle = '#cfd8e3';
    ctx.font = '13px Tahoma, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Carregando o mapa…', w / 2, h / 2);
  }
}
