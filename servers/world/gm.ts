import { query } from '../common/db/index';
import { BAG_MAX, BAG_SLOTS, notifyInventory, type Inventory } from '../character/inventory';
import { acceptsElement, isCashEquip, maxPiercing, maxUpgrade } from '../../shared/upgrade';

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
  /** modo invisível: liga (true), desliga (false) ou alterna (sem valor) a invisibilidade de quem digitou */
  invis?(on?: boolean): string;
  /** imortal: liga (true), desliga (false) ou alterna (sem valor) — leva os golpes mas o HP não cai */
  god?(on?: boolean): string;
  /** voar livremente (E sobe, Q desce, WASD guia) */
  fly?(on?: boolean): string;
  /** larga `count` do item no chão em volta de quem digitou (sem dono; para testar o pet coletor) */
  drop?(itemId: number, count: number): string;
  /** dia e noite: fixa a hora do jogo para todos (1–24, decimal) ou volta a andar (null) */
  time?(hour: number | null): string;
  revive?(id: number): string;
  /** leva um personagem online para `p` (x, y, z FlyFF; o cliente acerta a altura pelo chão) */
  teleport(id: number, p: [number, number, number]): boolean;
  /** mapas em que dá para entrar com //mapa (o principal, os extras e os do projeto) */
  worldList?(): { name: string; id: number }[];
  /** leva quem digitou para outro mapa, no ponto de chegada dele; devolve a mensagem para mostrar */
  travel?(world: string): string;
  /** pontos marcados no editor para o mapa de quem digitou: sem nome lista; com nome leva até o ponto; devolve a mensagem */
  point?(name?: string): string;
  /** quests (data/quests.json): sem op lista e mostra o estado de quem digitou; `reset [id]` zera o andamento */
  quest?(op: 'list' | 'reset', id?: string): Promise<string>;
  /** nome do mapa de quem digitou (para o //pos) */
  where?(): string;
  /** atributo do terreno onde quem digitou está (normal, NoWalk, NoMove…) */
  attr?(): string;
  /** áreas onde a barreira invisível (NoWalk/NoMove) deixa passar: adiciona em volta de quem digitou, lista, apaga uma ou todas */
  open?(op: 'add' | 'list' | 'del' | 'clear', arg?: string): string;
  /** velocidade de corrida em % da normal (100 = normal) de quem digitou; sem número mostra a atual */
  speed?(pct?: number): string;
  /** portais de dungeon do mapa de quem digitou: lista, fecha (não teleporta mais) ou abre */
  portal?(op: 'list' | 'close' | 'open', what?: string): string;
  /** eventos (data/events.json): sem op lista; `run <id>` dispara agora */
  event?(op: 'list' | 'run', id?: string): string;
  /** clima do mapa de quem digitou: sem tipo mostra; chuva/limpo muda (chuva por `minutes`) */
  weather?(kind: 'rain' | 'clear' | null, minutes: number): string;
}

/** elementos (SAI79): nome digitado → número */
const ELEMENTS: Record<string, number> = { fogo: 1, fire: 1, agua: 2, 'água': 2, water: 2, eletrico: 3, 'elétrico': 3, eletricidade: 3, electricity: 3, vento: 4, wind: 4, terra: 5, earth: 5 };
export const ELEMENT_NAMES = ['', 'Fire', 'Water', 'Electric', 'Wind', 'Earth'];

const HELP = [
  '//gm   opens the GM panel',
  '//goto <character>   go to the character · //summon <character>   bring the character to you',
  '//tp <x> <z> [y]   go to the coordinate · //point [name]   list / go to a point marked in the editor · //map [name]   list the maps / go to one (e.g. //map azria)',
  '//set-level [character] <level>   change the level (1–' + MAX_LEVEL + ')',
  '//set-job [character] <class>   change the class (e.g. knight, blade, ringmaster, elementor… or the JOB_* number)',
  '//give-item [character] <II_…|id> [quantity] [+enchant] [element+level] [piercingN]   e.g. //give-item II_WEA_SWO_WOODEN +5 fire+3',
  '   enchant: jewels up to +20, the rest up to +10 · piercing1–4: piercing sockets (suit only) · rar0–N or the name (epic, legendary…): weapon rarity',
  '//drop <II_…|id> [quantity]   drops the item on the ground around you (one at a time, max 20), unowned',
  "//portal [close|open <map>]   lists the map's portals / closes one (the ramp stops teleporting) or opens it again",
  '//unblock [radius]   opens a passage (invisible barrier: NoMove/NoWalk terrain and object collision) in a square around you (default 8 m) · //unblock list · //unblock del <n> · //unblock clear',
  '//speed [10–1000]   your run speed as % of normal (100 = normal; //speed 300 = 3× faster; //speed 100 resets)',
  '//pos   shows your exact position (x, y, z) and the //tp command to come back here',
  '//event [run <id>]   lists the events (data/events.json) / triggers one now · //weather [rain|clear] [minutes]   shows / changes the map weather',
  '//quest   lists the quests and your progress · //quest reset [id]   resets the progress (one or all)',
  '//reset-stats [character]   returns the stat points (STR/STA/DEX/INT go back to 15)',
  '//give-penya [character] <amount>',
  '//bag [character] <42-168>',
  '//mob <MI_…|id> [quantity] [x z]   summons monsters near you or at the point x z (they do not respawn; bosses come aggressive)',
  '//mob-clear   clears the summoned monsters of this map',
  '//invis [on|off]   invisible mode: players cannot see you (GMs/admins still can; mobs let go of you)',
  '//time <hour|auto>   fixes the game hour for everyone (e.g. //time 19, //time 6:30) or goes back to the normal day and night',
  '//god [on|off]   immortal: mobs hit you and the damage shows, but HP does not drop (on at login, for GM/admin)',
  '//kill [character]   kills the character · //revive [character]   revives on the spot with full HP',
  '//help   this list',
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
  if (!authority) { ctx.reply('You do not have permission to use GM commands.'); return; }

  const [cmd, ...args] = text.slice(2).trim().split(/\s+/);
  const name = (cmd ?? '').toLowerCase();
  /** primeiro argumento é nome de personagem se não for o valor esperado do comando */
  const target = async (looksLikeValue: (s: string) => boolean): Promise<GmTarget | null> => {
    if (args.length && !looksLikeValue(args[0])) {
      const t = await findTarget(ctx, args.shift()!);
      if (!t) ctx.reply('Character not found.');
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
    if (!t?.p) { ctx.reply(nick ? `${nick} is not online.` : `Usage: //${name} <character>`); return; }
    if (t.id === ctx.self.id) { ctx.reply('That is you.'); return; }
    if (name === 'goto') { ctx.teleport(ctx.self.id, [t.p[0] + 1.5, t.p[1], t.p[2]]); ctx.reply(`Teleported to ${t.name}.`); }
    else if (ctx.self.p) { ctx.teleport(t.id, [ctx.self.p[0] + 1.5, ctx.self.p[1], ctx.self.p[2]]); ctx.reply(`${t.name} was brought to you.`); }
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

  if (name === 'time' || name === 'hora') {
    const a = (args[0] ?? '').toLowerCase();
    if (!a || a === 'auto' || a === 'off') { ctx.reply(ctx.time?.(null) ?? 'Unavailable.'); log('time auto'); return; }
    const m = /^(\d{1,2})(?::(\d{2}))?$/.exec(a);
    const h = m ? Number(m[1]) + Number(m[2] ?? 0) / 60 : NaN;
    if (!(h >= 0 && h < 24.99)) { ctx.reply('Usage: //time <0–24>[:minutes] or //time auto. E.g.: //time 19 (night), //time 6 (dawn), //time 17:30 (dusk).'); return; }
    // o CGameTimer conta 1–24; 0 = 24 (meia-noite)
    ctx.reply(ctx.time?.(h < 1 ? h + 24 : h) ?? 'Unavailable.');
    log(`time ${a}`);
    return;
  }

  if (name === 'fly' || name === 'voar') {
    const a = (args[0] ?? '').toLowerCase();
    const r = ctx.fly?.(a === 'on' ? true : a === 'off' ? false : undefined);
    if (r) ctx.reply(r);
    log(`fly ${a || 'alterna'}`);
    return;
  }

  if (name === 'god' || name === 'imortal') {
    const a = (args[0] ?? '').toLowerCase();
    const r = ctx.god?.(a === 'on' ? true : a === 'off' ? false : undefined);
    if (r) ctx.reply(r);
    log(`god ${a || 'alterna'}`);
    return;
  }

  if (name === 'kill' || name === 'revive') {
    const t = args[0] ? ctx.online(args[0]) : ctx.self;
    if (!t) { ctx.reply(`${args[0]} is not online.`); return; }
    const r = name === 'kill' ? ctx.kill?.(t.id) : ctx.revive?.(t.id);
    if (r) ctx.reply(r);
    log(`${name} ${t.name}`);
    return;
  }

  if (name === 'mapa' || name === 'map') {
    const q = args.join(' ').trim();
    if (!q) { ctx.reply(`Maps: ${(ctx.worldList?.() ?? []).map((w) => `${w.name} (${w.id})`).join(', ') || 'none'}. Usage: //map <name or part of the name>`); return; }
    const r = ctx.travel?.(q);
    if (r) ctx.reply(r);
    log(`mapa ${q}`);
    return;
  }

  if (name === 'portal' || name === 'portais') {
    const a = (args[0] ?? '').toLowerCase();
    const op = ['fechar', 'close'].includes(a) ? 'close' : ['abrir', 'open'].includes(a) ? 'open' : 'list';
    ctx.reply(ctx.portal?.(op, args.slice(1).join(' ').trim()) ?? 'No portals on this server.');
    log(`portal ${args.join(' ')}`);
    return;
  }
  if (name === 'liberar' || name === 'passagem' || name === 'unblock') {
    const a = (args[0] ?? '').toLowerCase();
    const op = ['lista', 'list'].includes(a) ? 'list' : ['apagar', 'del'].includes(a) ? 'del' : ['limpar', 'clear'].includes(a) ? 'clear' : 'add';
    ctx.reply(ctx.open?.(op, op === 'add' ? args[0] : args[1]) ?? 'No areas on this server.');
    log(`liberar ${args.join(' ')}`);
    return;
  }
  if (name === 'speed' || name === 'velocidade') {
    const raw = args[0];
    const pct = raw === undefined ? undefined : ['normal', 'reset'].includes(raw.toLowerCase()) ? 100 : Number(raw);
    if (pct !== undefined && (!Number.isFinite(pct) || pct < 10 || pct > 1000)) { ctx.reply('Use a value from 10 to 1000 (100 = normal speed). E.g.: //speed 300'); return; }
    ctx.reply(ctx.speed?.(pct === undefined ? undefined : Math.round(pct)) ?? 'No speed control on this server.');
    log(`speed ${args.join(' ')}`);
    return;
  }
  if (name === 'pos' || name === 'position') {
    const [x, y, z] = (ctx.self.p ?? [0, 0, 0]).map((v) => Math.round(v * 100) / 100);
    const at = ctx.attr?.();
    ctx.reply(`Position${ctx.where ? ` in ${ctx.where()}` : ''}: x ${x}  y ${y}  z ${z}   ·   //tp ${x} ${z} ${y}${at ? `   ·   terrain: ${at}` : ''}`);
    log('pos');
    return;
  }
  if (name === 'evento' || name === 'event') {
    const run = (args[0] ?? '').toLowerCase() === 'run';
    ctx.reply(ctx.event?.(run ? 'run' : 'list', run ? args[1] : undefined) ?? 'No events on this server.');
    log(`evento ${args.join(' ')}`);
    return;
  }
  if (name === 'clima' || name === 'weather') {
    const k = (args[0] ?? '').toLowerCase();
    const kind = ['chuva', 'rain'].includes(k) ? 'rain' : ['limpo', 'clear', 'sol'].includes(k) ? 'clear' : null;
    ctx.reply(ctx.weather?.(kind, Math.max(1, Math.min(240, Number(args[1]) || 10))) ?? 'No weather on this server.');
    log(`clima ${args.join(' ')}`);
    return;
  }
  if (name === 'quest' || name === 'quests') {
    const reset = (args[0] ?? '').toLowerCase() === 'reset';
    ctx.reply(await (ctx.quest?.(reset ? 'reset' : 'list', reset ? args[1] : undefined) ?? Promise.resolve('No quests on this server.')));
    log(`quest ${args.join(' ')}`);
    return;
  }
  if (name === 'ponto' || name === 'point') {
    ctx.reply(ctx.point?.(args.join(' ').trim() || undefined) ?? 'No points on this server.');
    log(`ponto ${args.join(' ')}`);
    return;
  }

  if (name === 'tp') {
    const x = Number(args[0]), z = Number(args[1]), y = args[2] === undefined ? (ctx.self.p?.[1] ?? 100) : Number(args[2]);
    if (!Number.isFinite(x) || !Number.isFinite(z) || !Number.isFinite(y)) { ctx.reply('Usage: //tp <x> <z> [y]'); return; }
    if (!ctx.teleport(ctx.self.id, [x, y, z])) { ctx.reply('Coordinate outside the map.'); return; }
    log(`tp ${x} ${z}`);
    ctx.reply(`Teleported to ${Math.round(x)}, ${Math.round(z)}.`);
    return;
  }

  if (name === 'set-level' || name === 'setlevel' || name === 'level') {
    const t = await target(isInt);
    if (!t) return;
    const level = Number(args[0]);
    if (!isInt(args[0]) || level < 1 || level > MAX_LEVEL) { ctx.reply(`Usage: //set-level [character] <level 1–${MAX_LEVEL}>`); return; }
    // pontos de atributo: tudo o que o nível dá (2 por nível) menos o que já foi gasto (o servidor ajusta de novo se estiver online)
    await query(`UPDATE characters SET level = $2, exp = 0, hp = 0, mp = 0, fp = 0,
      stat_points = GREATEST(0, 2 * ($2 - 1) - ((str - 15) + (sta - 15) + (dex - 15) + ("int" - 15))),
      skill_points = (SELECT COALESCE(SUM(((lv - 1) / 20) + 2), 0) FROM generate_series(2, $2) AS lv), skills = '{}'::jsonb, updated_at = now() WHERE id = $1`, [t.id, level]);
    ctx.setLevelLive(t.id, level);
    log(`set-level ${t.name} ${t.level} → ${level}`);
    ctx.reply(`${t.name} is now level ${level}.`);
    return;
  }

  if (name === 'set-job' || name === 'job') {
    const isJob = (s: string) => isInt(s) || JOBS.includes(s.toLowerCase());
    const t = await target(isJob);
    if (!t) return;
    const v = (args[0] ?? '').toLowerCase();
    const job = isInt(v) ? Number(v) : JOBS.indexOf(v);
    if (!v || job < 0 || job >= JOBS.length) { ctx.reply('Usage: //set-job [character] <' + JOBS.slice(0, 14).join('|') + '|number>'); return; }
    await query('UPDATE characters SET job = $2, updated_at = now() WHERE id = $1', [t.id, job]);
    await ctx.setJobLive(t.id, job);
    log(`set-job ${t.name} → ${JOBS[job]} (${job})`);
    ctx.reply(`${t.name} is now ${JOBS[job]}.`);
    return;
  }

  if (name === 'mob-clear') { ctx.reply(ctx.clearMobs ? ctx.clearMobs() : 'Not available here.'); log('mob-clear'); return; }
  if (name === 'mob' || name === 'summon-mob') {
    const what = args[0] ?? '';
    const n = Math.min(30, Math.max(1, Number(args[1]) || 1));
    if (!what) { ctx.reply('Usage: //mob <MI_…|id> [quantity]'); return; }
    const x = Number(args[2]), z = Number(args[3]);
    ctx.reply(ctx.summonMob ? ctx.summonMob(what, n, Number.isFinite(x) && Number.isFinite(z) && args[3] !== undefined ? [x, z] : undefined) : 'Summoning monsters is not available here.');
    log(`mob ${what} ×${n}`);
    return;
  }
  if (name === 'drop') {
    const inv = ctx.inventory, what = args[0];
    const def = !inv ? undefined : isInt(what) ? inv.catalog.byId.get(Number(what)) : inv.catalog.bySymbol.get((what ?? '').toUpperCase());
    if (!def) { ctx.reply(what ? `Item ${what} does not exist.` : 'Usage: //drop <II_…|id> [quantity]'); return; }
    const n = Math.min(20, Math.max(1, isInt(args[1]) ? Number(args[1]) : 1));
    ctx.reply(ctx.drop ? ctx.drop(def.id, n) : 'Dropping items is not available here.');
    log(`drop ${def.symbol} ×${n}`);
    return;
  }
  if (name === 'give-item' || name === 'item') {
    const inv = ctx.inventory;
    if (!inv) { ctx.reply('Inventory unavailable on this server.'); return; }
    const isItem = (s: string) => /^II_/i.test(s) || isInt(s);
    const t = await target(isItem);
    if (!t) return;
    const what = args.shift();
    const def = isInt(what) ? inv.catalog.byId.get(Number(what)) : inv.catalog.bySymbol.get((what ?? '').toUpperCase());
    if (!def) { ctx.reply(what ? `Item ${what} does not exist.` : 'Usage: //give-item [character] <II_…|id> [quantity] [+enchant] [element+level]'); return; }
    // resto: quantidade, +N (enchant) e elemento com nível (fogo+3, agua5…), em qualquer ordem
    let count = 1, u = 0, e = 0, el = 0, p = 0, r = 0;
    const rarityByName = new Map(inv.catalog.rarity.map((x, i) => [x.name.toLowerCase(), i]));
    for (const a of args) {
      const low = a.toLowerCase();
      const m = /^([a-zà-ú]+)\+?(\d+)?$/.exec(low);
      const pierce = /^(?:furos?|piercing|p)(\d)$/.exec(low);
      const rar = /^(?:rar|raridade|r)(\d+)$/.exec(low);
      if (/^\+\d+$/.test(a)) u = Number(a.slice(1));
      else if (rar) r = Number(rar[1]);
      else if (rarityByName.has(low)) r = rarityByName.get(low)!;
      else if (pierce) p = Number(pierce[1]);
      else if (isInt(a)) count = Math.min(9999, Math.max(1, Number(a)));
      else if (m && ELEMENTS[m[1]]) { e = ELEMENTS[m[1]]; el = Math.min(20, Number(m[2] ?? 1)); }
      else { ctx.reply(`I did not understand "${a}". E.g.: //give-item ${def.symbol} 1 +5 fire+3`); return; }
    }
    let left: number;
    if (isCashEquip(def.kind2) && (u || e || p)) { ctx.reply(`${def.name} is a Cash Shop item: it does not accept enchant, element or piercing.`); return; }
    if (e && !acceptsElement(def.parts, def.kind2)) { ctx.reply(`${def.name} does not accept an element.`); return; }
    if (u > maxUpgrade(def.parts, def.kind2)) { ctx.reply(maxUpgrade(def.parts, def.kind2) ? `${def.name} goes up to +${maxUpgrade(def.parts, def.kind2)} at most.` : `${def.name} does not accept enchant.`); return; }
    if (r && def.kind1 !== 1) { ctx.reply('Rarity only applies to weapons.'); return; }
    if (r >= inv.catalog.rarity.length) { ctx.reply(`Rarity goes from 0 to ${inv.catalog.rarity.length - 1}.`); return; }
    if (p > maxPiercing(def.parts, def.kind2)) { ctx.reply(maxPiercing(def.parts, def.kind2) ? `${def.name} opens at most ${maxPiercing(def.parts, def.kind2)} sockets.` : 'Only the suit opens piercing sockets.'); return; }
    try { left = await inv.add(t.id, def.id, count, { u, e, el, p, r }); } catch (err) { ctx.reply((err as Error).message); return; }
    const extra = `${u ? ` +${u}` : ''}${e ? ` (${ELEMENT_NAMES[e]} +${el})` : ''}${p ? ` [${p} socket${p > 1 ? 's' : ''}]` : ''}${r ? ` <${inv.catalog.rarity[r].name}>` : ''}`;
    log(`give-item ${t.name} ${def.symbol}${extra} ×${count - left}`);
    ctx.reply(`${count - left}× ${def.name}${extra} added to ${t.name}'s bag.${left ? ` ${left} did not fit (bag full).` : ''}`);
    return;
  }

  if (name === 'reset-stats' || name === 'resetstats' || name === 'reset-status') {
    const t = await target(() => false);
    if (!t) return;
    // online: aplica na hora (atributos de luta, HP/MP/FP e pontos livres); offline: grava 15 e a conta dos pontos é refeita ao entrar
    if (!ctx.resetStatsLive(t.id)) await query('UPDATE characters SET str = 15, sta = 15, dex = 15, "int" = 15, updated_at = now() WHERE id = $1', [t.id]);
    log(`reset-stats ${t.name}`);
    ctx.reply(`${t.name}'s stat points were returned (STR/STA/DEX/INT = 15).`);
    return;
  }

  if (name === 'bag' || name === 'bolsa') {
    // //bag [personagem] <42–168>: desbloqueia espaços da bolsa (nunca acima do máximo)
    const t = await target(isInt);
    if (!t) return;
    if (!ctx.inventory) { ctx.reply('Inventory unavailable on this server.'); return; }
    const n = Number(args[0]);
    if (!isInt(args[0])) { ctx.reply(`Usage: //bag [character] <${BAG_SLOTS}-${BAG_MAX}>  (open bag slots)`); return; }
    const r = await ctx.inventory.setBag(t.id, n);
    if ('error' in r) { ctx.reply(r.error); return; }
    log(`bag ${t.name} → ${r.bag}`);
    ctx.reply(`${t.name} now has ${r.bag} open bag slots (maximum ${BAG_MAX}).`);
    return;
  }

  if (name === 'give-penya' || name === 'penya') {
    const t = await target(isInt);
    if (!t) return;
    const n = Number(args[0]);
    if (!isInt(args[0]) || n <= 0) { ctx.reply('Usage: //give-penya [character] <amount>'); return; }
    if (!ctx.inventory) { ctx.reply('Inventory unavailable on this server.'); return; }
    const gold = await ctx.inventory.addGold(t.id, n);
    log(`give-penya ${t.name} +${n}`);
    ctx.reply(`${t.name} now has ${gold.toLocaleString('en-US')} penya.`);
    return;
  }

  ctx.reply(`Unknown command: //${cmd}. Type //help.`);
}
