import { FILTER, cleanPetFilter, emptyPetFilter, type PetFilter } from '../../shared/petfilter';
import type { IncomingMessage, Server } from 'node:http';
import { TICKS_PER_SEC } from '../../shared/math';
import type { Duplex } from 'node:stream';
import { WebSocketServer, WebSocket } from 'ws';
import { pool, query } from '../common/db/index';
import { sessionFrom, type Session } from '../auth/sessions';
import type { MobWorld } from './mobs';
import { INVENTORY_CHANNEL, type Inventory, type InvState } from '../character/inventory';
import { gmAuthority, runGmCommand } from './gm';
import { rankOf, type Rank } from '../../shared/rank';
import { RIDE_TAG } from '../../shared/look';
import { TRADE_SLOTS, type TradeOffer } from '../character/inventory';
import { ItemCatalog, jobCanUse } from '../common/items';
import type { CombatRules, Equipped, Fighter } from './combat';
import { MOB_ATTACK_RANGE, type Mob } from './mobs';
import { GROUND_MS, OWNER_MS, type DropRules } from './drops';
import { notifyInventory } from '../character/inventory';
import type { ShopCatalog } from './shops';
import type { SkillCatalog } from './skills';
import fs from 'node:fs';
import path from 'node:path';
import { decodeText } from '../../shared/formats/rgn';
import { rates } from '../common/rates';
import { parseTeleports } from '../../shared/formats/teleport';
import { PartyManager, PARTY_MAX, PARTY_SKILLS, partyExpShares, type Party } from './party';
import type { MoverProp } from './world';
import { UpgradeRules, type SmithResult } from './upgrade';
import type { InvEdit } from '../character/inventory';

/**
 * Tempo real (fase 2): WebSocket em `/ws` no mesmo servidor HTTP (Vite em dev, `server/index.ts` em produção).
 * Mensagens JSON (cliente → servidor):
 *   { t: 'join', token, characterId }               entra no mundo com um personagem da conta logada (token do /api/login)
 *   { t: 'state', p: [x, y, z], h, s }              posição FlyFF, rumo (graus) e estado de animação (stand/walk/run/jump1–4)
 *   { t: 'chat', text }                             mensagem no chat geral (até CHAT_MAX caracteres, no máximo 5 a cada 5 s);
 *                                                   começando com // é comando de GM (server/gm.ts), não vai para ninguém
 *   { t: 'invMove', from: [c, s], to: [c, s] }      move/troca/empilha/equipa (c 0 = bolsa, 1 = equipado com s = PARTS_*)
 *   { t: 'atk', id }                                golpe no mob `id` (o servidor confere alcance, ritmo e calcula tudo)
 *   { t: 'skillUp', levels: { id: nível } } / { t: 'skill', id, target }   aprender/subir skills / lançar no mob `target`
 *   { t: 'shopOpen', key } / { t: 'buy', key, id, n } / { t: 'sell', key, s, n }   loja do NPC (perto dele): abrir, comprar, vender
 *   { t: 'use', id } / { t: 'bar', slots }          usa um item da bolsa pelo id (barra de atalhos) / salva a barra (10 posições)
 *   { t: 'statUp', str, sta, dex, int }            distribui pontos de atributo (soma ≤ pontos livres)
 *   { t: 'pick', id }                               pega o item `id` do chão (perto, dono ou depois de 30 s)
 *   { t: 'gmItems', q, k, g }                       painel de GM: busca no catálogo de itens (só contas GM); g = raridade (dwItemGrade)
 *   { t: 'invUse', c, s }                           duplo clique: equipa (da bolsa) ou desequipa (para a bolsa)
 *   { t: 'invDrop', s, n }                          lixeira: apaga `n` do item do espaço `s` da bolsa (não volta)
 *   { t: 'invSort' }                                organiza a bolsa por tipo e junta as pilhas
 *   { t: 'upgrade', s, m }                          martelo: material `m` (Sunstone, orichalcum brilhante, moonstone em joia, carta de
 *                                                   elemento) no item `s` da bolsa, sem proteção — resposta { t: 'smith', ok, fx, s, text }
 *   { t: 'smith', key, op, s, m, g, safe, rate }    ferreiro perto do NPC `key`: safe (upgrade seguro), pierceSize, pierceRemove,
 *                                                   removeGem, trans, makeGem, mixJewel, setGem (servers/world/upgrade.ts); `safe` = upgrade seguro
 *   { t: 'pierce', card, target }                   piercing: espeta a carta do espaço `card` da bolsa na suit do espaço `target` (também
 *                                                   da bolsa, não equipada) — resposta { t: 'pierced', ok, s } e o inventário novo
 *   { t: 'npcMenu', key } / { t: 'npcBuff', key }     perto do NPC: o que ele oferece (loja, buffs) / receber os buffs (Buff Pang)
 *   { t: 'zckTeleport', k }                         teleporte da janela Teleporter (tecla V): destino `k` do ZckTeleporteur.inc
 *   { t: 'buffOff', id }                            tira o buff da skill `id` (botão direito no ícone)
 *   { t: 'hide', m }                                partes escondidas do visual (bits de shared/look.ts HIDEABLE; também vai no 'join')
 *   { t: 'friendAdd', id } / { t: 'friendAnswer', id, ok } / { t: 'friendDel', id }   Mensageiro (tecla E): pedir amizade a
 *                                                   um jogador online, responder um pedido recebido, desfazer a amizade
 *   { t: 'partyInvite', id } / { t: 'partyAnswer', id, ok } / { t: 'partyLeave' } / { t: 'partyKick', id } /
 *   { t: 'partyLead', id } / { t: 'partySkill', k } / { t: 'partyList' }   party (P): convidar, responder convite, sair,
 *                                                   expulsar e passar liderança (líder), buff de party (líder), lista (L)
 *   { t: 'guildCreate', name } / { t: 'guildInvite', id } / { t: 'guildAnswer', id, ok } / { t: 'guildLeave' } /
 *   { t: 'guildKick', id } / { t: 'guildDisband' } / { t: 'guildInfo' }   guild (G): criar (líder de party; a party entra
 *                                                   junto), convidar, responder, sair, expulsar, desfazer (mestre), ver
 *   { t: 'revive' } / { t: 'res', id, target }      morto: renascer no ponto do mapa / Assist lança Resurrection (skill
 *   { t: 'tradeReq', id } / { t: 'tradeAnswer', id, ok } / { t: 'tradeItem', s, n } / { t: 'tradeRemove', s } / { t: 'tradeGold', gold }
 *   { t: 'tradeLock' } / { t: 'tradeOk' } / { t: 'tradeCancel' }   trade: pedir, responder, pôr/tirar item da bolsa e penya,
 *                                                   OK (trava a oferta; qualquer mudança tira), confirmar (os dois) e cancelar
 *   { t: 'stance' }                                 modo de batalha (janela de movimentos): postura de combate ↔ normal; atacar religa
 *                                                   `id`) no jogador morto `target`, que levanta ali mesmo
 *   { t: 'pm', to, text } / { t: 'pm', toName, text }   mensagem privada para um jogador online, pelo id (janela de
 *                                                   conversa) ou pelo nome (/say Nome msg no chat); mesmos limites do chat
 * (servidor → cliente):
 *   { t: 'welcome', id, players: PlayerView[] }     seu id + quem já está no mundo
 *   { t: 'ping', c } → { t: 'pong', c }          ping do rodapé (o cliente mede a ida e volta)
 *   { t: 'pet', a, m }                               pet coletor do jogador `a` apareceu (m = MI_*) ou sumiu (m = 0)
 *   { t: 'petGo', a, x, z, ms }                      o pet de `a` vai buscar o item em (x, z) e chega em `ms`
 *   { t: 'petFilter', f, n } ↔                       filtro do pet (o cliente manda para gravar; o servidor manda ao entrar, n = nome e ícone dos itens das listas)
 *   { t: 'petFind', q } → { t: 'petFind', list }     busca de itens para as listas do filtro: [id, nome, ícone]
 *   { t: 'clock', now, fixed }                       relógio do servidor (dia e noite) e a hora fixada pelo GM (null = andando)
 *   { t: 'friends', list: FriendView[] } / { t: 'friendOn', id, on } / { t: 'friendReq', id, name }
 *   { t: 'friendNew', f: FriendView } / { t: 'friendDel', id }   lista de amigos (ao entrar), amigo entrou/saiu, pedido
 *                                                   recebido, amizade feita, desfeita
 *   { t: 'party', p: PartyView | null } / { t: 'partyReq', id, name } / { t: 'partyList', list }   sua party (ao mudar e
 *                                                   a cada 1,5 s, com o HP dos membros), convite recebido, lista de partys
 *   { t: 'guildView', g } / { t: 'guildReq', id, name, guild } / { t: 'guildTag', id, g, m? }   sua guild (membros, cargos),
 *                                                   convite recebido, nome da guild de alguém mudou (acima do nome)
 *   { t: 'pm', with, wname, from, name, text }      mensagem privada (com quem é a conversa e o nome dele, quem escreveu)
 *   { t: 'tradeReq', id, name } / { t: 'trade', name, me, them, lock: [eu, ele], ok: [eu, ele] } / { t: 'tradeClose', text }
 *                                                   trade: pedido recebido, janela (ofertas: { gold, items: [{ s, it, d }] }), fechou
 *   { t: 'enter', player: PlayerView }              alguém entrou
 *   { t: 'invis', id, on }                          GM ficou invisível / visível (Dark Illusion; só GMs/admins e ele mesmo recebem)
 *   { t: 'god', on }                                seu modo imortal de GM/admin (//god; ligado ao entrar)
 *   { t: 'leave', id }                              alguém saiu
 *   { t: 'states', list: [id, x, y, z, h, s][] }    atualizações agrupadas, 10 por segundo, só de quem mudou
 *   { t: 'inv', gold, bag, items: [c, s, itemId, n][], defs }   inventário inteiro (ao entrar e a cada mudança)
 *   { t: 'invError', error }                        pedido recusado (nível, sexo, espaço ocupado…)
 *   { t: 'gmOpen' } / { t: 'gmItems', list }        abre o painel de GM / resultado da busca de itens
 *   { t: 'teleport', p }                            GM levou você para p (x, y, z)
 *   { t: 'hit', k: 'p'|'m', a, d, dmg, f, hp }      golpe: k 'p' jogador a → mob d, k 'm' mob a → jogador d; f 1 = errou,
 *                                                   2 = crítico; hp = HP do alvo (mob: em milésimos do máximo; jogador: valor)
 *   { t: 'mdie', id, k } / { t: 'pdie', id }        mob morreu (k = quem levou a exp) / jogador morreu
 *   { t: 'skills', points, levels: { id: nível }, list }   suas skills (ao entrar, ao mudar de classe e ao aprender)
 *   { t: 'skillUsed', id, cd }                      skill lançada: espera até a próxima
 *   { t: 'shop', key, name, tabs: [{ name, items: [{ ...ItemView, price }] }] }   janela de loja (resposta do shopOpen)
 *   { t: 'used', id, hp, mp, fp, cd }               item usado: quanto curou e a espera (ms) até usar de novo
 *   { t: 'bar', slots: ({ id, icon, name } | null)[] }   sua barra de atalhos (ao entrar)
 *   { t: 'ground', a: [id, itemId, x, z, n, gold, upgrade, nome][], d: id[] }   itens no chão perto (gold > 0 = penya)
 *   { t: 'stats', hp, maxHp, mp, maxMp, fp, maxFp, exp, expMax, level, mv }   seus atributos (ao entrar e quando mudam);
 *                                                   mv = velocidade de corrida (u/s) com os bônus de itens e buffs
 *   { t: 'level', id, level }                       nível mudou (comando de GM)
 *   { t: 'look', id, eq, mt }                           alguém trocou o equipamento (eq = símbolos II_* equipados)
 *   { t: 'chat', id, name, text }                   mensagem de chat de alguém (inclusive a sua, ecoada pelo servidor)
 *   { t: 'announce', text, loops }                  anúncio do painel admin: letreiro no meio da tela, `loops` passagens
 *   { t: 'error', error }                           e fecha (sessão inválida, personagem de outra conta…)
 *   { t: 'mobs', a: [id, modelId, x, z, h, s, y|null, hp][], u: [id, x, z, h, s, hp][], d: id[] }
 *                                                   mobs perto do jogador (5×/s): entraram (a), mudaram (u), saíram (d); y só de voadores;
 *                                                   s stand/walk/run/dead; hp em milésimos do máximo
 * O servidor confere a sessão e o dono do personagem, descarta valores absurdos e salva a posição ao sair.
 */
export interface PlayerView { /** mundo onde está (WdMadrigal, WdKebaras…) */ w: string; /** nome da guild (aparece acima do nome) */ guild?: string; id: number; name: string; sex: number; hair: number; head: number; /** cor do cabelo (m_dwHairColor; 0 = padrão) */ hc?: number; /** pet coletor (MI_*) seguindo o personagem */ pet?: number; /** mestre da guild (nome da guild dourado) */ gmaster?: 1; level: number; p: [number, number, number]; h: number; s: string; /** símbolos II_* equipados */ eq: string[]; /** postura de combate 1–15 (0 = sem arma) */ mt: number; /** classe (JOB_*) */ job: number; /** conta de admin ou GM (cor do nome) */ rank?: Rank; /** GM invisível (Dark Illusion) — só GMs/admins recebem */ iv?: 1 }

/** trade entre dois jogadores: o que cada um pôs, quem deu OK (trava a oferta) e quem confirmou a troca */
interface Trade { a: Conn; b: Conn; offer: Map<Conn, TradeOffer>; lock: Set<Conn>; ok: Set<Conn>; busy: boolean }
interface Conn { ws: WebSocket; player: PlayerView | null; accountId: number; dirty: boolean; alive: boolean; /** mobs que este cliente conhece */ mobs: Set<number>; /** horários das últimas mensagens de chat */ chatAt: number[]; /** pedidos de inventário em fila (um de cada vez) */ invQueue: Promise<void>; /** gravação do 'online = true' (a saída espera por ela) */ onlineSet?: Promise<void>; /** quando entrou no mundo (ms) — tempo de jogo */ joinedAt: number;
  /** combate: atributos, HP/MP/FP, exp, morte, ritmo dos golpes */ cb: PlayerCombat | null;
  /** itens do chão que este cliente conhece */ ground: Set<number>;
  /** partes do visual escondidas pelo jogador (máscara de bits, shared/look.ts) */ hide: number;
  /** GM invisível (Dark Illusion do painel): jogadores comuns não o veem e os mobs o ignoram */ invis?: boolean;
  /** GM/admin imortal (//god, ligado ao entrar): os golpes chegam e o dano aparece, mas o HP não cai */ god?: boolean;
  /** pet coletor ativo (item IK3_PET): item, MI_* que aparece, ocupado buscando um item até `busy` (ms) e itens que não couberam */
  pet?: { item: number; mover: number; busy: number; skip: Set<number> };
  /** filtro do pet (janela Pet Filter, tecla U) */ petFilter?: PetFilter;
  /** modo de batalha desligado (MOT_BASE_BATTLE): postura normal mesmo com arma; atacar liga de novo */ peace?: boolean; /** postura da arma equipada */ weaponMt?: number;
  /** ids dos amigos (Mensageiro) e pedidos de amizade recebidos (id de quem pediu → quando) */ friends?: Set<number>; friendReqs?: Map<number, number>;
  /** convites de party recebidos (id de quem convidou → quando) */ partyReqs?: Map<number, number>;
  /** trade aberto e pedidos de trade recebidos (id de quem pediu → quando) */ trade?: Trade | null; tradeReqs?: Map<number, number>;
  /** recebendo os buffs do Buff Pang (um a cada 0,5 s) */ buffing?: boolean;
  /** trocando de mundo: a conexão fecha e o cliente entra de novo no mundo novo (não sai da party nem avisa os amigos) */ switching?: boolean;
  /** de onde veio ao entrar num mapa de ticket (usar o ticket de novo volta para cá) */ ticketFrom?: { w: string; p: [number, number, number] };
  /** guild do personagem (cargo: 0 mestre … 4 rookie) e convites de guild recebidos */ guild?: { id: number; name: string; rank: number } | null; guildReqs?: Map<number, number>;
  /** último emote/emoticon (ms) — no máximo 3 por segundo */ emoteAt?: number;
  /** anti-speedhack: última mensagem de posição (ms), reserva de deslocamento (u), último puxão de volta e quantos já levou */
  move?: { at: number; budget: number; pulledAt: number; pulls: number } }

/** item no chão (drop de mob) */
interface GroundItem { /** mundo */ w: string; id: number; itemId: number; count: number; upgrade: number; gold: number; x: number; z: number; owner: number; ownerUntil: number; expires: number }
/** raio em que os itens do chão aparecem e distância máxima para pegar (com folga de rede) */
const GROUND_RADIUS = 60, PICK_RANGE = 4;

interface PlayerCombat {
  f: Fighter; hp: number; maxHp: number; mp: number; maxMp: number; fp: number; maxFp: number; exp: number;
  dead: boolean; nextAtk: number; lastHurt: number; dirty: boolean;
  /** pontos de atributo livres (m_nRemainGP) */ points: number;
  /** próxima vez que pode usar um item de cada grupo (comida/poção/refresher), ms */ readyAt: Map<number, number>;
  /** skills: níveis aprendidos, pontos livres e quando cada uma pode ser lançada de novo */ skills: Map<number, number>; skillPoints: number; skillReady: Map<number, number>;
  /** buffs ativos (skill → nível, fim e os efeitos DST que somam aos atributos de luta) */ buffs: Map<number, { lv: number; until: number; dst: [number, number][] }>;
}

/** raio (unidades) e limite de mobs enviados a cada jogador */
const MOB_RADIUS = 150, MOB_MAX = 80;

const STATES = new Set(['stand', 'walk', 'run', 'jump1', 'jump2', 'jump3', 'jump4', 'atk', 'dead', 'emote', 'fly', 'flyrun']);
/** alcance do golpe do jogador (corpo a corpo) com folga para a latência, e de onde se renasce ao morrer (Flaris) */
const PLAYER_ATTACK_RANGE = MOB_ATTACK_RANGE + 2.2;
/** alcance aceito para o golpe com a arma equipada: corpo a corpo como antes; arco/ioiô pelo dwAttackRange, com a mesma folga */
const reachOf = (range: number) => Math.max(PLAYER_ATTACK_RANGE, range + 2.2);
const REVIVE_AT: [number, number, number] = [6976, 100, 3327];
const REVIVE_MS = 5000;
const TICK_MS = 100;
/** limite do mapa (WdMadrigal: 30×30 tiles de 512) com folga; y razoável */
const inWorld = (p: unknown[]): p is number[] => p.length === 3 && p.every((v) => typeof v === 'number' && Number.isFinite(v)) && (p as number[])[0] > 0 && (p as number[])[2] > 0 && (p as number[])[0] <= 30 * 512 && (p as number[])[2] <= 30 * 512 && (p as number[])[1] > -500 && (p as number[])[1] < 3000;
/** maior deslocamento aceito entre duas mensagens (100 ms; corrida ≈ 1 unidade, queda/rede lenta com folga) — acima disso é ignorado */
const MAX_STEP = 60;
/**
 * Anti-speedhack: o deslocamento no chão (XZ) gasta uma reserva que enche a SPEED_SLACK × a velocidade calculada pelo servidor
 * (corrida pelo fSpeed + DST_SPEED; voando, o teto do voo), guardando até SPEED_BURST_S segundos — cobre mensagens que chegam
 * juntas depois de um soluço da rede. Passou da reserva: a posição não muda e o cliente volta para a do servidor (no máximo
 * 1 vez a cada PULLBACK_MS).
 */
const SPEED_SLACK = 1.25, SPEED_BURST_S = 3, SPEED_EXTRA = 2, PULLBACK_MS = 1000;
/** teto do voo (u/s): |fv| até 0,3 × 1,1 (turbo) por tique do Neuz, como em Player.updateFly */
const FLY_MAX_SPEED = 0.33 * TICKS_PER_SEC;
/** chat: tamanho máximo da mensagem e limite de 5 mensagens a cada 5 s por conexão */
const CHAT_MAX = 200, CHAT_BURST = 5, CHAT_WINDOW_MS = 5000;

/** um mundo carregado no servidor: mobs, NPCs/lojas, id do mundo (WI_WORLD_*) e onde se chega/renasce */
export interface WorldRuntime { name: string; id: number; define: string; mobs: MobWorld | null; shops: ShopCatalog | null; start: [number, number, number] }
export interface RealtimeOptions { /** mundos além do principal (ex.: WdKebaras = Azria) */ worlds?: WorldRuntime[]; mainWorld?: string; mobs?: MobWorld; inventory?: Inventory; combat?: CombatRules; drops?: DropRules; shops?: ShopCatalog; skills?: SkillCatalog; resolveSession?: (token: string) => Promise<Session | null> }
export function attachRealtime(http: Server, opts: RealtimeOptions = {}) {
  const inventory = opts.inventory ?? null;
  // ---------- mundos: o principal (opts.mobs/opts.shops) e os extras; cada jogador está em um ----------
  const MAIN = opts.mainWorld ?? 'WdMadrigal';
  const worlds = new Map<string, WorldRuntime>();
  worlds.set(MAIN, { name: MAIN, id: 1, define: 'WI_WORLD_MADRIGAL', mobs: opts.mobs ?? null, shops: opts.shops ?? null, start: [...REVIVE_AT] });
  for (const w of opts.worlds ?? []) worlds.set(w.name, w);
  /** mundo do jogador (ou o principal) */
  const W = (c: Conn | null | undefined) => worlds.get(c?.player?.w ?? MAIN) ?? worlds.get(MAIN)!;
  const worldByDefine = (d: string) => [...worlds.values()].find((w) => w.define === d) ?? null;
  /** ticket.inc: item de viagem → mundo e ponto de chegada (ex.: Azria Ticket → WI_WORLD_KEBARAS 1271, 114, 1326) */
  const tickets = (() => {
    const m = new Map<string, { define: string; pos: [number, number, number] }>();
    if (!inventory) return m;
    try {
      for (const line of fs.readFileSync(path.join(inventory.catalog.resDir, 'ticket.inc'), 'latin1').split(/\r?\n/)) {
        const f = line.replace(/\/\/.*$/, '').trim().split(/\s+/);
        if (f.length >= 5 && /^II_/.test(f[0]) && /^WI_WORLD_/.test(f[1])) m.set(f[0], { define: f[1], pos: [Number(f[2]), Number(f[3]), Number(f[4])] });
      }
    } catch { /* sem a tabela */ }
    return m;
  })();
  /** destinos do teleporte (ZckTeleporteur.inc) — mesmo leitor do cliente, então o índice bate */
  const teleports = (() => {
    if (!inventory) return [];
    try { const b = fs.readFileSync(path.join(inventory.catalog.resDir, 'ZckTeleporteur.inc')); return parseTeleports(decodeText(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer, 'windows-1252')); } catch { return []; }
  })();
  const rules = opts.combat ?? null;
  /** ferreiro (upgrade, elemento, piercing, ultimate) — também dá ao combate as joias da ultimate e o fator de elemento */
  const smith = inventory ? new UpgradeRules(inventory.catalog) : null;
  if (rules && smith) rules.upgrade = smith;
  if (inventory && smith) inventory.failStack = Object.fromEntries([...smith.failStack].map(([k, m]) => [String(k), Object.fromEntries(m)]));
  /** operação de ferreiro → menus do NPC (character.inc) que a liberam */
  const SMITH_MENUS: Record<string, string[]> = {
    safe: ['MMI_SMELT_SAFETY_GENERAL', 'MMI_SMELT_SAFETY_ACCESSORY', 'MMI_SMELT_SAFETY_ELEMENT', 'MMI_SMELT_SAFETY_PIERCING'],
    pierceSize: ['MMI_PIERCING'], pierceRemove: ['MMI_SMELT_REMOVE_PIERCING', 'MMI_PIERCING_REMOVE'], removeGem: ['MMI_SMELT_REMOVE_JEWEL'],
    trans: ['MMI_SMELT_CHANGEGWEAPON', 'MMI_SMELT_CHANGEUWEAPON'], makeGem: ['MMI_SMELT_EXTRACTION'], mixJewel: ['MMI_SMELT_MIXJEWEL'], setGem: ['MMI_SMELT_JEWEL'],
  };
  const dropRules = opts.drops ?? null;
  void query('UPDATE characters SET online = false WHERE online').catch(() => {}); // servidor (re)iniciou: ninguém está online
  const skillCat = opts.skills ?? null;
  const ground = new Map<number, GroundItem>();
  let groundSeq = 0;
  const wss = new WebSocketServer({ noServer: true, maxPayload: 4096 });
  const conns = new Set<Conn>();
  /** contadores para o painel admin: conexões desde o boot e mensagens recebidas/enviadas */
  const counters = { connections: 0, msgIn: 0, msgOut: 0 };

  // só trata /ws; outros upgrades (ex.: HMR do Vite) seguem para quem os atende
  http.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    if ((req.url ?? '').split('?')[0] !== '/ws') return;
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });

  const send = (ws: WebSocket, msg: unknown) => { if (ws.readyState === WebSocket.OPEN) { ws.send(JSON.stringify(msg)); counters.msgOut++; } };
  /**
   * GMs invisíveis (Dark Illusion do painel): o que eles fazem (aparecer, mexer, golpear, efeitos…) não chega a quem não é
   * GM/admin. `actorOf` diz de quem é a mensagem; `seesActor` se o destinatário pode ver.
   */
  const invisIds = new Set<number>();
  const isStaff = (o: Conn) => !!o.player?.rank;
  const actorOf = (msg: unknown): number | null => {
    if (!invisIds.size) return null;
    const m = msg as { t?: string; id?: number; a?: number; d?: number; k?: string; player?: { id: number } };
    switch (m.t) {
      case 'enter': return m.player?.id ?? null;
      case 'look': case 'pdie': case 'getup': case 'emote': case 'emo': case 'job': case 'guildTag': case 'level': return m.id ?? null;
      case 'hit': return (m.k === 'p' ? m.a : m.d) ?? null;
      case 'skillfx': return m.a ?? null;
      default: return null;
    }
  };
  const seesActor = (o: Conn, actor: number | null) => actor === null || !invisIds.has(actor) || o.player?.id === actor || isStaff(o);
  /** para todos (ou só quem está no mundo `w`) */
  const broadcast = (msg: unknown, except?: Conn, w?: string) => {
    const data = JSON.stringify(msg), actor = actorOf(msg);
    for (const c of conns) if (c !== except && c.player && (!w || c.player.w === w) && c.ws.readyState === WebSocket.OPEN && seesActor(c, actor)) { c.ws.send(data); counters.msgOut++; }
  };

  async function savePosition(p: PlayerView, cb: PlayerCombat | null = null, playedMs = 0) {
    try {
      await query('UPDATE characters SET pos_x = $2, pos_y = $3, pos_z = $4, angle = $5, online = false, play_minutes = play_minutes + $6, last_online_at = now(), updated_at = now(), world_id = $7 WHERE id = $1',
        [p.id, p.p[0], p.p[1], p.p[2], p.h, Math.floor(playedMs / 60000), worlds.get(p.w)?.id ?? 1]);
      if (cb) await saveCombat(p.id, cb, p.level);
    } catch (e) { console.error('realtime: falha ao salvar posição', p.name, (e as Error).message); }
  }

  const PARENT_JOB: Record<number, number> = { 6: 1, 7: 1, 8: 2, 9: 2, 10: 3, 11: 3, 12: 4, 13: 4 };
  /** classe que o nível permite: abaixo do nível mínimo da classe (15 → 1ª classe, 60 → 2ª) volta para a anterior, até a Vagrant */
  function jobForLevel(job: number, level: number) {
    while (job !== 0 && level < (job < 6 ? 15 : 60)) job = PARENT_JOB[job] ?? 0;
    return job;
  }
  /**
   * Pontos de atributo e de skill = o que o nível dá menos o que já foi gasto. Corrige personagem cujo nível foi mexido fora do jogo
   * (banco, //set-level offline) e tira skills de classes que ele não tem mais.
   */
  function reconcilePoints(cb: PlayerCombat, level: number) {
    if (!rules) return;
    if (skillCat) {
      const lin = skillCat.lineage(cb.f.job);
      let spent = 0;
      for (const [id, lv] of [...cb.skills]) {
        const s = skillCat.byId.get(id);
        if (!s || !lin.has(s.job)) { cb.skills.delete(id); continue; }
        spent += lv * skillCat.cost(s);
      }
      cb.skillPoints = Math.max(0, skillCat.totalAt(level) - spent);
    }
    const b = cb.f.base;
    cb.points = Math.max(0, rules.totalGp(level) - ((b.str - 15) + (b.sta - 15) + (b.dex - 15) + (b.int - 15)));
  }

  /** aplica a mudança de classe: banco, atributos de luta, postura da arma, skills e aviso a todos */
  async function changeJob(c: Conn, job: number) {
    const p = c.player, cb = c.cb;
    if (!p || !cb || !inventory) return;
    cb.exp = 0;
    p.job = job;
    cb.f.job = job;
    await query('UPDATE characters SET job = $2, updated_at = now() WHERE id = $1', [p.id, job]);
    const st = await inventory.state(p.id);
    refreshFighter(c, st);
    send(c.ws, skillsMsg(c));
    send(c.ws, statsMsg(c));
    const mt = stanceOf(c, inventory.combatMotion(st, job));
    if (mt !== p.mt) p.mt = mt;
    broadcast({ t: 'look', id: p.id, eq: p.eq, mt: p.mt });
    broadcast({ t: 'job', id: p.id, job });
    send(c.ws, { t: 'chat', id: 0, name: '', text: `Você agora é ${JOB_NAMES[job] ?? '#' + job}!` });
    void saveCombat(p.id, cb, p.level).catch((e) => console.error('realtime: salvar classe', e));
  }
  const JOB_NAMES: Record<number, string> = { 1: 'Mercenary', 2: 'Acrobat', 3: 'Assist', 4: 'Magician', 6: 'Knight', 7: 'Blade', 8: 'Jester', 9: 'Ranger', 10: 'Ringmaster', 11: 'Billposter', 12: 'Psykeeper', 13: 'Elementor' };

  /** grava aos poucos: a cada 30 s, quem mudou (posição, vida, exp…) desde a última gravação; o inventário tem a própria fila */
  const lastSaved = new Map<number, string>();
  const AUTOSAVE_MS = 30_000;
  const signature = (p: PlayerView, cb: PlayerCombat | null) => `${Math.round(p.p[0])},${Math.round(p.p[2])},${cb ? `${cb.hp},${cb.mp},${cb.fp},${cb.exp},${p.level},${cb.points},${cb.skillPoints},${cb.buffs.size ? Date.now() : ''}` : ''}`; // com buff ativo grava sempre (o tempo restante muda)
  async function autosave() {
    for (const c of [...conns]) {
      const p = c.player, cb = c.cb;
      if (!p) continue;
      const sig = signature(p, cb);
      if (lastSaved.get(p.id) === sig) continue;
      lastSaved.set(p.id, sig);
      try {
        await query('UPDATE characters SET pos_x = $2, pos_y = $3, pos_z = $4, angle = $5, updated_at = now() WHERE id = $1', [p.id, p.p[0], p.p[1], p.p[2], p.h]);
        if (cb) await saveCombat(p.id, cb, p.level);
      } catch (e) { lastSaved.delete(p.id); console.error('realtime: autosave', p.name, (e as Error).message); }
    }
  }
  const autosaveTimer = setInterval(() => void autosave(), AUTOSAVE_MS);
  autosaveTimer.unref?.();

  /** desligar o servidor: grava todo mundo (posição, combate, inventário) e marca como offline */
  async function shutdown() {
    clearInterval(autosaveTimer);
    await Promise.all([...conns].filter((c) => c.player).map((c) => savePosition(c.player!, c.cb, Date.now() - c.joinedAt)));
    await inventory?.flushAll();
  }

  /** HP/MP/FP, exp e nível no banco (0 em HP significa "cheio" para personagem novo, então morto grava 1) */
  async function saveCombat(id: number, cb: PlayerCombat, level: number) {
    await query('UPDATE characters SET hp = $2, mp = $3, fp = $4, exp = $5, level = $6, str = $7, sta = $8, dex = $9, "int" = $10, stat_points = $11, skills = $12, skill_points = $13, updated_at = now() WHERE id = $1',
      [id, Math.max(1, cb.hp), Math.max(1, cb.mp), Math.max(1, cb.fp), cb.exp, level, cb.f.base.str, cb.f.base.sta, cb.f.base.dex, cb.f.base.int, cb.points, JSON.stringify(Object.fromEntries(cb.skills)), cb.skillPoints]);
    await saveBuffs(id, cb);
  }

  // ---------- buffs guardados (characters.buffs, migração 013) ----------
  /** sem a coluna (migração não aplicada) os buffs só não ficam guardados; o resto grava normal */
  let buffsColumn = true;
  async function saveBuffs(id: number, cb: PlayerCombat) {
    if (!buffsColumn) return;
    const now = Date.now();
    const list = [...cb.buffs].filter(([, b]) => b.until > now).map(([skill, b]) => ({ id: skill, lv: b.lv, left: b.until - now, dst: b.dst }));
    try { await query('UPDATE characters SET buffs = $2 WHERE id = $1', [id, JSON.stringify(list)]); }
    catch (e) { if (/column "buffs"/.test((e as Error).message)) { buffsColumn = false; console.error('realtime: falta a coluna characters.buffs — rode "npm run db:migrate" para guardar os buffs'); } else throw e; }
  }
  /** buffs guardados do personagem (o tempo restante volta a correr a partir de agora) */
  async function loadBuffs(id: number): Promise<PlayerCombat['buffs']> {
    const out: PlayerCombat['buffs'] = new Map();
    if (!buffsColumn) return out;
    try {
      const r = await query<{ buffs: unknown }>('SELECT buffs FROM characters WHERE id = $1', [id]);
      const now = Date.now();
      for (const b of Array.isArray(r.rows[0]?.buffs) ? r.rows[0].buffs as Record<string, unknown>[] : []) {
        const skill = Number(b.id), lv = Number(b.lv), left = Number(b.left);
        const dst = Array.isArray(b.dst) ? (b.dst as unknown[]).filter((d): d is [number, number] => Array.isArray(d) && d.length === 2 && d.every(Number.isFinite)) : [];
        if (!Number.isInteger(skill) || !(left > 0) || !dst.length || !skillCat?.byId.has(skill)) continue;
        out.set(skill, { lv: Number.isFinite(lv) ? lv : 1, until: now + Math.min(left, 24 * 3600_000), dst });
      }
    } catch (e) { if (/column "buffs"/.test((e as Error).message)) buffsColumn = false; else console.error('realtime: ler buffs', (e as Error).message); }
    return out;
  }
  /** botão direito no ícone: tira o buff (como cancelar o buff no original) */
  function removeBuff(c: Conn, skill: number) {
    const p = c.player, cb = c.cb;
    if (!p || !cb || !cb.buffs.delete(skill)) return;
    void inventory?.state(p.id).then((st) => { refreshFighter(c, st); send(c.ws, buffsMsg(c)); send(c.ws, statsMsg(c)); void saveBuffs(p.id, cb).catch(() => {}); });
  }

  // ---------- combate ----------
  const connOf = (playerId: number) => { for (const c of conns) if (c.player?.id === playerId) return c; return null; };
  /** manda para quem está perto de (x, z) */
  /** para quem está perto de (x, z) no mundo `w` */
  const sendNear = (w: string, x: number, z: number, msg: unknown) => {
    const data = JSON.stringify(msg), actor = actorOf(msg);
    for (const c of conns) if (c.player && c.player.w === w && c.ws.readyState === WebSocket.OPEN && Math.hypot(c.player.p[0] - x, c.player.p[2] - z) <= MOB_RADIUS && seesActor(c, actor)) { c.ws.send(data); counters.msgOut++; }
  };

  /**
   * Dark Illusion de GM (SI_ACR_SUP_DARKILLUSION): some para quem não é GM/admin (que recebe 'leave'; os GMs recebem
   * 'invis' e veem translúcido) e os mobs largam o alvo. Desligar faz aparecer de novo ('enter'). O efeito da skill toca
   * para todos ao sumir e ao aparecer.
   */
  function setInvis(c: Conn, on: boolean) {
    const p = c.player;
    if (!p || !!c.invis === on) return;
    const s = skillCat?.byId.get(193);
    const fx = () => { if (s) sendNear(p.w, p.p[0], p.p[2], { t: 'skillfx', a: p.id, fx: { c: s.sfx[0], h: -1, s: -1, b: -1, mo: s.motion, sn: s.snd[0] } }); };
    if (on) fx(); // ainda visível: todos veem o efeito de sumir
    c.invis = on;
    if (on) { invisIds.add(p.id); p.iv = 1; } else { invisIds.delete(p.id); delete p.iv; }
    for (const o of conns) {
      if (o === c || !o.player || o.player.w !== p.w) continue;
      if (isStaff(o)) send(o.ws, { t: 'invis', id: p.id, on });
      else send(o.ws, on ? { t: 'leave', id: p.id } : { t: 'enter', player: p });
    }
    send(c.ws, { t: 'invis', id: p.id, on });
    if (on) W(c).mobs?.forget(p.id); else fx();
  }
  /** hora do jogo fixada por GM (//time 19), igual para todos; null = o relógio anda (shared/gameclock.ts) */
  let clockFixed: number | null = null;
  const mobHp = (m: Mob) => Math.round((m.hp / m.maxHp) * 1000);

  /** atributos de luta a partir do personagem e do que está equipado (arma da mão direita, defesa das armaduras) */
  function fighterFrom(ch: { level: number; job: number; str: number; sta: number; dex: number; int: number }, st: InvState | null, buffs: [number, number][] = []): Fighter {
    const equipped: Equipped[] = [];
    const now = Date.now();
    for (const i of st?.items ?? []) {
      if (i.c !== 1 || !inventory) continue;
      // item de tempo vencido não dá nada (CItemElem::expired: sem DST, defesa, set nem piercing)
      if (i.x && i.x <= now) continue;
      const d = inventory.catalog.byId.get(i.id);
      if (d) equipped.push({ d, u: i.u, s: i.s, p: i.p, e: i.e, el: i.el, g: i.g, r: i.r });
    }
    return rules!.buildFighter(ch, equipped, buffs);
  }
  /** equipou/desequipou: refaz os atributos de luta (bônus dos itens) e os máximos de HP/MP/FP */
  /** postura mostrada: a da arma (guardada em weaponMt), ou 0 com o modo de batalha desligado */
  function stanceOf(c: Conn, weaponMt: number) { c.weaponMt = weaponMt; return c.peace ? 0 : weaponMt; }

  /** liga/desliga o modo de batalha e avisa todos */
  function setPeace(c: Conn, peace: boolean) {
    const p = c.player;
    if (!p || !!c.peace === peace) return;
    c.peace = peace;
    p.mt = peace ? 0 : c.weaponMt ?? p.mt;
    broadcast({ t: 'look', id: p.id, eq: p.eq, mt: p.mt });
  }

  function refreshFighter(c: Conn, st: InvState) {
    const cb = c.cb;
    if (!cb || !rules) return;
    cb.f = fighterFrom({ level: c.player!.level, job: cb.f.job, ...cb.f.base }, st, [...cb.buffs.values()].flatMap((b) => b.dst));
    recalcMax(c);
    cb.dirty = true;
  }

  /** velocidade máxima no chão ou no ar (u/s) para o anti-speedhack */
  function maxSpeed(c: Conn) {
    const p = c.player!, run = rules && c.cb ? rules.runSpeed(c.cb.f, p.sex) : 6;
    return p.eq.some((s) => s.startsWith(RIDE_TAG)) ? Math.max(run, FLY_MAX_SPEED) : run;
  }

  /** confere um passo de `d` unidades contra a reserva de deslocamento; recusado, manda o cliente de volta à posição do servidor */
  function moveOk(c: Conn, d: number) {
    const now = Date.now(), v = maxSpeed(c) * SPEED_SLACK, cap = v * SPEED_BURST_S + SPEED_EXTRA;
    const m = (c.move ??= { at: now, budget: cap, pulledAt: 0, pulls: 0 });
    m.budget = Math.min(cap, m.budget + (v * (now - m.at)) / 1000);
    m.at = now;
    if (d <= MAX_STEP && d <= m.budget) { m.budget -= d; return true; }
    if (now - m.pulledAt >= PULLBACK_MS) {
      m.pulledAt = now; m.pulls++;
      const p = c.player!;
      console.warn(`[speed] ${p.name} (#${p.id}): passo de ${d.toFixed(1)} u com reserva de ${m.budget.toFixed(1)} u (máx. ${(v / SPEED_SLACK).toFixed(2)} u/s) — puxado de volta (${m.pulls}ª vez)`);
      send(c.ws, { t: 'teleport', p: p.p });
    }
    return false;
  }

  function statsMsg(c: Conn) {
    const cb = c.cb!, lv = c.player!.level;
    return { t: 'stats', hp: cb.hp, maxHp: cb.maxHp, mp: cb.mp, maxMp: cb.maxMp, fp: cb.fp, maxFp: cb.maxFp, exp: cb.exp, expMax: rules?.expToNext[lv] ?? 0, level: lv,
      atkMs: rules?.attackInterval(cb.f, c.player!.mt) ?? 1000, aspd: rules?.attackSpeed(cb.f) ?? 1, atk: rules?.shownAtk(cb.f) ?? [0, 0], atkShow: rules?.shownAtkValue(cb.f) ?? 0, range: rules?.attackRange(cb.f) ?? 2, def: rules?.showDefense(cb.f) ?? 0, crit: rules?.critChance(cb.f) ?? 0, cdmg: rules?.critBonus(cb.f) ?? 0, ...(rules ? rules.panel(cb.f) : {}),
      str: cb.f.base.str, sta: cb.f.base.sta, dex: cb.f.base.dex, int: cb.f.base.int, bonus: { str: cb.f.str - cb.f.base.str, sta: cb.f.sta - cb.f.base.sta, dex: cb.f.dex - cb.f.base.dex, int: cb.f.int - cb.f.base.int },
      acc: rules ? rules.accuracy(cb.f) : 0, dodge: rules ? rules.dodge(cb.f) : 0, spd: rules ? Math.floor(Math.floor(rules.attackSpeed(cb.f) * 100) / 2) : 0, points: cb.points, job: cb.f.job, jobOpts: rules ? rules.jobOptions(cb.f.job, lv) : [],
      mv: rules ? +rules.runSpeed(cb.f, c.player!.sex).toFixed(3) : 6, fx: rules ? rules.bonusList(cb.f) : [] };
  }

  /** recalcula os máximos (nível/classe mudou) mantendo a proporção atual ou enchendo */
  function recalcMax(c: Conn, fill = false) {
    const cb = c.cb;
    if (!cb || !rules) return;
    cb.f.level = c.player!.level;
    cb.maxHp = rules.maxHp(cb.f); cb.maxMp = rules.maxMp(cb.f); cb.maxFp = rules.maxFp(cb.f);
    if (fill) { cb.hp = cb.maxHp; cb.mp = cb.maxMp; cb.fp = cb.maxFp; }
    cb.hp = Math.min(cb.hp, cb.maxHp); cb.mp = Math.min(cb.mp, cb.maxMp); cb.fp = Math.min(cb.fp, cb.maxFp);
    cb.dirty = true;
  }

  /** exp ganha (já com a taxa de EXP do servidor): sobe de nível quantas vezes der (HP cheio a cada nível), avisa todos do nível novo */
  function addExp(c: Conn, amount: number) {
    const cb = c.cb, p = c.player;
    if (!cb || !p || !rules || amount <= 0) return;
    cb.exp += Math.max(1, Math.floor(amount * rates().exp));
    let up = false;
    const cap = rules.levelCap(cb.f.job);
    while (p.level < cap && rules.expToNext[p.level] > 0 && cb.exp >= rules.expToNext[p.level]) { cb.exp -= rules.expToNext[p.level]; p.level++; cb.points += rules.gpAt[p.level] ?? 2; if (skillCat) cb.skillPoints += skillCat.gainAt(p.level); up = true; }
    if (p.level >= cap && cb.f.job < 6) cb.exp = 0; // no teto da Vagrant/1ª classe a exp não sobe até mudar de classe
    if (up) {
      recalcMax(c, true);
      broadcast({ t: 'level', id: p.id, level: p.level });
      send(c.ws, skillsMsg(c));
      send(c.ws, { t: 'chat', id: 0, name: '', text: `Parabéns! ${p.name} chegou ao nível ${p.level}. Você tem ${cb.points} ponto(s) de atributo (tecla H).` });
      if (rules.jobOptions(cb.f.job, p.level).length) send(c.ws, { t: 'chat', id: 0, name: '', text: 'Você já pode mudar de classe! Escolha na janela que abriu.' });
      void saveCombat(p.id, cb, p.level).catch((e) => console.error('realtime: salvar nível', e));
    }
    cb.dirty = true;
  }

  // ---------- voo ----------
  /** PARTS_RIDE e o aviso de quem tenta montar lutando */
  const RIDE_PART = 13, BATTLE_RIDE = 'Você está em batalha. Afaste-se da luta para poder voar.';
  /** em batalha: apanhou há menos de 5 s ou golpeou há pouco (como no teleporte) */
  const inBattle = (c: Conn) => { const cb = c.cb, now = Date.now(); return !!cb && (now - cb.lastHurt < 5000 || now < cb.nextAtk + 1500); };

  // ---------- party ----------
  const parties = new PartyManager();
  const PARTY_RANGE = 64, PARTY_INVITE_MS = 60_000;
  const partyView = (p: Party) => ({
    id: p.id, name: p.name, leader: p.leader, level: p.level, exp: p.exp, expNext: parties.expNext(p), points: p.points,
    members: p.members.map((id) => {
      const o = liveConn(id);
      return o?.player ? { id, name: o.player.name, level: o.player.level, job: o.player.job, hp: o.cb ? Math.round((o.cb.hp / o.cb.maxHp) * 100) : 100, on: true }
        : { id, name: '?', level: 0, job: 0, hp: 0, on: false };
    }),
    skills: parties.activeSkills(p, Date.now()),
  });
  /** manda o estado da party a todos os membros online (e `null` a quem saiu) */
  function pushParty(p: Party | null, alsoNull: number[] = []) {
    if (p) { const v = partyView(p); for (const id of p.members) { const o = liveConn(id); if (o) send(o.ws, { t: 'party', p: v }); } }
    for (const id of alsoNull) { const o = liveConn(id); if (o) send(o.ws, { t: 'party', p: null }); }
  }
  const partyNotice = (p: Party, text: string) => { for (const id of p.members) { const o = liveConn(id); if (o) send(o.ws, { t: 'chat', id: 0, name: '', text }); } };

  function leaveParty(charId: number, why: string) {
    const r = parties.remove(charId);
    if (!r) return;
    const name = liveConn(charId)?.player?.name ?? 'Um membro';
    if (r.disbanded.length) { for (const id of r.disbanded) { const o = liveConn(id); if (o) send(o.ws, { t: 'chat', id: 0, name: '', text: `${name} ${why}. A party acabou.` }); } pushParty(null, [...r.disbanded, charId]); return; }
    partyNotice(r.party, `${name} ${why}.`);
    pushParty(r.party, [charId]);
  }

  // ---------- trade (janela de troca entre dois jogadores) ----------
  const TRADE_RANGE = 15, TRADE_REQ_MS = 30_000;
  const tradeOther = (t: Trade, c: Conn) => (t.a === c ? t.b : t.a);

  /** manda a janela aos dois: cada um vê a própria oferta (com os espaços da bolsa) e a do outro (com os itens completos) */
  async function tradePush(t: Trade) {
    if (!inventory) return;
    const side = async (c: Conn) => {
      const o = t.offer.get(c)!, st = await inventory.state(c.player!.id);
      return {
        gold: o.gold,
        items: o.items.map((e) => {
          const it = st.items.find((i) => i.c === 0 && i.s === e.s), d = it && inventory.catalog.byId.get(it.id);
          return it && d ? { s: e.s, it: { id: it.id, n: e.n, u: it.u, e: it.e, el: it.el, ...(it.p ? { p: it.p } : {}), ...(it.x ? { x: it.x } : {}), ...(it.r ? { r: it.r } : {}) }, d: inventory.catalog.viewFull(d) } : null;
        }).filter(Boolean),
      };
    };
    const va = await side(t.a), vb = await side(t.b);
    for (const [me, mine, theirs] of [[t.a, va, vb], [t.b, vb, va]] as const) {
      const o = tradeOther(t, me);
      send(me.ws, { t: 'trade', name: o.player?.name ?? '', me: mine, them: theirs, lock: [t.lock.has(me), t.lock.has(o)], ok: [t.ok.has(me), t.ok.has(o)] });
    }
  }

  /** fecha a janela nos dois (cancelou, saiu, morreu, trocou de mapa ou terminou) */
  function tradeClose(t: Trade, text: string) {
    for (const c of [t.a, t.b]) { if (c.trade === t) c.trade = null; send(c.ws, { t: 'tradeClose', text }); }
  }

  /** por que `c` não pode trocar com `o` agora (null = pode) */
  function tradeBlock(c: Conn, o: Conn | null): string | null {
    if (!o?.player || !c.player || o === c) return 'Esse jogador não está online.';
    if (o.player.w !== c.player.w || Math.hypot(o.player.p[0] - c.player.p[0], o.player.p[2] - c.player.p[2]) > TRADE_RANGE) return `Chegue mais perto de ${o.player.name} para negociar.`;
    if (c.cb?.dead || o.cb?.dead) return 'Não dá para negociar morto.';
    if (c.trade) return 'Você já está negociando.';
    if (o.trade) return `${o.player.name} já está negociando com outra pessoa.`;
    return null;
  }

  function tradeMsg(c: Conn, msg: Record<string, unknown>) {
    const me = c.player!;
    const reply = (text: string) => send(c.ws, { t: 'chat', id: 0, name: '', text });
    const t = c.trade ?? null;
    switch (msg.t) {
      case 'tradeReq': {
        const o = liveConn(Number(msg.id));
        const why = tradeBlock(c, o);
        if (why) { reply(why); return; }
        o!.tradeReqs ??= new Map();
        if ((o!.tradeReqs.get(me.id) ?? 0) > Date.now() - TRADE_REQ_MS) { reply(`Você já pediu para negociar com ${o!.player!.name}. Aguarde a resposta.`); return; }
        o!.tradeReqs.set(me.id, Date.now());
        send(o!.ws, { t: 'tradeReq', id: me.id, name: me.name });
        reply(`Pedido de troca enviado para ${o!.player!.name}.`);
        return;
      }
      case 'tradeAnswer': {
        const id = Number(msg.id), at = c.tradeReqs?.get(id);
        c.tradeReqs?.delete(id);
        const o = liveConn(id);
        if (!o?.player || !at || Date.now() - at > TRADE_REQ_MS) { reply('O pedido de troca expirou.'); return; }
        if (!msg.ok) { send(o.ws, { t: 'chat', id: 0, name: '', text: `${me.name} recusou a troca.` }); return; }
        const why = tradeBlock(c, o);
        if (why) { reply(why); return; }
        const nt: Trade = { a: o, b: c, offer: new Map([[o, { items: [], gold: 0 }], [c, { items: [], gold: 0 }]]), lock: new Set(), ok: new Set(), busy: false };
        o.trade = c.trade = nt;
        void tradePush(nt);
        return;
      }
    }
    if (!t || t.busy || !inventory) return;
    const offer = t.offer.get(c)!;
    // mudar a oferta: só sem OK; qualquer mudança tira o OK e a confirmação dos dois
    const change = async (fn: () => Promise<string | null> | string | null) => {
      if (t.lock.has(c)) { reply('Você já deu OK. Cancele a troca para mudar a oferta.'); return; }
      const err = await fn();
      if (err) { reply(err); return; }
      t.lock.clear(); t.ok.clear();
      await tradePush(t);
    };
    switch (msg.t) {
      case 'tradeItem': {
        const slot = Number(msg.s), n = Number(msg.n);
        void change(async () => {
          const it = (await inventory.state(me.id)).items.find((i) => i.c === 0 && i.s === slot);
          if (!it) return 'Esse espaço da bolsa está vazio.';
          if (!Number.isInteger(n) || n < 1) return 'Quantidade inválida.';
          const cur = offer.items.find((e) => e.s === slot);
          if (cur) { cur.n = Math.min(n, it.n); cur.id = it.id; return null; }
          if (offer.items.length >= TRADE_SLOTS) return `A troca aceita até ${TRADE_SLOTS} itens.`;
          offer.items.push({ s: slot, n: Math.min(n, it.n), id: it.id });
          return null;
        }).catch((e) => console.error('trade: item', e));
        return;
      }
      case 'tradeRemove': {
        const slot = Number(msg.s);
        void change(() => { offer.items = offer.items.filter((e) => e.s !== slot); return null; }).catch((e) => console.error('trade: tirar', e));
        return;
      }
      case 'tradeGold': {
        const g = Math.floor(Number(msg.gold) || 0);
        void change(async () => {
          const gold = (await inventory.state(me.id)).gold;
          if (g < 0 || g > gold) return 'Você não tem esse penya.';
          offer.gold = g;
          return null;
        }).catch((e) => console.error('trade: penya', e));
        return;
      }
      case 'tradeLock':
        t.lock.add(c);
        void tradePush(t);
        return;
      case 'tradeOk': {
        if (t.lock.size < 2) { reply('Os dois precisam dar OK antes de confirmar.'); return; }
        t.ok.add(c);
        if (t.ok.size < 2) { void tradePush(t); return; }
        t.busy = true;
        const a = t.a, b = t.b, oa = t.offer.get(a)!, ob = t.offer.get(b)!;
        inventory.exchange(a.player!.id, b.player!.id, oa, ob).then(async (err) => {
          if (err) {
            t.busy = false; t.lock.clear(); t.ok.clear();
            for (const x of [a, b]) send(x.ws, { t: 'chat', id: 0, name: '', text: `Troca não feita: ${err}` });
            await tradePush(t);
            return;
          }
          console.log(`trade: ${a.player?.name} (${oa.items.length} item(ns), ${oa.gold} penya) ↔ ${b.player?.name} (${ob.items.length} item(ns), ${ob.gold} penya)`);
          tradeClose(t, 'Troca concluída!');
          pushInventory(a.player!.id, false); pushInventory(b.player!.id, false);
        }).catch((e) => { console.error('trade: troca', e); t.busy = false; tradeClose(t, 'Erro na troca. Nada foi trocado.'); });
        return;
      }
      case 'tradeCancel':
        tradeClose(t, `${me.name} cancelou a troca.`);
        return;
    }
  }

  function partyMsg(c: Conn, msg: Record<string, unknown>) {
    const me = c.player!;
    const reply = (text: string) => send(c.ws, { t: 'chat', id: 0, name: '', text });
    const mine = parties.of(me.id);
    const id = Number(msg.id);
    switch (msg.t) {
      case 'partyInvite': {
        const o = liveConn(id);
        if (!o?.player || id === me.id) { reply('Esse jogador não está online.'); return; }
        if (mine && mine.leader !== me.id) { reply('Só o líder da party pode convidar.'); return; }
        if (mine && mine.members.length >= PARTY_MAX) { reply(`A party está cheia (${PARTY_MAX}).`); return; }
        if (parties.of(id)) { reply(`${o.player.name} já está em uma party.`); return; }
        o.partyReqs ??= new Map();
        if ((o.partyReqs.get(me.id) ?? 0) > Date.now() - PARTY_INVITE_MS) { reply(`Você já convidou ${o.player.name}. Aguarde a resposta.`); return; }
        o.partyReqs.set(me.id, Date.now());
        send(o.ws, { t: 'partyReq', id: me.id, name: me.name });
        reply(`Convite de party enviado para ${o.player.name}.`);
        return;
      }
      case 'partyAnswer': {
        const at = c.partyReqs?.get(id);
        c.partyReqs?.delete(id);
        const o = liveConn(id);
        if (!at || at < Date.now() - PARTY_INVITE_MS * 2) { reply('Esse convite expirou.'); return; }
        if (msg.ok !== true) { if (o) send(o.ws, { t: 'chat', id: 0, name: '', text: `${me.name} recusou o convite de party.` }); return; }
        if (!o?.player) { reply('Quem convidou saiu do jogo.'); return; }
        if (mine) { reply('Você já está em uma party.'); return; }
        let p = parties.of(id);
        if (p && p.leader !== id) { reply('O convite não vale mais.'); return; }
        if (!p) p = parties.create(id, o.player.name, me.id);
        else if (!parties.add(p, me.id)) { reply('A party está cheia.'); return; }
        partyNotice(p, `${me.name} entrou na party.`);
        pushParty(p);
        return;
      }
      case 'partyLeave': leaveParty(me.id, 'saiu da party'); return;
      case 'partyKick':
        if (!mine || mine.leader !== me.id || !mine.members.includes(id) || id === me.id) return;
        { const o = liveConn(id); if (o) send(o.ws, { t: 'chat', id: 0, name: '', text: 'Você foi tirado da party pelo líder.' }); }
        leaveParty(id, 'foi tirado da party');
        return;
      case 'partyLead':
        if (!mine || mine.leader !== me.id || !mine.members.includes(id)) return;
        mine.leader = id;
        partyNotice(mine, `${liveConn(id)?.player?.name ?? '?'} agora é o líder da party.`);
        pushParty(mine);
        return;
      case 'partySkill': {
        if (!mine || mine.leader !== me.id) { reply('Só o líder usa as habilidades de party.'); return; }
        const err = parties.useSkill(mine, String(msg.k ?? ''), Date.now());
        if (err) { reply(err); return; }
        const s = PARTY_SKILLS.find((x) => x.key === msg.k)!;
        partyNotice(mine, `${me.name} ligou ${s.name} para a party (${Math.round(s.ms / 60000)} min).`);
        pushParty(mine);
        return;
      }
      case 'partyList': {
        const now = Date.now();
        const list = [...parties.parties.values()].map((p) => ({ id: p.id, name: p.name, leader: liveConn(p.leader)?.player?.name ?? '?', level: p.level, size: p.members.length, max: PARTY_MAX, skills: parties.activeSkills(p, now).map((x) => x.k) }));
        send(c.ws, { t: 'partyList', list });
        return;
      }
    }
  }

  /**
   * Mob morto: sem party (ou sozinho perto), a exp vai toda para quem matou. Em party, divide entre os membros perto do
   * mob com o bônus de grupo (party.ts partyExpShares) e a party ganha exp de party.
   */
  function rewardKill(killer: Conn, prop: MoverProp, x: number, z: number) {
    const p = parties.of(killer.player!.id);
    const near = p ? p.members.map((id) => liveConn(id)).filter((o): o is Conn => !!o?.player && !!o.cb && !o.cb.dead && Math.hypot(o.player.p[0] - x, o.player.p[2] - z) <= PARTY_RANGE) : [];
    if (!p || near.length < 2) { addExp(killer, rules!.expFor(prop, killer.player!.level)); return; }
    const shares = partyExpShares(near.map((o) => ({ id: o.player!.id, level: o.player!.level })), (lv) => rules!.expFor(prop, lv));
    for (const o of near) { const e = shares.get(o.player!.id); if (e) addExp(o, e); }
    const avg = near.reduce((s, o) => s + o.player!.level, 0) / near.length;
    if (avg - prop.level < 5 && parties.addExp(p, prop.level, rates().exp)) partyNotice(p, `A party subiu para o nível ${p.level}! (${p.points} pontos de party)`);
    pushParty(p);
  }
  // HP dos membros na janela da party
  const partyTick = setInterval(() => { for (const p of parties.parties.values()) pushParty(p); }, 1500);

  // ---------- guild ----------
  const GUILD_MAX = 30, GUILD_INVITE_MS = 60_000;
  const RANK_NAME = ['Mestre', 'Kingpin', 'Captain', 'Supporter', 'Rookie'];
  async function loadGuildOf(charId: number) {
    const r = await query<{ id: string; name: string; rank: number }>('SELECT g.id, g.name, m.rank FROM guild_members m JOIN guilds g ON g.id = m.guild_id WHERE m.character_id = $1', [charId]);
    const row = r.rows[0];
    return row ? { id: Number(row.id), name: row.name, rank: row.rank } : null;
  }
  async function guildView(guildId: number) {
    const g = (await query<{ id: string; name: string; level: number; master_id: string; created_at: Date }>('SELECT id, name, level, master_id, created_at FROM guilds WHERE id = $1', [guildId])).rows[0];
    if (!g) return null;
    const ms = (await query<{ id: string; name: string; level: number; job: number; rank: number }>(
      'SELECT c.id, c.name, c.level, c.job, m.rank FROM guild_members m JOIN characters c ON c.id = m.character_id WHERE m.guild_id = $1 ORDER BY m.rank, lower(c.name)', [guildId])).rows;
    return {
      id: Number(g.id), name: g.name, level: g.level, master: Number(g.master_id), max: GUILD_MAX, created: g.created_at,
      members: ms.map((m) => { const o = liveConn(Number(m.id)); return { id: Number(m.id), name: m.name, level: o?.player?.level ?? m.level, job: o?.player?.job ?? m.job, rank: m.rank, rankName: RANK_NAME[m.rank] ?? '', on: !!o }; }),
    };
  }
  /** manda a guild atualizada a todos os membros online */
  async function pushGuild(guildId: number) {
    const v = await guildView(guildId);
    for (const o of conns) if (o.guild?.id === guildId && o.ws.readyState === WebSocket.OPEN) send(o.ws, { t: 'guildView', g: v });
  }
  /** a guild de um personagem mudou: guarda na conexão e avisa todos (nome da guild acima do nome dele) */
  function setGuildTag(o: Conn, g: { id: number; name: string; rank: number } | null) {
    o.guild = g;
    if (!o.player) return;
    if (g) o.player.guild = g.name; else delete o.player.guild;
    if (g?.rank === 0) o.player.gmaster = 1; else delete o.player.gmaster;
    broadcast({ t: 'guildTag', id: o.player.id, g: g?.name ?? null, ...(g?.rank === 0 ? { m: 1 } : {}) });
  }
  const guildNotice = (guildId: number, text: string) => { for (const o of conns) if (o.guild?.id === guildId) send(o.ws, { t: 'chat', id: 0, name: '', text }); };

  async function guildMsg(c: Conn, msg: Record<string, unknown>) {
    const me = c.player!;
    const reply = (text: string) => send(c.ws, { t: 'chat', id: 0, name: '', text });
    const g = c.guild;
    const id = Number(msg.id);
    switch (msg.t) {
      case 'guildInfo': send(c.ws, { t: 'guildView', g: g ? await guildView(g.id) : null }); return;
      case 'guildCreate': {
        // como o CreateGuild do NPC: o líder de uma party cria e todos os membros online da party entram
        const name = String(msg.name ?? '').trim();
        if (g) { reply('Você já está em uma guild.'); return; }
        if (!/^[A-Za-z0-9À-ÿ]{3,16}$/.test(name)) { reply('Nome da guild: de 3 a 16 letras ou números, sem espaços.'); return; }
        const p = parties.of(me.id);
        if (!p || p.leader !== me.id) { reply('Para criar uma guild você precisa ser o líder de uma party.'); return; }
        const members = p.members.map((mid) => liveConn(mid)).filter((o): o is Conn => !!o?.player);
        if (members.length !== p.members.length) { reply('Todos os membros da party precisam estar online.'); return; }
        const busy = members.find((o) => o.guild);
        if (busy) { reply(`${busy.player!.name} já está em uma guild.`); return; }
        if ((await query('SELECT 1 FROM guilds WHERE lower(name) = lower($1)', [name])).rowCount) { reply('Já existe uma guild com esse nome.'); return; }
        const ins = await query<{ id: string }>('INSERT INTO guilds (name, master_id) VALUES ($1, $2) RETURNING id', [name, me.id]);
        const gid = Number(ins.rows[0].id);
        for (const o of members) {
          const rank = o === c ? 0 : 4;
          await query('INSERT INTO guild_members (character_id, guild_id, rank) VALUES ($1, $2, $3)', [o.player!.id, gid, rank]);
          setGuildTag(o, { id: gid, name, rank });
        }
        guildNotice(gid, `A guild ${name} foi criada! Mestre: ${me.name}.`);
        await pushGuild(gid);
        return;
      }
      case 'guildInvite': {
        const o = liveConn(id);
        if (!g) { reply('Você não está em uma guild.'); return; }
        if (g.rank > 1) { reply('Só o mestre ou um kingpin convida para a guild.'); return; }
        if (!o?.player || id === me.id) { reply('Esse jogador não está online.'); return; }
        if (o.guild) { reply(`${o.player.name} já está em uma guild.`); return; }
        const n = (await query<{ n: string }>('SELECT count(*) AS n FROM guild_members WHERE guild_id = $1', [g.id])).rows[0];
        if (Number(n.n) >= GUILD_MAX) { reply(`A guild está cheia (${GUILD_MAX}).`); return; }
        o.guildReqs ??= new Map();
        if ((o.guildReqs.get(me.id) ?? 0) > Date.now() - GUILD_INVITE_MS) { reply(`Você já convidou ${o.player.name}. Aguarde a resposta.`); return; }
        o.guildReqs.set(me.id, Date.now());
        send(o.ws, { t: 'guildReq', id: me.id, name: me.name, guild: g.name });
        reply(`Convite da guild enviado para ${o.player.name}.`);
        return;
      }
      case 'guildAnswer': {
        const at = c.guildReqs?.get(id);
        c.guildReqs?.delete(id);
        const o = liveConn(id);
        if (!at || at < Date.now() - GUILD_INVITE_MS * 2) { reply('Esse convite expirou.'); return; }
        if (msg.ok !== true) { if (o) send(o.ws, { t: 'chat', id: 0, name: '', text: `${me.name} recusou o convite da guild.` }); return; }
        if (g) { reply('Você já está em uma guild.'); return; }
        const og = o?.guild;
        if (!og) { reply('O convite não vale mais.'); return; }
        const n = (await query<{ n: string }>('SELECT count(*) AS n FROM guild_members WHERE guild_id = $1', [og.id])).rows[0];
        if (Number(n.n) >= GUILD_MAX) { reply('A guild está cheia.'); return; }
        await query('INSERT INTO guild_members (character_id, guild_id, rank) VALUES ($1, $2, 4)', [me.id, og.id]);
        setGuildTag(c, { id: og.id, name: og.name, rank: 4 });
        guildNotice(og.id, `${me.name} entrou na guild.`);
        await pushGuild(og.id);
        return;
      }
      case 'guildLeave':
        if (!g) return;
        if (g.rank === 0) { reply('O mestre não pode sair: desfaça a guild (ou passe o cargo de mestre — ainda não disponível).'); return; }
        await query('DELETE FROM guild_members WHERE character_id = $1', [me.id]);
        guildNotice(g.id, `${me.name} saiu da guild.`);
        setGuildTag(c, null);
        send(c.ws, { t: 'guildView', g: null });
        await pushGuild(g.id);
        return;
      case 'guildKick': {
        if (!g || g.rank > 1 || id === me.id) return;
        const r = (await query<{ rank: number }>('SELECT rank FROM guild_members WHERE character_id = $1 AND guild_id = $2', [id, g.id])).rows[0];
        if (!r || r.rank <= g.rank) { reply('Você não pode expulsar esse membro.'); return; }
        await query('DELETE FROM guild_members WHERE character_id = $1', [id]);
        const o = liveConn(id);
        if (o) { send(o.ws, { t: 'chat', id: 0, name: '', text: 'Você foi expulso da guild.' }); setGuildTag(o, null); send(o.ws, { t: 'guildView', g: null }); }
        guildNotice(g.id, 'Um membro foi expulso da guild.');
        await pushGuild(g.id);
        return;
      }
      case 'guildDisband':
        if (!g || g.rank !== 0) { reply('Só o mestre pode desfazer a guild.'); return; }
        guildNotice(g.id, `A guild ${g.name} foi desfeita pelo mestre.`);
        await query('DELETE FROM guilds WHERE id = $1', [g.id]);
        for (const o of conns) if (o.guild?.id === g.id) { setGuildTag(o, null); send(o.ws, { t: 'guildView', g: null }); }
        return;
    }
  }

  // ---------- Mensageiro: amigos e mensagem privada ----------
  /** conexão de quem está jogando com o personagem `id` */
  const liveConn = (id: number) => { for (const o of conns) if (o.player?.id === id && o.ws.readyState === WebSocket.OPEN) return o; return null; };
  const FRIENDS_MAX = 200, FRIEND_REQ_MS = 60_000;
  interface FriendView { id: number; name: string; level: number; job: number; on: boolean }
  const friendView = (p: PlayerView): FriendView => ({ id: p.id, name: p.name, level: p.level, job: p.job, on: true });

  /** ao entrar: manda a lista e avisa os amigos online que ele chegou */
  async function loadFriends(c: Conn) {
    const p = c.player;
    if (!p) return;
    try {
      const r = await query<{ id: string; name: string; level: number; job: number }>(
        'SELECT c.id, c.name, c.level, c.job FROM friends f JOIN characters c ON c.id = f.friend_id AND NOT c.deleted WHERE f.character_id = $1 ORDER BY lower(c.name)', [p.id]);
      if (c.player !== p) return;
      c.friends = new Set(r.rows.map((x) => Number(x.id)));
      const list: FriendView[] = r.rows.map((x) => {
        const o = liveConn(Number(x.id));
        return o?.player ? friendView(o.player) : { id: Number(x.id), name: x.name, level: x.level, job: x.job, on: false };
      });
      send(c.ws, { t: 'friends', list });
      for (const f of c.friends) { const o = liveConn(f); if (o && o !== c) send(o.ws, { t: 'friendOn', id: p.id, on: true }); }
    } catch (e) { console.error('realtime: amigos', e); }
  }

  async function friendMsg(c: Conn, t: string, id: number, ok: boolean) {
    const me = c.player!;
    const reply = (text: string) => send(c.ws, { t: 'chat', id: 0, name: '', text });
    c.friends ??= new Set();
    if (t === 'friendAdd') {
      const o = liveConn(id);
      if (id === me.id) return;
      if (!o?.player) { reply('Esse jogador não está online.'); return; }
      if (c.friends.has(id)) { reply(`${o.player.name} já é seu amigo.`); return; }
      if (c.friends.size >= FRIENDS_MAX) { reply(`Sua lista de amigos está cheia (${FRIENDS_MAX}).`); return; }
      o.friendReqs ??= new Map();
      if ((o.friendReqs.get(me.id) ?? 0) > Date.now() - FRIEND_REQ_MS) { reply(`Você já pediu a amizade de ${o.player.name}. Aguarde a resposta.`); return; }
      o.friendReqs.set(me.id, Date.now());
      send(o.ws, { t: 'friendReq', id: me.id, name: me.name });
      reply(`Pedido de amizade enviado para ${o.player.name}.`);
    } else if (t === 'friendAnswer') {
      const at = c.friendReqs?.get(id);
      c.friendReqs?.delete(id);
      const o = liveConn(id);
      if (!at || at < Date.now() - FRIEND_REQ_MS * 5) { reply('Esse pedido de amizade expirou.'); return; }
      if (!ok) { if (o) send(o.ws, { t: 'chat', id: 0, name: '', text: `${me.name} recusou seu pedido de amizade.` }); return; }
      if (!o?.player) { reply('Esse jogador saiu do jogo.'); return; }
      if (c.friends.size >= FRIENDS_MAX || (o.friends?.size ?? 0) >= FRIENDS_MAX) { reply('A lista de amigos está cheia.'); return; }
      await query('INSERT INTO friends (character_id, friend_id) VALUES ($1, $2), ($2, $1) ON CONFLICT DO NOTHING', [me.id, id]);
      c.friends.add(id);
      (o.friends ??= new Set()).add(me.id);
      send(c.ws, { t: 'friendNew', f: friendView(o.player) });
      send(o.ws, { t: 'friendNew', f: friendView(me) });
      reply(`Agora você e ${o.player.name} são amigos.`);
      send(o.ws, { t: 'chat', id: 0, name: '', text: `Agora você e ${me.name} são amigos.` });
    } else if (t === 'friendDel') {
      if (!c.friends.has(id)) return;
      await query('DELETE FROM friends WHERE (character_id = $1 AND friend_id = $2) OR (character_id = $2 AND friend_id = $1)', [me.id, id]);
      c.friends.delete(id);
      send(c.ws, { t: 'friendDel', id });
      const o = liveConn(id);
      if (o) { o.friends?.delete(me.id); send(o.ws, { t: 'friendDel', id: me.id }); }
    }
  }

  /**
   * mensagem privada para um jogador online (amigo ou não, como o /say do cliente); quem mandou recebe a própria mensagem
   * de volta (vai para a janela). `to` = id (janela de conversa) ou nome (/say no chat).
   */
  function privateMessage(c: Conn, to: number | string, raw: string) {
    const me = c.player!;
    const text = raw.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, CHAT_MAX);
    if (!text) return;
    const now = Date.now();
    c.chatAt = c.chatAt.filter((t) => now - t < CHAT_WINDOW_MS);
    if (c.chatAt.length >= CHAT_BURST) { send(c.ws, { t: 'chat', id: 0, name: '', text: 'Calma! Você está mandando mensagens rápido demais.' }); return; }
    let o: Conn | null = null;
    if (typeof to === 'number') o = liveConn(to);
    else { const n = to.toLowerCase(); for (const x of conns) if (x.player?.name.toLowerCase() === n && x.ws.readyState === WebSocket.OPEN) { o = x; break; } }
    if (!o?.player) {
      // pelo nome: aviso no chat; numa janela já aberta (pelo id): o aviso aparece nela
      if (typeof to === 'number') send(c.ws, { t: 'pm', with: to, wname: '', from: 0, name: '', text: 'Esse jogador não está online. A mensagem não foi entregue.' });
      else send(c.ws, { t: 'chat', id: 0, name: '', text: `${to} não está online.` });
      return;
    }
    if (o === c) { send(c.ws, { t: 'chat', id: 0, name: '', text: 'Você não pode mandar mensagem para você mesmo.' }); return; }
    c.chatAt.push(now);
    send(o.ws, { t: 'pm', with: me.id, wname: me.name, from: me.id, name: me.name, text });
    send(c.ws, { t: 'pm', with: o.player.id, wname: o.player.name, from: me.id, name: me.name, text });
  }

  /**
   * Buff Pang (MMI_NPC_BUFF): perto do NPC, recebe todos os buffs dele — no nível MÁXIMO de cada skill (pedido do servidor;
   * o original dava o nível do SetBuffSkill) — com a duração do NPC; vale se o nível do personagem está na faixa dele.
   */
  function npcBuff(c: Conn, key: string) {
    const shops = W(c).shops;
    const p = c.player, cb = c.cb, k = key.toLowerCase();
    const list = shops?.npcBuffs.get(k);
    if (!p || !cb || !list || !skillCat || cb.dead) return;
    if (!shops!.near(key, p.p[0], p.p[2])) { reply(c, 'Chegue mais perto do NPC.'); return; }
    // os buffs que valem para o nível do personagem, cada um com o efeito e o som da própria skill
    const give: { skill: number; ms: number; lv: number; dst: [number, number][]; fx: number; snd: number }[] = [];
    for (const b of list) {
      if (p.level < b.minLv || p.level > b.maxLv) continue;
      const s = skillCat.byId.get(b.skill);
      const L = s?.levels[s.max - 1];
      if (!s || !L) continue;
      const dst: [number, number][] = [];
      for (let i = 0; i < 2; i++) { const d = L.dest[i], v = L.adj[i]; if (d > 0 && v && d !== DST.HP && d !== DST.MP && d !== DST.FP) dst.push([d, v]); }
      if (!dst.length) continue;
      // efeito em quem recebe (dwSfxObj3; sem ele, o do lançador) e o som do acerto (dwSndAttack2; sem ele, o de lançar)
      give.push({ skill: b.skill, ms: b.ms, lv: s.max, dst, fx: s.sfx[2] >= 0 ? s.sfx[2] : s.sfx[4], snd: s.snd[1] >= 0 ? s.snd[1] : s.snd[0] });
    }
    if (!give.length) { reply(c, 'Este NPC não tem buffs para o seu nível.'); return; }
    if (c.buffing) return; // já está recebendo
    c.buffing = true;
    // um de cada vez, a cada 0,5 s (como o NPC lançando um buff depois do outro)
    give.forEach((g, i) => setTimeout(() => {
      if (c.player !== p || !c.cb || c.cb.dead || c.ws.readyState !== WebSocket.OPEN) { c.buffing = false; return; }
      c.cb.buffs.set(g.skill, { lv: g.lv, until: Date.now() + g.ms, dst: g.dst });
      sendNear(p.w, p.p[0], p.p[2], { t: 'skillfx', a: p.id, fx: { c: -1, h: -1, s: g.fx, b: -1, mo: '', sn: g.snd } });
      void inventory?.state(p.id).then((st) => { if (!c.cb) return; refreshFighter(c, st); send(c.ws, buffsMsg(c)); send(c.ws, statsMsg(c)); });
      if (i === give.length - 1) {
        c.buffing = false;
        reply(c, `Você recebeu ${give.length} buff(s) no nível máximo por ${Math.round(give[0].ms / 60000)} minutos.`);
      }
    }, i * 500));
  }

  /**
   * Troca de mundo (ticket de Azria, teleporte para outro mapa): grava posição e mundo, avisa o cliente — ele mostra a tela
   * de carregamento do mapa, abre o mundo novo e entra de novo pelo `join` (a conexão antiga fecha sem sair da party).
   */
  async function changeWorld(c: Conn, world: string, pos: [number, number, number]) {
    const p = c.player;
    if (!p || !worlds.has(world)) return;
    W(c).mobs?.forget(p.id);
    p.w = world; p.p = [...pos]; p.s = 'stand';
    if (c.trade) tradeClose(c.trade, 'A troca foi cancelada.');
    c.switching = true;
    await savePosition(p, c.cb, 0);
    void query('UPDATE characters SET online = true WHERE id = $1', [p.id]).catch(() => {});
    send(c.ws, { t: 'changeWorld', w: world, p: pos });
  }

  /**
   * Ticket de mapa (ticket.inc, item de tempo: 1/3/7/15/30 dias = dwAbilityMin em minutos). Usar leva ao mapa dele e, na
   * primeira vez, começa a contar a validade (o item fica no inventário); usar de novo dentro do mapa volta de onde veio
   * (ou Flaris). Vencido não usa mais — fica cinza no inventário — e quem estiver no mapa é tirado de lá.
   */
  async function useTicket(c: Conn, slot: number, sym: string): Promise<boolean> {
    const t = tickets.get(sym), p = c.player, cb = c.cb;
    if (!t || !p || !inventory) return false;
    const wr = worldByDefine(t.define);
    if (!wr) { reply(c, 'Esse mapa ainda não está disponível neste servidor.'); return true; }
    const it = (await inventory.state(p.id)).items.find((i) => i.c === 0 && i.s === slot);
    const d = it && inventory.catalog.byId.get(it.id);
    if (!it || !d) return true;
    const now = Date.now();
    if (it.x && it.x <= now) { reply(c, `${d.name} expirou e não pode mais ser usado.`); return true; }
    if (cb && (now - cb.lastHurt < 5000 || now < cb.nextAtk + 1500)) { reply(c, 'Você não pode viajar em combate.'); return true; }
    if (wr.name === p.w) { // já está no mapa: o ticket leva de volta
      const back = c.ticketFrom && c.ticketFrom.w !== wr.name ? c.ticketFrom : { w: MAIN, p: [...REVIVE_AT] as [number, number, number] };
      c.ticketFrom = undefined;
      await changeWorld(c, back.w, back.p);
      return true;
    }
    if (!it.x) { // primeira vez: começa a contar
      const st = await inventory.setExpiry(p.id, slot, now + Math.max(1, d.abilityMin || 1440) * 60_000);
      if (st) send(c.ws, inventory.view(st));
      reply(c, `${d.name} ativado: vale por ${fmtLeft(Math.max(1, d.abilityMin || 1440) * 60_000)}. Use de novo para sair do mapa.`);
    }
    c.ticketFrom = { w: p.w, p: [...p.p] };
    await changeWorld(c, wr.name, t.pos);
    return true;
  }
  const fmtLeft = (ms: number) => { const m = Math.round(ms / 60000); return m >= 1440 ? `${Math.round(m / 1440)} dia(s)` : m >= 60 ? `${Math.round(m / 60)} hora(s)` : `${m} min`; };
  /** mapas que pedem ticket (os do ticket.inc) */
  const ticketWorlds = new Set([...tickets.values()].map((t) => worldByDefine(t.define)?.name).filter((n): n is string => !!n && n !== MAIN));
  /** a cada 30 s: quem está num mapa de ticket sem ticket válido daquele mapa volta para Flaris */
  const ticketCheck = setInterval(() => {
    if (!inventory) return;
    const now = Date.now();
    for (const c of conns) {
      const p = c.player;
      if (!p || !ticketWorlds.has(p.w) || c.switching) continue;
      void inventory.state(p.id).then((st) => {
        if (c.player !== p || !ticketWorlds.has(p.w) || c.switching) return;
        const ok = st.items.some((i) => { const sym = inventory.catalog.byId.get(i.id)?.symbol; const t = sym ? tickets.get(sym) : undefined; return t && worldByDefine(t.define)?.name === p.w && i.x && i.x > now; });
        if (ok) return;
        reply(c, 'Seu ticket deste mapa acabou. Voltando para Flaris…');
        send(c.ws, inventory.view(st));
        c.ticketFrom = undefined;
        void changeWorld(c, MAIN, [...REVIVE_AT]);
      }).catch(() => {});
    }
  }, 30_000);
  http.on('close', () => clearInterval(ticketCheck));

  /**
   * Teleporte da janela Teleporter (CZckTeleporteur::DoTeleport): não vale morto, em combate (bateu ou apanhou há pouco),
   * andando/pulando, nem para um ponto sem chão livre; por enquanto só destinos deste mundo (os outros ainda não existem aqui).
   */
  function zckTeleport(c: Conn, key: number) {
    const mobWorld = W(c).mobs;
    const p = c.player, cb = c.cb, d = teleports[key];
    if (!p || !d) return;
    const now = Date.now();
    if (cb?.dead) { reply(c, 'Você não pode se teletransportar morto.'); return; }
    if (cb && (now - cb.lastHurt < 5000 || now < cb.nextAtk + 1500)) { reply(c, 'Você não pode se teletransportar em combate.'); return; }
    if (p.s !== 'stand') { reply(c, 'Pare de andar para se teletransportar.'); return; }
    const dw = worldByDefine(d.world);
    if (!dw) { reply(c, `${d.name} ainda não está disponível neste servidor.`); return; }
    if (dw.name !== p.w) { reply(c, `Indo para ${d.name}…`); void changeWorld(c, dw.name, [...d.pos]); return; }
    if (mobWorld && !mobWorld.terrain.walkable(d.pos[0], d.pos[2])) { reply(c, 'Não é possível se teletransportar para lá.'); return; }
    p.p = [...d.pos]; c.dirty = true;
    send(c.ws, { t: 'teleport', p: d.pos });
    reply(c, `Teletransportado para ${d.name}.`);
  }

  /** golpe do jogador no mob (pedido { t: 'atk', id }) */
  function playerAttack(c: Conn, mobId: number) {
    const mobWorld = W(c).mobs;
    const p = c.player, cb = c.cb;
    if (!p || !cb || !rules || !mobWorld || cb.dead) return;
    const m = mobWorld.byId.get(mobId);
    if (!m || m.s === 'dead' || !m.prop) return;
    const now = Date.now();
    if (now < cb.nextAtk - 120) return; // rápido demais (com folga de rede)
    if (Math.hypot(m.x - p.p[0], m.z - p.p[2]) > reachOf(rules.attackRange(cb.f))) return;
    cb.nextAtk = now + rules.attackInterval(cb.f, p.mt);
    const r = rules.playerHitsMob(cb.f, m.prop);
    const died = r.hit && mobWorld.damage(m, p.id, r.dmg, rules.peaceful(m.prop), now);
    sendNear(p.w, m.x, m.z, { t: 'hit', k: 'p', a: p.id, d: m.id, dmg: r.dmg, f: (r.hit ? 0 : 1) | (r.crit ? 2 : 0), hp: mobHp(m), sn: [cb.f.weapon?.snd1 ?? -1, cb.f.weapon?.snd2 ?? -1] });
    if (!died) return;
    // exp para quem causou mais dano (como o líder do dano no original, sem grupo ainda)
    let best = p.id, bestDmg = -1;
    for (const [id, dmg] of m.dmgBy) if (dmg > bestDmg && connOf(id)) { best = id; bestDmg = dmg; }
    sendNear(p.w, m.x, m.z, { t: 'mdie', id: m.id, k: best });
    const killer = connOf(best);
    if (killer?.player) { rewardKill(killer, m.prop, m.x, m.z); dropLoot(m, killer); }
  }

  /**
   * O que o mob deixa (server/drops.ts): no chão em volta do corpo, com dono por 30 s; mob voador manda direto para a
   * bolsa/penya de quem matou (como no original).
   */
  function dropLoot(m: Mob, killer: Conn) {
    const p = killer.player;
    if (!dropRules || !inventory || !m.prop || !p) return;
    const now = Date.now();
    for (const d of dropRules.roll(m.modelId, m.prop, p.level)) {
      if (m.flying) { void giveLoot(killer, d.itemId, d.count, d.upgrade, d.gold); continue; }
      const g: GroundItem = {
        w: p.w, id: ++groundSeq, itemId: d.itemId, count: d.count, upgrade: d.upgrade, gold: d.gold,
        x: m.x + (Math.random() * 2 - 1), z: m.z + (Math.random() * 2 - 1), owner: p.id, ownerUntil: now + OWNER_MS, expires: now + GROUND_MS,
      };
      ground.set(g.id, g);
    }
  }

  /** põe na bolsa/penya; devolve quantos não couberam */
  async function giveLoot(c: Conn, itemId: number, count: number, upgrade: number, gold: number): Promise<number> {
    const p = c.player;
    if (!p || !inventory) return count;
    if (gold > 0) {
      await inventory.addGold(p.id, gold);
      send(c.ws, { t: 'chat', id: 0, name: '', text: `Você pegou ${gold.toLocaleString('pt-BR')} penya.` });
      return 0;
    }
    const d = inventory.catalog.byId.get(itemId);
    if (!d) return 0;
    const left = await inventory.add(p.id, itemId, count, { u: d.parts >= 0 ? upgrade : 0 });
    const got = count - left;
    if (got > 0) send(c.ws, { t: 'chat', id: 0, name: '', text: `Você pegou ${got > 1 ? `${got}× ` : ''}${d.name}${upgrade && d.parts >= 0 ? ` +${upgrade}` : ''}.` });
    if (left > 0) send(c.ws, { t: 'chat', id: 0, name: '', text: 'A bolsa está cheia.' });
    return left;
  }

  /** pedido de pegar um item do chão */
  function pickUp(c: Conn, id: number) {
    const p = c.player, g = ground.get(id);
    if (!p || !g || c.cb?.dead || g.w !== p.w) return;
    if (Math.hypot(g.x - p.p[0], g.z - p.p[2]) > PICK_RANGE) return;
    if (g.owner !== p.id && Date.now() < g.ownerUntil) { send(c.ws, { t: 'chat', id: 0, name: '', text: 'Esse item ainda é de quem derrotou o monstro.' }); return; }
    ground.delete(id); // reservado enquanto grava (ninguém mais pega)
    c.invQueue = c.invQueue.then(async () => {
      const left = await giveLoot(c, g.itemId, g.count, g.upgrade, g.gold);
      if (left > 0) { g.count = left; ground.set(g.id, g); }
    }).catch((e) => { console.error('realtime: pegar item', e); ground.set(g.id, g); });
  }

  // ---------- itens de uso e barra de atalhos ----------
  const D = (s: string) => inventory?.catalog.defines.get(s) ?? -999;
  const DST = { HP: D('DST_HP'), MP: D('DST_MP'), FP: D('DST_FP') };
  const USE_KINDS = new Set([D('IK2_POTION'), D('IK2_FOOD'), D('IK2_REFRESHER')]);

  type BarEntry = { k: 'item' | 'skill'; id: number } | null;
  /** barra salva: 10 posições, cada uma null, { k: 'item', id } de um item ou { k: 'skill', id } de uma skill que existe */
  function cleanBar(v: unknown): BarEntry[] {
    const out: BarEntry[] = [];
    const arr = Array.isArray(v) ? v : [];
    for (let i = 0; i < 10; i++) {
      const e = arr[i] as { k?: unknown; id?: unknown } | null | undefined;
      const ok = e && Number.isInteger(e.id) && ((e.k === 'item' && inventory?.catalog.byId.has(e.id as number)) || (e.k === 'skill' && skillCat?.byId.has(e.id as number)));
      out.push(ok ? { k: e!.k as 'item' | 'skill', id: e!.id as number } : null);
    }
    return out;
  }
  const barView = (bar: BarEntry[]) => bar.map((e) => {
    if (e?.k === 'skill') { const s = skillCat?.byId.get(e.id); return s ? { k: 'skill', id: s.id, icon: s.icon, name: s.name } : null; }
    const d = e && inventory?.catalog.byId.get(e.id); return d ? { k: 'item', id: d.id, icon: d.icon, name: d.name } : null;
  });

  // ---------- skills (server/skills.ts) ----------
  function skillsMsg(c: Conn) {
    const cb = c.cb!, job = c.player!.job;
    return { t: 'skills', points: cb.skillPoints, levels: Object.fromEntries(cb.skills), list: skillCat ? skillCat.forJob(job).map((s) => skillCat.view(s)) : [] };
  }

  /** aprender/subir: { id: nível novo } validado como no original */
  function skillUp(c: Conn, raw: unknown) {
    const p = c.player, cb = c.cb;
    if (!p || !cb || !skillCat || !raw || typeof raw !== 'object') return;
    const want = new Map<number, number>();
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) if (Number.isInteger(Number(k)) && Number.isInteger(v)) want.set(Number(k), v as number);
    if (!want.size) return;
    const r = skillCat.validate(p.job, p.level, cb.skills, want, cb.skillPoints);
    if (typeof r === 'string') { reply(c, r); send(c.ws, skillsMsg(c)); return; }
    cb.skillPoints -= r;
    for (const [id, lv] of want) if (lv > 0) cb.skills.set(id, lv);
    send(c.ws, skillsMsg(c));
    void saveCombat(p.id, cb, p.level).catch((e) => console.error('realtime: salvar skills', e));
  }

  /** lança a skill no mob (v1: golpes corpo a corpo EXT_MELEEATK) */
  /** lista de buffs para o cliente: ícone, nome e quanto falta (ms) */
  function buffsMsg(c: Conn) {
    const now = Date.now();
    return { t: 'buffs', list: [...(c.cb?.buffs.entries() ?? [])].map(([id, b]) => { const s = skillCat?.byId.get(id); return { id, name: s?.name ?? '', icon: s?.icon ?? '', lv: b.lv, left: Math.max(0, b.until - now) }; }) };
  }
  /** buffs vencidos saem e os atributos de luta voltam ao normal */
  function expireBuffs(c: Conn, force = false) {
    const cb = c.cb;
    if (!cb || !cb.buffs.size) return;
    const now = Date.now();
    let changed = false;
    for (const [id, b] of cb.buffs) if (force || b.until <= now) { cb.buffs.delete(id); changed = true; }
    if (!changed) return;
    void inventory?.state(c.player!.id).then((st) => { refreshFighter(c, st); send(c.ws, buffsMsg(c)); });
  }
  const buffTick = setInterval(() => { for (const c of conns) if (c.cb?.buffs.size) expireBuffs(c); }, 1000);
  http.on('close', () => clearInterval(buffTick));

  /**
   * Skill lançada. Por tipo (propSkill dwExeTarget): golpe (EXT_MELEEATK) e magia de ataque (EXT_MAGICATK/SHOT) precisam de um mob
   * alvo ao alcance; buff/cura (EXT_SELFCHGPARAMET, EXT_ANOTHER…) valem em quem lança: DST de efeito instantâneo (HP/MP/FP) cura na
   * hora, os demais viram um buff com a duração dwSkillTime (somam aos atributos como os itens equipados).
   */
  function castSkill(c: Conn, skillId: number, mobId: number) {
    const mobWorld = W(c).mobs;
    const p = c.player, cb = c.cb, s = skillCat?.byId.get(skillId);
    if (!p || !cb || !s || !rules || !mobWorld || cb.dead) return;
    const lv = cb.skills.get(skillId) ?? 0;
    if (lv <= 0) { reply(c, `Você ainda não aprendeu ${s.name}.`); return; }
    if (!skillCat!.lineage(p.job).has(s.job)) return;
    if (s.kind === 'other') { reply(c, `${s.name} ainda não pode ser lançada.`); return; }
    const now = Date.now();
    if ((cb.skillReady.get(skillId) ?? 0) > now) return;
    const L = s.levels[lv - 1];
    const attack = s.kind === 'melee' || s.kind === 'magic';
    let m: Mob | undefined;
    if (attack) {
      if (now < cb.nextAtk - 120) return;
      m = mobWorld.byId.get(mobId);
      if (!m || m.s === 'dead' || !m.prop) return;
      const reach = s.kind === 'magic' ? 24 : reachOf(rules.attackRange(cb.f)) + 1;
      if (Math.hypot(m.x - p.p[0], m.z - p.p[2]) > reach) return;
    }
    if (cb.mp < L.mp || cb.fp < L.fp) { reply(c, L.mp > cb.mp ? 'MP insuficiente.' : 'FP insuficiente.'); return; }
    cb.mp -= L.mp; cb.fp -= L.fp; cb.dirty = true;
    const cd = Math.max(L.cooldown || 0, s.kind === 'buff' ? 1000 : 1500);
    cb.skillReady.set(skillId, now + cd);
    send(c.ws, { t: 'skillUsed', id: skillId, cd });

    if (!attack) {
      // buff/cura em quem lança
      // duração = dwSkillTime + tempo por atributo (RT_TIME, SubReferTime): (refValue/10)×atributo + nível×(atributo/50), em ms
      let dur = L.time > 0 ? L.time : 0;
      if (dur > 0) {
        const def = inventory?.catalog.defines, RT_TIME = def?.get('RT_TIME') ?? -999;
        for (const r of s.refer) {
          if (r.target !== RT_TIME) continue;
          const stat = r.stat === def?.get('DST_INT') ? cb.f.int : r.stat === def?.get('DST_STA') ? cb.f.sta : r.stat === def?.get('DST_DEX') ? cb.f.dex : 0;
          dur += Math.floor((r.value / 10) * stat + lv * (stat / 50));
        }
      }
      const dst: [number, number][] = [];
      for (let i = 0; i < 2; i++) {
        const k = L.dest[i], v = L.adj[i];
        if (k <= 0 || !v) continue;
        if (k === DST.HP || k === DST.MP || k === DST.FP) {
          const key = k === DST.HP ? 'hp' : k === DST.MP ? 'mp' : 'fp', max = key === 'hp' ? cb.maxHp : key === 'mp' ? cb.maxMp : cb.maxFp;
          if (!dur) {
            // cura (CMover::ApplyParam DST_HP): valor da skill + (refValue/10)×atributo + nível×(atributo/50) — INT/STA/DEX conforme o dwReferStat
            let heal = v;
            if (key === 'hp') {
              const RT_HEAL = inventory?.catalog.defines.get('RT_HEAL') ?? -999;
              for (const r of s.refer) {
                if (r.target !== RT_HEAL) continue;
                const stat = r.stat === inventory?.catalog.defines.get('DST_INT') ? cb.f.int : r.stat === inventory?.catalog.defines.get('DST_STA') ? cb.f.sta : r.stat === inventory?.catalog.defines.get('DST_DEX') ? cb.f.dex : 0;
                heal += Math.floor((r.value / 10) * stat + lv * (stat / 50));
              }
            }
            cb[key] = Math.min(max, cb[key] + heal); cb.dirty = true;
          }
        } else if (dur) dst.push([k, v]);
      }
      if (dur && dst.length) {
        cb.buffs.set(skillId, { lv, until: now + dur, dst });
        void inventory?.state(p.id).then((st) => { refreshFighter(c, st); send(c.ws, buffsMsg(c)); });
      }
      sendNear(p.w, p.p[0], p.p[2], { t: 'skillfx', a: p.id, fx: { c: s.sfx[0], h: s.sfx[2], s: s.sfx[4], b: dur ? s.sfx[3] : -1, dur: Math.round(dur / 1000), mo: s.motion, sn: s.snd[0] } });
      return;
    }

    cb.nextAtk = now + (s.kind === 'magic' ? 1500 : 1200); // a animação da skill segura o próximo golpe
    const dmg = Math.max(1, skillCat!.meleePower(cb.f, s, lv, inventory?.catalog.bySymbol.get('II_WEA_HAN_HAND') ?? null) - skillCat!.mobSkillDefense(m!.prop!));
    const died = mobWorld.damage(m!, p.id, dmg, rules.peaceful(m!.prop!), now);
    sendNear(p.w, m!.x, m!.z, { t: 'hit', k: 'p', a: p.id, d: m!.id, dmg, f: 4, hp: mobHp(m!), sk: s.symbol, fx: { c: s.sfx[0], p: s.kind === 'magic' ? s.sfx[1] : -1, h: s.sfx[2], s: s.sfx[4], mo: s.kind === 'magic' ? s.motion : '', sn: s.snd[0], sh: s.snd[1] } });
    if (!died) return;
    let best = p.id, bestDmg = -1;
    for (const [id, d] of m!.dmgBy) if (d > bestDmg && connOf(id)) { best = id; bestDmg = d; }
    sendNear(p.w, m!.x, m!.z, { t: 'mdie', id: m!.id, k: best });
    const killer = connOf(best);
    if (killer?.player) { rewardKill(killer, m!.prop!, m!.x, m!.z); dropLoot(m!, killer); }
  }

  // ---------- pet coletor (CAIPet + __SYS_PETFILTER do Titanium) ----------
  /** o pet procura itens até 20 unidades do dono (CAIPet::SubItemLoot), corre a ~8 u/s e procura de novo a cada 0,3 s */
  const PET_RANGE = 20, PET_SPEED = 8;
  /** item IK3_PET: chama o pet (dwLinkKind = MI_* que aparece) ou recolhe se é o mesmo; outro pet troca */
  function togglePet(c: Conn, item: number, mover: number) {
    const p = c.player;
    if (!p) return;
    const same = c.pet?.item === item;
    c.pet = same ? undefined : { item, mover, busy: 0, skip: new Set() };
    p.pet = same ? undefined : mover;
    const msg = { t: 'pet', a: p.id, m: same ? 0 : mover };
    send(c.ws, msg);
    broadcast(msg, c, p.w);
  }
  /** manda o filtro com nome e ícone dos itens das listas */
  function sendPetFilter(c: Conn) {
    const f = c.petFilter ?? emptyPetFilter(), n: Record<number, [string, string]> = {};
    for (const id of [...f.white, ...f.black]) { const d = inventory?.catalog.byId.get(id); if (d) n[id] = [d.name, d.icon]; }
    send(c.ws, { t: 'petFilter', f, n });
  }
  /** o filtro deixa o pet pegar este item? (CUser::ShouldPickUp + listas branca e negra) */
  function petWants(c: Conn, itemId: number, gold: number): boolean {
    if (gold > 0) return true;
    const f = c.petFilter ?? emptyPetFilter(), d = inventory?.catalog.byId.get(itemId);
    if (!d) return false;
    if (f.white.includes(d.id)) return true;
    if (f.black.includes(d.id)) return false;
    const b = f.bits, sym = d.symbol, has = (bit: number) => (b & bit) !== 0;
    const job = c.player?.job ?? 0;
    if (has(FILTER.HPFOOD) && d.kind2 === D('IK2_FOOD')) return false;
    if (has(FILTER.MPFOOD) && d.kind3 === D('IK3_REFRESHER')) return false;
    if (has(FILTER.FPFOOD) && (d.kind2 === D('IK2_POTION') || d.kind3 === D('IK3_DRINK'))) return false;
    if (has(FILTER.BWEAPON) && d.kind1 === D('IK1_WEAPON') && d.referStat1 !== 1) return false;
    if (has(FILTER.GWEAPON) && d.kind1 === D('IK1_WEAPON') && d.referStat1 === 1) return false;
    if (has(FILTER.ULT_WEAP) && d.referStat1 === 2) return false;
    if (has(FILTER.BSET) && d.kind1 === D('IK1_ARMOR') && d.referStat1 !== 3) return false;
    if (has(FILTER.GSET) && d.referStat1 === 3) return false;
    if (has(FILTER.NECKLACE) && d.kind3 === D('IK3_NECKLACE')) return false;
    if (has(FILTER.EARRING) && d.kind3 === D('IK3_EARRING')) return false;
    if (has(FILTER.RING) && d.kind3 === D('IK3_RING')) return false;
    if (has(FILTER.EGG) && sym === 'II_PET_EGG') return false;
    if (has(FILTER.SUNSTONE) && /^II_(GEN_MAT_ORICHALCUM0[12](_1)?|SYS_SYS_SCR_SCRAPORICHALCUM)$/.test(sym)) return false;
    if (has(FILTER.MOONSTONE) && /^II_(GEN_MAT_MOONSTONE(_1)?|SYS_SYS_SCR_SCRAPMOONSTONE)$/.test(sym)) return false;
    if (has(FILTER.QUESTITEM) && (d.kind2 === D('IK2_GEM') || d.kind3 === D('IK3_GEM') || d.kind3 === D('IK3_EVENTSUB'))) return false;
    if (has(FILTER.CRAFT_MAT) && d.kind3 === D('IK3_CRAFTING_MAT')) return false;
    if (has(FILTER.ELECARDS) && d.kind3 === D('IK3_ELECARD')) return false;
    if (has(FILTER.CARD4P) && /^II_GEN_MAT_ELE_(MAGMA|FLOOD|STORM|THUNDER|MOUNTAIN)$/.test(sym)) return false;
    if (has(FILTER.CARD7P) && /^II_GEN_MAT_ELE_(EARTHQUAKE|LIGHTING|VACCUM|OCEAN|VOLCANO)$/.test(sym)) return false;
    if (has(FILTER.BPIECARD) && /^II_GEN_MAT_ELE_(CANDLE|RAINATK|BREEZEATK|SPARKATK|SANDATK)B$/.test(sym)) return false;
    if (has(FILTER.APIECARD) && /^II_GEN_MAT_ELE_(CANDLE|RAINATK|BREEZEATK|SPARKATK|SANDATK)A$/.test(sym)) return false;
    if (has(FILTER.MALE) && d.sex === 0) return false;
    if (has(FILTER.FEMALE) && d.sex === 1) return false;
    if (has(FILTER.JEWELS) && d.kind2 === D('IK2_MATERIAL') && d.kind3 === D('IK3_ULTIMATE')) return false;
    const weapon = d.kind1 === D('IK1_WEAPON') || d.kind3 === D('IK3_SHIELD'), armor = d.kind1 === D('IK1_ARMOR') && d.kind3 !== D('IK3_SHIELD');
    if (has(FILTER.OTHER_WEAP) && weapon && !jobCanUse(d.job, job)) return false;
    if (has(FILTER.OTHER_ARM) && armor && !jobCanUse(d.job, job)) return false;
    // raridade mínima: os drops ainda não sorteiam raridade (são todos Common), então só "Common" ou desligado deixa pegar
    if (f.wr > 0 && weapon) return false;
    if (f.ar > 0 && armor) return false;
    return true;
  }
  /** a cada 0,3 s: cada pet livre vai buscar o item mais perto do dono que ele pode pegar */
  const petTick = setInterval(() => {
    const now = Date.now();
    for (const c of conns) {
      const p = c.player, pet = c.pet;
      if (!p || !pet || pet.busy > now || c.cb?.dead || c.switching || p.s.startsWith('fly')) continue;
      let best: GroundItem | null = null, bestD = PET_RANGE;
      for (const g of ground.values()) {
        if (g.w !== p.w || pet.skip.has(g.id)) continue;
        const dist = Math.hypot(g.x - p.p[0], g.z - p.p[2]);
        if (dist >= bestD || (g.owner !== p.id && now < g.ownerUntil) || !petWants(c, g.itemId, g.gold)) continue;
        best = g; bestD = dist;
      }
      if (!best) continue;
      const g = best, ms = Math.round((bestD / PET_SPEED) * 1000) + 250;
      pet.busy = now + ms + 300;
      sendNear(p.w, g.x, g.z, { t: 'petGo', a: p.id, x: g.x, z: g.z, ms });
      setTimeout(() => {
        if (c.pet !== pet || !c.player || ground.get(g.id) !== g || c.player.w !== g.w) return;
        ground.delete(g.id);
        c.invQueue = c.invQueue.then(async () => {
          const left = await giveLoot(c, g.itemId, g.count, g.upgrade, g.gold);
          if (left > 0) { g.count = left; ground.set(g.id, g); pet.skip.add(g.id); } // bolsa cheia: não fica tentando
        }).catch((e) => { console.error('realtime: pet pegar item', e); ground.set(g.id, g); });
      }, ms);
    }
  }, 300);

  /**
   * Usa o item do espaço `slot` da bolsa (CMover::DoUseItem / DoUseItemFood): poção, comida e refresher curam HP/MP/FP
   * pelo dwDestParam/nAdjParamVal; acima do limite dwAbilityMin a cura cai para 30 %; espera dwSkillReady (mín. 1 s) por grupo.
   */
  function useItem(c: Conn, slot: number) {
    const p = c.player, cb = c.cb;
    if (!p || !cb || !inventory || cb.dead) return;
    c.invQueue = c.invQueue.then(async () => {
      const st = await inventory.state(p.id);
      const it = st.items.find((i) => i.c === 0 && i.s === slot);
      const d = it && inventory.catalog.byId.get(it.id);
      if (!d) return;
      if (d.kind3 === 122 && await useTicket(c, slot, d.symbol)) return; // IK3_TICKET: viagem para outro mapa (Azria)
      if (d.kind3 === D('IK3_PET') && d.linkKind) { togglePet(c, d.id, d.linkKind); return; } // pet coletor: chama / recolhe
      if (it.x && it.x <= Date.now()) { send(c.ws, { t: 'invError', error: `${d.name} expirou.` }); return; }
      // caixa (propPackItem.inc): tudo o que vem dentro vai para a bolsa
      if (inventory.catalog.packs.has(d.id)) {
        const r = await inventory.openPack(p.id, slot);
        if ('error' in r) { send(c.ws, { t: 'invError', error: r.error }); return; }
        send(c.ws, inventory.view(r.state));
        for (const n of r.names) reply(c, `Você recebeu ${n}.`);
        return;
      }
      if (!USE_KINDS.has(d.kind2)) { send(c.ws, { t: 'invError', error: `${d.name} ainda não pode ser usado.` }); return; }
      const now = Date.now();
      if ((cb.readyAt.get(d.kind2) ?? 0) > now) return; // ainda esperando (teclas repetidas)
      const gains = { hp: 0, mp: 0, fp: 0 };
      for (let i = 0; i < 3; i++) {
        const dst = d.dest[i], val = d.adj[i];
        const key = dst === DST.HP ? 'hp' : dst === DST.MP ? 'mp' : dst === DST.FP ? 'fp' : null;
        if (!key || val <= 0) continue;
        const cur = cb[key], max = key === 'hp' ? cb.maxHp : key === 'mp' ? cb.maxMp : cb.maxFp;
        const add = d.abilityMin > 0 && cur >= d.abilityMin ? Math.floor(val * 0.3) : val;
        const next = Math.min(max, cur + add);
        gains[key] = next - cur;
        cb[key] = next;
      }
      const after = await inventory.consume(p.id, slot);
      if (!after) return;
      const cd = Math.max(1000, d.ready || 0);
      cb.readyAt.set(d.kind2, now + cd);
      cb.dirty = true;
      send(c.ws, inventory.view(after));
      send(c.ws, { t: 'used', id: d.id, ...gains, cd });
    }).catch((e) => console.error('realtime: usar item', e));
  }

  // ---------- lojas dos NPCs (server/shops.ts) ----------
  const reply = (c: Conn, text: string) => send(c.ws, { t: 'chat', id: 0, name: '', text });

  function shopOpen(c: Conn, key: string) {
    const shops = W(c).shops;
    const p = c.player;
    if (!p || !shops || !inventory) return;
    const k = key.toLowerCase();
    if (!shops.near(k, p.p[0], p.p[2])) return;
    const shop = shops.shops.get(k);
    if (!shop) { const tk = shops.tokenShops.get(k); if (tk) reply(c, `Esta loja só aceita ${tk} (ainda não disponível).`); return; }
    send(c.ws, {
      t: 'shop', key: k, name: shop.name,
      tabs: shop.tabs.map((tab) => ({ name: tab.name, items: tab.items.map((it) => ({ ...inventory.catalog.viewFull(inventory.catalog.byId.get(it.id)!), price: it.price })) })),
    });
  }

  /** compra: tira o penya primeiro (só se tiver), põe na bolsa e devolve o que não coube */
  function shopBuy(c: Conn, key: string, itemId: number, n: number) {
    const shops = W(c).shops;
    const p = c.player, k = key.toLowerCase();
    const shop = shops?.shops.get(k), it = shop?.tabs.flatMap((t) => t.items).find((x) => x.id === itemId), d = inventory?.catalog.byId.get(itemId);
    if (!p || !shops || !inventory || !it || !d || !shops.near(k, p.p[0], p.p[2])) return;
    const count = Math.max(1, Math.min(d.packMax > 1 ? Math.min(d.packMax, 9999) : 1, n));
    const total = it.price * count;
    c.invQueue = c.invQueue.then(async () => {
      if (!(await inventory.spendGold(p.id, total))) { reply(c, `Penya insuficiente: ${count}× ${d.name} custa ${total.toLocaleString('pt-BR')}.`); return; }
      const left = await inventory.add(p.id, itemId, count);
      if (left > 0) {
        await inventory.addGold(p.id, left * it.price);
        reply(c, left === count ? 'A bolsa está cheia.' : `Só couberam ${count - left}; o resto foi devolvido.`);
      }
      if (left < count) reply(c, `Você comprou ${count - left > 1 ? `${count - left}× ` : ''}${d.name} por ${((count - left) * it.price).toLocaleString('pt-BR')} penya.`);
    }).catch((e) => { console.error('realtime: compra', e); reply(c, 'Erro na compra.'); });
  }

  /** venda: tira da bolsa e paga dwCost/4 por unidade */
  function shopSell(c: Conn, key: string, slot: number, n: number) {
    const shops = W(c).shops;
    const p = c.player, k = key.toLowerCase();
    if (!p || !shops || !inventory || !shops.shops.has(k) || !shops.near(k, p.p[0], p.p[2])) return;
    c.invQueue = c.invQueue.then(async () => {
      const got = await inventory.takeFromSlot(p.id, slot, Math.max(1, n));
      if (!got) return;
      const d = inventory.catalog.byId.get(got.item.id);
      const gold = shops.sellPrice(got.item.id) * got.taken;
      await inventory.addGold(p.id, gold);
      reply(c, `Você vendeu ${got.taken > 1 ? `${got.taken}× ` : ''}${d?.name ?? 'item'} por ${gold.toLocaleString('pt-BR')} penya.`);
    }).catch((e) => { console.error('realtime: venda', e); reply(c, 'Erro na venda.'); });
  }

  /** golpe do mob no jogador (chamado pela IA dos mobs) */
  function mobAttack(m: Mob, playerId: number) {
    const c = connOf(playerId), cb = c?.cb, p = c?.player;
    if (!c || !cb || !p || !rules || !m.prop || cb.dead) return;
    const r = rules.mobHitsPlayer(m.prop, cb.f);
    // imortal (GM/admin): o golpe acontece e o dano aparece, mas o HP não cai
    if (r.hit && !c.god) { cb.hp = Math.max(0, cb.hp - r.dmg); cb.lastHurt = Date.now(); cb.dirty = true; }
    sendNear(p.w, m.x, m.z, { t: 'hit', k: 'm', a: m.id, d: p.id, dmg: r.dmg, f: (r.hit ? 0 : 1) | (r.crit ? 2 : 0), hp: cb.hp });
    if (cb.hp > 0) return;
    killPlayer(c);
  }

  /** morreu (golpe de mob ou //kill): os mobs desistem; renasce pela caixa "Reviver na cidade" ou por Resurrection */
  function killPlayer(c: Conn) {
    const cb = c.cb, p = c.player;
    if (!cb || !p || cb.dead) return;
    if (c.trade) tradeClose(c.trade, 'A troca foi cancelada.');
    cb.dead = true;
    cb.hp = 0; cb.dirty = true;
    expireBuffs(c, true);
    p.s = 'dead'; c.dirty = true;
    W(c).mobs?.forget(p.id);
    broadcast({ t: 'pdie', id: p.id }, undefined, p.w);
    send(c.ws, { t: 'chat', id: 0, name: '', text: 'Você foi derrotado. Renasça na cidade ou espere um Assist usar Resurrection.' });
  }

  /** //revive: levanta ali mesmo (MTI_GETUP) com HP/MP/FP cheios */
  function reviveInPlace(c: Conn) {
    const cb = c.cb, p = c.player;
    if (!cb || !p || !cb.dead) return;
    cb.dead = false;
    cb.hp = cb.maxHp; cb.mp = cb.maxMp; cb.fp = cb.maxFp; cb.dirty = true;
    p.s = 'stand'; c.dirty = true;
    sendNear(p.w, p.p[0], p.p[2], { t: 'getup', id: p.id });
  }

  /** botão "Reviver": volta ao ponto de chegada do mapa com metade do HP */
  function reviveInTown(c: Conn) {
    const cb = c.cb, p = c.player;
    if (!cb || !p || !cb.dead) return;
    cb.dead = false;
    cb.hp = Math.ceil(cb.maxHp / 2); cb.mp = Math.max(cb.mp, Math.ceil(cb.maxMp / 2)); cb.fp = Math.max(cb.fp, Math.ceil(cb.maxFp / 2));
    cb.dirty = true;
    const at = W(c).start;
    p.p = [...at]; p.s = 'stand'; c.dirty = true;
    send(c.ws, { t: 'teleport', p: at, revive: true });
  }

  /**
   * Resurrection (SI_ASS_HEAL_RESURRECTION, Assist e evoluções; EXT_ANOTHER): no jogador morto a até 20 m, no mesmo mapa.
   * Ele levanta ali mesmo (MTI_GETUP) com HP de 20 % + 8 % por nível da skill. Quem lança toca MTI_ASS_RESURRECTION com o
   * efeito de lançar (dwSfxObj) e o alvo recebe o efeito do acerto (dwSfxObj3).
   */
  function resurrect(c: Conn, skillId: number, targetId: number) {
    const p = c.player, cb = c.cb, s = skillCat?.byId.get(skillId);
    if (!p || !cb || !s || cb.dead || s.symbol !== 'SI_ASS_HEAL_RESURRECTION') return;
    const lv = cb.skills.get(skillId) ?? 0;
    if (lv <= 0 || !skillCat!.lineage(p.job).has(s.job)) { reply(c, `Você ainda não aprendeu ${s.name}.`); return; }
    const o = liveConn(targetId), tp = o?.player, tcb = o?.cb;
    if (!o || !tp || !tcb || !tcb.dead) { reply(c, 'Escolha um jogador derrotado.'); return; }
    if (tp.w !== p.w || Math.hypot(tp.p[0] - p.p[0], tp.p[2] - p.p[2]) > 20) { reply(c, 'Chegue mais perto do jogador derrotado.'); return; }
    const now = Date.now();
    if ((cb.skillReady.get(skillId) ?? 0) > now) return;
    const L = s.levels[lv - 1];
    if (cb.mp < L.mp || cb.fp < L.fp) { reply(c, L.mp > cb.mp ? 'MP insuficiente.' : 'FP insuficiente.'); return; }
    cb.mp -= L.mp; cb.fp -= L.fp; cb.dirty = true;
    const cd = Math.max(L.cooldown || 0, 3000);
    cb.skillReady.set(skillId, now + cd);
    send(c.ws, { t: 'skillUsed', id: skillId, cd });
    sendNear(p.w, p.p[0], p.p[2], { t: 'skillfx', a: p.id, fx: { c: s.sfx[0], h: -1, s: -1, b: -1, mo: s.motion, sn: s.snd[0] } });
    // o alvo levanta depois da animação de lançar
    setTimeout(() => {
      if (!tcb.dead || o.player !== tp || !conns.has(o)) return;
      tcb.dead = false;
      tcb.hp = Math.max(1, Math.ceil(tcb.maxHp * Math.min(1, 0.2 + 0.08 * lv)));
      tcb.dirty = true;
      tp.s = 'stand'; o.dirty = true;
      sendNear(tp.w, tp.p[0], tp.p[2], { t: 'skillfx', a: tp.id, fx: { c: -1, h: -1, s: s.sfx[2], b: -1, mo: '', sn: s.snd[1] } });
      sendNear(tp.w, tp.p[0], tp.p[2], { t: 'getup', id: tp.id });
      send(o.ws, { t: 'chat', id: 0, name: '', text: `${p.name} trouxe você de volta à vida.` });
      reply(c, `Você reviveu ${tp.name}.`);
    }, 1200);
  }

  for (const wr of worlds.values()) {
    const mobWorld = wr.mobs;
    if (!mobWorld) continue;
    mobWorld.hooks = {
      player: (id) => { const c = connOf(id); return c?.player && c.player.w === wr.name && c.cb && !c.cb.dead && !c.invis ? [c.player.p[0], c.player.p[2]] : null; },
      playersNear: (x, z, r) => {
        const out: { id: number; x: number; z: number }[] = [];
        for (const c of conns) if (c.player && c.player.w === wr.name && c.cb && !c.cb.dead && !c.invis && Math.hypot(c.player.p[0] - x, c.player.p[2] - z) <= r) out.push({ id: c.player.id, x: c.player.p[0], z: c.player.p[2] });
        return out;
      },
      attack: (m, id) => { if (connOf(id)?.player?.w === wr.name) mobAttack(m, id); },
    };
  }

  // recuperação fora de combate (a cada 3 s, 5 s depois do último golpe recebido) e envio dos atributos que mudaram
  const regen = setInterval(() => {
    const now = Date.now();
    for (const c of conns) {
      const cb = c.cb;
      if (!cb || !c.player) continue;
      if (!cb.dead && now - cb.lastHurt > 5000 && (cb.hp < cb.maxHp || cb.mp < cb.maxMp || cb.fp < cb.maxFp)) {
        cb.hp = Math.min(cb.maxHp, cb.hp + Math.max(1, Math.round(cb.maxHp * 0.03)));
        cb.mp = Math.min(cb.maxMp, cb.mp + Math.max(1, Math.round(cb.maxMp * 0.03)));
        cb.fp = Math.min(cb.maxFp, cb.fp + Math.max(1, Math.round(cb.maxFp * 0.03)));
        cb.dirty = true;
      }
    }
  }, 3000);
  const statsTick = setInterval(() => {
    for (const c of conns) if (c.cb?.dirty && c.player) { c.cb.dirty = false; send(c.ws, statsMsg(c)); }
  }, 200);
  http.on('close', () => { clearInterval(regen); clearInterval(statsTick); clearInterval(autosaveTimer); });

  async function join(c: Conn, msg: Record<string, unknown>) {
    const tok = typeof msg.token === 'string' ? msg.token : null;
    const s = opts.resolveSession ? (tok ? await opts.resolveSession(tok) : null) : sessionFrom(tok);
    if (!s) { send(c.ws, { t: 'error', error: 'Sessão expirada. Entre novamente.' }); c.ws.close(); return; }
    const r = await query<{ id: string; name: string; sex: number; hair_mesh: number; hair_color: number; head_mesh: number; level: number; job: number; pos_x: number; pos_y: number; pos_z: number; angle: number;
      str: number; sta: number; dex: number; int: number; hp: number; mp: number; fp: number; exp: string; stat_points: number; shortcuts: unknown; skills: Record<string, number>; skill_points: number; world_id: number; pet_filter: unknown }>(
      'SELECT id, name, sex, hair_mesh, hair_color, head_mesh, level, job, pos_x, pos_y, pos_z, angle, world_id, str, sta, dex, "int", hp, mp, fp, exp, stat_points, shortcuts, skills, skill_points, pet_filter FROM characters WHERE id = $1 AND account_id = $2 AND NOT deleted',
      [Number(msg.characterId), s.accountId]);
    const ch = r.rows[0];
    if (!ch) { send(c.ws, { t: 'error', error: 'Personagem não encontrado nesta conta.' }); c.ws.close(); return; }
    const id = Number(ch.id);
    // o mesmo personagem aberto em outro lugar: a conexão antiga sai
    for (const o of conns) if (o !== c && o.player?.id === id) { send(o.ws, { t: 'error', error: 'Personagem conectado em outro lugar.' }); o.ws.close(); }
    c.accountId = s.accountId;
    const p0: unknown[] = Array.isArray(msg.p) ? msg.p : [ch.pos_x, ch.pos_y, ch.pos_z];
    const rank = rankOf(await gmAuthority(s.accountId));
    c.hide = Number.isInteger(msg.hide) ? (msg.hide as number) & 0x7f : 0;
    let inv = inventory ? await inventory.attach(id, ch.sex) : null;
    const removed = inventory && inv ? await inventory.fixEquipped(id, { sex: ch.sex, level: ch.level, job: jobForLevel(ch.job, ch.level) }) : [];
    if (inventory && removed.length) inv = await inventory.state(id);
    if (c.ws.readyState !== WebSocket.OPEN) { void inventory?.detach(id); return; } // fechou enquanto carregava
    const guildRow = await loadGuildOf(id);
    c.guild = guildRow;
    const wr = [...worlds.values()].find((x) => x.id === ch.world_id) ?? null;
    const wname = wr?.name ?? MAIN;
    const pStart = wr ? (inWorld(p0) ? p0 : [ch.pos_x, ch.pos_y, ch.pos_z]) : [...REVIVE_AT];
    c.player = { w: wname, ...(guildRow ? { guild: guildRow.name } : {}), ...(guildRow?.rank === 0 ? { gmaster: 1 as const } : {}), id, name: ch.name, sex: ch.sex, hair: ch.hair_mesh, ...(ch.hair_color ? { hc: ch.hair_color } : {}), head: ch.head_mesh, level: ch.level, p: pStart as [number, number, number], h: ch.angle, s: 'stand', eq: inv ? inventory!.looks(inv, c.hide) : [], job: ch.job, mt: stanceOf(c, inv ? inventory!.combatMotion(inv, ch.job) : 0), rank };
    if (rules) {
      const okJob = jobForLevel(ch.job, ch.level);
      if (okJob !== ch.job) { // nível abaixo do da classe (mexido fora do jogo): volta para a classe que o nível permite
        ch.job = okJob; c.player.job = okJob; ch.skills = {};
        await query('UPDATE characters SET job = $2, skills = \'{}\'::jsonb, updated_at = now() WHERE id = $1', [id, okJob]);
      }
      const buffs = await loadBuffs(id); // buffs guardados já entram nos máximos de HP/MP/FP
      const f = fighterFrom(ch, inv, [...buffs.values()].flatMap((b) => b.dst));
      const maxHp = rules.maxHp(f), maxMp = rules.maxMp(f), maxFp = rules.maxFp(f);
      // 0 salvo = personagem novo (ou comando de GM) → cheio
      c.cb = { f, maxHp, maxMp, maxFp, hp: Math.min(maxHp, ch.hp || maxHp), mp: Math.min(maxMp, ch.mp || maxMp), fp: Math.min(maxFp, ch.fp || maxFp),
        exp: Number(ch.exp) || 0, dead: false, nextAtk: 0, lastHurt: 0, dirty: false, points: ch.stat_points ?? 0, readyAt: new Map(),
        skills: new Map(Object.entries(ch.skills ?? {}).map(([k, v]) => [Number(k), Number(v)] as [number, number]).filter(([k, v]) => Number.isInteger(k) && v > 0)),
        skillPoints: ch.skill_points ?? 0, skillReady: new Map(), buffs };
      reconcilePoints(c.cb, ch.level);
    }
    c.onlineSet = query('UPDATE characters SET online = true WHERE id = $1', [id]).then(() => {}, () => {}); // o site mostra quem está online
    const me = c.player;
    c.petFilter = cleanPetFilter(ch.pet_filter);
    sendPetFilter(c);
    send(c.ws, { t: 'clock', now: Date.now(), fixed: clockFixed });
    send(c.ws, { t: 'welcome', id, w: me.w, p: me.p, eq: me.eq, mt: me.mt, players: [...conns].filter((o) => o !== c && o.player && o.player.w === me.w && seesActor(c, o.player.id)).map((o) => o.player) });
    // GM/admin entra imortal (pode desligar com //god off ou no painel)
    if (isStaff(c)) { c.god = true; send(c.ws, { t: 'god', on: true }); }
    if (inv) send(c.ws, inventory!.view(inv));
    if (removed.length) send(c.ws, { t: 'chat', id: 0, name: '', text: `Sua classe não pode usar: ${removed.join(', ')}. Foi para a bolsa.` });
    if (c.cb) send(c.ws, statsMsg(c));
    send(c.ws, { t: 'bar', slots: barView(cleanBar(ch.shortcuts)) });
    if (c.cb) send(c.ws, skillsMsg(c));
    if (c.cb?.buffs.size) send(c.ws, buffsMsg(c));
    broadcast({ t: 'enter', player: c.player }, c, c.player.w);
    void loadFriends(c);
    const pt = parties.of(id); // voltou de outro mundo: a party continua
    if (pt) pushParty(pt);
    console.log(`realtime: ${c.player.name} entrou (${[...conns].filter((o) => o.player).length} online)`);
  }

  // inventário mudado fora do jogo (npm run account -- give-item/give-penya): o PostgreSQL avisa por NOTIFY e quem está
  // online com aquele personagem recebe o estado novo na hora. Uma conexão dedicada fica escutando; se cair, reconecta.
  /** manda o inventário atual aos jogadores online daquele personagem; `fresh` = mudou no banco por fora → relê antes */
  function pushInventory(id: number, fresh: boolean) {
    if (!inventory) return;
    for (const c of conns) {
      if (c.player?.id !== id) continue;
      const player = c.player, ws = c.ws;
      c.invQueue = c.invQueue.then(async () => {
        const st = fresh ? await inventory.reload(id) : await inventory.state(id);
        send(ws, inventory.view(st));
        refreshFighter(c, st);
        const eq = inventory.looks(st, c.hide), mt = stanceOf(c, inventory.combatMotion(st, player.job));
        if (eq.join() !== player.eq.join() || mt !== player.mt) { player.eq = eq; player.mt = mt; broadcast({ t: 'look', id, eq, mt }); }
      }).catch((e) => console.error('realtime: inventário (aviso)', e));
    }
  }
  if (inventory) {
    inventory.onLocalChange = (id) => pushInventory(id, false);
    let stopped = false;
    const listen = async () => {
      try {
        const client = await pool.connect();
        const retry = () => { client.release(true); if (!stopped) setTimeout(() => void listen(), 5000); };
        client.on('error', (e) => { console.error('realtime: LISTEN caiu', e.message); retry(); });
        client.on('notification', (n) => pushInventory(Number(n.payload), true));
        await client.query(`LISTEN ${INVENTORY_CHANNEL}`);
      } catch (e) {
        console.error('realtime: não consegui escutar avisos de inventário', (e as Error).message);
        if (!stopped) setTimeout(() => void listen(), 5000);
      }
    };
    void listen();
    http.on('close', () => { stopped = true; });
  }

  wss.on('connection', (ws: WebSocket) => {
    const c: Conn = { ws, player: null, accountId: 0, dirty: false, alive: true, mobs: new Set(), chatAt: [], invQueue: Promise.resolve(), cb: null, ground: new Set(), hide: 0, joinedAt: Date.now() };
    conns.add(c);
    counters.connections++;
    ws.on('pong', () => { c.alive = true; });
    ws.on('message', (raw) => {
      counters.msgIn++;
      let msg: Record<string, unknown>;
      try { msg = JSON.parse(String(raw)); } catch { return; }
      // ping do rodapé do cliente: devolve na hora o carimbo dele (mede ida e volta)
      if (msg.t === 'ping') { if (typeof msg.c === 'number') send(ws, { t: 'pong', c: msg.c }); return; }
      if (msg.t === 'join' && !c.player) { join(c, msg).catch((e) => { console.error('realtime join', e); send(ws, { t: 'error', error: 'Servidor indisponível.' }); ws.close(); }); return; }
      if (msg.t === 'state' && c.player && !c.cb?.dead) {
        const p: unknown[] = Array.isArray(msg.p) ? msg.p : [];
        if (!inWorld(p)) return;
        const q = c.player.p;
        if (!moveOk(c, Math.hypot(p[0] - q[0], p[2] - q[2]))) return;
        const h = Number(msg.h);
        c.player.p = [p[0], p[1], p[2]];
        if (Number.isFinite(h)) c.player.h = ((h % 360) + 360) % 360;
        if (typeof msg.s === 'string' && STATES.has(msg.s)) c.player.s = msg.s;
        c.dirty = true;
      } else if ((msg.t === 'friendAdd' || msg.t === 'friendAnswer' || msg.t === 'friendDel') && c.player && Number.isInteger(msg.id)) {
        void friendMsg(c, msg.t, msg.id as number, msg.ok === true);
      } else if (msg.t === 'revive' && c.player) {
        reviveInTown(c);
      } else if (msg.t === 'res' && c.player && Number.isInteger(msg.id) && Number.isInteger(msg.target)) {
        resurrect(c, msg.id as number, msg.target as number);
      } else if (typeof msg.t === 'string' && msg.t.startsWith('guild') && c.player) {
        void guildMsg(c, msg).catch((e) => { console.error('realtime: guild', e); send(c.ws, { t: 'chat', id: 0, name: '', text: 'Servidor indisponível.' }); });
      } else if (typeof msg.t === 'string' && msg.t.startsWith('trade') && c.player) {
        tradeMsg(c, msg);
      } else if (typeof msg.t === 'string' && msg.t.startsWith('party') && c.player) {
        partyMsg(c, msg);
      } else if (msg.t === 'pm' && c.player && (Number.isInteger(msg.to) || typeof msg.toName === 'string') && typeof msg.text === 'string') {
        privateMessage(c, Number.isInteger(msg.to) ? msg.to as number : String(msg.toName).slice(0, 32), msg.text);
      } else if ((msg.t === 'emote' || msg.t === 'emo') && c.player) {
        // janela de movimentos (tecla O): movimento (MTI_*, modo 0/1/2 do propMotion) ou emoticon (0–68, texChatEmoticon)
        const now = Date.now(), p = c.player;
        if (now - (c.emoteAt ?? 0) < 330) return;
        if (msg.t === 'emote' && typeof msg.m === 'string' && /^MTI_[A-Z0-9_]{1,24}$/.test(msg.m)) {
          c.emoteAt = now;
          sendNear(p.w, p.p[0], p.p[2], { t: 'emote', id: p.id, m: msg.m, md: Math.max(0, Math.min(2, Number(msg.md) | 0)) });
        } else if (msg.t === 'emo' && Number.isInteger(msg.i) && (msg.i as number) >= 0 && (msg.i as number) < 69) {
          c.emoteAt = now;
          sendNear(p.w, p.p[0], p.p[2], { t: 'emo', id: p.id, i: msg.i });
        }
      } else if (msg.t === 'chat' && c.player && typeof msg.text === 'string') {
        // tira caracteres de controle, junta espaços e corta no limite; o cliente mostra como texto (sem HTML)
        const text = msg.text.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, CHAT_MAX);
        if (!text) return;
        const now = Date.now();
        c.chatAt = c.chatAt.filter((t) => now - t < CHAT_WINDOW_MS);
        if (c.chatAt.length >= CHAT_BURST) { send(ws, { t: 'chat', id: 0, name: '', text: 'Calma! Você está mandando mensagens rápido demais.' }); return; }
        c.chatAt.push(now);
        if (text.startsWith('//')) {
          const me = c.player;
          const reply = (t: string) => send(ws, { t: 'chat', id: 0, name: '', text: t });
          runGmCommand({
            accountId: c.accountId, self: { id: me.id, name: me.name, level: me.level, p: [...me.p] }, inventory, reply,
            online: (name) => { for (const o of conns) if (o.player && o.player.name.toLowerCase() === name.toLowerCase()) return { id: o.player.id, name: o.player.name, level: o.player.level, p: [...o.player.p] }; return null; },
            openPanel: () => send(ws, { t: 'gmOpen' }),
            invis: (on) => {
              const want = on ?? !c.invis;
              setInvis(c, want);
              return want ? 'Dark Illusion: você está invisível para os jogadores (GMs e admins ainda veem você).' : 'Dark Illusion desligada: todos veem você de novo.';
            },
            drop: (itemId, n) => {
              const p = c.player!, now = Date.now(), name = inventory?.catalog.byId.get(itemId)?.name ?? 'Item';
              for (let i = 0; i < n; i++) {
                const a = Math.random() * Math.PI * 2, r = 3 + Math.random() * 6;
                ground.set(++groundSeq, { w: p.w, id: groundSeq, itemId, count: 1, upgrade: 0, gold: 0, x: p.p[0] + Math.cos(a) * r, z: p.p[2] + Math.sin(a) * r, owner: 0, ownerUntil: 0, expires: now + GROUND_MS });
              }
              return `${n}× ${name} no chão.`;
            },
            time: (hour) => {
              clockFixed = hour;
              for (const o of conns) if (o.player) send(o.ws, { t: 'clock', now: Date.now(), fixed: clockFixed });
              return hour === null ? 'Relógio do jogo andando de novo (dia 6h–19h em 21,6 min, noite em 7,2 min).' : `Hora do jogo fixada em ${String(Math.floor(hour) % 24).padStart(2, '0')}:${String(Math.round((hour % 1) * 60)).padStart(2, '0')} para todos (//time auto volta ao normal).`;
            },
            god: (on) => {
              c.god = on ?? !c.god;
              send(ws, { t: 'god', on: c.god });
              return c.god ? 'Imortal ligado: os mobs batem, o dano aparece, mas o seu HP não cai.' : 'Imortal desligado: você volta a perder HP e pode morrer.';
            },
            kill: (id) => {
              const o = liveConn(id);
              if (!o?.cb || !o.player) return 'Esse personagem não está online.';
              if (o.cb.dead) return `${o.player.name} já está morto.`;
              if (o.god) return `${o.player.name} está imortal (//god off para desligar).`;
              killPlayer(o);
              return `${o.player.name} foi morto.`;
            },
            revive: (id) => {
              const o = liveConn(id);
              if (!o?.cb || !o.player) return 'Esse personagem não está online.';
              if (!o.cb.dead) return `${o.player.name} não está morto.`;
              reviveInPlace(o);
              send(o.ws, { t: 'chat', id: 0, name: '', text: 'Um GM trouxe você de volta à vida.' });
              return `${o.player.name} foi revivido.`;
            },
            clearMobs: () => { const n = W(c).mobs?.clearSummons() ?? 0; return n ? `${n} monstro(s) invocado(s) apagado(s).` : 'Nenhum monstro invocado neste mapa.'; },
            summonMob: (what, n, at) => {
              const mw = W(c).mobs, p = c.player;
              if (!mw || !p) return 'Sem monstros neste mapa.';
              if (at && Math.hypot(at[0] - p.p[0], at[1] - p.p[2]) > 120) return 'Esse ponto está longe demais (até 120 m de você).';
              let id = /^\d+$/.test(what) ? Number(what) : -1;
              if (id < 0) for (const [k, v] of mw.terrain.moverProps) if (v.symbol.toLowerCase() === what.toLowerCase()) { id = k; break; }
              const made = id >= 0 ? mw.summon(id, at ? at[0] : p.p[0] + 3, at ? at[1] : p.p[2] + 3, p.p[1], n) : 0;
              return made ? `${made}× ${mw.terrain.moverProps.get(id)?.symbol} invocado(s) ${at ? 'no lugar marcado' : 'perto de você'}.` : `Monstro ${what} não existe.`;
            },
            teleport: (id, p) => {
              if (!inWorld(p)) return false;
              for (const o of conns) if (o.player?.id === id) { o.player.p = [...p]; o.dirty = true; send(o.ws, { t: 'teleport', p }); }
              return true;
            },
            setJobLive: async (id, job) => {
              for (const o of conns) {
                if (o.player?.id !== id || !inventory) continue;
                o.player.job = job;
                if (o.cb) { o.cb.f.job = job; recalcMax(o); send(o.ws, skillsMsg(o)); }
                const mt = stanceOf(o, inventory.combatMotion(await inventory.state(id), job));
                if (mt !== o.player.mt) { o.player.mt = mt; broadcast({ t: 'look', id, eq: o.player.eq, mt }); }
              }
            },
            resetStatsLive: (id) => {
              let done = false;
              for (const o of conns) if (o.player?.id === id && o.cb && rules) {
                o.cb.f.base = { str: 15, sta: 15, dex: 15, int: 15 };
                reconcilePoints(o.cb, o.player.level); // pontos livres = tudo o que o nível dá
                void inventory?.state(id).then((st) => { refreshFighter(o, st); send(o.ws, statsMsg(o)); });
                void saveCombat(id, o.cb, o.player.level).catch((e) => console.error('realtime: salvar reset de atributos (GM)', e));
                done = true;
              }
              return done;
            },
            setLevelLive: (id, level) => {
              for (const o of conns) if (o.player?.id === id) {
                o.player.level = level;
                if (o.cb && rules) {
                  o.cb.exp = 0;
                  // nível abaixo do da classe (ex.: 14 sendo Mercenary): volta para Vagrant/1ª classe; //set-level zera as skills e devolve os pontos
                  const okJob = jobForLevel(o.cb.f.job, level);
                  if (okJob !== o.cb.f.job) {
                    o.player.job = okJob; o.cb.f.job = okJob; o.cb.buffs.clear();
                    void query('UPDATE characters SET job = $2, updated_at = now() WHERE id = $1', [id, okJob]).catch(() => {});
                    send(o.ws, { t: 'chat', id: 0, name: '', text: `Você voltou a ser ${okJob === 0 ? 'Vagrant' : JOB_NAMES[okJob] ?? '#' + okJob}.` });
                    broadcast({ t: 'job', id, job: okJob });
                  }
                  o.cb.skills.clear();
                  reconcilePoints(o.cb, level);
                  send(o.ws, skillsMsg(o));
                  send(o.ws, buffsMsg(o));
                  void inventory?.state(id).then((st) => { refreshFighter(o, st); const mt = stanceOf(o, inventory!.combatMotion(st, o.player!.job)); if (o.player && mt !== o.player.mt) { o.player.mt = mt; broadcast({ t: 'look', id, eq: o.player.eq, mt }); } });
                  recalcMax(o, true);
                  void saveCombat(id, o.cb, level).catch((e) => console.error('realtime: salvar nível (GM)', e));
                }
              }
              broadcast({ t: 'level', id, level });
            },
          }, text).catch((e) => { console.error('comando de GM', e); reply('Erro ao executar o comando.'); });
          return;
        }
        broadcast({ t: 'chat', id: c.player.id, name: c.player.name, text });
      } else if (msg.t === 'skillUp' && c.player) {
        skillUp(c, msg.levels);
      } else if (msg.t === 'skill' && c.player && Number.isInteger(msg.id) && Number.isInteger(msg.target)) {
        if (c.peace) setPeace(c, false);
        castSkill(c, msg.id as number, msg.target as number);
      } else if (msg.t === 'shopOpen' && c.player && typeof msg.key === 'string') {
        shopOpen(c, msg.key.slice(0, 40));
      } else if (c.trade && (msg.t === 'invMove' || msg.t === 'invUse' || msg.t === 'sell' || msg.t === 'invDrop' || msg.t === 'invSort')) {
        send(ws, { t: 'invError', error: 'Termine ou cancele a troca antes de mexer no inventário.' });
      } else if (msg.t === 'invDrop' && c.player && inventory && Number.isInteger(msg.s) && Number.isInteger(msg.n)) {
        // lixeira: apaga o item (ou parte da pilha) do espaço `s` da bolsa
        const player = c.player, inv = inventory;
        c.invQueue = c.invQueue.then(async () => {
          const r = await inv.discard(player.id, msg.s as number, msg.n as number);
          if ('error' in r) { send(ws, { t: 'invError', error: r.error }); return; }
          const name = inv.catalog.byId.get(r.item.id)?.name ?? `item ${r.item.id}`;
          console.log(`[lixeira] ${player.name} (#${player.id}) apagou ${r.n}× ${name}${r.item.u ? ` +${r.item.u}` : ''}`);
          send(ws, inv.view(await inv.state(player.id)));
          send(ws, { t: 'chat', id: 0, name: '', text: `${r.n > 1 ? `${r.n}× ` : ''}${name} apagado.` });
        }).catch((e) => { console.error('realtime: lixeira', e); send(ws, { t: 'invError', error: 'Servidor indisponível.' }); });
      } else if (msg.t === 'invSort' && c.player && inventory) {
        // organizar a bolsa por tipo (botão das duas setas)
        const player = c.player, inv = inventory;
        c.invQueue = c.invQueue.then(async () => { send(ws, inv.view(await inv.sortBag(player.id))); })
          .catch((e) => { console.error('realtime: organizar bolsa', e); send(ws, { t: 'invError', error: 'Servidor indisponível.' }); });
      } else if (msg.t === 'buy' && c.player && typeof msg.key === 'string' && Number.isInteger(msg.id) && Number.isInteger(msg.n)) {
        shopBuy(c, msg.key.slice(0, 40), msg.id as number, msg.n as number);
      } else if (msg.t === 'sell' && c.player && typeof msg.key === 'string' && Number.isInteger(msg.s) && Number.isInteger(msg.n)) {
        shopSell(c, msg.key.slice(0, 40), msg.s as number, msg.n as number);
      } else if (msg.t === 'use' && c.player && inventory && Number.isInteger(msg.id)) {
        const player = c.player, id = msg.id as number;
        void inventory.state(player.id).then((st) => {
          const it = st.items.find((i) => i.c === 0 && i.id === id);
          if (it) useItem(c, it.s);
          else send(ws, { t: 'invError', error: 'Você não tem mais esse item.' });
        }).catch((e) => console.error('realtime: usar item (barra)', e));
      } else if (msg.t === 'npcMenu' && c.player && typeof msg.key === 'string') {
        const key = msg.key.slice(0, 40), k = key.toLowerCase();
        const shops = W(c).shops;
        if (!shops?.near(key, c.player.p[0], c.player.p[2])) return;
        send(ws, { t: 'npcMenu', key, name: shops.npcNames.get(k) ?? key, shop: shops.shops.has(k) || shops.tokenShops.has(k), buff: shops.npcBuffs.has(k), smith: [...(shops.npcMenus.get(k) ?? [])] });
      } else if (msg.t === 'npcBuff' && c.player && typeof msg.key === 'string') {
        npcBuff(c, msg.key.slice(0, 40));
      } else if (msg.t === 'buffOff' && c.player && Number.isInteger(msg.id)) {
        removeBuff(c, msg.id as number);
      } else if (msg.t === 'zckTeleport' && c.player && Number.isInteger(msg.k)) {
        zckTeleport(c, msg.k as number);
      } else if (msg.t === 'hide' && c.player && inventory && Number.isInteger(msg.m)) {
        c.hide = (msg.m as number) & 0x7f;
        const player = c.player;
        c.invQueue = c.invQueue.then(async () => {
          const eq = inventory.looks(await inventory.state(player.id), c.hide);
          if (eq.join() !== player.eq.join()) { player.eq = eq; broadcast({ t: 'look', id: player.id, eq, mt: player.mt }); }
        }).catch((e) => console.error('realtime: esconder visual', e));
      } else if (msg.t === 'bar' && c.player) {
        const bar = cleanBar(msg.slots);
        void query('UPDATE characters SET shortcuts = $2 WHERE id = $1', [c.player.id, JSON.stringify(bar)]).catch((e) => console.error('realtime: salvar barra', e));
        send(ws, { t: 'bar', slots: barView(bar) });
      } else if (msg.t === 'jobChange' && c.player && c.cb && rules) {
        // mudança de classe: só no nível certo (15 → 1ª classe, 60 → 2ª) e só para as classes daquela linha
        const job = Number(msg.job), cb = c.cb, p = c.player;
        if (!Number.isInteger(job) || !rules.jobOptions(cb.f.job, p.level).includes(job)) { reply(c, 'Você não pode mudar para essa classe agora.'); return; }
        void changeJob(c, job);
      } else if (msg.t === 'statUp' && c.player && c.cb) {
        const add = (['str', 'sta', 'dex', 'int'] as const).map((k) => msg[k]);
        if (!add.every((v) => Number.isInteger(v) && (v as number) >= 0)) return;
        const [s, t, d, i] = add as number[], total = s + t + d + i;
        const cb = c.cb;
        if (total <= 0 || total > cb.points) return;
        cb.points -= total;
        cb.f.base.str += s; cb.f.base.sta += t; cb.f.base.dex += d; cb.f.base.int += i;
        cb.f.str += s; cb.f.sta += t; cb.f.dex += d; cb.f.int += i;
        recalcMax(c);
        void saveCombat(c.player.id, cb, c.player.level).catch((e) => console.error('realtime: salvar atributos', e));
      } else if (msg.t === 'petFilter' && c.player) {
        c.petFilter = cleanPetFilter(msg.f);
        void query('UPDATE characters SET pet_filter = $2 WHERE id = $1', [c.player.id, JSON.stringify(c.petFilter)]).catch((e) => console.error('realtime: filtro do pet', e));
        c.pet?.skip.clear();
        sendPetFilter(c);
      } else if (msg.t === 'petFind' && c.player && inventory) {
        const q = typeof msg.q === 'string' ? msg.q.slice(0, 40) : '';
        send(ws, { t: 'petFind', list: q.trim().length < 2 ? [] : inventory.catalog.search(q, '', 0, 40).map((d) => [d.id, d.name, d.icon]) });
      } else if (msg.t === 'pick' && c.player) {
        if (Number.isInteger(msg.id)) pickUp(c, msg.id as number);
      } else if (msg.t === 'atk' && c.player) {
        if (c.peace) setPeace(c, false); // atacar liga o modo de batalha
        if (Number.isInteger(msg.id)) playerAttack(c, msg.id as number);
      } else if (msg.t === 'stance' && c.player && !c.cb?.dead) {
        setPeace(c, !c.peace);
      } else if (msg.t === 'gmItems' && c.player && inventory) {
        const q = typeof msg.q === 'string' ? msg.q.slice(0, 40) : '', kind = typeof msg.k === 'string' ? msg.k : '', grade = Number.isInteger(msg.g) ? msg.g as number : 0;
        gmAuthority(c.accountId).then((a) => {
          if (!a) return;
          send(ws, { t: 'gmItems', list: inventory.catalog.search(q, kind, grade, 1000).map((d) => inventory.catalog.viewFull(d)) });
        }).catch((e) => console.error('painel GM: busca', e));
      } else if ((msg.t === 'upgrade' || msg.t === 'smith') && c.player && inventory && smith) {
        // upgrade pelo martelo (duplo clique no material, sem proteção) ou pelas janelas do ferreiro (perto do NPC com o menu)
        const player = c.player, inv = inventory, int = (v: unknown) => (Number.isInteger(v) ? (v as number) : -1);
        // recusa: responde como o ferreiro (a janela sai do "trabalhando…") e o martelo volta ao normal
        const refuse = (text: string) => send(ws, { t: 'smith', ok: false, fx: null, s: null, text });
        if (c.trade) { refuse('Termine a troca antes de mexer nos itens.'); return; }
        let run: ((x: InvEdit) => SmithResult) | null = null;
        const s = int(msg.s), m = int(msg.m), g = int(msg.g), safe = msg.safe === true, rate = msg.rate === true;
        if (msg.t === 'upgrade') run = (x) => smith.enchant(x, s, m, { safe: false, rate: false });
        else {
          const op = String(msg.op), key = String(msg.key ?? '').slice(0, 40), menus = W(c).shops?.npcMenus.get(key.toLowerCase());
          if (!SMITH_MENUS[op]?.some((k) => menus?.has(k))) { refuse('Este NPC não faz isso.'); return; }
          if (!W(c).shops?.near(key, player.p[0], player.p[2])) { refuse('Chegue perto do ferreiro para isso.'); return; }
          run = op === 'safe' ? (x) => smith.enchant(x, s, m, { safe: true, rate })
            : op === 'pierceSize' ? (x) => smith.pierceSize(x, s, safe)
            : op === 'pierceRemove' ? (x) => smith.pierceRemove(x, s)
            : op === 'removeGem' ? (x) => smith.removeGem(x, s)
            : op === 'trans' ? (x) => smith.transWeapon(x, s, safe)
            : op === 'makeGem' ? (x) => smith.makeGem(x, s)
            : op === 'mixJewel' ? (x) => smith.mixJewel(x)
            : op === 'setGem' ? (x) => smith.setGem(x, s, g) : null;
        }
        if (!run) return;
        const job = run;
        c.invQueue = c.invQueue.then(async () => {
          const r = await inv.edit(player.id, job);
          if (r.fx) {
            send(ws, inv.view(await inv.state(player.id)));
            console.log(`[ferreiro] ${player.name} (#${player.id}) ${msg.t === 'upgrade' ? 'martelo' : String(msg.op)}: ${r.text}`);
          }
          send(ws, { t: 'smith', ok: r.ok, fx: r.fx ?? null, s: r.slot ?? null, text: r.text });
        }).catch((e) => { console.error('realtime ferreiro', e); refuse('Servidor indisponível.'); });
      } else if (msg.t === 'pierce' && c.player && inventory && Number.isInteger(msg.card) && Number.isInteger(msg.target)) {
        // piercing: carta (bolsa) → suit (bolsa); o servidor confere tudo e só então gasta a carta
        const player = c.player, inv = inventory;
        if (c.trade) { send(ws, { t: 'invError', error: 'Termine a troca antes de aplicar cartas.' }); return; }
        c.invQueue = c.invQueue.then(async () => {
          const r = await inv.pierce(player.id, msg.card as number, msg.target as number);
          if ('error' in r) { send(ws, { t: 'pierced', ok: false }); if (r.error) send(ws, { t: 'invError', error: r.error }); return; }
          send(ws, inv.view(r.state));
          send(ws, { t: 'pierced', ok: true, s: msg.target });
          send(ws, { t: 'chat', id: 0, name: '', text: `${r.card.name} aplicada em ${r.suit.name}.` });
        }).catch((e) => { console.error('realtime piercing', e); send(ws, { t: 'invError', error: 'Servidor indisponível.' }); });
      } else if ((msg.t === 'invMove' || msg.t === 'invUse') && c.player && inventory) {
        const pair = (v: unknown): [number, number] | null => Array.isArray(v) && v.length === 2 && v.every((x) => Number.isInteger(x)) ? [v[0], v[1]] : null;
        const player = c.player, inv = inventory;
        const ch = { sex: player.sex, level: player.level, job: player.job };
        // um pedido de cada vez por conexão (cliques rápidos não se atropelam no banco)
        c.invQueue = c.invQueue.then(async () => {
          let r: { state: import('../character/inventory').InvState } | { error: string };
          if (msg.t === 'invMove') {
            const from = pair(msg.from), to = pair(msg.to);
            if (!from || !to) return;
            if (to[0] === 1 && to[1] === RIDE_PART && inBattle(c)) { send(ws, { t: 'invError', error: BATTLE_RIDE }); return; }
            r = await inv.move(player.id, ch, from, to);
          } else {
            const cc = Number(msg.c), ss = Number(msg.s);
            if (!Number.isInteger(cc) || !Number.isInteger(ss)) return;
            if (cc === 0) {
              const it = (await inv.state(player.id)).items.find((i) => i.c === 0 && i.s === ss);
              const d = it && inv.catalog.byId.get(it.id);
              if (d && d.parts < 0) { useItem(c, ss); return; }
              if (d?.parts === RIDE_PART && inBattle(c)) { send(ws, { t: 'invError', error: BATTLE_RIDE }); return; }
            }
            r = cc === 1 ? await inv.unequip(player.id, ch, ss) : await inv.equip(player.id, ch, ss);
          }
          if ('error' in r) { if (r.error) send(ws, { t: 'invError', error: r.error }); return; }
          send(ws, inv.view(r.state));
          refreshFighter(c, r.state);
          const eq = inv.looks(r.state, c.hide), mt = stanceOf(c, inv.combatMotion(r.state, player.job));
          if (eq.join() !== player.eq.join() || mt !== player.mt) { player.eq = eq; player.mt = mt; broadcast({ t: 'look', id: player.id, eq, mt }); }
        }).catch((e) => { console.error('realtime inventário', e); send(ws, { t: 'invError', error: 'Servidor indisponível.' }); });
      }
    });
    ws.on('close', () => {
      conns.delete(c);
      if (c.trade) tradeClose(c.trade, `${c.player?.name ?? 'O outro jogador'} saiu. A troca foi cancelada.`);
      if (c.player && !liveConn(c.player.id)) invisIds.delete(c.player.id);
      if (c.player) {
        broadcast({ t: 'leave', id: c.player.id });
        if (!c.switching && !liveConn(c.player.id)) leaveParty(c.player.id, 'saiu do jogo');
        if (!c.switching && !liveConn(c.player.id)) for (const f of c.friends ?? []) { const o = liveConn(f); if (o) send(o.ws, { t: 'friendOn', id: c.player.id, on: false }); }
        for (const wr of worlds.values()) wr.mobs?.forget(c.player.id);
        const p = c.player, cb = c.cb;
        lastSaved.delete(p.id);
        const played = Date.now() - c.joinedAt;
        void (c.onlineSet ?? Promise.resolve()).then(() => savePosition(p, cb, played)).then(() => (conns.size && [...conns].some((o) => o.player?.id === p.id) ? inventory?.flush(p.id) : inventory?.detach(p.id))); // espera o 'online = true' para o 'false' ser o último
        console.log(`realtime: ${c.player.name} saiu (${[...conns].filter((o) => o.player).length} online)`);
      }
    });
  });

  // 10×/s: manda as mudanças agrupadas (cada mundo recebe só os seus) e anda a IA dos mobs de cada mundo
  const tick = setInterval(() => {
    const lists = new Map<string, (number | string)[][]>();
    for (const c of conns) {
      if (!c.player || !c.dirty) continue;
      c.dirty = false;
      const p = c.player;
      let l = lists.get(p.w);
      if (!l) lists.set(p.w, (l = []));
      l.push([p.id, +p.p[0].toFixed(2), +p.p[1].toFixed(2), +p.p[2].toFixed(2), Math.round(p.h), p.s]);
    }
    for (const [w, list] of lists) {
      const vis = invisIds.size ? list.filter((e) => !invisIds.has(e[0] as number)) : list;
      if (vis.length === list.length) { broadcast({ t: 'states', list }, undefined, w); continue; }
      // tem GM invisível: quem não é GM recebe a lista sem ele
      const all = JSON.stringify({ t: 'states', list }), some = vis.length ? JSON.stringify({ t: 'states', list: vis }) : null;
      for (const o of conns) {
        if (!o.player || o.player.w !== w || o.ws.readyState !== WebSocket.OPEN) continue;
        const data = isStaff(o) || invisIds.has(o.player.id) ? all : some;
        if (data) { o.ws.send(data); counters.msgOut++; }
      }
    }
    for (const wr of worlds.values()) wr.mobs?.tick(TICK_MS / 1000);
    if (++tickN % 2 === 0) { sendMobs(); for (const wr of worlds.values()) wr.mobs?.clearDirty(); }
  }, TICK_MS);

  /** a cada 200 ms: para cada jogador, mobs que entraram no raio, que se mexeram e que saíram */
  let tickN = 0;
  function sendMobs() {
    const now = Date.now();
    for (const [id, g] of ground) if (now >= g.expires) ground.delete(id);
    for (const c of conns) {
      if (!c.player || c.ws.readyState !== WebSocket.OPEN) continue;
      const near = W(c).mobs?.near(c.player.p[0], c.player.p[2], MOB_RADIUS, MOB_MAX) ?? [];
      const seen = new Set<number>();
      const a: (number | string | null)[][] = [], u: (number | string)[][] = [], d: number[] = [];
      for (const m of near) {
        seen.add(m.id);
        if (!c.mobs.has(m.id)) {
          a.push([m.id, m.modelId, +m.x.toFixed(1), +m.z.toFixed(1), Math.round(m.h), m.s, m.flying ? +m.y.toFixed(1) : null, mobHp(m)]);
        } else if (m.dirty) u.push([m.id, +m.x.toFixed(1), +m.z.toFixed(1), Math.round(m.h), m.s, mobHp(m)]);
      }
      for (const id of c.mobs) if (!seen.has(id)) d.push(id);
      c.mobs = seen;
      if (a.length || u.length || d.length) send(c.ws, { t: 'mobs', a, u, d });
      // itens no chão perto
      const ga: (number | string)[][] = [], gd: number[] = [], gseen = new Set<number>();
      for (const g of ground.values()) {
        if (g.w !== c.player.w || Math.hypot(g.x - c.player.p[0], g.z - c.player.p[2]) > GROUND_RADIUS) continue;
        gseen.add(g.id);
        if (!c.ground.has(g.id)) ga.push([g.id, g.itemId, +g.x.toFixed(2), +g.z.toFixed(2), g.count, g.gold, g.upgrade, inventory?.catalog.byId.get(g.itemId)?.name ?? '']);
      }
      for (const id of c.ground) if (!gseen.has(id)) gd.push(id);
      c.ground = gseen;
      if (ga.length || gd.length) send(c.ws, { t: 'ground', a: ga, d: gd });
    }
  }

  // conexões mortas (Wi-Fi caiu, aba fechada sem aviso) saem em até ~30 s
  const ping = setInterval(() => {
    for (const c of conns) {
      if (!c.alive) { c.ws.terminate(); continue; }
      c.alive = false;
      c.ws.ping();
    }
  }, 15000);

  http.on('close', () => { clearInterval(tick); clearInterval(ping); clearInterval(petTick); clearInterval(partyTick); wss.close(); });
  return {
    online: () => [...conns].filter((c) => c.player).length,
    /** retrato para o painel admin */
    stats: () => ({
      ...counters,
      inventory: inventory?.stats() ?? { cached: 0, pending: 0 },
      sockets: conns.size,
      mobs: [...worlds.values()].reduce((n, wr) => n + (wr.mobs?.mobs.length ?? 0), 0),
      players: [...conns].filter((c) => c.player).map((c) => ({ accountId: c.accountId, characterId: c.player!.id, name: c.player!.name, level: c.player!.level, p: c.player!.p })),
    }),
    shutdown,
    /** anúncio do painel admin para todos no mundo (letreiro no meio da tela); devolve para quantos foi */
    announce(text: string, loops: number) {
      broadcast({ t: 'announce', text, loops });
      return [...conns].filter((c) => c.player).length;
    },
    /** derruba as conexões de uma conta (kick/ban pelo painel); devolve quantas fechou */
    kickAccount(accountId: number, reason: string) {
      let n = 0;
      for (const c of conns) if (c.accountId === accountId) { send(c.ws, { t: 'error', error: reason }); c.ws.close(); n++; }
      return n;
    },
  };
}
