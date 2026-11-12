import fs from 'node:fs';
import { jobCanUse } from '../../shared/jobuse';
import { applyPatch, blankItem, readItemsCustom, type ItemsCustom } from './items-custom';
import path from 'node:path';
import { parseDefines } from '../../shared/formats/inc';
import { decodeText } from '../../shared/formats/rgn';
import { nameTable } from './names';

/**
 * Catálogo de itens lido da pasta Resource: `Spec_Item.txt` (o propItem novo; cai para `propItem.txt` se não existir),
 * nomes de `propItem.txt.txt` (IDS_PROPITEM_TXT_* → texto) e os números dos símbolos II_* / PARTS_* / IK* dos defines.
 * As colunas são achadas pelo cabeçalho (`//dwID`, `szName`, `szIcon`…), então funciona com as duas versões do arquivo.
 */
export interface ItemDef {
  id: number; symbol: string; name: string; icon: string;
  /** quantos empilham num slot (1 = não empilha) */
  packMax: number;
  /** PARTS_* onde equipa; -1 = não é equipamento */
  parts: number;
  /** 0 masculino, 1 feminino, -1 qualquer */
  sex: number;
  /** nível pedido para usar (dwLimitLevel1; sem ele, dwItemLV) */
  level: number; kind1: number; kind2: number; kind3: number; cost: number;
  /** dwAbilityMin/Max: ataque da arma ou defesa da armadura */
  abilityMin: number; abilityMax: number;
  /** dwWeaponType (WT_*) e dwAttackSpeed (fator de velocidade da arma) */
  weaponType: number; attackSpeed: number;
  /** dwItemRare: "nível de raridade" usado pelo DropKind dos mobs e pelas lojas por categoria (AddVendorItem) */
  rare: number;
  /** dwShopAble: -1 = não aparece nas lojas por categoria */
  shopAble: number;
  /** efeitos ao usar: dwDestParam1–3 (DST_*) com nAdjParamVal1–3, e a espera dwSkillReady (ms) */
  dest: number[]; adj: number[]; ready: number;
  /** nAdjHitRate e dwParry: precisão e esquiva extras do equipamento */
  adjHit: number; parry: number;
  /** dwSndAttack1 (ao golpear) e dwSndAttack2 (ao acertar): ids SND_* (-1 = nenhum) */
  snd1: number; snd2: number;
  /** efeito do golpe normal: no alvo (dwSfxObj3, ex.: XI_HIT_SWORD01) e em quem golpeia (dwSfxObj5); -1 = nenhum */
  sfx3: number; sfx5: number;
  /** dwAttackRange (AR_*): alcance do golpe da arma — ver attackRangeOf */
  attackRange: number;
  /** dwItemJob (JOB_*): classe que pode usar (-1 = qualquer) — ver jobCanUse; dwHanded: 1 uma mão, 2 duas mãos */
  job: number; handed: number;
  /** prancha/vassoura (IK3_BOARD/IK3_STICK): fFlightSpeed (velocidade), fFlightLRAngle e fFlightTBAngle (giro para os lados e
   * para cima/baixo, graus por tique) — undefined nos outros itens */
  fly?: [number, number, number];
  /** voo: conjunto de movimentos (dwUseMotion MTI_FSTAND1_X → 'X': A vassoura, B prancha, C bike, D asas, F outros) */
  rideMotion?: string;
  /** dwBasePartsIgnore: peça base (PARTS_*) que o item esconde ao equipar — ex. chapéu/cabelo de cash esconde o cabelo; -1 = nenhuma */
  ignorePart: number;
  /** dwItemGrade (defineItemGrade.h): 100 comum, 200 unique (verde), 300 ultimate, 400 baruna */
  grade: number;
  /** eItemType (_FIRE 1, _WATER 2, _ELECTRICITY 3, _WIND 4, _EARTH 5; 0 nenhum): elemento da carta de elemento e da arma */
  element: number;
  /**
   * dwReferStat1: arma geral/unique/ultimate (WEAPON_GENERAL 0, UNIQUE 1, ULTIMATE 2; -1 outros); dwReferStat2: DST_* que a joia
   * de arma ultimate dá; dwReferTarget1: item em que a arma vira ao converter (geral → unique → ultimate); dwReferTarget2: chance
   * própria da conversão (n/1.000.000), -1 = a do Ultimate_UltimateWeapon.txt
   */
  referStat1: number; referStat2: number; referTarget1: number; referTarget2: number;
  /** descrição (szComment: texto entre aspas ou IDS_* do propItem.txt.txt) */
  desc?: string;
  /** visual: símbolo II_* de outro item cujo modelo aparece no personagem (itens criados no painel admin) */
  look?: string;
  /** dwLinkKind: no pet coletor (IK3_PET), o MI_* que aparece seguindo o dono; -1 = nenhum */
  linkKind?: number;
}

/**
 * Arma que ocupa as duas mãos (não deixa usar escudo). O bastão (IK3_CHEERSTICK) vem como HD_TWO nos dados, mas neste
 * servidor Assist/Ringmaster/Billposter usam bastão (ou knuckle) com escudo — então ele conta como uma mão.
 */
export const twoHanded = (d: ItemDef) => d.handed === 2 && d.kind3 !== 4;

export { jobCanUse };

/**
 * Conjunto (SetItem do propItemEtc.inc): peças (item + PARTS_* onde precisa estar equipada) e bônus por quantidade
 * equipada — cada linha do Avail vale quando há `n` ou mais peças, e as linhas se somam (CSetItem::GetItemAvail, bAll).
 */
export interface SetDef { id: number; name: string; elems: { item: number; part: number }[]; avail: { dst: number; adj: number; n: number }[] }

/**
 * Colunas do Spec_Item.txt das versões novas (FLSpecManager::LoadSpecItem), que vem sem a linha de nomes — só descrições em
 * coreano. Mesma ordem do arquivo; MAX_ITEM_PARAM = 6.
 */
/** token do CScript: string entre aspas ("" escapa aspas) ou sequência sem espaço */
const TOKEN = /"(?:[^"]|"")*"|\S+/g;
const SPEC_COLUMNS = [
  'ver', 'dwID', 'szName', 'dwNum', 'dwPackMax', 'dwItemKind1', 'dwItemKind2', 'dwItemKind3', 'dwItemJob', 'bPermanence', 'dwUseable', 'dwItemSex',
  'dwCost', 'dwEndurance', 'nAbrasion', 'nMaxRepair', 'dwHanded', 'dwFlag', 'dwParts', 'dwPartsub', 'bPartFile', 'dwExclusive', 'dwBasePartsIgnore',
  'dwItemLV', 'dwItemRare', 'dwShopAble', 'bLog', 'bCharged', 'dwLinkKindBullet', 'dwLinkKind', 'dwAbilityMin', 'dwAbilityMax', 'eItemType',
  'wItemEAtk', 'dwParry', 'dwBlockRating', 'dwAddSkillMin', 'dwAddSkillMax', 'dwAtkStyle', 'dwWeaponType', 'dwItemAtkOrder1', 'dwItemAtkOrder2',
  'dwItemAtkOrder3', 'dwItemAtkOrder4', 'bContinuousPain', 'dwShellQuantity', 'dwRecoil', 'dwLoadingTime', 'nAdjHitRate', 'dwAttackSpeed',
  'dwDmgShift', 'dwAttackRange', 'nProbability',
  ...[1, 2, 3, 4, 5, 6].map((i) => `dwDestParam${i}`), ...[1, 2, 3, 4, 5, 6].map((i) => `nAdjParamVal${i}`),
  ...[1, 2, 3, 4, 5, 6].map((i) => `dwChgParamVal${i}`), ...[1, 2, 3, 4, 5, 6].map((i) => `nDestData1_${i}`),
  'dwActiveSkill', 'dwActiveSkillLv', 'dwActiveSkillRate', 'dwReqMp', 'dwReqFp', 'dwReqDisLV', 'dwReSkill1', 'dwReSkillLevel1', 'dwReSkill2',
  'dwReSkillLevel2', 'dwSkillReadyType', 'dwSkillReady', 'dwSkillRange', 'dwSfxElemental', 'dwSfxObj', 'dwSfxObj2', 'dwSfxObj3', 'dwSfxObj4',
  'dwSfxObj5', 'dwUseMotion', 'dwCircleTime', 'dwSkillTime', 'dwExeTarget', 'dwUseChance', 'dwSpellRegion', 'dwSpellType', 'dwReferStat1',
  'dwReferStat2', 'dwReferTarget1', 'dwReferTarget2', 'dwReferValue1', 'dwReferValue2', 'dwSkillType', 'fResistElecricity', 'fResistFire',
  'fResistWind', 'fResistWater', 'fResistEarth', 'nEvildoing', 'dwExpertLV', 'ExpertMax', 'dwSubDefine', 'dwExp', 'dwComboStyle', 'fFlightSpeed',
  'fFlightLRAngle', 'fFlightTBAngle', 'dwFlightLimit', 'dwFFuelReMax', 'dwAFuelReMax', 'dwFuelRe', 'dwLimitLevel1', 'nReflect', 'dwSndAttack1',
  'dwSndAttack2', 'szIcon', 'dwQuestID', 'szTextFile', 'szComment', 'nMinLimitLevel', 'nMaxLimitLevel',
];

const DEFINE_FILES = ['defineSound.h', 'defineObj.h', 'define.h', 'defineNeuz.h', 'defineItem.h', 'defineItemkind.h', 'defineJob.h', 'defineWorld.h', 'defineAttribute.h', 'defineSkill.h', 'defineItemGrade.h'];

/** PARTS_* que aparecem na janela de inventário (os demais não são equipáveis por aqui ainda) */
export const EQUIP_PARTS = new Set([2, 4, 5, 6, 8, 9, 10, 11, 12, 13, 19, 20, 21, 22, 23, 25, 26, 27, 28, 29]);
/** peças com dois espaços (anel e brinco): qualquer um dos dois serve */
const PAIR: Record<number, number> = { 20: 21, 21: 20, 22: 23, 23: 22 };
/** espaço do inventário aceita o item? */
export const fitsPart = (itemParts: number, slot: number) => itemParts === slot || PAIR[itemParts] === slot;

export class ItemCatalog {
  readonly byId = new Map<number, ItemDef>();
  readonly bySymbol = new Map<string, ItemDef>();
  /** todos os #define dos .h lidos (II_*, JOB_*, WT_*…) */
  readonly defines = new Map<string, number>();
  /** conjuntos (SetItem) e, para cada item que faz parte de um, o conjunto dele */
  readonly sets: SetDef[] = [];
  readonly setByItem = new Map<number, SetDef>();
  /**
   * Bônus das joias por enchant (CAccessoryProperty, accessory.inc): item → enchant → DST_* e valor. Vale no lugar do
   * enchant das armas/armaduras: um anel +5 soma os DST da linha 5 (não acumula com as linhas abaixo).
   */
  readonly accessory = new Map<number, Map<number, [number, number][]>>();
  /** IK3_SOCKETCARD: carta que vai nos furos de piercing da suit */
  suitCardKind = -1;
  /**
   * Bônus de cada carta espetada (CPiercingAvail, blocos `Piercing II_* { DST_* valor … }` do propItemEtc.inc). As cartas
   * não têm DST no Spec_Item: o bônus vem só daqui (ex.: Volcano = HP máx. +7%, Lighting = ataque +7%).
   */
  readonly piercing = new Map<number, [number, number][]>();
  /**
   * Raridade da arma (__WEAPON_RARITY, WeaponRarity.inc): por nível, nome, cor (0xAARRGGBB), multiplicador do ataque
   * (GetHitMinMax e o golpe) e dos DST do item (SetDestParamEquip). Nível 0 = Common (×1).
   */
  readonly rarity: { name: string; color: number; atk: number; stats: number }[] = [];

  /** `useNames`: aplica a tabela de nomes por símbolo (servers/common/names.ts); false = só os textos do Resource */
  constructor(readonly resDir: string, private useNames = true) {}

  private read(file: string): string | null {
    try { const b = fs.readFileSync(path.join(this.resDir, file)); return decodeText(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer, 'windows-1252'); } catch { return null; }
  }

  load() {
    const defines = this.defines;
    for (const f of DEFINE_FILES) { const t = this.read(f); if (t) parseDefines(t, defines); }
    const names = new Map<string, string>();
    const nt = this.read('propItem.txt.txt');
    if (nt) for (const line of nt.split(/\r?\n/)) { const i = line.indexOf('\t'); if (i > 0 && !line.slice(i + 1).trim().startsWith('IDS_')) names.set(line.slice(0, i).trim(), line.slice(i + 1).trim()); }

    const text = this.read('Spec_Item.txt') ?? this.read('propItem.txt');
    if (!text) { console.warn('Itens: Spec_Item.txt/propItem.txt não encontrado'); return this; }
    const lines = text.split(/\r?\n/);
    // o cabeçalho é a linha com os nomes das colunas (`dwID`…); versões mais novas têm antes linhas de descrição em coreano
    // sem essa linha (Spec_Item novo, só descrições), usa a ordem do FLSpecManager::LoadSpecItem
    const found = lines.findIndex((l) => /(^|\t)(\/\/)?dwID(\t|$)/.test(l));
    const hi = found >= 0 ? found : lines.findIndex((l) => !l.startsWith('//')) - 1;
    const head = found >= 0 ? lines[hi].split('\t').map((h) => h.replace(/^\/\//, '').trim()) : SPEC_COLUMNS;
    const col = (n: string) => head.indexOf(n);
    const C = {
      id: col('dwID'), name: col('szName'), pack: col('dwPackMax'), k1: col('dwItemKind1'), k2: col('dwItemKind2'), k3: col('dwItemKind3'),
      sex: col('dwItemSex'), cost: col('dwCost'), parts: col('dwParts'), lv: col('dwItemLV'), limit: col('dwLimitLevel1'), icon: col('szIcon'),
      amin: col('dwAbilityMin'), amax: col('dwAbilityMax'), wt: col('dwWeaponType'), aspd: col('dwAttackSpeed'), rare: col('dwItemRare'), shop: col('dwShopAble'),
      d1: col('dwDestParam1'), d2: col('dwDestParam2'), d3: col('dwDestParam3'), d4: col('dwDestParam4'), d5: col('dwDestParam5'), d6: col('dwDestParam6'),
      a1: col('nAdjParamVal1'), a2: col('nAdjParamVal2'), a3: col('nAdjParamVal3'), a4: col('nAdjParamVal4'), a5: col('nAdjParamVal5'), a6: col('nAdjParamVal6'),
      ready: col('dwSkillReady'), range: col('dwAttackRange'), job: col('dwItemJob'), hand: col('dwHanded'), hit: col('nAdjHitRate'), parry: col('dwParry'), sa1: col('dwSndAttack1'), sa2: col('dwSndAttack2'), x3: col('dwSfxObj3'), x5: col('dwSfxObj5'),
      ignore: col('dwBasePartsIgnore'), grade: col('dwItemGrade'), elem: col('eItemType'),
      cm: col('szComment'), link: col('dwLinkKind'), rs1: col('dwReferStat1'), rs2: col('dwReferStat2'), rt1: col('dwReferTarget1'), rt2: col('dwReferTarget2'), fs: col('fFlightSpeed'), flr: col('fFlightLRAngle'), ftb: col('fFlightTBAngle'),
    };
    const float = (v: string | undefined) => { const n = Number((v ?? '').trim()); return Number.isFinite(n) ? n : 0; };
    if (C.id < 0 || C.icon < 0) { console.warn('Itens: cabeçalho do arquivo de itens não reconhecido'); return this; }
    /** número ou símbolo; '=' (vazio) → def */
    const num = (v: string | undefined, def: number) => {
      const s = (v ?? '').trim();
      if (!s || s === '=') return def;
      if (/^-?\d+$/.test(s)) return Number(s);
      return defines.get(s) ?? def;
    };
    for (const line of lines.slice(hi + 1)) {
      if (line.startsWith('//')) continue;
      // o CScript do original separa por qualquer espaço (aspas com "" de escape); ~1/3 das linhas do Spec_Item misturam
      // espaços e tabs ("II_X   "Nome"", "1  1"), então o split por tab desalinha as colunas — usa os tokens quando batem
      const toks = line.match(TOKEN);
      const c = toks && toks.length === head.length ? toks : line.split('\t');
      if (c.length <= C.icon) continue;
      const symbol = c[C.id].trim();
      const id = defines.get(symbol);
      if (id === undefined) continue;
      const def: ItemDef = {
        id, symbol, name: names.get(c[C.name]?.trim()) || (c[C.name]?.startsWith('"') ? c[C.name].replace(/"/g, '').trim() : '') || symbol, icon: c[C.icon].replace(/"/g, '').trim(),
        packMax: Math.max(1, num(c[C.pack], 1)), parts: num(c[C.parts], -1), sex: num(c[C.sex], -1), level: (C.limit >= 0 && num(c[C.limit], 0) > 0 && num(c[C.limit], 0) < 1000 ? num(c[C.limit], 0) : num(c[C.lv], 0)),
        kind1: num(c[C.k1], 0), kind2: num(c[C.k2], 0), kind3: num(c[C.k3], 0), cost: num(c[C.cost], 0),
        abilityMin: num(c[C.amin], 0), abilityMax: num(c[C.amax], 0), weaponType: num(c[C.wt], 0), attackSpeed: float(c[C.aspd]), rare: num(c[C.rare], 0), shopAble: C.shop < 0 ? 1 : num(c[C.shop], -1),
        dest: [C.d1, C.d2, C.d3, C.d4, C.d5, C.d6].map((k) => (k < 0 ? -1 : num(c[k], -1))), adj: [C.a1, C.a2, C.a3, C.a4, C.a5, C.a6].map((k) => (k < 0 ? 0 : num(c[k], 0))), ready: Math.max(0, num(c[C.ready], 0)),
        adjHit: C.hit < 0 ? 0 : num(c[C.hit], 0), parry: C.parry < 0 ? 0 : num(c[C.parry], 0),
        snd1: C.sa1 < 0 ? -1 : num(c[C.sa1], -1), snd2: C.sa2 < 0 ? -1 : num(c[C.sa2], -1),
        sfx3: C.x3 < 0 ? -1 : num(c[C.x3], -1), sfx5: C.x5 < 0 ? -1 : num(c[C.x5], -1),
        attackRange: C.range < 0 ? 0 : num(c[C.range], 0),
        job: C.job < 0 ? -1 : num(c[C.job], -1), handed: C.hand < 0 ? 1 : num(c[C.hand], 1),
        ignorePart: C.ignore < 0 ? -1 : num(c[C.ignore], -1),
        // a raridade vem como símbolo ITEM_GRADE_*; várias linhas têm colunas a mais/menos, então procura o símbolo na linha
        grade: num(c.find((v) => /^ITEM_GRADE_[A-Z]+$/.test(v.trim())) ?? (C.grade >= 0 ? c[C.grade] : undefined), 100) || 100,
        element: C.elem < 0 ? 0 : num(c[C.elem], 0),
        // NULL_ID (0xffffffff) e lixo viram -1
        referStat1: C.rs1 < 0 ? -1 : num(c[C.rs1], -1), referStat2: C.rs2 < 0 ? -1 : num(c[C.rs2], -1),
        referTarget1: C.rt1 < 0 ? -1 : num(c[C.rt1], -1), referTarget2: C.rt2 < 0 ? -1 : num(c[C.rt2], -1),
      };
      if (C.cm >= 0) { const cm = (c[C.cm] ?? '').trim(); const t = cm.startsWith('"') ? cm.replace(/"/g, '').trim() : names.get(cm) ?? ''; if (t && t !== '=') def.desc = t; }
      if (C.link >= 0) { const lk = num(c[C.link], -1); if (lk > 0) def.linkKind = lk; }
      if (def.element < 0 || def.element > 5) def.element = 0;
      // 0 arma geral, 1 unique, 2 ultimate, 3 armadura de set (ARMOR_SET: fail stack próprio do UpgradeSuccess.inc)
      if (def.referStat1 > 3) def.referStat1 = -1;
      for (const k of ['referStat2', 'referTarget1', 'referTarget2'] as const) if (def[k] >= 0x7fffffff || def[k] < 0) def[k] = -1;
      if (def.parts === 13) { // PARTS_RIDE: prancha, vassoura, bike, asas…
        def.fly = [float(c[C.fs]), float(c[C.flr]), float(c[C.ftb])];
        // como a raridade, procura o símbolo na linha (algumas têm colunas a mais/menos)
        def.rideMotion = /^MTI_FSTAND1_([A-Z])$/.exec((c.find((v) => /^MTI_FSTAND1_[A-Z]$/.test(v.trim())) ?? '').trim())?.[1];
      }
      if (def.ignorePart > 40) def.ignorePart = -1; // NULL_ID (0xffffffff) e afins
      if (def.job > 40) def.job = -1; // coluna com lixo (NULL_ID e afins): sem restrição
      if (def.sex !== 0 && def.sex !== 1) def.sex = -1;
      this.byId.set(id, def);
      this.bySymbol.set(symbol, def);
    }
    this.loadSets();
    this.loadAccessory();
    this.loadRarity();
    this.loadPacks();
    this.loadGifts();
    this.suitCardKind = defines.get('IK3_SOCKETCARD') ?? -1;
    const table = this.useNames ? nameTable() : null;
    if (table) {
      for (const d of this.byId.values()) { const n = table.items[d.symbol]; if (n) d.name = n; }
      for (const s of this.sets) { const first = this.byId.get(s.elems[0]?.item)?.symbol; const n = first && table.sets[first]; if (n) s.name = n; }
    }
    this.applyCustom(readItemsCustom());
    return this;
  }

  // ---------- alterações do painel admin (data/items-custom.json, servers/common/items-custom.ts) ----------
  /** cópia de cada item como veio do Spec_Item (antes das alterações), para desfazer e para o painel comparar */
  readonly original = new Map<number, ItemDef>();
  /** ids mexidos pelas alterações atuais: editados, criados e removidos */
  readonly customIds = { edited: new Set<number>(), added: new Set<number>(), removed: new Set<number>() };

  /** volta tudo o que as alterações anteriores mexeram e aplica `c` (o painel chama de novo a cada gravação) */
  applyCustom(c: ItemsCustom) {
    if (!this.original.size) for (const d of this.byId.values()) this.original.set(d.id, structuredClone(d));
    for (const id of [...this.customIds.edited, ...this.customIds.removed]) {
      const o = this.original.get(id);
      if (o) { const d = structuredClone(o); this.byId.set(id, d); this.bySymbol.set(d.symbol, d); }
    }
    for (const id of this.customIds.added) { const d = this.byId.get(id); this.byId.delete(id); if (d) { this.bySymbol.delete(d.symbol); this.defines.delete(d.symbol); } }
    this.customIds.edited.clear(); this.customIds.added.clear(); this.customIds.removed.clear();
    for (const n of c.added) {
      const id = Math.floor(Number(n.id)), symbol = String(n.symbol ?? '').trim().toUpperCase();
      if (!(id > 0) || !/^II_[A-Z0-9_]+$/.test(symbol) || this.original.has(id) || this.bySymbol.has(symbol)) continue;
      const base = n.base ? this.bySymbol.get(n.base) : undefined;
      const d = base ? { ...structuredClone(base), id, symbol } : blankItem(id, symbol);
      applyPatch(d, n);
      this.byId.set(id, d); this.bySymbol.set(symbol, d); this.defines.set(symbol, id);
      this.customIds.added.add(id);
    }
    for (const [k, p] of Object.entries(c.edits)) {
      const d = this.byId.get(Number(k));
      if (!d || this.customIds.added.has(d.id)) continue;
      applyPatch(d, p);
      this.customIds.edited.add(d.id);
    }
    for (const id of c.removed) {
      const d = this.byId.get(id);
      if (!d) continue;
      this.byId.delete(id); this.bySymbol.delete(d.symbol);
      this.customIds.removed.add(id);
    }
  }

  /** blocos `Add_Weapon_Rarity { nRarityLevel = n; szName = "…"; dwColor = 0x…; fAttackRate = 1.04f; fStatsRate = 1.10f; }` */
  private loadRarity() {
    const text = this.read('WeaponRarity.inc');
    if (!text) return;
    for (const m of text.matchAll(/Add_Weapon_Rarity\s*\{([^}]*)\}/g)) {
      const v = (k: string) => m[1].match(new RegExp(`${k}\\s*=\\s*([^;]+);`))?.[1].trim() ?? '';
      const lv = Number(v('nRarityLevel'));
      if (!Number.isInteger(lv) || lv < 0 || lv > 50) continue;
      this.rarity[lv] = { name: v('szName').replace(/"/g, ''), color: Number(v('dwColor')) || 0, atk: parseFloat(v('fAttackRate')) || 1, stats: parseFloat(v('fStatsRate')) || 1 };
    }
  }
  /**
   * Caixas (CPackItem, propPackItem.inc): `PackItem II_CAIXA <minutos> { II_ITEM enchant quantidade … }`. Abrir dá todos os
   * itens de uma vez (só com espaço livre para todos), cada um valendo `span` minutos (0 = para sempre).
   */
  readonly packs = new Map<number, { span: number; items: { id: number; u: number; n: number }[] }>();
  private loadPacks() {
    const text = this.read('propPackItem.inc');
    if (!text) return;
    const tok: string[] = text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ').match(/[{}]|[^\s{}]+/g) ?? [];
    const D = (s: string) => (/^-?\d+$/.test(s) ? Number(s) : this.defines.get(s));
    for (let i = 0; i < tok.length; i++) {
      if (tok[i] !== 'PackItem') continue;
      const box = D(tok[i + 1]), span = Number(tok[i + 2]) || 0;
      if (tok[i + 3] !== '{') continue;
      const items: { id: number; u: number; n: number }[] = [];
      let k = i + 4;
      for (; k + 2 < tok.length && tok[k] !== '}'; k += 3) {
        const id = D(tok[k]);
        if (id !== undefined && this.byId.has(id)) items.push({ id, u: Number(tok[k + 1]) || 0, n: Math.max(1, Number(tok[k + 2]) || 1) });
      }
      if (box !== undefined && items.length) this.packs.set(box, { span, items });
      i = k;
    }
  }

  /**
   * Caixas sorteadas (CGiftboxMan, propGiftbox.inc): `GiftBox<N> II_CAIXA { II_ITEM probabilidade quantidade [flag [minutos [enchant]]] … }`.
   * Abrir dá UM item sorteado: a chance é sobre 1.000.000 (a probabilidade do arquivo × 1 / 100 / 10 conforme a versão — GiftBox,
   * GiftBox3, GiftBox4, GiftBox5, GiftBox6) e o último item leva a sobra até 1.000.000 (CGiftboxMan::Verify).
   */
  readonly gifts = new Map<number, { entries: { id: number; n: number; span: number; u: number; low: number; high: number }[] }>();
  private loadGifts() {
    const text = this.read('propGiftbox.inc');
    if (!text) return;
    const tok: string[] = text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ').match(/[{}]|[^\s{}]+/g) ?? [];
    const D = (s: string) => (/^-?\d+$/.test(s) ? Number(s) : this.defines.get(s));
    // GiftBox (prob n) · 3 (×100, n, flag) · 4 (×100, n, flag, span) · 5 (×10, n, flag, span) · 6 (×10, n, flag, span, enchant)
    const FORMAT: Record<string, { mul: number; cols: number }> = { GiftBox: { mul: 1, cols: 2 }, GiftBox3: { mul: 100, cols: 3 }, GiftBox4: { mul: 100, cols: 4 }, GiftBox5: { mul: 10, cols: 4 }, GiftBox6: { mul: 10, cols: 5 } };
    for (let i = 0; i < tok.length; i++) {
      const fmt = FORMAT[tok[i]];
      if (!fmt || tok[i + 2] !== '{') continue;
      const box = D(tok[i + 1]);
      const list: { id: number; n: number; span: number; u: number; w: number }[] = [];
      let k = i + 3;
      for (; k < tok.length && tok[k] !== '}'; k += 1 + fmt.cols) {
        const id = D(tok[k]), c = (j: number) => Number(tok[k + 1 + j]) || 0;
        if (id !== undefined && this.byId.has(id)) list.push({ id, n: Math.max(1, c(1)), span: fmt.cols >= 4 ? c(3) : 0, u: fmt.cols >= 5 ? c(4) : 0, w: c(0) * fmt.mul });
      }
      if (box !== undefined && list.length) {
        let low = 0;
        const entries = list.map((x, j) => { const w = j === list.length - 1 ? Math.max(0, 1_000_000 - low) : x.w; const e = { id: x.id, n: x.n, span: x.span, u: x.u, low, high: low + w }; low += w; return e; });
        this.gifts.set(box, { entries });
      }
      i = k;
    }
  }

  /** multiplicadores da raridade `r` (sem raridade ou nível desconhecido: ×1) */
  rarityOf(r: number | undefined) { const x = r ? this.rarity[r] : undefined; return { atk: x?.atk ?? 1, stats: x?.stats ?? 1 }; }

  /** SetItem <id> <IDS_…> { Elem { II_* PARTS_* … } Avail { DST_* valor peças … } } do propItemEtc.inc */
  private loadSets() {
    const text = this.read('propItemEtc.inc');
    if (!text) return;
    const names = new Map<string, string>();
    const nt = this.read('propItemEtc.txt.txt');
    if (nt) for (const line of nt.split(/\r?\n/)) { const i = line.indexOf('\t'); if (i > 0 && !line.slice(i + 1).trim().startsWith('IDS_')) names.set(line.slice(0, i).trim(), line.slice(i + 1).trim()); }
    // nome sem texto no propItemEtc.txt.txt: o comentário da linha (`SetItem 486 IDS_… // Beginner Accessory Set`)
    const comments = new Map<string, string>();
    for (const m of text.matchAll(/SetItem\s+\d+\s+(\S+)[ \t]*\/\/[ \t]*([^\r\n]+)/g)) comments.set(m[1], m[2].trim());
    const tok = text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ').match(/[{}]|[^\s{}]+/g) ?? [];
    const D = (s: string) => (/^-?\d+$/.test(s) ? Number(s) : this.defines.get(s));
    /** pula um bloco { … } (com aninhados) a partir do índice do '{' e devolve o índice depois do '}' */
    const skip = (i: number) => { let depth = 0; do { if (tok[i] === '{') depth++; else if (tok[i] === '}') depth--; i++; } while (depth > 0 && i < tok.length); return i; };
    for (let i = 0; i < tok.length; i++) {
      // Piercing II_* { DST_* valor … } (CProject::LoadPiercingAvail)
      if (tok[i] === 'Piercing' && tok[i + 2] === '{') {
        const item = D(tok[i + 1]), end = skip(i + 2), dst: [number, number][] = [];
        for (let k = i + 3; k + 1 < end - 1; k += 2) { const d = D(tok[k]), v = Number(tok[k + 1]); if (d !== undefined && d > 0 && Number.isFinite(v)) dst.push([d, v]); }
        if (item !== undefined && dst.length) this.piercing.set(item, [...(this.piercing.get(item) ?? []), ...dst]);
        i = end - 1;
        continue;
      }
      if (tok[i] !== 'SetItem') continue;
      const id = Number(tok[i + 1]), ids = tok[i + 2];
      i += 3;
      if (tok[i] !== '{') continue;
      const end = skip(i);
      const set: SetDef = { id, name: names.get(ids) || comments.get(ids) || ids, elems: [], avail: [] };
      for (let j = i + 1; j < end - 1; j++) {
        if ((tok[j] !== 'Elem' && tok[j] !== 'Avail') || tok[j + 1] !== '{') continue;
        const kind = tok[j], close = skip(j + 1) - 1;
        const body = tok.slice(j + 2, close);
        if (kind === 'Elem') {
          for (let k = 0; k + 1 < body.length; k += 2) { const item = D(body[k]), part = D(body[k + 1]); if (item !== undefined && part !== undefined) set.elems.push({ item, part }); }
        } else {
          for (let k = 0; k + 2 < body.length; k += 3) { const dst = D(body[k]), adj = Number(body[k + 1]), n = Number(body[k + 2]); if (dst !== undefined && dst > 0 && Number.isFinite(adj) && n > 0) set.avail.push({ dst, adj, n }); }
        }
        j = close;
      }
      i = end - 1;
      if (!set.elems.length) continue;
      this.sets.push(set);
      for (const e of set.elems) this.setByItem.set(e.item, set);
    }
  }

  /**
   * accessory.inc (CAccessoryProperty::LoadScript): `Probability { … }` (chance de enchant, não usada aqui) e
   * `Accessory { II_* { <enchant> { DST_* valor DST_* valor … } … } … }`.
   */
  private loadAccessory() {
    const text = this.read('accessory.inc') ?? this.read('Accessory.inc');
    if (!text) { console.warn('Itens: accessory.inc não encontrado (joias sem bônus de enchant)'); return; }
    const tok: string[] = text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ').match(/[{}]|[^\s{}]+/g) ?? [];
    const D = (s: string) => (/^-?\d+$/.test(s) ? Number(s) : this.defines.get(s));
    let i = tok.indexOf('Accessory');
    while (i >= 0 && i < tok.length) {
      if (tok[++i] !== '{') break;
      i++;
      // II_* { n { DST v … } … }
      while (i < tok.length && tok[i] !== '}') {
        const item = D(tok[i++]);
        if (tok[i] !== '{') break;
        i++;
        const levels = new Map<number, [number, number][]>();
        while (i < tok.length && tok[i] !== '}') {
          const lv = Number(tok[i++]);
          if (tok[i] !== '{') break;
          i++;
          const dst: [number, number][] = [];
          while (i + 1 < tok.length && tok[i] !== '}') {
            const k = D(tok[i]), v = Number(tok[i + 1]);
            if (k !== undefined && k > 0 && Number.isFinite(v)) dst.push([k, v]);
            i += 2;
          }
          i++; // }
          if (Number.isInteger(lv)) levels.set(lv, dst);
        }
        i++; // }
        if (item !== undefined) this.accessory.set(item, levels);
      }
      i = tok.indexOf('Accessory', i);
    }
    console.log(`Itens: ${this.accessory.size} joias com bônus de enchant (accessory.inc)`);
  }

  /** bônus da joia no enchant `u` (vazio se não é joia ou não tem linha) */
  accessoryDst(itemId: number, u: number): [number, number][] { return this.accessory.get(itemId)?.get(u) ?? []; }
  /** carta de piercing da suit? */
  isSuitCard(d: ItemDef) { return this.suitCardKind >= 0 && d.kind3 === this.suitCardKind; }
  /** bônus da carta quando espetada (vazio se não tem linha Piercing) */
  piercingDst(itemId: number): [number, number][] { return this.piercing.get(itemId) ?? []; }

  /**
   * Busca para o painel de GM: nome ou símbolo contendo `q` (sem diferenciar maiúsculas), filtrado por categoria
   * (weapon, armor, general…: dwItemKind1), no máximo `max`, os nomes "de verdade" primeiro e por nível.
   */
  /** busca do painel de GM: nome/símbolo, categoria (kind1) e raridade (`grade` 100–400; 0 = todas) */
  search(q: string, kind: string, grade = 0, max = 200): ItemDef[] {
    const k = ({ weapon: [1], armor: [2], general: [3], ride: [4], system: [5], charged: [6] } as Record<string, number[]>)[kind];
    const s = q.trim().toLowerCase();
    const out: ItemDef[] = [];
    for (const d of this.byId.values()) {
      if (k && !k.includes(d.kind1)) continue;
      if (grade && d.grade !== grade) continue;
      if (s && !d.name.toLowerCase().includes(s) && !d.symbol.toLowerCase().includes(s)) continue;
      out.push(d);
    }
    out.sort((a, b) => Number(a.name === a.symbol) - Number(b.name === b.symbol) || a.level - b.level || a.name.localeCompare(b.name));
    return out.slice(0, max);
  }

  /**
   * Wikipedia de itens: categorias (árvore da janela) e filtros. `cat`: all, weapons, sets, jewelry, cs (Cash Shop: equipamento),
   * othercs (Cash Shop: o resto), pets, furniture, other e, dentro de other, cards, beads, gems, tickets, powerup, food.
   * Itens sem nome de verdade (o nome é só o símbolo II_*) ficam de fora.
   */
  wikiInCategory(d: ItemDef, cat: string): boolean {
    const k3 = d.kind3, k2 = d.kind2, k1 = d.kind1;
    const pet = k3 === 100 || k3 === 120, furniture = k1 === 7 || [34, 35, 38, 39, 40].includes(k2);
    const jewelry = k2 === 13, weapon = k1 === 1, set = this.setByItem.has(d.id), cashEquip = [9, 10, 32].includes(k2), cashOther = k1 === 6;
    switch (cat) {
      case 'all': return true;
      case 'weapons': return weapon;
      case 'sets': return set;
      case 'jewelry': return jewelry;
      case 'cs': return cashEquip;
      case 'othercs': return cashOther;
      case 'pets': return pet;
      case 'furniture': return furniture;
      case 'cards': return [37, 62, 63, 248].includes(k3);
      case 'beads': return /bead/i.test(d.name);
      case 'gems': return k2 === 16 || k3 === 34;
      case 'tickets': return k3 === 122 || /ticket/i.test(d.symbol);
      case 'powerup': return k2 === 50 || [51, 119, 165, 166, 167, 168, 203, 204, 207, 208, 224, 225, 226].includes(k3) || (k3 === 50 && /stone|rune|protection|hammer|enchant|upgrade/i.test(d.name));
      case 'food': return k3 !== 256 && (k2 === 14 || [30, 31, 32, 35, 59, 161, 218].includes(k3)); // k3 256 = badge
      case 'other': return !weapon && !set && !jewelry && !cashEquip && !cashOther && !pet && !furniture;
      default: return true;
    }
  }

  /** busca da Wikipedia: filtros, ordenação (`name`, `job` ou `level`) e página (`off`/`n`); devolve o total e as linhas leves */
  wiki(o: { q: string; cat: string; job: number; sex: number; lo: number; hi: number; sort: string; desc: boolean; off: number; n: number }) {
    const s = o.q.trim().toLowerCase();
    const list: ItemDef[] = [];
    for (const d of this.byId.values()) {
      if (d.name === d.symbol || !d.name) continue;
      if (o.lo > 0 && d.level < o.lo) continue;
      if (o.hi > 0 && d.level > o.hi) continue;
      if (o.sex >= 0 && d.sex >= 0 && d.sex !== o.sex) continue;
      if (o.job >= 0 && !jobCanUse(d.job, o.job)) continue;
      if (s && !d.name.toLowerCase().includes(s)) continue;
      if (!this.wikiInCategory(d, o.cat)) continue;
      list.push(d);
    }
    const dir = o.desc ? -1 : 1;
    list.sort((a, b) => (o.sort === 'level' ? a.level - b.level || a.name.localeCompare(b.name) : o.sort === 'job' ? a.job - b.job || a.name.localeCompare(b.name) : a.name.localeCompare(b.name)) * dir);
    return { total: list.length, rows: list.slice(o.off, o.off + o.n).map((d) => [d.id, d.symbol, d.name, d.icon, d.level, d.job, d.sex, d.kind1, d.parts, d.packMax, d.grade, d.kind2]) };
  }

  /** o que o cliente precisa para desenhar (nome, ícone, empilhamento, onde equipa) */
  /** dados do item para o cliente (inclui o que a dica do item mostra: ataque/defesa, velocidade, classe, bônus de atributo) */
  static view(d: ItemDef) {
    const fx = d.dest.map((k, i) => [k, d.adj[i]]).filter(([k, v]) => k > 0 && v !== 0);
    return { id: d.id, sym: d.symbol, name: d.name, icon: d.icon, pack: d.packMax, parts: d.parts, sex: d.sex, lv: d.level, cost: d.cost,
      k1: d.kind1, k2: d.kind2, k3: d.kind3, amin: d.abilityMin, amax: d.abilityMax, aspd: d.attackSpeed, rare: d.rare, wt: d.weaponType, gr: d.grade, job: d.job, hand: d.handed, fx, ...(d.fly ? { fly: d.fly } : {}),
      // arma geral/unique/ultimate (0/1/2) e elemento da carta de elemento — para o ferreiro e o martelo
      ...(d.referStat1 >= 0 ? { ref: d.referStat1 } : {}), ...(d.element ? { elem: d.element } : {}) };
  }

  /** `view` + o conjunto do item (nome, peças e bônus por quantidade) — para a dica completa (inventário, loja, painel de GM) */
  viewFull(d: ItemDef) {
    const s = this.setByItem.get(d.id), acc = this.accessory.get(d.id), pierce = this.piercing.get(d.id);
    const to = d.referStat1 === 0 || d.referStat1 === 1 ? this.byId.get(d.referTarget1)?.name : undefined;
    // carta: a dica mostra o bônus que ela dá espetada
    return { ...ItemCatalog.view(d), ...(pierce ? { fx: pierce } : {}), ...(s ? { set: { name: s.name, pieces: s.elems.length, avail: s.avail.map((a) => [a.n, a.dst, a.adj] as [number, number, number]),
      // peças do conjunto (a dica lista cada uma, azul se equipada)
      items: s.elems.map((e) => [e.item, this.byId.get(e.item)?.name ?? ''] as [number, string]) } } : {}),
      ...(acc ? { acc: Object.fromEntries(acc) } : {}), ...(this.isSuitCard(d) ? { card: 1 } : {}),
      // arma que converte (Bobochan): em qual ela vira
      ...(to ? { to } : {}),
      // caixa: o que vem dentro ([nome, quantidade]) e a descrição
      ...(this.packs.has(d.id) ? { box: this.packs.get(d.id)!.items.map((x) => [this.byId.get(x.id)?.name ?? '?', x.n] as [string, number]) } : {}),
      ...(d.desc ? { desc: d.desc } : {}) };
  }
}
