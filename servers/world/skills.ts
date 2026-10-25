import fs from 'node:fs';
import path from 'node:path';
import type { ItemCatalog, ItemDef } from '../common/items';
import { nameTable } from '../common/names';
import type { Fighter } from './combat';
import type { MoverProp } from './world';

/**
 * Skills dos jogadores, dos arquivos originais:
 * - `propSkill.txt` (colunas pelo cabeçalho): SI_*, nome (propSkill.txt.txt), tipo JTYPE_BASE/EXPERT/PRO (custo 1/2/3 pontos
 *   por nível — CProject::m_dwVagSP/ExpertSP/ProSP), classe (dwItemKind2), nível pedido (dwReqDisLV), pré-requisitos
 *   (dwReSkill1/2 + nível), ícone (Data/Icon), alvo/tipo (dwExeTarget: EXT_MELEEATK = golpe corpo a corpo), atributo de
 *   referência (dwReferStat/Target/Value), máximo (ExpertMax);
 * - `propSkillAdd.csv`: por nível — dano mínimo/máximo, MP/FP, espera (dwCooldown, ms), alcance.
 * Pontos ao subir de nível: ((nível − 1) / 20) + 2 (CMover, MoverParam.cpp). Aprender: OnDoUseSkillPoint.
 * Dano corpo a corpo: CMover::GetMeleeSkillPower — ((arma + habilidade×5 + atributo − 20) × (16 + nível) / 13).
 * v1: só as skills EXT_MELEEATK lançam; as demais (buffs, magias) aparecem e podem ser aprendidas, mas ainda não lançam.
 */
/** por nível: ataque mín/máx, custo, espera, alcance, e o efeito (dwDestParam/nAdjParamVal ×2) com a duração `time` (ms; 0 = instantâneo) */
export interface SkillLevel { min: number; max: number; mp: number; fp: number; cooldown: number; range: number; dest: [number, number]; adj: [number, number]; time: number }
/** melee = golpe; magic = ataque mágico no alvo; buff = efeito em quem lança (buff com duração ou cura); other = ainda sem efeito */
export type SkillKind = 'melee' | 'magic' | 'buff' | 'other';
export interface SkillDef {
  id: number; symbol: string; name: string; desc: string; jtype: string; job: number; reqLevel: number;
  pre: [number, number][]; max: number; icon: string; melee: boolean; kind: SkillKind;
  refer: { stat: number; target: number; value: number }[];
  levels: SkillLevel[];
  /** dwSfxObj…dwSfxObj5 (ids XI_*, -1 = nenhum): 0 ao lançar, 1 projétil, 2 no alvo ao acertar, 3 que dura no alvo (buff), 4 no lançador ao acertar */
  sfx: number[];
  /** dwUseMotion: movimento do personagem ao lançar (MTI_*_CASTING01…); '' = o da própria skill */
  motion: string;
  /** dwSndAttack1 / dwSndAttack2 (ids SND_*, -1 = nenhum): ao lançar e ao acertar */
  snd: number[];
}

/** EXT_* do propSkill → o que o servidor sabe fazer */
const kindOf = (exe: string): SkillKind => (exe === 'EXT_MELEEATK' ? 'melee' : exe === 'EXT_MAGICATK' || exe === 'EXT_MAGICATKSHOT' ? 'magic'
  : ['EXT_SELFCHGPARAMET', 'EXT_ANOTHER', 'EXT_ANOTHERWITH', 'EXT_OBJCHGPARAMET', 'EXT_TROUPE', 'EXT_MAGIC'].includes(exe) ? 'buff' : 'other');

const JOB_PARENT: Record<number, number> = { 6: 1, 7: 1, 8: 2, 9: 2, 10: 3, 11: 3, 12: 4, 13: 4 };

export class SkillCatalog {
  readonly byId = new Map<number, SkillDef>();
  private D: (s: string) => number;

  constructor(resDir: string, private items: ItemCatalog, useNames = true) {
    this.D = (s: string) => items.defines.get(s) ?? -1;
    const read = (f: string, enc = 'euc-kr') => {
      try {
        const b = fs.readFileSync(path.join(resDir, f));
        return b[0] === 0xff && b[1] === 0xfe ? new TextDecoder('utf-16le').decode(b.subarray(2)) : new TextDecoder(enc).decode(b);
      } catch { return ''; }
    };
    const names = new Map<string, string>();
    const nt = useNames ? nameTable() : null;
    for (const line of read('propSkill.txt.txt').split(/\r?\n/)) { const i = line.indexOf('\t'); if (i > 0 && !line.slice(i + 1).trim().startsWith('IDS_')) names.set(line.slice(0, i).trim(), line.slice(i + 1).trim()); }

    // níveis (propSkillAdd.csv): agrupa por skill
    const levels = new Map<string, SkillLevel[]>();
    const add = read('propSkillAdd.csv', 'windows-1252').split(/\r?\n/);
    const ah = (add[1] ?? '').replace(/^\/\//, '').split(',').map((s) => s.trim().toLowerCase());
    const A = (n: string) => ah.indexOf(n.toLowerCase());
    const ai = { d1: A('dwDestParam1'), d2: A('dwDestParam2'), a1: A('nAdjParamVal1'), a2: A('nAdjParamVal2'), time: A('dwSkillTime'), name: A('dwName'), lv: A('dwSkillLvl'), min: A('dwAbilityMin'), max: A('dwAtkAbilityMax'), mp: A('dwReqMp'), fp: A('dwRepFp'), cd: A('dwCooldown'), range: A('dwSkillRange') };
    const n0 = (v: string | undefined) => { const x = Number((v ?? '').trim()); return Number.isFinite(x) ? x : 0; };
    const dst = (v: string | undefined) => { const s = (v ?? '').trim(); if (!s || s === '=') return -1; return /^\d+$/.test(s) ? Number(s) : this.D(s); };
    for (const line of add.slice(2)) {
      if (!line || line.startsWith('//')) continue;
      const c = line.split(',');
      const sym = (c[ai.name] ?? '').trim(), lv = n0(c[ai.lv]);
      if (!sym.startsWith('SI_') || lv < 1) continue;
      let a = levels.get(sym);
      if (!a) levels.set(sym, (a = []));
      a[lv - 1] = { min: n0(c[ai.min]), max: n0(c[ai.max]), mp: n0(c[ai.mp]), fp: n0(c[ai.fp]), cooldown: n0(c[ai.cd]), range: n0(c[ai.range]),
        dest: [dst(c[ai.d1]), dst(c[ai.d2])], adj: [n0(c[ai.a1]), n0(c[ai.a2])], time: n0(c[ai.time]) };
    }

    const rows = read('propSkill.txt').split(/\r?\n/);
    const head = (rows[1] ?? '').split('\t').map((h) => h.replace(/^\/\//, '').replace(/"/g, '').trim().toLowerCase());
    const H = (n: string) => head.findIndex((h) => h === n.toLowerCase() || h.startsWith(n.toLowerCase() + '('));
    const C = {
      id: H('dwID'), name: H('szName'), k1: H('dwItemKind1'), k2: H('dwItemKind2'), req: H('dwReqDisLV'), re1: H('dwReSkill1'), rl1: H('dwReSkillLevel1'),
      re2: H('dwReSkill2'), rl2: H('dwReSkillLevel2'), icon: H('szIcon'), exe: H('dwExeTarget'), rs1: H('dwReferStat1'), rs2: H('dwReferStat2'),
      sfx0: H('dwSfxObj'), sfx1: H('dwSfxObj2'), sfx2: H('dwSfxObj3'), sfx3: H('dwSfxObj4'), sfx4: H('dwSfxObj5'),
      motion: H('dwUseMotion'), sa1: H('dwSndAttack1'), sa2: H('dwSndAttack2'), rt1: H('dwReferTarget1'), rt2: H('dwReferTarget2'), rv1: H('dwReferValue1'), rv2: H('dwReferValue2'), max: H('ExpertMax'), comment: H('szComment'),
    };
    const num = (v: string | undefined) => { const s = (v ?? '').trim(); if (!s || s === '=') return -1; return /^-?\d+$/.test(s) ? Number(s) : this.D(s); };
    for (const line of rows.slice(2)) {
      const c = line.split('\t');
      const sym = (c[C.id] ?? '').trim();
      if (!sym.startsWith('SI_')) continue;
      const jtype = (c[C.k1] ?? '').trim();
      if (!['JTYPE_BASE', 'JTYPE_EXPERT', 'JTYPE_PRO'].includes(jtype)) continue;
      const id = this.D(sym);
      const lv = levels.get(sym) ?? [];
      if (id < 0 || !lv.length) continue;
      const pre: [number, number][] = [];
      for (const [r, l] of [[C.re1, C.rl1], [C.re2, C.rl2]]) { const pid = num(c[r]), plv = num(c[l]); if (pid > 0 && plv > 0) pre.push([pid, plv]); }
      const refer = [[C.rs1, C.rt1, C.rv1], [C.rs2, C.rt2, C.rv2]].map(([s, t, v]) => ({ stat: num(c[s]), target: num(c[t]), value: num(c[v]) })).filter((r) => r.stat > 0);
      this.byId.set(id, {
        id, symbol: sym, name: nt?.skills[sym]?.[0] || names.get((c[C.name] ?? '').trim()) || sym, desc: nt?.skills[sym]?.[1] ?? names.get((c[C.comment] ?? '').trim()) ?? '', jtype, job: num(c[C.k2]),
        reqLevel: Math.max(1, num(c[C.req])), pre, max: Math.min(lv.length, Math.max(1, num(c[C.max]) > 0 ? num(c[C.max]) : lv.length)),
        icon: (c[C.icon] ?? '').replace(/"/g, '').trim(), melee: (c[C.exe] ?? '').trim() === 'EXT_MELEEATK', kind: kindOf((c[C.exe] ?? '').trim()), refer, levels: lv,
        sfx: [C.sfx0, C.sfx1, C.sfx2, C.sfx3, C.sfx4].map((k) => (k < 0 ? -1 : num(c[k]))),
        snd: [C.sa1, C.sa2].map((k) => (k < 0 ? -1 : num(c[k]))),
        motion: C.motion < 0 ? '' : /^MTI_\w+$/.test((c[C.motion] ?? '').trim()) ? (c[C.motion] ?? '').trim() : '',
      });
    }
  }

  /** classes cujas skills o personagem pode usar: Vagrant + 1ª classe + 2ª (master/hero contam como a 2ª) */
  lineage(job: number) {
    const base = job >= 24 && job <= 31 ? job - 18 : job >= 16 && job <= 23 ? job - 10 : job;
    const out = new Set([0, base]);
    if (JOB_PARENT[base] !== undefined) out.add(JOB_PARENT[base]);
    return out;
  }
  forJob(job: number) { const l = this.lineage(job); return [...this.byId.values()].filter((s) => l.has(s.job)).sort((a, b) => a.job - b.job || a.reqLevel - b.reqLevel || a.id - b.id); }

  /** pontos por nível da skill: Vagrant 1, 1ª classe 2, 2ª classe 3 */
  cost(s: SkillDef) { return s.jtype === 'JTYPE_BASE' ? 1 : s.jtype === 'JTYPE_EXPERT' ? 2 : 3; }
  /** pontos ganhos ao chegar no nível `level` e o total até ele */
  gainAt(level: number) { return Math.floor((level - 1) / 20) + 2; }
  totalAt(level: number) { let s = 0; for (let lv = 2; lv <= level; lv++) s += this.gainAt(lv); return s; }
  spent(levels: Map<number, number>) { let s = 0; for (const [id, lv] of levels) { const d = this.byId.get(id); if (d) s += lv * this.cost(d); } return s; }

  /**
   * Aprender/subir: valida como OnDoUseSkillPoint (não desce, não passa do máximo, pontos suficientes) + classe, nível do
   * personagem e pré-requisitos (com os níveis novos). Devolve o custo ou a mensagem de erro.
   */
  validate(job: number, level: number, cur: Map<number, number>, want: Map<number, number>, points: number): number | string {
    const lineage = this.lineage(job);
    const next = new Map(cur);
    let cost = 0;
    for (const [id, lv] of want) {
      const d = this.byId.get(id);
      if (!d || !lineage.has(d.job)) return 'Skill de outra classe.';
      const now = cur.get(id) ?? 0;
      if (lv < now || lv > d.max) return `${d.name}: nível inválido.`;
      if (lv > now && level < d.reqLevel) return `${d.name} pede o nível ${d.reqLevel}.`;
      cost += (lv - now) * this.cost(d);
      next.set(id, lv);
    }
    for (const [id, lv] of want) {
      const d = this.byId.get(id)!;
      if (lv <= (cur.get(id) ?? 0)) continue;
      for (const [pid, plv] of d.pre) if ((next.get(pid) ?? 0) < plv) return `${d.name} pede ${this.byId.get(pid)?.name ?? 'outra skill'} no nível ${plv}.`;
    }
    if (cost > points) return 'Pontos de skill insuficientes.';
    return cost;
  }

  /** GetMeleeSkillPower: dano de uma skill corpo a corpo antes da defesa */
  meleePower(f: Fighter, s: SkillDef, lv: number, hand: ItemDef | null): number {
    const L = s.levels[lv - 1];
    if (!L) return 1;
    const w = f.weapon ?? hand;
    const add = f.weapon && f.weaponUpgrade > 0 ? Math.floor(Math.pow(f.weaponUpgrade, 1.5)) : 0;
    const wMin = (w?.abilityMin ?? 1) + add, wMax = (w?.abilityMax ?? 2) + add;
    const stat = (dst: number) => (dst === this.D('DST_STR') ? f.str : dst === this.D('DST_DEX') ? f.dex : dst === this.D('DST_INT') ? f.int : dst === this.D('DST_STA') ? f.sta : 0);
    let refer = 0;
    for (const r of s.refer) {
      const v = stat(r.stat);
      refer += r.target === this.D('RT_ATTACK') && r.value > 0 ? Math.floor((r.value / 10) * v + lv * (v / 50)) : v;
    }
    const min = Math.floor(((wMin + L.min * 5 + refer - 20) * (16 + lv)) / 13);
    const max = Math.floor(((wMax + L.max * 5 + refer - 20) * (16 + lv)) / 13);
    return Math.max(1, min + Math.floor(Math.random() * Math.max(1, max - min + 1)));
  }

  /** CalcDefenseNPC para golpe de skill: armadura natural / 7 + 1 */
  mobSkillDefense(m: MoverProp) { return Math.floor(m.naturalArmor / 7 + 1); }

  /** o que o cliente precisa para a janela de skills e a barra */
  view(s: SkillDef) {
    return { id: s.id, sym: s.symbol, name: s.name, desc: s.desc, icon: s.icon, job: s.job, jtype: s.jtype, req: s.reqLevel, pre: s.pre, max: s.max, cost: this.cost(s), melee: s.kind !== 'other', kind: s.kind, mo: s.kind === 'melee' ? '' : s.motion,
      levels: s.levels.slice(0, s.max).map((l) => ({ mp: l.mp, fp: l.fp, cd: l.cooldown, min: l.min, max: l.max, dest: l.dest, adj: l.adj, time: l.time })) };
  }
}
