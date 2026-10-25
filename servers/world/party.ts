/**
 * Party (CParty / CPartyMng do original), em memória — some quando o servidor reinicia ou quando fica com menos de 2.
 * - até 8 membros; o líder convida, expulsa e passa a liderança; qualquer um sai;
 * - nível da party (expTable.inc `expParty`): cada mob morto por um membro dá INT((nível do mob/25+1)×10) de exp de party
 *   (só se a média de nível dos membros perto não passar o nível do mob em 5 ou mais); até o 10 segue a tabela
 *   (200, 200, 250, 300, 350, 400, 450, 500, 500) e dá 15 pontos por nível; do 10 em diante vira party avançada:
 *   INT((50+nível)×nível/13)×10 por nível e 15 pontos;
 * - habilidades de party (propTroupeSkill.txt): o líder gasta pontos e liga um buff para a party por um tempo.
 */
export interface PartySkillDef { key: string; name: string; desc: string; icon: string; reqLv: number; cost: number; ms: number }

/** buffs de party (as ordens Call Out/Blitz/Retreat não entram) */
export const PARTY_SKILLS: PartySkillDef[] = [
  { key: 'ST_SPHERECIRCLE', name: 'Precision', desc: 'Ataques dos membros com chance quase certa de crítico.', icon: 'skill_TroSpherecircle.dds', reqLv: 17, cost: 1, ms: 60_000 },
  { key: 'ST_LINKATTACK', name: 'Link Attack', desc: 'Dano dos membros aumenta ao atacar.', icon: 'skill_TroLinkattack.dds', reqLv: 20, cost: 1, ms: 300_000 },
  { key: 'ST_FORTUNECIRCLE', name: 'Lucky Drop', desc: 'Mais chance de itens raros caírem.', icon: 'skill_TroFortunecircle.dds', reqLv: 25, cost: 5, ms: 300_000 },
  { key: 'ST_STRETCHING', name: 'Resting', desc: 'Membros recuperam HP/MP/FP 1,5× mais rápido.', icon: 'skill_TroStretching.dds', reqLv: 30, cost: 2, ms: 120_000 },
  { key: 'ST_GIFTBOX', name: 'Treasure Hunter', desc: 'Mais itens caem dos monstros.', icon: 'skill_TroGiftbox.dds', reqLv: 40, cost: 8, ms: 300_000 },
];

export const PARTY_MAX = 8, MAX_PARTYLEVEL = 10;
/** exp de party para passar do nível n (índice n−1) — expParty, só até o 10 */
const EXP_TABLE = [200, 200, 250, 300, 350, 400, 450, 500, 500];

export interface Party {
  id: number; name: string; leader: number; members: number[];
  level: number; exp: number; points: number;
  /** buffs ligados: chave → até quando (ms) */
  skills: Map<string, number>;
}

export class PartyManager {
  private seq = 0;
  readonly parties = new Map<number, Party>();
  private byChar = new Map<number, number>();

  of(charId: number) { const id = this.byChar.get(charId); return id === undefined ? null : this.parties.get(id) ?? null; }

  /** cria com o líder e o primeiro convidado */
  create(leader: number, leaderName: string, member: number) {
    const p: Party = { id: ++this.seq, name: `Party de ${leaderName}`, leader, members: [leader, member], level: 1, exp: 0, points: 0, skills: new Map() };
    this.parties.set(p.id, p);
    this.byChar.set(leader, p.id); this.byChar.set(member, p.id);
    return p;
  }

  add(p: Party, charId: number) {
    if (p.members.includes(charId) || p.members.length >= PARTY_MAX) return false;
    p.members.push(charId);
    this.byChar.set(charId, p.id);
    return true;
  }

  /** tira um membro; com menos de 2 a party acaba (devolve quem ficou sem party) */
  remove(charId: number): { party: Party; disbanded: number[] } | null {
    const p = this.of(charId);
    if (!p) return null;
    p.members = p.members.filter((m) => m !== charId);
    this.byChar.delete(charId);
    if (p.leader === charId && p.members.length) p.leader = p.members[0];
    if (p.members.length < 2) {
      const left = [...p.members];
      for (const m of left) this.byChar.delete(m);
      this.parties.delete(p.id);
      return { party: p, disbanded: left };
    }
    return { party: p, disbanded: [] };
  }

  expNext(p: Party) { return p.level < MAX_PARTYLEVEL ? EXP_TABLE[p.level - 1] ?? 500 : Math.floor(((50 + p.level) * p.level) / 13) * 10; }

  /** exp de party por mob morto; devolve true se subiu de nível */
  addExp(p: Party, monLv: number, rate = 1) {
    p.exp += Math.floor((Math.floor(monLv / 25) + 1) * 10 * rate);
    let up = false;
    for (let need = this.expNext(p); p.exp >= need; need = this.expNext(p)) { p.exp -= need; p.level++; p.points += 15; up = true; }
    return up;
  }

  /** líder liga um buff de party: confere nível e pontos */
  useSkill(p: Party, key: string, now: number): string | null {
    const s = PARTY_SKILLS.find((x) => x.key === key);
    if (!s) return 'Habilidade desconhecida.';
    if (p.level < s.reqLv) return `${s.name} precisa da party no nível ${s.reqLv}.`;
    if (p.points < s.cost) return `${s.name} custa ${s.cost} ponto(s) de party.`;
    p.points -= s.cost;
    p.skills.set(key, now + s.ms);
    return null;
  }

  /** buffs ainda ativos (limpa os vencidos) */
  activeSkills(p: Party, now: number) {
    for (const [k, until] of p.skills) if (until <= now) p.skills.delete(k);
    return [...p.skills].map(([k, until]) => ({ k, left: Math.ceil((until - now) / 1000) }));
  }
}

/**
 * Exp do mob dividida na party (CMover::AddExperiencePartyLevel): os membros a até 64 m do mob e com nível acima de
 * (maior nível − 10) entram; o total é exp × (1 + 0,2 × (membros − 1)) e cada um leva a parte proporcional ao nível².
 * `base(nivel)` = exp do mob para aquele nível (já com a redução por diferença de nível).
 */
export function partyExpShares(members: { id: number; level: number }[], base: (level: number) => number): Map<number, number> {
  const out = new Map<number, number>();
  if (!members.length) return out;
  const maxLv = Math.max(...members.map((m) => m.level));
  const ok = members.filter((m) => m.level > maxLv - 10);
  const exp = base(maxLv);
  const total = exp * (1 + 0.2 * (ok.length - 1));
  const sumSq = ok.reduce((s, m) => s + m.level * m.level, 0) || 1;
  for (const m of ok) out.set(m.id, Math.floor(total * (m.level * m.level) / sumSq));
  return out;
}
