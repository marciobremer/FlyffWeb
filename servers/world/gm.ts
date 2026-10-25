import { query } from '../common/db/index';
import { notifyInventory, type Inventory } from '../character/inventory';
import { maxPiercing, maxUpgrade } from '../../shared/upgrade';

/**
 * Comandos de GM digitados no chat, começando com `//` (nunca vão para o chat dos outros).
 * Só para contas com `accounts.authority` diferente de 'F' (F = jogador; Z = dono do servidor; G = GM; outras letras = níveis de GM,
 * como no FlyFF). A permissão é conferida no banco a cada comando, então mudar a conta vale na hora.
 * Sem nome de personagem o alvo é você mesmo. Toda execução fica no log do servidor (painel admin → Logs).
 */
export const MAX_LEVEL = 150;

export interface GmTarget { id: number; name: string; level: number; /** posição (só de quem está online) */ p?: [number, number, number] }

export interface GmContext {
  accountId: number;
  self: GmTarget;
  inventory: Inventory | null;
  /** personagem online com esse nome (sem diferenciar maiúsculas), se houver */
  online(name: string): GmTarget | null;
  /** aplica a classe nova a quem está online (postura de combate) */
  setJobLive(id: number, job: number): Promise<void>;
  /** aplica o nível novo a quem está online (servidor e cliente) */
  setLevelLive(id: number, level: number): void;
  /** devolve os pontos de atributo de quem está online (STR/STA/DEX/INT voltam a 15); false se não está online */
  resetStatsLive(id: number): boolean;
  reply(text: string): void;
  /** abre o painel de GM no cliente de quem digitou */
  openPanel(): void;
  /** invoca `n` monstros (id ou símbolo MI_…) perto de quem digitou; devolve a resposta */
  summonMob?(what: string, n: number, at?: [number, number]): string;
  /** apaga os monstros invocados do mapa de quem digitou */
  clearMobs?(): string;
  /** mata / revive (ali mesmo, com HP cheio) um personagem online; devolve a resposta */
  kill?(id: number): string;
  /** Dark Illusion: liga (true), desliga (false) ou alterna (sem valor) a invisibilidade de quem digitou */
  invis?(on?: boolean): string;
  revive?(id: number): string;
  /** leva um personagem online para `p` (x, y, z FlyFF; o cliente acerta a altura pelo chão) */
  teleport(id: number, p: [number, number, number]): boolean;
}

/** elementos (SAI79): nome digitado → número */
const ELEMENTS: Record<string, number> = { fogo: 1, fire: 1, agua: 2, 'água': 2, water: 2, eletrico: 3, 'elétrico': 3, eletricidade: 3, electricity: 3, vento: 4, wind: 4, terra: 5, earth: 5 };
export const ELEMENT_NAMES = ['', 'Fogo', 'Água', 'Elétrico', 'Vento', 'Terra'];

const HELP = [
  '//gm   abre o painel de GM',
  '//goto <personagem>   vai até o personagem · //summon <personagem>   traz o personagem até você',
  '//tp <x> <z>   vai para a coordenada',
  '//set-level [personagem] <nível>   muda o nível (1–' + MAX_LEVEL + ')',
  '//set-job [personagem] <classe>   muda a classe (ex.: knight, blade, ringmaster, elementor… ou o número JOB_*)',
  '//give-item [personagem] <II_…|id> [quantidade] [+enchant] [elemento+nível] [furosN]   ex.: //give-item II_WEA_SWO_WOODEN +5 fogo+3',
  '   enchant: joias até +20, o resto até +10 · furos1–4: espaços de piercing (só suit)',
  '//reset-stats [personagem]   devolve os pontos de atributo (STR/STA/DEX/INT voltam a 15)',
  '//give-penya [personagem] <quantia>',
  '//mob <MI_…|id> [quantidade] [x z]   invoca monstros perto de você ou no ponto x z (não renascem; boss já vem agressivo)',
  '//mob-clear   apaga os monstros invocados deste mapa',
  '//invis [on|off]   Dark Illusion: fica invisível para os jogadores (GMs/admins ainda veem; mobs largam você)',
  '//kill [personagem]   mata o personagem · //revive [personagem]   revive ali mesmo com HP cheio',
  '//help   esta lista',
];

const isInt = (s: string | undefined) => !!s && /^\d+$/.test(s);

/** JOB_* (defineJob.h) na ordem dos números, em minúsculas */
const JOBS = ['vagrant', 'mercenary', 'acrobat', 'assist', 'magician', 'puppeteer', 'knight', 'blade', 'jester', 'ranger', 'ringmaster', 'billposter',
  'psykeeper', 'elementor', 'gatekeeper', 'doppler', 'knight_master', 'blade_master', 'jester_master', 'ranger_master', 'ringmaster_master',
  'billposter_master', 'psykeeper_master', 'elementor_master', 'knight_hero', 'blade_hero', 'jester_hero', 'ranger_hero', 'ringmaster_hero',
  'billposter_hero', 'psykeeper_hero', 'elementor_hero', 'lordtempler', 'stormblade', 'windlurker', 'crackshooter', 'florist', 'forcemaster',
  'mentalist', 'elementorlord'];

/** personagem pelo nome: online primeiro (estado ao vivo), senão no banco */
async function findTarget(ctx: GmContext, name: string): Promise<GmTarget | null> {
  const on = ctx.online(name);
  if (on) return on;
  const r = await query<{ id: string; name: string; level: number }>('SELECT id, name, level FROM characters WHERE lower(name) = lower($1) AND NOT deleted', [name]);
  return r.rows[0] ? { id: Number(r.rows[0].id), name: r.rows[0].name, level: r.rows[0].level } : null;
}

/** confere no banco se a conta pode usar comandos de GM; devolve a autoridade ou null */
export async function gmAuthority(accountId: number): Promise<string | null> {
  const auth = await query<{ authority: string }>('SELECT authority FROM accounts WHERE id = $1', [accountId]);
  const a = auth.rows[0]?.authority ?? 'F';
  return a === 'F' ? null : a;
}

export async function runGmCommand(ctx: GmContext, text: string): Promise<void> {
  const authority = await gmAuthority(ctx.accountId);
  if (!authority) { ctx.reply('Você não tem permissão para comandos de GM.'); return; }

  const [cmd, ...args] = text.slice(2).trim().split(/\s+/);
  const name = (cmd ?? '').toLowerCase();
  /** primeiro argumento é nome de personagem se não for o valor esperado do comando */
  const target = async (looksLikeValue: (s: string) => boolean): Promise<GmTarget | null> => {
    if (args.length && !looksLikeValue(args[0])) {
      const t = await findTarget(ctx, args.shift()!);
      if (!t) ctx.reply('Personagem não encontrado.');
      return t;
    }
    return ctx.self;
  };
  const log = (what: string) => console.log(`GM ${ctx.self.name} (${authority}): ${what}`);

  if (name === 'help' || !name) { for (const l of HELP) ctx.reply(l); return; }

  if (name === 'gm' || name === 'panel') { ctx.openPanel(); return; }

  if (name === 'goto' || name === 'summon') {
    const nick = args[0];
    const t = nick ? ctx.online(nick) : null;
    if (!t?.p) { ctx.reply(nick ? `${nick} não está online.` : `Uso: //${name} <personagem>`); return; }
    if (t.id === ctx.self.id) { ctx.reply('Esse é você.'); return; }
    if (name === 'goto') { ctx.teleport(ctx.self.id, [t.p[0] + 1.5, t.p[1], t.p[2]]); ctx.reply(`Teleportado até ${t.name}.`); }
    else if (ctx.self.p) { ctx.teleport(t.id, [ctx.self.p[0] + 1.5, ctx.self.p[1], ctx.self.p[2]]); ctx.reply(`${t.name} foi trazido até você.`); }
    log(`${name} ${t.name}`);
    return;
  }

  if (name === 'invis' || name === 'darkillusion') {
    const a = (args[0] ?? '').toLowerCase();
    const r = ctx.invis?.(a === 'on' ? true : a === 'off' ? false : undefined);
    if (r) ctx.reply(r);
    log(`invis ${a || 'alterna'}`);
    return;
  }

  if (name === 'kill' || name === 'revive') {
    const t = args[0] ? ctx.online(args[0]) : ctx.self;
    if (!t) { ctx.reply(`${args[0]} não está online.`); return; }
    const r = name === 'kill' ? ctx.kill?.(t.id) : ctx.revive?.(t.id);
    if (r) ctx.reply(r);
    log(`${name} ${t.name}`);
    return;
  }

  if (name === 'tp') {
    const x = Number(args[0]), z = Number(args[1]);
    if (!Number.isFinite(x) || !Number.isFinite(z)) { ctx.reply('Uso: //tp <x> <z>'); return; }
    if (!ctx.teleport(ctx.self.id, [x, ctx.self.p?.[1] ?? 100, z])) { ctx.reply('Coordenada fora do mapa.'); return; }
    log(`tp ${x} ${z}`);
    ctx.reply(`Teleportado para ${Math.round(x)}, ${Math.round(z)}.`);
    return;
  }

  if (name === 'set-level' || name === 'setlevel' || name === 'level') {
    const t = await target(isInt);
    if (!t) return;
    const level = Number(args[0]);
    if (!isInt(args[0]) || level < 1 || level > MAX_LEVEL) { ctx.reply(`Uso: //set-level [personagem] <nível 1–${MAX_LEVEL}>`); return; }
    // pontos de atributo: tudo o que o nível dá (2 por nível) menos o que já foi gasto (o servidor ajusta de novo se estiver online)
    await query(`UPDATE characters SET level = $2, exp = 0, hp = 0, mp = 0, fp = 0,
      stat_points = GREATEST(0, 2 * ($2 - 1) - ((str - 15) + (sta - 15) + (dex - 15) + ("int" - 15))),
      skill_points = (SELECT COALESCE(SUM(((lv - 1) / 20) + 2), 0) FROM generate_series(2, $2) AS lv), skills = '{}'::jsonb, updated_at = now() WHERE id = $1`, [t.id, level]);
    ctx.setLevelLive(t.id, level);
    log(`set-level ${t.name} ${t.level} → ${level}`);
    ctx.reply(`${t.name} agora está no nível ${level}.`);
    return;
  }

  if (name === 'set-job' || name === 'job') {
    const isJob = (s: string) => isInt(s) || JOBS.includes(s.toLowerCase());
    const t = await target(isJob);
    if (!t) return;
    const v = (args[0] ?? '').toLowerCase();
    const job = isInt(v) ? Number(v) : JOBS.indexOf(v);
    if (!v || job < 0 || job >= JOBS.length) { ctx.reply('Uso: //set-job [personagem] <' + JOBS.slice(0, 14).join('|') + '|número>'); return; }
    await query('UPDATE characters SET job = $2, updated_at = now() WHERE id = $1', [t.id, job]);
    await ctx.setJobLive(t.id, job);
    log(`set-job ${t.name} → ${JOBS[job]} (${job})`);
    ctx.reply(`${t.name} agora é ${JOBS[job]}.`);
    return;
  }

  if (name === 'mob-clear') { ctx.reply(ctx.clearMobs ? ctx.clearMobs() : 'Não disponível aqui.'); log('mob-clear'); return; }
  if (name === 'mob' || name === 'summon-mob') {
    const what = args[0] ?? '';
    const n = Math.min(30, Math.max(1, Number(args[1]) || 1));
    if (!what) { ctx.reply('Uso: //mob <MI_…|id> [quantidade]'); return; }
    const x = Number(args[2]), z = Number(args[3]);
    ctx.reply(ctx.summonMob ? ctx.summonMob(what, n, Number.isFinite(x) && Number.isFinite(z) && args[3] !== undefined ? [x, z] : undefined) : 'Invocar monstros não está disponível aqui.');
    log(`mob ${what} ×${n}`);
    return;
  }
  if (name === 'give-item' || name === 'item') {
    const inv = ctx.inventory;
    if (!inv) { ctx.reply('Inventário indisponível neste servidor.'); return; }
    const isItem = (s: string) => /^II_/i.test(s) || isInt(s);
    const t = await target(isItem);
    if (!t) return;
    const what = args.shift();
    const def = isInt(what) ? inv.catalog.byId.get(Number(what)) : inv.catalog.bySymbol.get((what ?? '').toUpperCase());
    if (!def) { ctx.reply(what ? `Item ${what} não existe.` : 'Uso: //give-item [personagem] <II_…|id> [quantidade] [+enchant] [elemento+nível]'); return; }
    // resto: quantidade, +N (enchant) e elemento com nível (fogo+3, agua5…), em qualquer ordem
    let count = 1, u = 0, e = 0, el = 0, p = 0;
    for (const a of args) {
      const low = a.toLowerCase();
      const m = /^([a-zà-ú]+)\+?(\d+)?$/.exec(low);
      const pierce = /^(?:furos?|piercing|p)(\d)$/.exec(low);
      if (/^\+\d+$/.test(a)) u = Number(a.slice(1));
      else if (pierce) p = Number(pierce[1]);
      else if (isInt(a)) count = Math.min(9999, Math.max(1, Number(a)));
      else if (m && ELEMENTS[m[1]]) { e = ELEMENTS[m[1]]; el = Math.min(10, Number(m[2] ?? 1)); }
      else { ctx.reply(`Não entendi "${a}". Ex.: //give-item ${def.symbol} 1 +5 fogo+3`); return; }
    }
    let left: number;
    if (u > maxUpgrade(def.parts)) { ctx.reply(maxUpgrade(def.parts) ? `${def.name} vai no máximo até +${maxUpgrade(def.parts)}.` : `${def.name} não aceita enchant.`); return; }
    if (p > maxPiercing(def.parts)) { ctx.reply(maxPiercing(def.parts) ? `${def.name} abre no máximo ${maxPiercing(def.parts)} furos.` : 'Só a suit abre furos de piercing.'); return; }
    try { left = await inv.add(t.id, def.id, count, { u, e, el, p }); } catch (err) { ctx.reply((err as Error).message); return; }
    const extra = `${u ? ` +${u}` : ''}${e ? ` (${ELEMENT_NAMES[e]} +${el})` : ''}${p ? ` [${p} furo${p > 1 ? 's' : ''}]` : ''}`;
    log(`give-item ${t.name} ${def.symbol}${extra} ×${count - left}`);
    ctx.reply(`${count - left}× ${def.name}${extra} na bolsa de ${t.name}.${left ? ` ${left} não couberam (bolsa cheia).` : ''}`);
    return;
  }

  if (name === 'reset-stats' || name === 'resetstats' || name === 'reset-status') {
    const t = await target(() => false);
    if (!t) return;
    // online: aplica na hora (atributos de luta, HP/MP/FP e pontos livres); offline: grava 15 e a conta dos pontos é refeita ao entrar
    if (!ctx.resetStatsLive(t.id)) await query('UPDATE characters SET str = 15, sta = 15, dex = 15, "int" = 15, updated_at = now() WHERE id = $1', [t.id]);
    log(`reset-stats ${t.name}`);
    ctx.reply(`Pontos de atributo de ${t.name} devolvidos (STR/STA/DEX/INT = 15).`);
    return;
  }

  if (name === 'give-penya' || name === 'penya') {
    const t = await target(isInt);
    if (!t) return;
    const n = Number(args[0]);
    if (!isInt(args[0]) || n <= 0) { ctx.reply('Uso: //give-penya [personagem] <quantia>'); return; }
    if (!ctx.inventory) { ctx.reply('Inventário indisponível neste servidor.'); return; }
    const gold = await ctx.inventory.addGold(t.id, n);
    log(`give-penya ${t.name} +${n}`);
    ctx.reply(`${t.name} agora tem ${gold.toLocaleString('pt-BR')} penya.`);
    return;
  }

  ctx.reply(`Comando desconhecido: //${cmd}. Digite //help.`);
}
