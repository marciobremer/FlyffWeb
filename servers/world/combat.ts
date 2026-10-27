import fs from 'node:fs';
import { TICKS_PER_SEC } from '../../shared/math';
import path from 'node:path';
import { decodeText } from '../../shared/formats/rgn';
import { parseDefines, parseModelTable } from '../../shared/formats/inc';
import { parseAni } from '../../shared/formats/chr';
import { motionOf } from '../../shared/motions';
import { fitsPart, type ItemCatalog, type ItemDef } from '../common/items';
import type { MoverProp } from './world';
import type { UpgradeRules } from './upgrade';
import { effectiveExpUp } from '../../shared/expup';

/**
 * Fórmulas de combate portadas do servidor original (Source/_Common/MoverAttack.cpp, MoverParam.cpp,
 * WORLDSERVER/AttackArbiter.cpp) — ataque normal corpo a corpo, jogador × monstro. Ficaram de fora por enquanto: skills,
 * buffs (GetParam = 0), propriedades elementais, bloqueio e PvP. Equipamentos entram como no original: defesa das peças
 * (com enchant), bônus de atributo/ataque/defesa/precisão/velocidade/HP/MP/FP (DST_*) somados a quem equipa (SetDestParam),
 * mais os bônus de conjunto (SetItem do propItemEtc.inc) conforme quantas peças do set estão equipadas.
 *
 *  acerto  GetAttackResult: jogador→mob  (HR·1.6/(HR+ER))·1.5·(nv·1.2/(nv+nvMob))·100; mob→jogador (HR·1.5/(HR+parry))·2·(nv·0.5/(nv+nvJog·0.3))·100;
 *          HR do jogador = DEX, parry = DEX·0.5; mob usa dwHR/dwER; limite 20–96 %
 *  ataque  GetHitMinMax + GetHitPower: jogador = arma.dwAbility×2 + GetWeaponATK (STR, nível, fator da classe) + enchant^1.5;
 *          mob = dwAtkMin/Max + dwAbility da arma do mob (dwAtk1); mob com nível maior: +5 % por nível (PostCalcDamage)
 *  defesa  CalcDefenseCore (ataque genérico): ((nv·2 + STA/2)/2.8 − 4) + (STA−14)·fatorDEF + defesaItens/4
 *  crítico DEX/10 × fator da classe (%) → dano ×2.3 (ApplyDPC)
 *  HP/MP/FP máximos: GetMaxOriginHitPoint/ManaPoint/FatiguePoint
 */
export interface JobProp {
  atkSpeed: number; maxHp: number; maxMp: number; maxFp: number; def: number; hpRec: number;
  swd: number; axe: number; staff: number; stick: number; knuckle: number; wand: number; blocking: number; yoyo: number; critical: number; bow: number;
}

/** personagem no combate (o que as fórmulas precisam) */
export interface Stats { str: number; sta: number; dex: number; int: number }
export interface Fighter {
  level: number; job: number;
  /** atributos TOTAIS (base + bônus dos equipamentos) — o que as fórmulas usam */
  str: number; sta: number; dex: number; int: number;
  /** atributos distribuídos pelo jogador (o que fica salvo) */
  base: Stats;
  /** arma na mão direita (ou nada = mão: II_WEA_HAN_HAND) e o enchant dela */
  weapon: ItemDef | null; weaponUpgrade: number;
  /** multiplicador do enchant da arma (GetItemMultiplier) */
  weaponMul: number;
  /** soma da defesa dos equipamentos (dwAbilityMin/Max, com enchant) */
  defMin: number; defMax: number;
  /** soma dos bônus DST_* dos equipamentos (DST → valor) */
  dst: Map<number, number>;
  /** precisão e esquiva extras (nAdjHitRate / dwParry dos itens) */
  adjHit: number; parry: number;
  /** elemento e nível da arma (ataque) e da suit (defesa) — [0, 0] sem elemento */
  wElem: [number, number]; sElem: [number, number];
  /** fAttackRate da raridade da arma da mão direita (__WEAPON_RARITY; 1 = Common) */
  wRare: number;
}

/** item equipado: definição, enchant, espaço (PARTS_*), cartas espetadas (piercing, 0 = furo vazio), elemento e joias da ultimate */
export interface Equipped { d: ItemDef; u: number; s: number; p?: number[]; e?: number; el?: number; g?: number[]; /** raridade da arma (WeaponRarity.inc) */ r?: number }

/** `float` do C++: int × float vira float (32 bits) antes do (int) — 10 × 1.3f dá 12, não 13 */
const f32mul = (a: number, b: number) => Math.trunc(Math.fround(a * Math.fround(b)));

export interface HitResult { hit: boolean; dmg: number; crit: boolean }

/** golpe sem a animação lida (ms a 1x) e o menor intervalo entre golpes (folga para a rede) */
const ATTACK_MOTION_MS = 900, ATTACK_MIN_MS = 250;

const rand = (min: number, max: number) => (max > min ? min + Math.floor(Math.random() * (max - min + 1)) : min);
const MIN_HR = 20;

export class CombatRules {
  readonly jobs = new Map<number, JobProp>();
  /** exp para passar do nível n para n+1 (expTable.inc, coluna EXP da linha n+1) */
  readonly expToNext: number[] = [];
  /** pontos de atributo ganhos ao chegar no nível n (coluna GP da linha n = dwLPPoint) */
  readonly gpAt: number[] = [];
  private hand: ItemDef | null;
  private wt: Record<string, number>;
  /** AR_SHORT, AR_LONG, AR_FAR, AR_RANGE, AR_WAND, AR_HRANGE, AR_HWAND (ids) */
  private ar: number[] = [];
  /** DST_* usados (id pelo nome) */
  readonly D: Record<string, number> = {};
  /** expUpitem (expTable.inc): bônus % por enchant — colunas arma, capacete, traje, luva, bota, escudo */
  private expUp: number[][] = [];
  /** Setitem do expTable.inc: bônus das 4 peças (traje, luva, bota, capacete) pelo menor enchant entre elas, +1…+10 —
   *  [precisão, bloqueio, HP máx. %, magia extra, todos os atributos] */
  private setUp: number[][] = [];
  private ik: { armor: number; armorEtc: number; helmet: number; suit: number; gauntlet: number; boots: number; shield: number };

  constructor(resDir: string, readonly items: ItemCatalog) {
    const read = (f: string) => { try { const b = fs.readFileSync(path.join(resDir, f)); return decodeText(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer, 'windows-1252'); } catch { return ''; } };
    for (const line of read('propJob.inc').split(/\r?\n/)) {
      const c = line.trim().split(/\s+/);
      const id = items.defines.get(c[0]);
      if (!c[0]?.startsWith('JOB_') || id === undefined || c.length < 18) continue;
      const v = c.slice(1, 18).map(Number);
      const [atkSpeed, maxHp, maxMp, maxFp, def, hpRec, , , swd, axe, staff, stick, knuckle, wand, blocking, yoyo, critical] = v;
      this.jobs.set(id, { atkSpeed, maxHp, maxMp, maxFp, def, hpRec, swd, axe, staff, stick, knuckle, wand, blocking, yoyo, critical, bow: Number(c[18]) || 1 });
    }
    const exp = read('expTable.inc');
    const block = exp.slice(exp.indexOf('{') + 1, exp.indexOf('}'));
    const rows = block.split(/\r?\n/).map((l) => l.replace(/\/\/.*$/, '').trim()).filter(Boolean).map((l) => l.split(/\s+/).map(Number));
    for (let lv = 0; lv + 1 < rows.length; lv++) this.expToNext[lv] = rows[lv + 1][0];
    for (let lv = 0; lv < rows.length; lv++) this.gpAt[lv] = rows[lv][2] || 0;
    this.hand = items.bySymbol.get('II_WEA_HAN_HAND') ?? null;
    for (const n of ['STR', 'STA', 'DEX', 'INT', 'ADJDEF', 'ADJDEF_RATE', 'ATKPOWER_RATE', 'CHR_DMG', 'ATTACKSPEED', 'ATTACKSPEED_RATE', 'ADJ_HITRATE', 'PARRY', 'HP_MAX', 'MP_MAX', 'FP_MAX', 'HP_MAX_RATE', 'MP_MAX_RATE', 'FP_MAX_RATE',
      'SWD_DMG', 'AXE_DMG', 'KNUCKLE_DMG', 'YOY_DMG', 'BOW_DMG', 'CRITICAL_BONUS', 'MONSTER_DMG', 'ATKPOWER', 'CHR_CHANCECRITICAL', 'STAT_ALLUP', 'SPEED', 'BLOCK_MELEE', 'BLOCK_RANGE', 'SPELL_RATE', 'PVP_DMG', 'ADDMAGIC']) this.D[n] = items.defines.get('DST_' + n) ?? -999;
    const dd = (s: string) => items.defines.get(s) ?? -1;
    this.ik = { armor: dd('IK2_ARMOR'), armorEtc: dd('IK2_ARMORETC'), helmet: dd('IK3_HELMET'), suit: dd('IK3_SUIT'), gauntlet: dd('IK3_GAUNTLET'), boots: dd('IK3_BOOTS'), shield: dd('IK3_SHIELD') };
    const up = exp.slice(exp.indexOf('expUpitem'));
    const ub = up.slice(up.indexOf('{') + 1, up.indexOf('}'));
    const su = exp.slice(exp.search(/^Setitem\b/m));
    this.setUp = su.slice(su.indexOf('{') + 1, su.indexOf('}')).split(/\r?\n/).map((l) => l.replace(/\/\/.*$/, '').trim()).filter(Boolean).map((l) => l.split(/\s+/).map(Number));
    // a tabela como o oficial a usa de fato (transbordo do m_aExpUpItem[6][11], shared/expup.ts)
    this.expUp = effectiveExpUp(ub.split(/\r?\n/).map((l) => l.replace(/\/\/.*$/, '').trim()).filter(Boolean).map((l) => l.split(/\s+/).map(Number)));
    const d = (s: string) => items.defines.get(s) ?? -1;
    this.ar = [d('AR_SHORT'), d('AR_LONG'), d('AR_FAR'), d('AR_RANGE'), d('AR_WAND'), d('AR_HRANGE'), d('AR_HWAND')];
    this.wt = { SWD: d('WT_MELEE_SWD'), AXE: d('WT_MELEE_AXE'), STICK: d('WT_MELEE_STICK'), KNUCKLE: d('WT_MELEE_KNUCKLE'), STAFF: d('WT_MELEE_STAFF'), WAND: d('WT_MAGIC_WAND'), YOYO: d('WT_MELEE_YOYO'), BOW: d('WT_RANGE_BOW') };
    this.loadAttackMotions(resDir);
  }

  /**
   * Duração (ms, a 1x) do golpe de cada postura de arma 0–15: média de MTI_ATK1/ATK2 (os que o cliente alterna) do personagem
   * (`Mvr_male_*.ani`; o feminino tem os mesmos quadros). No original a velocidade de ataque é o multiplicador dessa animação.
   */
  private attackMotionMs: number[] = [];
  private loadAttackMotions(resDir: string) {
    try {
      const txt = (f: string) => { const b = fs.readFileSync(path.join(resDir, f)); return decodeText(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer, 'windows-1252'); };
      const defines = parseDefines(txt('defineObj.h'));
      const male = parseModelTable(txt('mdlDyna.inc'), 5, defines).find((e) => e.type === 5 && e.id === defines.get('MI_MALE'));
      const dir = path.join(resDir, 'Data', 'Model');
      const files = new Map(fs.readdirSync(dir).map((f) => [f.toLowerCase(), f]));
      const ms = (symbol: string) => {
        const file = male?.motions?.find((m) => m.symbol === symbol)?.file;
        const real = file && files.get(`mvr_male_${file}.ani`.toLowerCase());
        if (!real) return null;
        const b = fs.readFileSync(path.join(dir, real));
        const m = parseAni(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer);
        return ((m.frameCount - 1) / (m.perSlerp * TICKS_PER_SEC)) * 1000;
      };
      for (let n = 0; n <= 15; n++) {
        const v = [1, 2].map((h) => ms(motionOf('atk', n, h)[0])).filter((x): x is number => x !== null && x > 0);
        this.attackMotionMs[n] = v.length ? v.reduce((a, b) => a + b, 0) / v.length : ATTACK_MOTION_MS;
      }
    } catch (e) { console.error('combate: não li as animações de golpe —', (e as Error).message); }
  }

  /**
   * Teto de nível por tipo de classe (MoverParam.cpp AddExperience): Vagrant 15 (MAX_JOB_LEVEL), 1ª classe 60 (15 + MAX_EXP_LEVEL 45),
   * 2ª classe em diante 120 (MAX_GENERAL_LEVEL). No teto da Vagrant/1ª classe a exp fica em 0 até mudar de classe.
   */
  levelCap(job: number) { return job === 0 ? 15 : job < 6 ? 60 : 120; }
  /** classes que o personagem pode escolher agora (OnSendJobChange): Vagrant no nv 15 → 4 classes; 1ª classe no nv 60 → as 2 dela */
  jobOptions(job: number, level: number): number[] {
    if (job === 0 && level === 15) return [1, 2, 3, 4];
    if (job >= 1 && job <= 4 && level === 60) return [[6, 7], [8, 9], [10, 11], [12, 13]][job - 1];
    return [];
  }

  /** pontos que um personagem do nível `level` já ganhou ao todo (níveis 2…level, como CMover::SetLevel) */
  totalGp(level: number) { let s = 0; for (let lv = 2; lv <= level; lv++) s += this.gpAt[lv] ?? 2; return s; }

  /** bônus % do enchant `u` para o tipo de item (GetExpUpItem): arma 0, capacete 1, traje 2, luva 3, bota 4, escudo 5 */
  private expUpFor(d: ItemDef, u: number) {
    if (u <= 0) return 0;
    const k = this.ik, col = d.kind3 === k.helmet ? 1 : d.kind3 === k.suit ? 2 : d.kind3 === k.gauntlet ? 3 : d.kind3 === k.boots ? 4 : d.kind3 === k.shield ? 5 : 0;
    return this.expUp[Math.min(u, this.expUp.length - 1)]?.[col] ?? 0;
  }

  /** soma de um bônus DST_* dos equipamentos */
  private dstOf(f: Fighter, name: string) { return f.dst.get(this.D[name]) ?? 0; }

  /**
   * Monta o lutador: atributos base + bônus dos equipamentos (SetEquipDstParam), defesa das peças (SumEquipDefenseAbility:
   * dwAbility × multiplicador do enchant + enchant^1.5), arma da mão direita (parte 10), precisão e esquiva dos itens.
   */
  buildFighter(ch: { level: number; job: number } & Stats, equipped: Equipped[], buffs: [number, number][] = []): Fighter {
    const dst = new Map<number, number>();
    for (const [k, v] of buffs) if (k > 0 && v) dst.set(k, (dst.get(k) ?? 0) + v); // buffs ativos somam como os itens
    let weapon: ItemDef | null = null, weaponUpgrade = 0, defMin = 0, defMax = 0, adjHit = 0, parry = 0;
    let wElem: [number, number] = [0, 0], sElem: [number, number] = [0, 0], wRare = 1;
    const add = (k: number, v: number) => { if (k > 0 && v) dst.set(k, (dst.get(k) ?? 0) + v); };
    for (const { d, u, s, p, e, el, g, r } of equipped) {
      // arma ultimate: joias engastadas (GetDestParamUltimate, só na mão direita)
      if (s === 10 && g?.length && this.upgrade) for (const [k, v] of this.upgrade.gemDst(g)) add(k, v);
      if (e && s === 10) wElem = [e, el ?? 0];
      if (e && s === 2) sElem = [e, el ?? 0];
      // raridade (SetDestParamEquip): os DST do item × fStatsRate, truncados
      const rare = this.items.rarityOf(r);
      for (let i = 0; i < d.dest.length; i++) add(d.dest[i], r ? f32mul(d.adj[i], rare.stats) : d.adj[i]);
      if (s === 10) wRare = rare.atk;
      // joia: bônus da linha do enchant dela (accessory.inc)
      for (const [k, v] of this.items.accessoryDst(d.id, u)) add(k, v);
      // piercing (DestParamPiercingAvail): os DST de cada carta espetada (blocos Piercing do propItemEtc.inc)
      for (const card of p ?? []) if (card) for (const [k, v] of this.items.piercingDst(card)) add(k, v);
      if (d.adjHit > 0) adjHit += d.adjHit;
      if (d.parry > 0) parry += d.parry;
      if (s === 10) { weapon = d; weaponUpgrade = u; }
      else if (d.kind2 === this.ik.armor || d.kind2 === this.ik.armorEtc) {
        const k = 1 + this.expUpFor(d, u) / 100, opt = u > 0 ? Math.floor(Math.pow(u, 1.5)) : 0;
        defMin += Math.floor(d.abilityMin * k) + opt; defMax += Math.floor(d.abilityMax * k) + opt;
      }
    }
    // conjuntos (SetDestParamSetItem): conta as peças de cada set equipadas no lugar certo e soma os bônus de 1…n peças
    const sets = new Set(equipped.map((e) => this.items.setByItem.get(e.d.id)).filter((x) => !!x));
    for (const set of sets) {
      // como o SetDestParamSetItem: conta cada item equipado do conjunto (um anel só vale uma vez, mesmo o set tendo 2 vagas de anel)
      const n = Math.min(set!.elems.length, equipped.filter((e) => this.items.setByItem.get(e.d.id) === set && set!.elems.some((el) => el.item === e.d.id && fitsPart(el.part, e.s))).length);
      for (const a of set!.avail) if (a.n <= n) dst.set(a.dst, (dst.get(a.dst) ?? 0) + a.adj);
    }
    // enchant do conjunto (GetSetItem + SetSetItemAvail): as 4 peças de armadura equipadas, qualquer set, pelo menor enchant
    const armor = [2, 4, 5, 6].map((part) => equipped.find((e) => e.s === part));
    const minUp = armor.every((e) => e) ? Math.min(...armor.map((e) => e!.u)) : 0;
    const su = minUp > 0 ? this.setUp[Math.min(minUp, this.setUp.length) - 1] : undefined;
    if (su) {
      const [hit, block, hpRate, magic, added] = su;
      add(this.D.ADJ_HITRATE, hit); add(this.D.BLOCK_RANGE, block); add(this.D.BLOCK_MELEE, block); add(this.D.HP_MAX_RATE, hpRate); add(this.D.ADDMAGIC, magic);
      for (const n of ['STR', 'DEX', 'INT', 'STA']) add(this.D[n], added);
    }
    const f: Fighter = { level: ch.level, job: ch.job, str: ch.str, sta: ch.sta, dex: ch.dex, int: ch.int, base: { str: ch.str, sta: ch.sta, dex: ch.dex, int: ch.int },
      weapon, weaponUpgrade, weaponMul: weapon ? 1 + this.expUpFor(weapon, weaponUpgrade) / 100 : 1, defMin, defMax, dst, adjHit, parry, wElem, sElem, wRare };
    const all = this.dstOf(f, 'STAT_ALLUP');
    f.str += this.dstOf(f, 'STR') + all; f.sta += this.dstOf(f, 'STA') + all; f.dex += this.dstOf(f, 'DEX') + all; f.int += this.dstOf(f, 'INT') + all;
    return f;
  }

  /** defesa (CalcDefenseCore, ataque genérico): atributos, defesa dos itens/4, DST_ADJDEF e DST_ADJDEF_RATE; `random` sorteia entre min e máx */
  private defense(f: Fighter, random: boolean) {
    const item = random ? rand(f.defMin, f.defMax) : Math.floor((f.defMin + f.defMax) / 2);
    // GetSta()/2 é divisão de inteiros no original
    const base = Math.trunc((f.level * 2 + Math.floor(f.sta / 2)) / 2.8 - 4 + (f.sta - 14) * this.job(f.job).def) + Math.floor(item / 4) + this.dstOf(f, 'ADJDEF');
    return Math.max(0, Math.floor(base * (1 + this.dstOf(f, 'ADJDEF_RATE') / 100)));
  }
  /** valores para a janela de personagem: defesa média contra mobs e chance de crítico (%) */
  showDefense(f: Fighter) { return this.defense(f, false); }
  /** dano crítico extra (%, DST_CRITICAL_BONUS de itens, sets e buffs): multiplica o golpe crítico */
  critBonus(f: Fighter) { return this.dstOf(f, 'CRITICAL_BONUS'); }
  /**
   * resto do "Detalhe" da janela de personagem (CWndCharInfo): bloqueio corpo a corpo e à distância (GetBlockMelee/Range,
   * 0–96%), redução do tempo de conjuração (GetSpellCastSpeed, DST_SPELL_RATE) e dano extra em monstro e em jogador (%)
   */
  panel(f: Fighter) {
    const block = (n: string) => Math.max(0, Math.min(96, this.dstOf(f, n)));
    // __STATISTICS: Speed = DST_SPEED cru (GetSpeedRun), Hit Rate = DST_ADJ_HITRATE (GetHitRate), Dodge = DST_PARRY ≥ 0 (GetDodgeRate)
    return { mBlock: block('BLOCK_MELEE'), rBlock: block('BLOCK_RANGE'), dct: this.dstOf(f, 'SPELL_RATE'), pvm: this.dstOf(f, 'MONSTER_DMG'), pvp: this.dstOf(f, 'PVP_DMG'),
      mvPct: this.dstOf(f, 'SPEED'), hit: this.dstOf(f, 'ADJ_HITRATE'), dodgeRate: Math.max(0, this.dstOf(f, 'PARRY')) };
  }
  critChance(f: Fighter) { return Math.max(0, Math.floor(Math.floor(f.dex / 10) * this.job(f.job).critical) + this.dstOf(f, 'CHR_CHANCECRITICAL')); }

  /**
   * Alcance do golpe normal (GetAttackRange do dwAttackRange da arma): AR_SHORT 2, LONG 3, FAR 4, RANGE 10, WAND 15, HRANGE 6, HWAND 18.
   * Arco e ioiô atacam de longe; sem arma, como AR_SHORT.
   */
  attackRange(f: Fighter) {
    const i = this.ar.indexOf(f.weapon?.attackRange ?? -1);
    return [2, 3, 4, 10, 15, 6, 18][i] ?? 2;
  }
  /** precisão (%) e esquiva do jogador, para a janela */
  hitBonus(f: Fighter) { return f.adjHit + this.dstOf(f, 'ADJ_HITRATE'); }
  /** chance de acerto contra um mob "médio" do mesmo nível (referência para a janela) */
  accuracy(f: Fighter) { return Math.max(0, this.hitBonus(f)); }
  dodge(f: Fighter) { return Math.floor(f.dex * 0.5 + f.parry + this.dstOf(f, 'PARRY')); }

  /** regras do ferreiro (joias da ultimate e fator de elemento); o realtime liga quando há inventário */
  upgrade: UpgradeRules | null = null;

  /** fSpeed do propMover dos personagens [MI_MALE, MI_FEMALE] (unidades por tique do Neuz, 16 ms); o startWorld lê do mundo */
  playerFSpeed: [number, number] = [0.1, 0.1];
  /**
   * velocidade de corrida (u/s): CMover::GetSpeed com __JEFF_11 (ligado no WorldServer e no Neuz) = fSpeed + fSpeed × DST_SPEED/1000
   * — o DST_SPEED de itens, sets, cartas e buffs vale por mil, não por cento —, a 62,5 tiques/s (passo de 16 ms do Neuz)
   */
  runSpeed(f: Fighter, sex: number) {
    const base = this.playerFSpeed[sex === 1 ? 1 : 0] || 0.1;
    return Math.max(0, base * (1 + this.dstOf(f, 'SPEED') / 1000)) * TICKS_PER_SEC;
  }

  job(j: number): JobProp { return this.jobs.get(j) ?? this.jobs.get(0) ?? { atkSpeed: 75, maxHp: 0.9, maxMp: 0.3, maxFp: 0.3, def: 1, hpRec: 1.2, swd: 4.5, axe: 5.5, staff: 0.8, stick: 3, knuckle: 5, wand: 6, blocking: 0.2, yoyo: 4.2, critical: 1, bow: 1 }; }

  maxHp(f: Fighter) { const a = (this.job(f.job).maxHp * f.level) / 2; const v = Math.floor(a * ((f.level + 1) / 4) * (1 + f.sta / 50) + f.sta * 10 + 80) + this.dstOf(f, 'HP_MAX'); return Math.max(1, Math.floor(v * (1 + this.dstOf(f, 'HP_MAX_RATE') / 100))); }
  maxMp(f: Fighter) { const k = this.job(f.job).maxMp; const v = Math.floor((f.level * 2 + f.int * 8) * k + 22 + f.int * k) + this.dstOf(f, 'MP_MAX'); return Math.max(1, Math.floor(v * (1 + this.dstOf(f, 'MP_MAX_RATE') / 100))); }
  maxFp(f: Fighter) { const k = this.job(f.job).maxFp; const v = Math.floor((f.level * 2 + f.sta * 6) * k + f.sta * k) + this.dstOf(f, 'FP_MAX'); return Math.max(1, Math.floor(v * (1 + this.dstOf(f, 'FP_MAX_RATE') / 100))); }

  /** velocidade de ataque (GetAttackSpeed): A = classe + arma·(4·DEX + nv/8) − 3 → 50/(200−A)/2 + tabela, mais DST; limitada a 0,1–2 */
  attackSpeed(f: Fighter) {
    const w = f.weapon ?? this.hand;
    const A = Math.min(187, Math.floor(this.job(f.job).atkSpeed + (w?.attackSpeed ?? 0) * (4 * f.dex + f.level / 8) - 3));
    const plus = [0.08, 0.16, 0.24, 0.32, 0.4, 0.48, 0.56, 0.64, 0.72, 0.8, 0.88, 0.96, 1.04, 1.12, 1.2, 1.3, 1.38, 1.5][Math.max(0, Math.min(17, Math.floor(A / 10)))];
    let v = 50 / (200 - A) / 2 + plus + this.dstOf(f, 'ATTACKSPEED') / 1000;
    const rate = this.dstOf(f, 'ATTACKSPEED_RATE');
    if (rate > 0) v += (v * rate) / 100;
    return Math.max(0.1, Math.min(2, v));
  }
  /**
   * intervalo entre golpes do jogador (ms): a animação de golpe da postura da arma (`posture` = MTI_ATK*_NN) tocada na
   * velocidade de ataque, como no original (o golpe do knuckle dura 0,53 s a 1x; o da espada 0,57 s)
   */
  attackInterval(f: Fighter, posture = 0) {
    const base = this.attackMotionMs[posture] ?? this.attackMotionMs[0] ?? ATTACK_MOTION_MS;
    return Math.round(Math.max(ATTACK_MIN_MS, Math.min(3000, base / this.attackSpeed(f))));
  }

  /** GetWeaponATK: bônus de ataque pelo tipo de arma, STR/INT/DEX, nível e fator da classe */
  private weaponAtk(f: Fighter, wt: number) {
    const j = this.job(f.job), W = this.wt;
    const bonus = (n: string) => this.dstOf(f, n);
    if (wt === W.SWD) return Math.floor((f.str - 12) * j.swd + f.level * 1.1) + bonus('SWD_DMG');
    if (wt === W.AXE) return Math.floor((f.str - 12) * j.axe + f.level * 1.2) + bonus('AXE_DMG');
    if (wt === W.STAFF) return Math.floor((f.str - 10) * j.staff + f.level * 1.1);
    if (wt === W.STICK) return Math.floor((f.str - 10) * j.stick + f.level * 1.3);
    if (wt === W.KNUCKLE) return Math.floor((f.str - 10) * j.knuckle + f.level * 1.2) + bonus('KNUCKLE_DMG');
    if (wt === W.WAND) return Math.floor((f.int - 10) * j.wand + f.level * 1.2);
    if (wt === W.YOYO) return Math.floor((f.str - 12) * j.yoyo + f.level * 1.1) + bonus('YOY_DMG');
    if (wt === W.BOW) return Math.floor(((f.dex - 14) * j.bow + f.level * 1.3 + f.str * 0.2) * 0.7) + bonus('BOW_DMG');
    return 0;
  }

  /** ataque mínimo/máximo do jogador (GetHitMinMax) — também mostrado na janela de status no futuro */
  playerAtk(f: Fighter): [number, number] {
    const w = f.weapon ?? this.hand;
    if (!w) return [1, 2];
    let min = w.abilityMin * 2, max = w.abilityMax * 2;
    const plus = this.weaponAtk(f, w.weaponType) + this.dstOf(f, 'CHR_DMG');
    min += plus; max += plus;
    if (f.weapon) { min = Math.floor(min * f.weaponMul); max = Math.floor(max * f.weaponMul); }
    if (f.weapon && f.weaponUpgrade > 0) { const v = Math.floor(Math.pow(f.weaponUpgrade, 1.5)); min += v; max += v; }
    // raridade da arma: × fAttackRate depois do enchant
    if (f.weapon && f.wRare !== 1) { min = f32mul(min, f.wRare); max = f32mul(max, f.wRare); }
    return [Math.max(1, min), Math.max(1, max)];
  }

  /** ataque mostrado na janela: GetHitMinMax × DST_ATKPOWER_RATE (cartas Lighting, buffs) + DST_ATKPOWER, como no golpe */
  shownAtk(f: Fighter): [number, number] {
    const [a, b] = this.playerAtk(f), k = this.dstOf(f, 'ATKPOWER'), r = 1 + this.dstOf(f, 'ATKPOWER_RATE') / 100;
    return [Math.floor(a * r) + k, Math.floor(b * r) + k];
  }
  /**
   * ataque da janela H (CWndCharInfo::RenderATK): média do mínimo e máximo do GetHitMinMax; o DST_ATKPOWER_RATE (se positivo)
   * em cima dessa média, em inteiros; depois o DST_ATKPOWER
   */
  shownAtkValue(f: Fighter) {
    const [a, b] = this.playerAtk(f), rate = this.dstOf(f, 'ATKPOWER_RATE');
    let v = Math.trunc((a + b) / 2);
    if (rate > 0) v += Math.trunc((v * rate) / 100);
    return Math.max(0, v + this.dstOf(f, 'ATKPOWER'));
  }
  /** todos os bônus DST_* somados (itens, joias, cartas, sets, buffs) para a janela de status */
  bonusList(f: Fighter): [number, number][] { return [...f.dst].filter(([k, v]) => k > 0 && v !== 0).sort((x, y) => x[0] - y[0]); }

  private mobAtk(m: MoverProp): [number, number] {
    let min = m.atkMin, max = m.atkMax;
    const w = m.atk1 ? this.items.bySymbol.get(m.atk1) : undefined;
    if (w) { min += w.abilityMin; max += w.abilityMax; }
    return [min, max];
  }

  /** CalcDefenseCore (ataque genérico) do jogador e do mob */
  private playerDef(f: Fighter) { return this.defense(f, true); }
  private mobDef(m: MoverProp) {
    return Math.max(0, Math.floor((m.level * 2 + m.sta / 2) / 2.8 - 4 + (m.sta - 14)) + Math.floor(m.naturalArmor / 4));
  }

  private chance(p: number) { return Math.random() * 100 < Math.max(MIN_HR, Math.min(96, p)); }

  /** golpe do jogador no mob (GetAttackResult + GetHitPower + PostCalcGeneric) */
  playerHitsMob(f: Fighter, m: MoverProp): HitResult {
    const hr = f.dex;
    const rate = Math.floor(((hr * 1.6) / (hr + m.er)) * 1.5 * ((f.level * 1.2) / (f.level + m.level)) * 100) + this.hitBonus(f);
    if (!this.chance(rate)) return { hit: false, dmg: 0, crit: false };
    let [min, max] = this.playerAtk(f);
    const crit = Math.random() * 100 < this.critChance(f);
    if (crit) {
      // crítico: 1,1–1,4× (1,2–2,0× contra mob de nível menor), mais DST_CRITICAL_BONUS
      const [a, b] = f.level > m.level ? [1.2, 2.0] : [1.1, 1.4];
      const bonus = Math.max(1, 1 + this.dstOf(f, 'CRITICAL_BONUS') / 100);
      min = Math.floor(min * a * bonus); max = Math.floor(max * b * bonus);
    }
    // DST_ATKPOWER soma depois dos multiplicadores (AttackArbiter: nATK += GetParam(DST_ATKPOWER))
    // elemento da arma contra o do mob (GetDamagePropertyFactor, n/10000)
    const elem = 1 + (this.upgrade?.elementFactor(f.wElem[0], f.wElem[1], m.element, m.elementLevel) ?? 0) / 10000;
    const atk = Math.floor(rand(min, max) * elem * (1 + this.dstOf(f, 'ATKPOWER_RATE') / 100) * (1 + this.dstOf(f, 'MONSTER_DMG') / 100)) + this.dstOf(f, 'ATKPOWER');
    // AttackArbiter (__WEAPON_RARITY): o golpe pronto × fAttackRate de novo
    return { hit: true, dmg: Math.max(1, (f.wRare !== 1 ? f32mul(atk, f.wRare) : atk) - this.mobDef(m)), crit };
  }

  /** golpe do mob no jogador */
  mobHitsPlayer(m: MoverProp, f: Fighter): HitResult {
    const parry = this.dodge(f);
    const rate = ((m.hr * 1.5) / (m.hr + parry)) * 2 * ((m.level * 0.5) / (m.level + f.level * 0.3)) * 100;
    if (!this.chance(rate)) return { hit: false, dmg: 0, crit: false };
    const [min, max] = this.mobAtk(m);
    let atk = rand(min, max);
    if (m.level > f.level) atk = Math.floor(atk * (1 + 0.05 * (m.level - f.level)));
    const crit = Math.random() * 100 < Math.floor(m.dex / 10);
    if (crit) atk = Math.floor(atk * (f.level > m.level ? 1.4 + Math.random() * 0.4 : 1.1 + Math.random() * 0.3));
    // elemento do mob contra o da suit (GetDamagePropertyFactor: a suit é a defesa de elemento do jogador)
    atk = Math.max(0, Math.floor(atk * (1 + (this.upgrade?.elementFactor(m.element, m.elementLevel, f.sElem[0], f.sElem[1]) ?? 0) / 10000)));
    // o mob sempre causa ao menos 10 % do ataque dele (PostCalcGeneric)
    return { hit: true, dmg: Math.max(1, atk - this.playerDef(f), Math.floor(atk * 0.1)), crit };
  }

  /**
   * Exp por matar o mob (nExpValue do propMover). Penalidade simples por diferença de nível, no espírito do original:
   * mob 5+ níveis abaixo dá menos (−20 % por nível além de 4, mínimo 10 %).
   */
  expFor(m: MoverProp, playerLevel: number) {
    const diff = playerLevel - m.level;
    const k = diff >= 5 ? Math.max(0.1, 1 - (diff - 4) * 0.2) : 1;
    return Math.max(diff >= 5 ? 0 : 1, Math.floor(m.exp * k));
  }

  /** a mob é pacífica (não revida)? */
  peaceful(m: MoverProp) { return m.belligerence === 'BELLI_PEACEFUL'; }
}
