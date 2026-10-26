import fs from 'node:fs';
import path from 'node:path';
import { parseWld, tileFileName, type WldInfo } from '../../shared/formats/wld';
import { parseLnd } from '../../shared/formats/lnd';
import { decodeText, parseRgn, parseTxtTxt, type Respawn } from '../../shared/formats/rgn';
import { parseDefines } from '../../shared/formats/inc';
import { MAP_SIZE } from '../../shared/formats/types';

/**
 * Dados do mundo que o servidor precisa para simular (lidos direto da pasta Resource): tamanho do mapa (.wld), respawns (.rgn),
 * velocidade/voo dos movers (propMover.txt) e atributos do terreno (.lnd, carregados sob demanda) para escolher destinos andáveis.
 * Mesmos leitores do cliente (shared/formats).
 */
const DEFINE_FILES = ['defineObj.h', 'define.h', 'defineNeuz.h', 'defineItem.h', 'defineWorld.h'];

/** colunas de combate do propMover.txt (MoverProp no código original) */
export interface MoverProp {
  symbol: string; str: number; sta: number; dex: number; int: number; hr: number; er: number; belligerence: string; level: number;
  /** dwClass (RANK_*): RANK_BOSS, RANK_MIDBOSS e RANK_SUPER são os boss */
  rank: string;
  atkMin: number; atkMax: number; /** arma de ataque do mob (II_WEA_MOB_*): soma o dwAbilityMin/Max */ atk1: string;
  attackSpeed: number; reAttackDelay: number; hp: number; naturalArmor: number; exp: number;
  /** dwCorrectionValue (%): multiplica a chance dos DropKind; dwFlying: voador (drop vai direto para a bolsa) */
  correction: number; flying: boolean;
  /** eElementType (1 fogo, 2 água, 3 elétrico, 4 vento, 5 terra; 0 nenhum) e wElementAtk (nível do elemento) */
  element: number; elementLevel: number;
}

export class ServerWorld {
  wld!: WldInfo;
  respawns: Respawn[] = [];
  /** propMover: fSpeed (unidades por tick de 1/60 s) por modelID */
  moverSpeed = new Map<number, number>();
  flyingMovers = new Set<number>();
  /** propMover.txt: atributos de combate por modelID (colunas conferidas com CProject::LoadPropMover e os dados reais) */
  moverProps = new Map<number, MoverProp>();
  private attrs = new Map<string, Uint8Array | null>();
  private files = new Map<string, string>(); // minúsculas → nome real

  constructor(readonly resDir: string, readonly name: string) {}

  private ab(p: string): ArrayBuffer | null {
    try { const b = fs.readFileSync(p); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer; } catch { return null; }
  }
  /** arquivo da pasta do mundo sem diferenciar maiúsculas (o Windows não liga, o Linux sim) */
  private worldFile(file: string) { return path.join(this.resDir, 'World', this.name, this.files.get(file.toLowerCase()) ?? file); }

  load() {
    const dir = path.join(this.resDir, 'World', this.name);
    for (const f of fs.readdirSync(dir)) this.files.set(f.toLowerCase(), f);
    const wld = this.ab(this.worldFile(`${this.name}.wld`));
    if (!wld) throw new Error(`Não achei ${this.name}.wld em ${dir}`);
    this.wld = parseWld(decodeText(wld));
    const rgn = this.ab(this.worldFile(`${this.name}.rgn`));
    const txt = this.ab(this.worldFile(`${this.name}.txt.txt`));
    if (rgn) this.respawns = parseRgn(decodeText(rgn), txt ? parseTxtTxt(decodeText(txt, "windows-1252")) : new Map()).respawns;
    const defines = new Map<string, number>();
    for (const f of DEFINE_FILES) { const b = this.ab(path.join(this.resDir, f)); if (b) parseDefines(decodeText(b, 'windows-1252'), defines); }
    const pm = this.ab(path.join(this.resDir, 'propMover.txt'));
    if (pm) {
      for (const line of new TextDecoder('windows-1252').decode(pm).split(/\r?\n/)) {
        const c = line.split('\t');
        const id = defines.get(c[0]?.trim());
        if (id === undefined) continue;
        const sp = Number(c[44]);
        if (sp > 0) this.moverSpeed.set(id, sp);
        if (c[46] && c[46].trim() !== '0' && c[46].trim() !== '=') this.flyingMovers.add(id);
        const n = (k: number) => { const v = Number((c[k] ?? '').trim()); return Number.isFinite(v) ? v : 0; };
        this.moverProps.set(id, {
          symbol: c[0].trim(), str: n(3), sta: n(4), dex: n(5), int: n(6), hr: n(7), er: n(8), belligerence: (c[10] ?? '').trim(), rank: (c[15] ?? '').trim(),
          level: Math.max(1, n(12)), atkMin: n(20), atkMax: n(21), atk1: (c[22] ?? '').trim(), attackSpeed: n(33), reAttackDelay: n(34),
          hp: Math.max(1, n(35)), naturalArmor: n(37), exp: n(62), correction: n(61), flying: this.flyingMovers.has(id),
          element: n(41) >= 0 && n(41) <= 5 ? n(41) : 0, elementLevel: Math.max(0, n(42)),
        });
      }
    }
    return this;
  }

  get tileSize() { return MAP_SIZE * this.wld.mpu; }

  /** atributo do terreno no ponto (0 normal, 1 NoWalk, 2 NoFly, 3 NoMove, 4 Die); tile sem arquivo → 0 */
  attrAt(x: number, z: number): number {
    const s = this.tileSize, tx = Math.floor(x / s), tz = Math.floor(z / s);
    const k = `${tx},${tz}`;
    let a = this.attrs.get(k);
    if (a === undefined) {
      const buf = this.ab(this.worldFile(tileFileName(this.name, tx, tz)));
      try { a = buf ? parseLnd(buf, tx, tz, this.wld.mpu).attrs : null; } catch { a = null; }
      this.attrs.set(k, a);
    }
    if (!a) return 0;
    const mpu = this.wld.mpu;
    const ix = Math.min(MAP_SIZE, Math.max(0, Math.round((x - tx * s) / mpu)));
    const iz = Math.min(MAP_SIZE, Math.max(0, Math.round((z - tz * s) / mpu)));
    return a[iz * (MAP_SIZE + 1) + ix];
  }

  walkable(x: number, z: number) { const a = this.attrAt(x, z); return a !== 1 && a !== 3 && a !== 4; }
}
