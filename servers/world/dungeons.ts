import fs from 'node:fs';
import path from 'node:path';

/**
 * Dungeons e portas (regiões de teleporte dos .rgn): tabela de mundos (World.inc + defineWorld.h) e as regras das dungeons de
 * instância (PartyDungeon.lua do servidor original: classes, faixa de nível, tempo de espera e monstros).
 * No original (InstanceDungeonParty): só entra quem está em party; cada party tem a própria cópia da dungeon (camada = id da
 * party) e quem sai da party é retirado depois de 3 minutos.
 */
export interface WorldInfo { id: number; define: string; name: string }

const text = (file: string) => {
  const b = fs.readFileSync(file);
  if (b[0] === 0xff && b[1] === 0xfe) return new TextDecoder('utf-16le').decode(b.subarray(2));
  return new TextDecoder('windows-1252').decode(b);
};

/** todos os mundos: WI_* (define) → id numérico (defineWorld.h) → nome da pasta (World.inc) */
export function worldTable(resDir: string): { byId: Map<number, WorldInfo>; byDefine: Map<string, WorldInfo> } {
  const byId = new Map<number, WorldInfo>(), byDefine = new Map<string, WorldInfo>();
  try {
    const ids = new Map<string, number>();
    for (const m of text(path.join(resDir, 'defineWorld.h')).matchAll(/#define\s+(WI_\w+)\s+(\d+)/g)) ids.set(m[1], Number(m[2]));
    for (const m of text(path.join(resDir, 'World.inc')).matchAll(/^\s*(WI_\w+)\s+"?([A-Za-z0-9_]+)"?/gm)) {
      const id = ids.get(m[1]);
      if (id === undefined || byDefine.has(m[1]) || !/^(Wd|Du|Ti)/.test(m[2])) continue; // vale a primeira linha da tabela (as seguintes são SetTitle/…)
      const w = { id, define: m[1], name: m[2] };
      byId.set(id, w); byDefine.set(m[1], w);
    }
  } catch { /* sem as tabelas */ }
  return { byId, byDefine };
}

export type DungeonClass = 'NORMAL' | 'MASTER' | 'HERO' | 'LEGEND_HERO';
/** categoria do personagem (CLASS_* do InstanceDungeonBase.lua) pelo id da classe: 0–15 normal, 16–23 master, 24–31 hero, 32–39 legend hero */
export const classOfJob = (job: number): DungeonClass => (job >= 32 ? 'LEGEND_HERO' : job >= 24 ? 'HERO' : job >= 16 ? 'MASTER' : 'NORMAL');

export interface InstanceRule {
  define: string;
  classes: Set<DungeonClass>;
  level: [number, number];
  /** tempo de espera para entrar em outra dungeon do mesmo tipo (min) */
  coolMin: number;
  /** monstros (SetMonster): tipo (NORMAL/MIDBOSS/BOSS), símbolo MI_*, agressivo e posição */
  monsters: { kind: 'NORMAL' | 'MIDBOSS' | 'BOSS'; mover: string; aggressive: boolean; pos: [number, number, number] }[];
}

/** PartyDungeon.lua → regras por WI_INSTANCE_* (e WI_DUNGEON_* listadas) */
export function instanceRules(resDir: string): Map<string, InstanceRule> {
  const out = new Map<string, InstanceRule>();
  let src = '';
  try { src = text(path.join(resDir, 'PartyDungeon.lua')); } catch { return out; }
  // tira os comentários (-- linha e --[[ bloco ]])
  src = src.replace(/--\[\[[\s\S]*?--\]\]/g, '').replace(/--[^\n]*/g, '');
  let cur: InstanceRule | null = null;
  const CLASS: Record<string, DungeonClass> = { CLASS_NORMAL: 'NORMAL', CLASS_MASTER: 'MASTER', CLASS_HERO: 'HERO', CLASS_LEGEND_HERO: 'LEGEND_HERO' };
  for (const line of src.split(/\r?\n/)) {
    let m: RegExpExecArray | null;
    if ((m = /AddDungeon\(\s*"(\w+)"\s*\)/.exec(line))) { cur = { define: m[1], classes: new Set(), level: [1, 999], coolMin: 0, monsters: [] }; out.set(m[1], cur); continue; }
    if (!cur) continue;
    if ((m = /SetClass\(([^)]*)\)/.exec(line))) { for (const k of m[1].split(',')) { const c = CLASS[k.trim()]; if (c) cur.classes.add(c); } continue; }
    if ((m = /SetLevel\(\s*(\d+)\s*,\s*(\d+)\s*\)/.exec(line))) { cur.level = [Number(m[1]), Number(m[2])]; continue; }
    if ((m = /SetCoolTime\(\s*MIN\(\s*(\d+)\s*\)\s*\)/.exec(line))) { cur.coolMin = Number(m[1]); continue; }
    if ((m = /SetMonster\(\s*ID_(NORMAL|MIDBOSS|BOSS)\s*,\s*"(\w+)"\s*,\s*(true|false)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\)/.exec(line))) {
      cur.monsters.push({ kind: m[1] as 'NORMAL' | 'MIDBOSS' | 'BOSS', mover: m[2], aggressive: m[3] === 'true', pos: [Number(m[4]), Number(m[5]), Number(m[6])] });
    }
  }
  return out;
}
