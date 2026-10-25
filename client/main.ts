import { WorldView } from '../shared/world';
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { keyedImage, themeImage, themeTiles } from '../shared/tga';
import type { Sex } from '../shared/humans';
import { GameHud, provisionalMax } from './hud';
import { type SkillFx, NetClient, RemotePlayers } from './net';
import { ActionBar, ChatWindow, InventoryWindow, type BarItem } from './ui';
import { Announcer } from './announce';
import { VersionWatcher } from './version';
import { GmPanel } from './gmpanel';
import { Combat } from './combat';
import { GroundItems } from './ground';
import { CharacterWindow } from './charwnd';
import { ShopWindow } from './shop';
import { SkillWindow } from './skillwnd';
import { JobWindow } from './jobwnd';
import { BuffBar } from './buffbar';
import { PartyBuffs } from './partybuffs';
import { TeleportWindow } from './teleport';
import { MotionWindow } from './motionwnd';
import { lookSymbol } from '../shared/look';
import { FriendsWindow, friendRequestPrompt } from './friends';
import { PartyListWindow, PartyWindow } from './party';
import { GuildWindow } from './guild';
import { NpcMenu, type NpcMenuOption } from './npcmenu';
import { GameAudio } from './audio';
import type { MoverInstance } from '../shared/movers';
import { OT } from '../shared/formats/types';
import { PLAYER_LABEL_LIFT, rankOf } from '../shared/rank';
import { lookList, type LookPiece } from '../shared/look';
import { netStats } from '../shared/netstats';

/**
 * Cliente do jogo: login (janela no estilo do cliente, imagens de Data/Theme/Default) → seleção de personagem (3 vagas) ou
 * criação (nome, sexo, cabelo, rosto, com prévia 3D) → mundo. Contas e personagens vêm do servidor (PostgreSQL `flyffweb`).
 */
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const WORLD = 'WdMadrigal';
/** mundo aberto agora (WdMadrigal; WdKebaras = Azria) e o mundo de cada world_id do banco */
let curWorld = WORLD;
const WORLD_BY_ID: Record<number, string> = { 1: 'WdMadrigal', 2: 'WdKebaras' };
/** tela de carregamento de cada mapa (Theme/Default/MapLoading_*.png, como no cliente) e o nome mostrado */
const WORLD_LOADING: Record<string, { img: string; name: string }> = {
  WdMadrigal: { img: 'MapLoading_Madrigal.png', name: 'Madrigal' },
  WdKebaras: { img: 'MapLoading_Azria.png', name: 'Azria' },
};
/** tela de transição entre mapas: imagem do mapa e barra andando enquanto o mundo novo carrega */
const mapLoading = (() => {
  const el = document.createElement('div');
  el.className = 'map-loading';
  el.hidden = true;
  el.setAttribute('role', 'status');
  el.setAttribute('aria-live', 'polite');
  const label = document.createElement('div'); label.className = 'ml-label';
  const bar = document.createElement('div'); bar.className = 'ml-bar';
  const fill = document.createElement('i'); bar.append(fill);
  el.append(label, bar);
  document.body.append(el);
  let t0 = 0, raf = 0;
  const step = () => { const k = 1 - Math.exp(-(performance.now() - t0) / 2500); fill.style.width = `${Math.min(95, k * 100)}%`; raf = requestAnimationFrame(step); };
  return {
    show(world: string) {
      const info = WORLD_LOADING[world] ?? { img: 'MapLoading_Default.png', name: world };
      el.style.backgroundImage = `url('/res/Data/Theme/Default/${info.img}')`;
      label.textContent = `Carregando ${info.name}…`;
      el.hidden = false; el.classList.remove('done');
      t0 = performance.now(); cancelAnimationFrame(raf); raf = requestAnimationFrame(step);
    },
    hide() { fill.style.width = '100%'; cancelAnimationFrame(raf); el.classList.add('done'); setTimeout(() => { el.hidden = true; }, 350); },
  };
})();
/** abre outro mundo (com a tela de carregamento) e espera o chão em volta de (x, z) */
async function openWorld(world: string, x: number, z: number) {
  if (world === curWorld) return;
  mapLoading.show(world);
  try {
    await view.open(world);
    curWorld = world;
    await view.loadTile(Math.floor(x / 512), Math.floor(z / 512));
  } catch (e) { console.error('abrir mundo', world, e); }
}
/** ponto de entrada padrão (Flaris) e palco da prévia do personagem, em coordenadas FlyFF */
const FLARIS = { x: 6976, z: 3327 };
/** malhas existentes no cliente: Part_<sexo>Hair01–10, Part_<sexo>Head01–24 (iguais aos limites do servidor) */
const LIMITS = { hair: 10, head: 24 };

interface CharacterInfo {
  id: number; slot: number; name: string; sex: number; hairMesh: number; headMesh: number; level: number; worldId: number; pos: [number, number, number]; hp: number; mp: number; fp: number; exp: number;
  /** equipado (com enchant) e postura da arma: a prévia da seleção fica igual ao personagem no jogo */
  equip?: LookPiece[]; mt?: number;
}
interface Account { username: string; authority: string }
interface LoginReply { token: string; account: Account; characters: CharacterInfo[] }

const view = new WorldView($<HTMLCanvasElement>('view'));
view.playerControl = false;
/** mobs vêm do servidor: todos os jogadores veem os mesmos */
view.serverMobs = true;
/** morto não anda nem seleciona */
view.inputBlocked = () => !!view.player?.dead;
/** menu + janela de status (só aparecem dentro do jogo); Desconectar volta ao login */
const hud = new GameHud(document.body, () => void backToLogin(), () => inventory.toggle(), () => charWnd.toggle(), () => skillWnd.toggle());
/** inventário (tecla I), barra de atalhos (1…0) e chat (Enter) — ver game/ui.ts */
const inventory = new InventoryWindow(document.body);
/** Teleporter (tecla V, como o APP_ZCK_TELEPORTEUR do cliente) */
const teleportWnd = new TeleportWindow(document.body);
teleportWnd.onTeleport = (k) => { if (!net.zckTeleport(k)) chat.system('Sem conexão com o servidor.'); };
/** janela de movimentos (tecla O): movimento no personagem (os outros veem pelo servidor) e emoticon acima da cabeça */
const motionWnd = new MotionWindow(document.body);
hud.onMotion = () => motionWnd.toggle();
motionWnd.onMotion = (m) => {
  const p = view.player;
  if (!p?.active) return;
  // modo de batalha: troca a postura de combate ↔ normal (o servidor avisa todos com 'look')
  if (m.id === 'MOT_BASE_BATTLE') { if (!net.toggleStance()) chat.system('Sem conexão com o servidor.'); return; }
  combat.stop();
  if (!p.emote(m.motion, m.play)) { chat.system('Pare de pular ou de andar para fazer um movimento.'); return; }
  net.emote(m.motion, m.play);
};
motionWnd.onEmoticon = (i) => { if (!net.emoticon(i)) chat.system('Sem conexão com o servidor.'); };
const actionBar = new ActionBar(document.body);
actionBar.onUseItem = (id) => { if (!rideToggle(id)) net.useItem(id); };
actionBar.onChange = (slots) => { net.saveBar(slots); };
const chat = new ChatWindow(document.body);
/** janela de personagem (tecla H): atributos e pontos */
const charWnd = new CharacterWindow(document.body);
/** loja do NPC (clicar no NPC: anda até ele e abre) */
const shopWnd = new ShopWindow(document.body);
/** janela de skills (tecla K) */
const skillWnd = new SkillWindow(document.body);
const jobWnd = new JobWindow(document.body);
const buffBar = new BuffBar(document.body);
const partyBuffs = new PartyBuffs(document.body);
const audio = new GameAudio();
audio.listener = () => view.player?.pos ?? null;
jobWnd.onChoose = (job) => { if (!net.jobChange(job)) chat.system('Sem conexão com o servidor.'); };
skillWnd.onApply = (levels) => { if (!net.skillUp(levels)) chat.system('Sem conexão com o servidor.'); };
shopWnd.onBuy = (k, id, n) => { if (!net.shopBuy(k, id, n)) chat.system('Sem conexão com o servidor.'); };
shopWnd.onSell = (k, s, n) => { if (!net.shopSell(k, s, n)) chat.system('Sem conexão com o servidor.'); };
/** NPC que o personagem está indo falar e onde está o NPC da loja aberta */
let npcGoing: { inst: MoverInstance; key: string; next: number; best?: number; since?: number } | null = null;
let shopNpc: [number, number] | null = null;
charWnd.onApply = (add) => { if (!net.statUp(add)) chat.system('Sem conexão com o servidor.'); };
/** painel de GM (//gm no chat; o servidor só abre para contas GM/admin) */
const gmPanel = new GmPanel(document.body);
gmPanel.run = (cmd) => net.sendChat(cmd);
gmPanel.pickPoint = (done) => view.pickGroundPoint(5, done);
gmPanel.monsters = () => {
  const d = view.data;
  if (!d) return [];
  return [...d.monsterMovers].map((id) => ({ id, name: d.moverNames.get(id) ?? d.moverSymbols.get(id) ?? String(id), symbol: d.moverSymbols.get(id) ?? String(id), level: d.moverLevel.get(id) ?? 0, boss: d.bossMovers.has(id) }));
};
gmPanel.search = (q, k, g) => { net.gmItems(q, k, g); };
/** outros jogadores (WebSocket /ws) */
const remotes = new RemotePlayers(view);
const net = new NetClient(remotes);
let inGame = false;
// versão nova do jogo no servidor: recarrega fora do mundo, avisa dentro dele (client/version.ts)
const versionWatcher = new VersionWatcher(() => inGame);
net.onMobs = (add, upd, del) => {
  const d = view.data, mm = view.moverMgr;
  if (!d) return;
  for (const id of del) mm.removeExternal(id);
  for (const [id, modelId, x, z, h, s, y, hp] of add) {
    const entry = d.dynaModels.get(`${OT.MOVER}:${modelId}`);
    if (entry) mm.addExternal(id, entry, x, z, h, s, y ?? null, hp ?? 1000);
  }
  for (const [id, x, z, h, s, hp] of upd) {
    mm.moveExternal(id, x, z, h, s, hp);
    if (hp !== undefined && view.target && view.target === mm.externalInfo(id)?.inst) view.setTargetHp(hp / 1000);
  }
};

// ---------- combate (server/combat.ts decide; aqui só ataque automático, animações e números) ----------
const combat = new Combat(view);
combat.sendAttack = (id) => { net.attack(id); };
combat.sendSkill = (sk, id) => { net.castSkill(sk, id); };
net.onBuffs = (list) => buffBar.set(list);
buffBar.onRemove = (id) => { net.removeBuff(id); };
net.onSkills = (points, levels, list) => { const ch = characters.find((c) => c.slot === selectedSlot); skillWnd.set(points, levels, list, ch?.level ?? 1); };
net.onSkillUsed = (id, cd) => {
  actionBar.cooldown(id, cd, 'skill');
  const s = skillWnd.get(id);
  if (s?.kind === 'buff' && s.mo) view.player?.cast(s.mo); // o servidor aceitou: toca o movimento de lançar o buff
};
/** atalho de skill: lança no mob selecionado (anda até o alcance) */
actionBar.onUseSkill = (id) => {
  const s = skillWnd.get(id);
  if (!s) return;
  if (skillWnd.levelOf(id) <= 0) { chat.system(`Você ainda não aprendeu ${s.name}.`); return; }
  if (!s.melee) { chat.system(`${s.name} ainda não pode ser lançada.`); return; }
  if (s.sym === 'SI_ASS_HEAL_RESURRECTION') { // Resurrection: no jogador derrotado selecionado
    const t = view.target, rid = t && t.owner === 'players' ? remotes.idOf(t) : null;
    if (rid === null || !remotes.isDead(rid)) { chat.system('Selecione um jogador derrotado (clique nele) para usar Resurrection.'); return; }
    if (s.mo) view.player?.cast(s.mo);
    if (!net.resurrect(id, rid)) chat.system('Sem conexão com o servidor.');
    return;
  }
  if (s.kind === 'buff') { // buff/cura: vale em você, sem alvo
    net.castSkill(id, 0);
    return;
  }
  if (!combat.attacking) {
    const t = view.target;
    if (!t || t.owner !== 'spawns') { chat.system('Selecione um monstro primeiro.'); return; }
    combat.start(t);
    if (!combat.attacking) return;
  }
  combat.queueSkill(id, s.mo || s.sym.replace(/^SI_/, 'MTI_'));
};
/**
 * Action Slot (CWndTaskBar::UseSkillQueue): clique direito no monstro ou tecla C com ele selecionado — anda até ele e lança
 * as skills da sequência, uma depois da outra; depois segue no golpe normal.
 */
function runActionSlot(inst: MoverInstance | null = view.target) {
  if (!inGame) return;
  if (!inst || inst.owner !== 'spawns') { chat.system('Selecione um monstro primeiro.'); return; }
  const list = actionBar.queueSkills.map((it) => skillWnd.get(it.id)).filter((s): s is NonNullable<typeof s> => !!s && s.melee && skillWnd.levelOf(s.id) > 0)
    .map((s) => ({ id: s.id, motion: s.mo || s.sym.replace(/^SI_/, 'MTI_'), buff: s.kind === 'buff' }));
  if (!list.length) { chat.system('A Action Slot está vazia: arraste skills aprendidas da janela de skills (K) para ela.'); return; }
  if (view.target !== inst) view.selectTarget(inst);
  combat.start(inst);
  if (combat.attacking) combat.queueChain(list);
}
combat.onChainStep = (i) => actionBar.markQueue(i);
view.onMoverRightClick = (inst) => { if (inst.owner === 'spawns') runActionSlot(inst); };
actionBar.onQueueChange = () => {
  const ch = characters.find((c) => c.slot === selectedSlot);
  if (ch) try { localStorage.setItem(`flyff.queue.${ch.id}`, JSON.stringify(actionBar.queueList)); } catch { /* sem armazenamento */ }
};
/** clique num mob: o 1º só seleciona; clicar de novo no mesmo (já selecionado) ataca */
view.onMoverClick = (inst, again) => {
  const id = view.moverMgr.externalIdOf(inst), info = id === null ? null : view.moverMgr.externalInfo(id);
  if (info) view.setTargetHp(info.hp / 1000);
  ground.cancel();
  npcGoing = null;
  if (inGame && inst.owner === 'spawns' && again) combat.start(inst);
  else if (!(inGame && inst.owner === 'spawns' && combat.attacking && combat.isTarget(inst))) combat.stop();
  if (inGame && inst.owner === 'movers' && inst.source.characterKey) npcGoing = { inst, key: inst.source.characterKey.trim(), next: 0 };
};
view.onGroundClick = () => { combat.stop(); ground.cancel(); npcGoing = null; };
net.onShop = (s) => {
  shopWnd.open(s);
  if (!inventory.visible) inventory.show();
};
/** anda até o NPC clicado e pede a loja; fecha a loja ao se afastar */
function npcFrame(now: number) {
  const p = view.player;
  if (!p?.active) return;
  if (npcGoing) {
    const [nx, , nz] = npcGoing.inst.source.pos;
    if (view.moveKeysDown() || p.dead) npcGoing = null;
    // o servidor aceita conversar a até 12 m (SHOP_RANGE): a 8 m já abre — não precisa encostar (degraus e cercas no caminho travavam)
    else if (Math.hypot(nx - p.pos[0], nz - p.pos[2]) > 8) {
      // sem chegar mais perto por 2 s (cerca, degrau, parede no caminho): desiste e avisa
      const d = Math.hypot(nx - p.pos[0], nz - p.pos[2]);
      if (npcGoing.best === undefined || d < npcGoing.best - 0.3) { npcGoing.best = d; npcGoing.since = now; }
      if (now - (npcGoing.since ?? now) > 2000) { p.stop(); npcGoing = null; chat.system('Não consigo chegar até esse NPC por aqui.'); return; }
      if (now >= npcGoing.next) { p.moveTo(nx, nz); npcGoing.next = now + 250; }
    }
    else { p.stop(); p.face(nx, nz); menuNpc = npcGoing; net.npcMenu(npcGoing.key); shopNpc = [nx, nz]; npcGoing = null; }
  }
  // fecha o menu ao se afastar além do alcance de conversa do servidor (12 m)
  if (npcMenu.visible && shopNpc && Math.hypot(shopNpc[0] - p.pos[0], shopNpc[1] - p.pos[2]) > 12) npcMenu.hide();
  if (shopWnd.visible && shopNpc && Math.hypot(shopNpc[0] - p.pos[0], shopNpc[1] - p.pos[2]) > 14) { shopWnd.hide(); shopNpc = null; }
}
/** menu do NPC ao chegar perto: Comércio (loja) e Receber Buffs! (Buff Pang) — o servidor diz o que ele tem */
const npcMenu = new NpcMenu(document.body);
let menuNpc: { inst: MoverInstance; key: string } | null = null;
net.onNpcMenu = (m) => {
  const opts: NpcMenuOption[] = [];
  if (m.shop) opts.push({ label: 'Comércio', run: () => net.shopOpen(m.key) });
  if (m.buff) opts.push({ label: 'Receber Buffs!', run: () => net.npcBuff(m.key) });
  if (!opts.length) return;
  // ao lado do NPC, na altura da cabeça
  const inst = menuNpc?.key === m.key ? menuNpc.inst : null;
  const at = inst ? view.screenOf(inst) : null;
  npcMenu.show(m.name, opts, at ? at[0] + 30 : innerWidth / 2, at ? at[1] : innerHeight / 2);
};
// itens no chão (drops): clicar no item ou no nome anda até ele e pega
const ground = new GroundItems(view);
ground.sendPick = (id) => { net.pick(id); };
ground.onGo = () => combat.stop();
view.pickFirst = (ev) => {
  const id = ground.pick(view.raycast(ev, ground.meshes()));
  if (id !== null) { ground.go(id); return true; }
  return playerClick(ev);
};
/**
 * Clique (esquerdo) em outro jogador: seleciona (setas + janela do alvo) e abre o menu dele, como no cliente original.
 * As opções ainda sem sistema no servidor só avisam no chat.
 */
const PLAYER_MENU = ['Negociar', 'Adicionar como amigo', 'Convidar para grupo', 'Convidar para guild', 'Seguir', 'Ver equipamentos', 'Animar', 'Couple proposal', 'Reportar'];
function playerClick(ev: { clientX: number; clientY: number }) {
  if (!inGame) return false;
  const hit = remotes.at(ev);
  if (!hit) return false;
  ground.cancel();
  combat.stop();
  npcGoing = null;
  view.selectTarget(hit.inst);
  const opts: NpcMenuOption[] = PLAYER_MENU.map((label) => ({ label, run: () => chat.system(`"${label}": função ainda não implementada.`) }));
  opts[1].run = () => { if (!net.friendAdd(hit.id)) chat.system('Sem conexão com o servidor.'); };
  opts[2].run = () => { if (!net.party('partyInvite', { id: hit.id })) chat.system('Sem conexão com o servidor.'); };
  opts[3].run = () => { if (!net.guild('guildInvite', { id: hit.id })) chat.system('Sem conexão com o servidor.'); };
  const at = view.screenOf(hit.inst);
  npcMenu.show(hit.name, opts, at ? at[0] + 30 : ev.clientX + 20, at ? at[1] : ev.clientY);
  shopNpc = null;
  return true;
}
net.onBar = (slots) => actionBar.setItems(slots);
/**
 * Troca de mundo (ticket de Azria, teleporte de/para outro mapa): tela de carregamento do mapa, abre o mundo novo, põe o
 * personagem no ponto de chegada com o mesmo visual e entra de novo no servidor.
 */
let changingWorld = false;
net.onChangeWorld = (w, p) => {
  if (changingWorld) return;
  changingWorld = true;
  void (async () => {
    const pl = view.player;
    const sex = pl?.sex ?? 'male', look = pl?.currentLook ?? { equip: lookNow };
    combat.stop(); ground.clear(); npcMenu.hide(); shopWnd.hide(); view.selectTarget(null);
    view.playerControl = false;
    net.pause();
    mapLoading.show(w);
    if (w !== curWorld) { await openWorld(w, p[0], p[2]); mapLoading.show(w); }
    await view.spawnPlayer(p[0], p[2], p[1], sex, look);
    const ch = characters.find((c) => c.slot === selectedSlot);
    if (ch) { view.player?.inst?.setLabel(ch.name, rankOf(account?.authority), PLAYER_LABEL_LIFT); view.player?.inst?.setGuildTag(myGuild); }
    void view.player?.setCombat(combatMt);
    view.playerControl = true;
    net.resume();
    mapLoading.hide();
    chat.system(`Você chegou em ${WORLD_LOADING[w]?.name ?? w}.`);
    changingWorld = false;
  })();
};
view.onSfxSound = (file, pos) => audio.play(file, pos);
net.onUsed = (id, g, cd) => {
  actionBar.cooldown(id, cd);
  const at = playerHead(net.myId);
  if (!at) return;
  if (g.hp) combat.popup(at, `+${g.hp}`, 'heal');
  if (g.mp) combat.popup([at[0], at[1] - 0.3, at[2]], `+${g.mp}`, 'healmp');
  if (g.fp) combat.popup([at[0], at[1] - 0.6, at[2]], `+${g.fp}`, 'healfp');
};
net.onGround = (a, d) => { for (const id of d) ground.remove(id); ground.add(a); };
/** altura da cabeça de um mob do servidor (para o número de dano) */
const mobHead = (id: number): [number, number, number] | null => {
  const info = view.moverMgr.externalInfo(id);
  if (!info) return null;
  const h = info.inst ? info.inst.tpl.height * info.inst.tpl.entry.scale + (info.inst.tpl.lift ?? 0) : 1.5;
  return [info.pos[0], info.pos[1] + h + 0.2, info.pos[2]];
};
const playerHead = (id: number): [number, number, number] | null => {
  const p = id === net.myId ? view.player?.pos ?? null : remotes.pos(id);
  return p ? [p[0], p[1] + 2.2, p[2]] : null;
};
/** efeitos da skill (propSkill dwSfxObj/3/5): ao lançar no lançador, no alvo ao acertar e no lançador ao acertar */
function skillFx(a: number, target: [number, number, number] | null, fx: SkillFx) {
  const posOf = () => (a === net.myId ? view.player?.pos ?? null : remotes.pos(a));
  const me = posOf();
  if (!me) return;
  const dx = target ? target[0] - me[0] : 0, dz = target ? target[2] - me[2] : -1;
  const yaw = (Math.atan2(dx, -dz) * 180) / Math.PI;
  // movimento de lançar dos outros jogadores (o seu já tocou ao apertar a skill)
  if (fx.mo && a !== net.myId) remotes.cast(a, fx.mo);
  audio.play(fx.sn, me); // som de lançar (dwSndAttack1)
  view.playSfx(fx.c, [me[0], me[1], me[2]], yaw);
  const impact = () => {
    audio.play(fx.sh, target); // som do impacto (dwSndAttack2)
    if (target) view.playSfx(fx.h, [target[0], target[1] + 1, target[2]], yaw);
    view.playSfx(fx.s, [me[0], me[1], me[2]], yaw);
  };
  // magia: o projétil voa até o alvo e o impacto toca na chegada
  if (target && fx.p !== undefined && fx.p >= 0) {
    const dist = Math.hypot(dx, dz);
    view.playSfxMoving(fx.p, [me[0], me[1] + 1.2, me[2]], [target[0], target[1] + 1, target[2]], yaw, Math.max(0.15, Math.min(0.9, dist / 40)), impact);
  } else impact();
  // buff: o efeito fica no personagem enquanto durar
  if (fx.b !== undefined && fx.b >= 0 && fx.dur) view.playSfxFollow(fx.b, () => { const p = posOf(); return p ? [p[0], p[1], p[2]] : null; }, fx.dur);
}
net.onSkillFx = (a, fx) => skillFx(a, null, fx);
net.onHit = (k, a, d, dmg, flags, hp, fx, sn) => {
  if ((k === 'p' && a === net.myId) || (k === 'm' && d === net.myId)) lastBattleAt = performance.now(); // batalha: não monta
  const mm = view.moverMgr, miss = (flags & 1) !== 0, crit = (flags & 2) !== 0;
  if (k === 'p' && sn) { // golpe da arma: o do swing sempre, o do impacto só se acertou
    const at = a === net.myId ? view.player?.pos ?? null : remotes.pos(a);
    audio.play(sn[0], at);
    if (!miss) audio.play(sn[1], mm.externalInfo(d)?.pos ?? at);
  }
  if (k === 'p' && fx) skillFx(a, mm.externalInfo(d)?.pos ?? null, fx);
  else if (k === 'p' && a !== net.myId) remotes.swing(a); // golpe normal de outro jogador: a animação a cada golpe
  if (k === 'p') {
    const land = () => {
      mm.setExternalHp(d, hp);
      if (view.target && view.target === mm.externalInfo(d)?.inst) view.setTargetHp(hp / 1000);
      if (!miss) mm.playExternal(d, 'MTI_DMG1');
      // números só dos seus golpes (os dos outros também aparecem, menores)
      const at = mobHead(d);
      if (at && (a === net.myId || !miss)) combat.popup(at, miss ? 'MISS' : String(dmg), miss ? 'miss' : crit ? 'crit' : a === net.myId ? 'mob' : 'other');
    };
    // golpe normal de arco/besta: a flecha (XI_ITEM_RANGE_ATK1, sfx_middlearrow_01) voa do peito do arqueiro até o alvo
    // e o dano aparece quando ela chega (CMover::OnAttackRange)
    const stance = a === net.myId ? view.player?.stance ?? 0 : remotes.stance(a);
    const from = a === net.myId ? view.player?.pos ?? null : remotes.pos(a), to = mm.externalInfo(d)?.pos;
    const arrow = view.data?.defines.get('XI_ITEM_RANGE_ATK1');
    if (!fx && (stance === 13 || stance === 15) && from && to && arrow !== undefined) {
      const dx = to[0] - from[0], dz = to[2] - from[2], dist = Math.hypot(dx, dz);
      const yaw = (Math.atan2(dx, -dz) * 180) / Math.PI;
      view.playSfxMoving(arrow, [from[0], from[1] + 1, from[2]], [to[0], to[1] + 1, to[2]], yaw, Math.max(0.1, Math.min(0.6, dist / 30)), land);
    } else land();
  } else {
    mm.playExternal(a, 'MTI_ATK1');
    const at = playerHead(d);
    if (at) combat.popup(at, miss ? 'MISS' : String(dmg), miss ? 'miss' : d === net.myId ? (crit ? 'crit' : 'me') : 'other');
  }
};
net.onMobDie = (id) => { view.moverMgr.setExternalState(id, 'dead'); if (view.target && view.target === view.moverMgr.externalInfo(id)?.inst) view.setTargetHp(0); };
net.onPlayerDie = (id) => { if (id === net.myId) { combat.stop(); view.player?.die(); deathScreen(true); } };
/**
 * Morto: a tela perde a cor e aparece a caixa com "Reviver na cidade" — ou espera um Assist usar Resurrection, que levanta
 * o personagem ali mesmo.
 */
const deathBox = (() => {
  const box = document.createElement('div');
  box.className = 'death-box';
  box.hidden = true;
  box.setAttribute('role', 'alertdialog');
  box.setAttribute('aria-label', 'Você morreu');
  const h = document.createElement('b'); h.textContent = 'Você morreu';
  const p = document.createElement('p'); p.textContent = 'Renasça na cidade ou espere um Assist usar Resurrection para voltar aqui mesmo.';
  const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'cw-btn'; btn.textContent = 'Reviver na cidade';
  btn.addEventListener('click', () => { if (!net.revive()) chat.system('Sem conexão com o servidor.'); });
  box.append(h, p, btn);
  document.body.append(box);
  return box;
})();
function deathScreen(on: boolean) {
  view.renderer.domElement.style.filter = on ? 'grayscale(1)' : '';
  deathBox.hidden = !on;
  if (on) (deathBox.querySelector('button') as HTMLButtonElement).focus();
}
net.onGetUp = () => {
  deathScreen(false);
  view.player?.revive();
  view.player?.emote('MTI_GETUP', 0); // levanta e volta a ficar em pé
};
net.onStats = (s) => {
  const ch = characters.find((c) => c.slot === selectedSlot);
  if (!ch) return;
  ch.level = s.level;
  combat.interval = s.atkMs || 1000;
  if (view.player) view.player.attackRate = s.aspd || 1;
  combat.range = s.range ?? 2;
  const expPct = s.expMax > 0 ? (s.exp / s.expMax) * 100 : 0;
  hud.setStatus({ name: ch.name, level: s.level, hp: s.hp, maxHp: s.maxHp, mp: s.mp, maxMp: s.maxMp, fp: s.fp, maxFp: s.maxFp, expPct });
  charWnd.setName(ch.name);
  skillWnd.setCharLevel(s.level);
  charWnd.setStats(s);
  jobWnd.setOptions(s.jobOpts ?? []);
};
net.onReset = () => { deathScreen(false); view.moverMgr.clearExternal(); ground.clear(); friendsWnd.clear(); partyWnd.set(null, 0); partyBuffs.set(null); guildWnd.set(null, 0); myGuild = null; myInvis = false; gmPanel.setInvis(false); };
/** guild (tecla G); o nome da sua guild fica acima do seu nome */
const guildWnd = new GuildWindow(document.body);
let myGuild: string | null = null;
hud.onGuild = () => guildWnd.toggle();
guildWnd.onOpen = () => net.guild('guildInfo');
guildWnd.onCreate = (name) => net.guild('guildCreate', { name });
guildWnd.onLeave = () => net.guild('guildLeave');
guildWnd.onKick = (id) => net.guild('guildKick', { id });
guildWnd.onDisband = () => net.guild('guildDisband');
net.onGuildView = (g) => { guildWnd.set(g, net.myId); net.onMyGuildTag(g?.name ?? null); };
net.onMyGuildTag = (g) => { myGuild = g; view.player?.inst?.setGuildTag(g); };
net.onGuildReq = (id, name, guild) => friendRequestPrompt(document.body, name, (ok) => net.guild('guildAnswer', { id, ok }), `${name} convidou você para a guild ${guild}.`);
/** party (tecla P) e lista de partys (tecla L) */
const partyWnd = new PartyWindow(document.body);
const partyListWnd = new PartyListWindow(document.body);
hud.onParty = () => partyWnd.toggle();
hud.onPartyList = () => partyListWnd.toggle();
partyWnd.onLeave = () => net.party('partyLeave');
partyWnd.onKick = (id) => net.party('partyKick', { id });
partyWnd.onLead = (id) => net.party('partyLead', { id });
partyWnd.onSkill = (k) => net.party('partySkill', { k });
partyListWnd.onRefresh = () => net.party('partyList');
net.onParty = (p) => {
  const was = partyWnd.current;
  partyWnd.set(p, net.myId);
  partyBuffs.set(p);
  remotes.setParty(new Set(p?.members.map((m) => m.id).filter((id) => id !== net.myId) ?? []));
  if (p && !was && !partyWnd.visible) partyWnd.show(); // entrou numa party: abre a janela
};
net.onPartyReq = (id, name) => friendRequestPrompt(document.body, name, (ok) => net.party('partyAnswer', { id, ok }), `${name} convidou você para a party.`);
net.onPartyList = (list) => partyListWnd.set(list);
/** Mensageiro (tecla E): amigos e conversas privadas */
const friendsWnd = new FriendsWindow(document.body);
hud.onMessenger = () => friendsWnd.toggle();
friendsWnd.onRemove = (id) => net.friendDel(id);
friendsWnd.onSend = (id, text) => { if (!net.pm(id, text)) chat.system('Sem conexão com o servidor.'); };
friendsWnd.onNotice = (text) => chat.system(text);
net.onFriends = (list) => friendsWnd.set(list);
net.onFriendOn = (id, on) => friendsWnd.online(id, on);
net.onFriendNew = (f) => friendsWnd.add(f);
net.onFriendDel = (id) => friendsWnd.remove(id);
net.onFriendReq = (id, name) => friendRequestPrompt(document.body, name, (ok) => net.friendAnswer(id, ok));
net.onPm = (withId, withName, from, name, text) => friendsWnd.message(withId, withName, from, name, text, from === net.myId);
net.onChat = (id, name, text) => {
  if (id) {
    chat.message(name, text, id === net.myId);
    if (id === net.myId) view.player?.inst?.say(text); else remotes.say(id, text);
  }
  else { chat.system(text); if (gmPanel.visible) gmPanel.status(text, /não|erro|uso:|inválid|fora do/i.test(text)); }
};
// anúncio do painel admin: letreiro no meio da tela e uma cópia no chat (para quem perdeu)
const announcer = new Announcer(document.body);
net.onAnnounce = (text, loops) => { announcer.show(text, loops); chat.system(`[Aviso] ${text}`); };
net.onGmOpen = () => gmPanel.show();
net.onGmItems = (list) => gmPanel.setResults(list);
net.onTeleport = (p, revive) => { if (revive) { view.player?.revive(); deathScreen(false); } void view.teleportPlayer(p[0], p[2], p[1]); };
chat.onSend = (text) => {
  // comando de emoticon (/laugh, /sad…): mostra a carinha em vez de mandar o texto
  // /say Nome mensagem (ou /s): mensagem privada — se a pessoa está online abre a janela de conversa
  const say = /^\/(?:say|s)\s+(\S+)\s+(.+)$/i.exec(text.trim());
  if (say) return net.pmName(say[1], say[2]);
  if (/^\/(?:say|s)(\s|$)/i.test(text.trim())) { chat.system('Uso: /say NomeDoJogador mensagem (ou /s NomeDoJogador mensagem)'); return true; }
  const emo = motionWnd.emoticonOf(text);
  return emo >= 0 ? net.emoticon(emo) : net.sendChat(text);
};
net.onEmote = (id, m, md) => { if (id !== net.myId) remotes.emote(id, m, md); };
net.onEmo = (id, i) => {
  const inst = id === net.myId ? view.player?.inst : remotes.instOf(id);
  inst?.say(motionWnd.emoticonEl(i), 60, 4000);
};
// inventário: o servidor valida e devolve o estado; equipamento muda o visual do próprio personagem
inventory.onMove = (from, to) => {
  // arrastar a prancha para o espaço de montaria também passa pelo preparo
  const it = from[0] === 0 && to[0] === 1 && to[1] === 13 ? inventory.all.get(`0:${from[1]}`) : undefined;
  if (it && rideToggle(it.id)) return;
  if (!net.invMove(from, to)) chat.system('Sem conexão com o servidor.');
};
inventory.onUse = (c, s) => {
  const it = inventory.all.get(`${c}:${s}`);
  if (it && rideToggle(it.id)) return;
  if (!net.invUse(c, s)) chat.system('Sem conexão com o servidor.');
};

/**
 * Montaria (prancha, vassoura, bike, asas) pela barra de atalhos ou pelo inventário, como no cliente: apertar de novo
 * desmonta na hora; montar leva 3 s com uma barrinha nos pés — andar, pular, apanhar ou atacar cancela — e não dá em
 * batalha (o servidor confere de novo). Devolve false se o item não é de montaria (segue o uso normal).
 */
const RIDE_CAST_MS = 3000;
let rideCast: { id: number; cancel: () => void } | null = null;
/** último golpe dado ou levado (ms): batalha = menos de 5 s */
let lastBattleAt = 0;
function rideToggle(id: number): boolean {
  if (inventory.def(id)?.parts !== 13) return false;
  const p = view.player;
  if (!p?.active || p.dead) return true;
  const equipped = [...inventory.all.values()].find((i) => i.c === 1 && i.s === 13);
  if (equipped?.id === id) { rideCast?.cancel(); net.invUse(1, 13); return true; } // desmonta
  if (rideCast) { rideCast.cancel(); return true; } // apertar de novo durante o preparo cancela
  if (combat.attacking || performance.now() - lastBattleAt < 5000) { chat.system('Você está em batalha. Afaste-se da luta para poder voar.'); return true; }
  const bag = [...inventory.all.values()].find((i) => i.c === 0 && i.id === id);
  if (!bag || !p.inst) return true;
  const start = [...p.pos];
  const el = document.createElement('div');
  el.className = 'cast-bar';
  el.setAttribute('role', 'progressbar');
  el.setAttribute('aria-label', 'Preparando a montaria');
  const fill = document.createElement('i');
  el.append(fill);
  const obj = new CSS2DObject(el);
  obj.center.set(0.5, 0);
  obj.position.set(0, -0.05, 0);
  p.inst.group.add(obj);
  const t0 = performance.now();
  let done = false;
  const end = () => { done = true; obj.removeFromParent(); el.remove(); rideCast = null; };
  rideCast = { id, cancel: end };
  const tick = () => {
    if (done) return;
    const t = (performance.now() - t0) / RIDE_CAST_MS;
    const moved = Math.hypot(p.pos[0] - start[0], p.pos[2] - start[2]) > 0.3 || Math.abs(p.pos[1] - start[1]) > 0.5;
    if (!p.active || p.dead || moved || performance.now() - lastBattleAt < 5000) { end(); if (moved) chat.system('Preparo da montaria cancelado.'); return; }
    fill.style.width = `${Math.min(100, t * 100)}%`;
    if (t >= 1) {
      end();
      const now = [...inventory.all.values()].find((i) => i.c === 0 && i.id === id);
      if (now && !net.invUse(0, now.s)) chat.system('Sem conexão com o servidor.');
      return;
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  return true;
}
net.onInvError = (error) => chat.system(error);
net.onInv = (m) => {
  inventory.setState(m.gold, m.bag, m.items, m.defs);
  // prancha/vassoura equipada (PARTS_RIDE = 13): velocidade e giro dela no voo
  const ride = m.items.find(([c, s]) => c === 1 && s === 13);
  view.player?.setFlyParams(ride ? m.defs[ride[2]]?.fly ?? null : null);
  shopWnd.setGold(m.gold);
  const counts = new Map<number, number>();
  for (const [c, , id, n] of m.items) if (c === 0) counts.set(id, (counts.get(id) ?? 0) + n);
  actionBar.setCounts(counts);
  // mesmo cálculo do servidor (shared/look.ts): cash por cima, partes escondidas fora, enchant para o brilho
  void restyle(lookList(inventory.equippedPieces(), inventory.hidden));
};
net.onWelcome = (eq, mt) => { combatMt = mt; void restyle(eq); void view.player?.setCombat(mt); net.guild('guildInfo'); };
// postura de combate (arma/escudo equipado, conforme a classe) e equipamento vindos do servidor
net.onLook = (eq, mt) => { combatMt = mt; void restyle(eq); void view.player?.setCombat(mt); };
/** caixinhas do inventário: esconde/mostra capacete, capa, máscara e roupas de cash (lembrado por personagem neste navegador) */
inventory.onHide = (mask) => {
  const ch = characters.find((c) => c.slot === selectedSlot);
  if (ch) try { localStorage.setItem(`flyff.hide.${ch.id}`, String(mask)); } catch { /* sem armazenamento */ }
  net.setHide(mask);
  void restyle(lookList(inventory.equippedPieces(), mask));
};
// nível mudado por GM: atualiza o personagem e a janela de status (HP/MP/FP cheios com os máximos novos)
// nível novo (GM ou exp): os valores certos chegam logo depois em `stats`
net.onLevel = (level) => { const ch = characters.find((c) => c.slot === selectedSlot); if (ch) ch.level = level; };
/** troca o equipamento visível do personagem local (recoloca o nome na instância nova) */
let combatMt = 0, lookNow: string[] = [];
/** você está com a Dark Illusion de GM ligada (invisível para os jogadores): seu boneco fica translúcido */
let myInvis = false;
net.onInvis = (on) => { myInvis = on; view.player?.inst?.setGhost(on); gmPanel.setInvis(on); };
async function restyle(eq: string[]) {
  lookNow = eq;
  const inst = await view.player?.restyle(eq);
  const ch = characters.find((c) => c.slot === selectedSlot);
  if (inst && ch) { inst.setLabel(ch.name, rankOf(account?.authority), PLAYER_LABEL_LIFT); inst.setGuildTag(myGuild); }
  if (inst && myInvis) inst.setGhost(true);
  updateInvPreview();
}
/** boneco do inventário: o mesmo modelo do jogador (template já montado) */
function updateInvPreview() {
  const p = view.player;
  inventory.preview.setModel(p?.inst?.tpl ?? null, lookNow, p?.sex ?? 'male', combatMt, view.data, { lib: view.sfxLib, fileOf: (id) => view.sfxFile(id) });
}
addEventListener('keydown', (e) => {
  if (!inGame || e.ctrlKey || e.altKey || e.metaKey) return;
  const tag = (e.target as HTMLElement).tagName;
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
  if (e.code === 'Escape') combat.stop();
  if (e.code === 'KeyI' && !e.repeat) inventory.toggle();
  else if (e.code === 'KeyH' && !e.repeat) charWnd.toggle();
  else if (e.code === 'KeyK' && !e.repeat) skillWnd.toggle();
  else if (e.code === 'KeyJ' && !e.repeat) jobWnd.toggle(); // reabre a escolha de classe, se ainda há
  else if (e.code === 'KeyC' && !e.repeat) runActionSlot();
  else if (e.code === 'KeyV' && !e.repeat) teleportWnd.toggle();
  else if (e.code === 'KeyO' && !e.repeat) motionWnd.toggle();
  else if (e.code === 'KeyE' && !e.repeat) friendsWnd.toggle();
  else if (e.code === 'KeyP' && !e.repeat) partyWnd.toggle();
  else if (e.code === 'KeyG' && !e.repeat) guildWnd.toggle();
  else if (e.code === 'KeyL' && !e.repeat) partyListWnd.toggle();
  else if (e.code === 'Enter') { e.preventDefault(); chat.focus(); }
  else if (/^Digit[0-9]$/.test(e.code)) actionBar.use((Number(e.code.slice(5)) + 9) % 10);
});
net.onStatus = (t, error = false) => {
  const el = $('netStatus'); el.textContent = t; el.hidden = !t; el.classList.toggle('error', error);
  if (!t) void versionWatcher.check(); // conectou de novo: o servidor pode ter voltado com um build novo
};

// ---------- aparência das janelas (peças do tema) ----------
void themeTiles(['WndTile00.tga', 'WndTile01.tga', 'WndTile02.tga'], 3, 1).then((t) => { if (t) document.querySelectorAll<HTMLElement>('.fwnd-title').forEach((e) => { e.style.borderImageSource = `url(${t.url})`; }); });
void themeTiles([3, 4, 5, 6, 7, 8, 9, 10, 11].map((i) => `WndTile${String(i).padStart(2, '0')}.tga`), 3, 3).then((t) => { if (t) document.querySelectorAll<HTMLElement>('.fwnd-body').forEach((e) => { e.style.borderImageSource = `url(${t.url})`; }); });
void themeTiles([0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => `WndEditTile${String(i).padStart(2, '0')}.tga`), 3, 3).then((t) => { if (t) document.querySelectorAll<HTMLElement>('.fedit').forEach((e) => { e.style.borderImageSource = `url(${t.url})`; }); });
void themeImage('ButtCheck.tga').then((u) => { if (u) document.querySelectorAll<HTMLElement>('.fcheck span').forEach((e) => { e.style.backgroundImage = `url(${u})`; }); });
document.querySelectorAll<HTMLElement>('.fbtn[data-img]').forEach((b) => {
  const file = b.dataset.img!;
  // .tga é decodificado e .bmp tem o magenta do cliente tirado (shared/tga.ts). Sem a imagem, fica o botão com texto.
  if (/\.tga$/i.test(file)) { void themeImage(file).then((u) => { if (u) b.style.backgroundImage = `url(${u})`; }); return; }
  void keyedImage(file).then((u) => { if (u) b.style.backgroundImage = `url(${u})`; });
});
const message = (el: HTMLElement) => (t: string, error = false) => { el.textContent = t; el.classList.toggle('error', error); };
const sayLogin = message($('loginMsg')), saySelect = message($('selectMsg')), sayCreate = message($('createMsg'));

// ---------- preferências locais (contas salvas: nome + token de lembrar do servidor, NUNCA a senha) ----------
/**
 * Conta salva: o nome e, se foi salva com a senha certa, um token de lembrar (POST /gapi/remember) — o duplo clique entra
 * com ele sem digitar a senha. O token vale 30 dias (renovados a cada entrada), some ao apagar a conta salva ou ao trocar a
 * senha; no servidor fica só o hash dele.
 */
interface SavedLogin { name: string; remember?: string }
const prefs = (() => { try { return JSON.parse(localStorage.getItem('flyff.game') ?? '{}') as { saved?: (SavedLogin | string)[]; last?: string; quality?: string }; } catch { return {}; } })();
const savePrefs = () => { try { localStorage.setItem('flyff.game', JSON.stringify(prefs)); } catch { /* sem armazenamento */ } };
// versões antigas guardavam só o nome (string)
const saved: SavedLogin[] = (prefs.saved ?? []).map((x) => (typeof x === 'string' ? { name: x } : x)).filter((x) => x && typeof x.name === 'string');
prefs.saved = saved;
const findSaved = (name: string) => saved.find((s) => s.name.toLowerCase() === name.toLowerCase());
const user = $<HTMLInputElement>('username'), pass = $<HTMLInputElement>('password');
user.value = prefs.last ?? '';
$<HTMLInputElement>('saveAccount').checked = !!prefs.last;
$<HTMLSelectElement>('quality').value = prefs.quality ?? 'high';

let selectedSaved: string | null = null;
function renderSaved() {
  $('savedList').replaceChildren(...saved.map((s) => {
    const li = document.createElement('li');
    li.textContent = s.name;
    li.setAttribute('role', 'option');
    li.setAttribute('aria-selected', String(s.name === selectedSaved));
    li.title = s.remember ? 'Dois cliques para entrar' : 'Dois cliques para preencher a conta (salve com a senha para entrar direto)';
    if (s.remember) li.classList.add('auto');
    li.addEventListener('click', () => { selectedSaved = s.name; user.value = s.name; renderSaved(); });
    li.addEventListener('dblclick', () => void useSaved(s.name));
    return li;
  }));
}
renderSaved();
/** guarda (ou troca) a conta salva com um token de lembrar novo, pedido com a sessão `tok` */
async function rememberLogin(name: string, tok: string) {
  const r = await fetch('/gapi/remember', { method: 'POST', headers: { authorization: `Bearer ${tok}` } });
  const body = await r.json().catch(() => ({})) as { remember?: string };
  if (!r.ok || !body.remember) return false;
  const old = findSaved(name);
  if (old?.remember) void forgetRemember(old.remember);
  if (old) { old.name = name; old.remember = body.remember; } else saved.push({ name, remember: body.remember });
  savePrefs();
  selectedSaved = name;
  renderSaved();
  return true;
}
const forgetRemember = (remember: string) => fetch('/gapi/forget', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ remember }) }).catch(() => {});
/** duplo clique / Carregar: entra direto com o token; sem token (ou expirado) só preenche a conta e pede a senha */
async function useSaved(name: string) {
  const s = findSaved(name);
  if (!s) return;
  selectedSaved = s.name; user.value = s.name; renderSaved();
  if (!s.remember) { pass.focus(); sayLogin('Digite a senha. Para entrar direto da próxima vez, marque "Salvar conta".'); return; }
  const ok = await doLogin({ username: s.name, remember: s.remember });
  if (!ok) { delete s.remember; savePrefs(); renderSaved(); pass.focus(); }
}
$('saveLogin').addEventListener('click', async () => {
  const n = user.value.trim(), p = pass.value;
  if (!n) { sayLogin('Digite a conta para salvar.', true); return; }
  if (!p) {
    if (!findSaved(n)) { saved.push({ name: n }); savePrefs(); }
    selectedSaved = n; renderSaved();
    sayLogin('Conta salva (só o nome). Digite a senha e salve de novo para entrar direto com dois cliques.');
    return;
  }
  // confere a senha no servidor, pega o token de lembrar e fecha essa sessão de conferência
  try {
    const reply = await api<LoginReply>('/gapi/login', { method: 'POST', body: JSON.stringify({ username: n, password: p }) });
    const ok = await rememberLogin(reply.account.username, reply.token);
    void fetch('/gapi/logout', { method: 'POST', headers: { authorization: `Bearer ${reply.token}` } });
    pass.value = '';
    sayLogin(ok ? 'Conta salva. Dê dois cliques nela para entrar.' : 'Não foi possível salvar a conta.', !ok);
  } catch (e) { sayLogin((e as Error).message, true); pass.select(); }
});
$('loadLogin').addEventListener('click', () => { if (selectedSaved) void useSaved(selectedSaved); });
$('deleteLogin').addEventListener('click', () => {
  if (!selectedSaved) return;
  const s = findSaved(selectedSaved);
  if (s?.remember) void forgetRemember(s.remember);
  const i = s ? saved.indexOf(s) : -1;
  if (i >= 0) saved.splice(i, 1);
  if (prefs.last?.toLowerCase() === selectedSaved.toLowerCase()) prefs.last = undefined;
  selectedSaved = null; savePrefs(); renderSaved();
});
$('quitBtn').addEventListener('click', () => { location.href = '/'; });

/** painel de voo (como o velocímetro do cliente): velocidade, aceleração, turbo e os controles */
const flyEl = document.createElement('div');
flyEl.className = 'fly-hud';
flyEl.hidden = true;
flyEl.setAttribute('aria-live', 'off');
document.body.append(flyEl);
let flyText = '';
function flyHud(p: { flySpeed: number; flyAcc: boolean; flyTurbo: boolean } | null) {
  const t = p ? `Voo · ${Math.round(p.flySpeed * 3.6)} km/h${p.flyAcc ? ' · acelerando' : ''}${p.flyTurbo ? ' · TURBO' : ''}\nEspaço acelera/para · W/S desce/sobe · A/D vira · X turbo · desequipe a prancha para pousar` : '';
  if (t === flyText) return;
  flyText = t;
  flyEl.hidden = !p;
  flyEl.textContent = t;
}

// ---------- qualidade ----------
/** baixa = menos tiles, sem sombra e resolução 1×: ajuda máquinas fracas (ex.: celular/notebook) */
function applyQuality(q: string) {
  const low = q === 'low';
  view.radius = low ? 2 : 3;
  view.settings = { ...view.settings, shadows: !low };
  view.renderer.setPixelRatio(low ? 1 : Math.min(devicePixelRatio, 2));
  view.resize();
  view.invalidate();
}
applyQuality($<HTMLSelectElement>('quality').value);
$('quality').addEventListener('change', () => { prefs.quality = $<HTMLSelectElement>('quality').value; savePrefs(); applyQuality(prefs.quality); });

// ---------- carregamento do mundo (atrás da tela de login) ----------
const loginBtn = $<HTMLButtonElement>('loginBtn');
loginBtn.disabled = true;
view.onStatus = (s) => { if (!view.data) { sayLogin(s); bootStep(s); } };

/** na seleção/criação o personagem fica parado no palco, de frente, só com a animação de repouso */
let previewing = false;
view.onFrame = (dt) => {
  // mostra a porta do servidor: cada servidor (ex.: 8080 do painel e 5173 de desenvolvimento) é um mundo separado
  $('hud').textContent = inGame ? `${view.fps.toFixed(0)} fps · ${net.online} online · servidor :${location.port || (location.protocol === 'https:' ? 443 : 80)}` : `${view.fps.toFixed(0)} fps`;
  if (previewing) view.player?.preview(dt, 0);
  if (inGame) {
    remotes.frame(dt);
    const p = view.player;
    combat.frame(performance.now());
    ground.frame(performance.now());
    npcFrame(performance.now());
    if (p?.active) net.sendState(p.pos, p.heading, p.animState, performance.now());
    flyHud(p?.flying ? p : null);
  }
};
view.start();
// testes: com `?debug` no endereço, o console enxerga o mundo e a rede (window.__flyff)
if (new URLSearchParams(location.search).has('debug')) (window as unknown as Record<string, unknown>).__flyff = { view, net, combat, inventory };

// ---------- tela de carregamento (antes do login) ----------
/**
 * Mostra o progresso real dos downloads (shared/netstats.ts) em três etapas: tabelas do jogo (0–35 %), o tile de Flaris
 * (35–55 %) e os modelos/texturas em volta, até a rede ficar parada (55–100 %). Numa conexão lenta a pessoa vê a barra
 * andando em vez de um login travado em "Lendo tabelas de modelos…". A barra nunca volta (novos pedidos só a seguram).
 */
const bootEl = { screen: $('bootScreen'), fill: $('bootFill'), step: $('bootStep'), pct: $('bootPct'), bytes: $('bootBytes') };
const boot = { base: 0, span: 0.35, started: 0, done: 0, shown: 0 };
function bootStep(text: string) { bootEl.step.textContent = text; }
function bootPhase(text: string, base: number, span: number) {
  bootStep(text);
  // o que já estava baixando quando a etapa começou também conta como dela (senão terminavam "mais" do que começaram)
  Object.assign(boot, { base, span, started: netStats.done, done: netStats.done });
}
/** total do manifesto (servidor): arquivos e bytes que um carregamento completo de Flaris baixa nesta qualidade */
let bootTotal: { files: number; bytes: number } | null = null;
const bootQuality = prefs.quality === 'low' ? 'low' : 'high';
const bootTotalReady = fetch(`/gapi/boot-manifest?q=${bootQuality}`).then((r) => (r.ok ? r.json() : {})).then((j: { files?: number; bytes?: number }) => {
  if (j.files && j.files > 0) bootTotal = { files: j.files, bytes: j.bytes ?? 0 };
}).catch(() => {});
const mb = (b: number) => (b / 1048576).toFixed(1);
function bootPaint(force?: number) {
  if (bootTotal && force === undefined) {
    // com o total conhecido a barra é simplesmente "arquivos baixados ÷ total" (até 99 % — os 100 % ficam para o fim real)
    boot.shown = Math.max(boot.shown, Math.min(0.99, netStats.done / bootTotal.files));
    const pct = Math.floor(boot.shown * 100);
    bootEl.fill.style.width = `${pct}%`;
    bootEl.pct.textContent = `${pct}%`;
    bootEl.screen.setAttribute('aria-valuenow', String(pct));
    bootEl.bytes.textContent = `${Math.min(netStats.done, bootTotal.files)} / ${bootTotal.files} arquivos · ${mb(Math.min(netStats.bytes, bootTotal.bytes || netStats.bytes))} de ${mb(bootTotal.bytes)} MB`;
    return;
  }
  const started = netStats.started - boot.started, done = netStats.done - boot.done;
  // a fila esvazia por instantes entre um lote e outro (done = started): sem o teto, a barra pulava para o fim da etapa.
  // Cada etapa vai até 90 % do seu trecho, ponderado por quantos arquivos já vieram (o total não se sabe de antemão);
  // os 100 % só quando tudo terminou de verdade.
  const v = force ?? boot.base + boot.span * 0.9 * (started > 0 ? done / started : 0) * (done / (done + 40));
  boot.shown = Math.max(boot.shown, Math.min(1, v));
  const pct = Math.floor(boot.shown * 100);
  bootEl.fill.style.width = `${pct}%`;
  bootEl.pct.textContent = `${pct}%`;
  bootEl.screen.setAttribute('aria-valuenow', String(pct));
  bootEl.bytes.textContent = bootTotal && force !== undefined
    ? `${bootTotal.files} / ${bootTotal.files} arquivos · ${mb(bootTotal.bytes)} de ${mb(bootTotal.bytes)} MB`
    : `${mb(netStats.bytes)} MB baixados · ${netStats.done} arquivos (primeiro carregamento: contando o total…)`;
}
const bootTimer = setInterval(() => bootPaint(), 150);
/** espera a rede ficar parada (nenhum download pendente por `quiet` ms) ou o tempo limite */
function networkIdle(quiet = 900, limit = 120_000) {
  return new Promise<void>((resolve) => {
    const t0 = performance.now();
    let since = performance.now();
    const check = () => {
      const now = performance.now();
      if (netStats.started !== netStats.done) since = now;
      if (now - since >= quiet || now - t0 >= limit) { resolve(); return; }
      setTimeout(check, 100);
    };
    check();
  });
}

const worldReady = (async () => {
  bootPhase('Lendo os dados do jogo…', 0, 0.35);
  await view.open(WORLD);
  view.lookAt(FLARIS.x, FLARIS.z, 60);
  bootPhase('Carregando Flaris…', 0.35, 0.2);
  await view.loadTile(Math.floor(FLARIS.x / 512), Math.floor(FLARIS.z / 512));
  view.lookAt(FLARIS.x, FLARIS.z, 60);
  view.camera.position.y -= 25; // vista mais baixa, de cena
  view.controls.update();
  // os modelos, texturas e NPCs em volta são pedidos pelos quadros seguintes: espera tudo chegar
  bootPhase('Carregando modelos e texturas…', 0.55, 0.45);
  await networkIdle();
})();
worldReady.then(() => {
  clearInterval(bootTimer);
  // ainda sem total (primeira vez ou dados mudaram): manda a lista ao servidor — ele só aceita do próprio computador dele
  void bootTotalReady.then(() => {
    if (bootTotal) return;
    void fetch(`/gapi/boot-manifest?q=${bootQuality}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ urls: netStats.urls, bytes: netStats.bytes, count: netStats.done }) }).catch(() => {});
  });
  bootStep('Pronto!');
  bootPaint(1);
  setTimeout(() => { bootEl.screen.classList.add('done'); setTimeout(() => { bootEl.screen.hidden = true; }, 700); }, 250);
  sayLogin('Digite sua conta e senha.');
  loginBtn.disabled = false;
  (user.value ? pass : user).focus();
  $('loginScreen').classList.add('live');
  view.controls.autoRotate = true;
  view.controls.autoRotateSpeed = 0.35;
}, (e) => {
  clearInterval(bootTimer);
  bootStep('Erro ao carregar o mundo: ' + (e as Error).message);
  bootEl.step.style.color = '#ff8a8a';
  sayLogin('Erro ao carregar o mundo: ' + (e as Error).message, true);
});

// ---------- sessão ----------
let token = '';
let account: Account | null = null;
let characters: CharacterInfo[] = [];

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const r = await fetch(path, { ...init, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...init.headers } });
  const body = await r.json().catch(() => ({})) as T & { error?: string };
  if (!r.ok) throw new Error(body.error ?? `Falha (${r.status}).`);
  return body;
}

$('loginWnd').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const username = user.value.trim(), password = pass.value;
  if (!username || !password) { sayLogin('Informe a conta e a senha.', true); return; }
  await doLogin({ username, password });
});

/** entra com senha ou com o token de uma conta salva; devolve se deu certo */
async function doLogin(cred: { username: string; password?: string; remember?: string }): Promise<boolean> {
  loginBtn.disabled = true;
  sayLogin('Conectando…');
  try {
    const reply = await api<LoginReply>('/gapi/login', { method: 'POST', body: JSON.stringify(cred) });
    pass.value = '';
    const keep = $<HTMLInputElement>('saveAccount').checked;
    prefs.last = keep ? reply.account.username : undefined;
    savePrefs();
    // "Salvar conta" marcado ao entrar com a senha: guarda já com o token (próxima vez é só dar dois cliques)
    if (keep && cred.password) await rememberLogin(reply.account.username, reply.token);
    token = reply.token; account = reply.account; characters = reply.characters;
    try { sessionStorage.setItem('flyff.token', token); } catch { /* sem armazenamento */ }
    await worldReady;
    $('loginScreen').classList.add('leaving');
    setTimeout(() => { $('loginScreen').hidden = true; }, 450);
    view.controls.autoRotate = false;
    $('charScreen').hidden = false;
    if (characters.length) showSelect(); else showCreate(false);
    return true;
  } catch (e) {
    sayLogin((e as Error).message, true);
    pass.select();
    return false;
  } finally { loginBtn.disabled = false; }
}

// ---------- prévia 3D ----------
/** Mostra a aparência no palco (Flaris), de frente para a câmera, com a câmera próxima. */
let previewSeq = 0;
async function showPreview(look: { sex: number; hair: number; head: number; equip?: string[]; mt?: number }) {
  const seq = ++previewSeq;
  if (curWorld !== WORLD) { await openWorld(WORLD, FLARIS.x, FLARIS.z); mapLoading.hide(); } // voltou de Azria: a seleção é em Flaris
  previewing = true;
  // câmera travada na seleção/criação: sem girar nem dar zoom (o enquadramento é feito aqui)
  view.controls.enabled = false;
  view.controls.autoRotate = false;
  view.labelRenderer.domElement.hidden = true; // nomes de NPC não cobrem o personagem na prévia
  view.playerControl = false;
  // já monta com o que ele tem equipado no jogo (sem as partes escondidas nas caixinhas do inventário) e a postura da arma;
  // a prancha/vassoura fica de fora: na seleção ele aparece em pé no chão mesmo se saiu voando
  const equip = (look.equip ?? []).filter((s) => !/^II_RID_/.test(lookSymbol(s)));
  await view.spawnPlayer(FLARIS.x, FLARIS.z, 100, look.sex === 1 ? 'female' : 'male', { hair: look.hair, head: look.head, equip });
  if (seq !== previewSeq || !view.player) return;
  await view.player.setCombat(look.mt ?? 0);
  if (seq !== previewSeq || !view.player) return;
  const p = view.player.pos;
  // de frente (heading 0 olha para −Z FlyFF = +Z no Three), corpo inteiro enquadrado de perto; deslocado para a direita
  // para não ficar atrás da janela. Altura do enquadramento pelo tamanho real do modelo.
  view.player.heading = 0;
  const h = (view.player.inst?.tpl.height ?? 1.6) + (view.player.inst?.tpl.lift ?? 0);
  const shift = innerWidth > 700 ? -0.42 : 0;
  view.controls.target.set(p[0] + shift, p[1] + h * 0.5, -p[2]);
  view.camera.position.set(p[0] + shift, p[1] + h * 0.56, -p[2] + h * 1.25);
  view.controls.update();
}

// ---------- seleção ----------
/** partes escondidas nas caixinhas do inventário (guardadas por personagem neste navegador) */
function hideMaskOf(charId: number) { try { return Number(localStorage.getItem(`flyff.hide.${charId}`)) || 0; } catch { return 0; } }
let selectedSlot: number | null = null;
function showSelect() {
  $('charCreate').hidden = true;
  $('charSelect').hidden = false;
  $('accountName').textContent = account?.username ?? 'Conta';
  if (selectedSlot === null || !characters.some((c) => c.slot === selectedSlot)) selectedSlot = characters[0]?.slot ?? null;
  renderSlots();
  saySelect(characters.length ? 'Escolha o personagem e clique em Entrar.' : '');
  $<HTMLButtonElement>('newCharBtn').disabled = characters.length >= 3;
  $<HTMLButtonElement>('enterBtn').disabled = selectedSlot === null;
  const ch = characters.find((c) => c.slot === selectedSlot);
  if (ch) void showPreview({ sex: ch.sex, hair: ch.hairMesh, head: ch.headMesh, equip: lookList(ch.equip ?? [], hideMaskOf(ch.id)), mt: ch.mt });
}
function renderSlots() {
  $('slotList').replaceChildren(...[0, 1, 2].map((slot) => {
    const ch = characters.find((c) => c.slot === slot);
    const li = document.createElement('li');
    li.setAttribute('role', 'option');
    li.setAttribute('aria-selected', String(!!ch && slot === selectedSlot));
    if (ch) {
      li.textContent = ch.name;
      const small = document.createElement('small');
      small.textContent = `Nv ${ch.level}`;
      li.appendChild(small);
      li.addEventListener('click', () => { if (selectedSlot !== slot) { selectedSlot = slot; showSelect(); } });
      li.addEventListener('dblclick', () => void enter());
    } else {
      li.className = 'empty';
      li.textContent = 'Vaga livre — criar personagem';
      li.addEventListener('click', () => showCreate(true));
    }
    return li;
  }));
}
$('newCharBtn').addEventListener('click', () => showCreate(true));
$('enterBtn').addEventListener('click', () => void enter());
$('logoutBtn').addEventListener('click', () => void backToLogin());

/** Encerra a sessão no servidor e volta à tela de login (botão Voltar da seleção e "Desconectar" do menu do jogo). */
async function backToLogin() {
  // sai do mundo primeiro (o servidor salva a posição ao fechar o WebSocket), depois encerra a sessão
  inGame = false;
  net.close();
  try { await api('/gapi/logout', { method: 'POST' }); } catch { /* sessão já expirada */ }
  token = ''; account = null; characters = []; selectedSlot = null; previewing = false;
  view.controls.enabled = true;
  try { sessionStorage.removeItem('flyff.token'); } catch { /* sem armazenamento */ }
  view.playerControl = false;
  view.selectTarget(null);
  view.player?.remove();
  view.labelRenderer.domElement.hidden = false;
  hud.hide();
  inventory.hide(); inventory.clear(); actionBar.hide(); chat.hide(); chat.clear(); gmPanel.hide(); charWnd.hide(); shopWnd.hide(); skillWnd.hide(); teleportWnd.hide(); jobWnd.setOptions([]); buffBar.clear(); partyBuffs.set(null);
  $('help').hidden = true;
  $('charScreen').hidden = true;
  $('loginScreen').hidden = false;
  $('loginScreen').classList.remove('leaving');
  view.lookAt(FLARIS.x, FLARIS.z, 60);
  view.camera.position.y -= 25;
  view.controls.update();
  view.controls.autoRotate = true;
  sayLogin('Digite sua conta e senha.');
  pass.focus();
}

// ---------- criação ----------
const draft = { sex: 0, hair: 1, head: 1 };
function renderPickers() {
  for (const el of document.querySelectorAll<HTMLElement>('.picker')) {
    const k = el.dataset.key as keyof typeof draft;
    el.querySelector('output')!.textContent = k === 'sex' ? (draft.sex ? 'Feminino' : 'Masculino') : String(draft[k]);
  }
}
let previewTimer = 0;
document.querySelectorAll<HTMLElement>('.picker').forEach((el) => {
  const k = el.dataset.key as keyof typeof draft;
  el.querySelectorAll<HTMLButtonElement>('button[data-step]').forEach((b) => b.addEventListener('click', () => {
    const step = Number(b.dataset.step);
    if (k === 'sex') draft.sex = draft.sex ? 0 : 1;
    else { const max = LIMITS[k]; draft[k] = ((draft[k] - 1 + step + max) % max) + 1; }
    renderPickers();
    clearTimeout(previewTimer);
    previewTimer = window.setTimeout(() => void showPreview(draft), 120); // cliques rápidos: só a última aparência
  }));
});
function showCreate(canGoBack: boolean) {
  $('charSelect').hidden = true;
  $('charCreate').hidden = false;
  $<HTMLButtonElement>('createBackBtn').disabled = !canGoBack && !characters.length;
  Object.assign(draft, { sex: 0, hair: 1, head: 1 });
  $<HTMLInputElement>('newName').value = '';
  renderPickers();
  sayCreate(characters.length ? '' : 'Sua conta ainda não tem personagem. Crie o primeiro!');
  void showPreview(draft);
  $('newName').focus();
}
$('createBackBtn').addEventListener('click', () => { if (characters.length) showSelect(); });
$('charCreate').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const name = $<HTMLInputElement>('newName').value.trim();
  if (!/^[A-Za-z0-9]{2,16}$/.test(name)) { sayCreate('Nome: 2 a 16 letras ou números, sem espaços.', true); return; }
  const btn = $<HTMLButtonElement>('createBtn');
  btn.disabled = true;
  sayCreate('Criando…');
  try {
    const r = await api<{ character: CharacterInfo; characters: CharacterInfo[] }>('/gapi/characters', { method: 'POST', body: JSON.stringify({ name, ...draft }) });
    characters = r.characters;
    selectedSlot = r.character.slot;
    showSelect();
    saySelect(`${r.character.name} criado! Clique em Entrar.`);
  } catch (e) {
    sayCreate((e as Error).message, true);
  } finally { btn.disabled = false; }
});

// ---------- entrar no mundo ----------
async function enter() {
  const ch = characters.find((c) => c.slot === selectedSlot);
  if (!ch || !account) return;
  $<HTMLButtonElement>('enterBtn').disabled = true;
  saySelect(`Entrando como ${ch.name}…`);
  previewing = false;
  view.controls.enabled = true; // no jogo a câmera volta a girar/dar zoom
  // posição salva só vale no mundo 1 (WdMadrigal) e dentro do mapa; a altura vem do chão
  const savedWorld = WORLD_BY_ID[ch.worldId] ?? WORLD;
  if (savedWorld !== curWorld) await openWorld(savedWorld, ch.pos[0], ch.pos[2]);
  const d = view.data!;
  const s = 512;
  const inMap = (ch.worldId === 1 || savedWorld === curWorld) && ch.pos[0] > 0 && ch.pos[2] > 0 && ch.pos[0] < d.wld.width * s && ch.pos[2] < d.wld.height * s && d.hasTile(Math.floor(ch.pos[0] / s), Math.floor(ch.pos[2] / s));
  const [x, z] = inMap ? [ch.pos[0], ch.pos[2]] : [FLARIS.x, FLARIS.z];
  const sex: Sex = ch.sex === 1 ? 'female' : 'male';
  // já entra vestido como na prévia (equipamento salvo, sem as partes escondidas): sem isso o boneco aparecia sem roupa até
  // o inventário chegar do servidor; o restyle do `welcome` não refaz o modelo se o visual for o mesmo
  const hide = hideMaskOf(ch.id);
  const equip = lookList(ch.equip ?? [], hide);
  await view.spawnPlayer(x, z, inMap ? ch.pos[1] : 100, sex, { hair: ch.hairMesh, head: ch.headMesh, equip });
  if (curWorld !== WORLD) mapLoading.hide();
  combatMt = ch.mt ?? 0;
  await view.player?.setCombat(combatMt);
  lookNow = equip;
  updateInvPreview();
  inventory.setHide(hide);
  net.hide = hide;
  let queue: (BarItem | null)[] = [];
  try { queue = JSON.parse(localStorage.getItem(`flyff.queue.${ch.id}`) ?? '[]') as (BarItem | null)[]; } catch { /* sem armazenamento */ }
  actionBar.setQueue(Array.isArray(queue) ? queue : []);
  view.player?.inst?.setLabel(ch.name, rankOf(account.authority), PLAYER_LABEL_LIFT);
  view.player?.inst?.setGuildTag(myGuild);
  view.labelRenderer.domElement.hidden = false;
  view.playerControl = true;
  $('charScreen').hidden = true;
  $('help').hidden = false;
  // janela de status: valores salvos 0 = personagem novo → cheio (máximos provisórios, ver hud.ts)
  const max = provisionalMax(ch.level);
  const status = { name: ch.name, level: ch.level, ...max, hp: ch.hp || max.maxHp, mp: ch.mp || max.maxMp, fp: ch.fp || max.maxFp, expPct: 0 };
  hud.setStatus(status);
  hud.show();
  actionBar.show();
  chat.show();
  chat.system(`Bem-vindo, ${ch.name}! Enter para conversar · I abre o inventário.`);
  // retrato: renderiza o rosto uma vez, depois que o personagem já foi posado na tela
  requestAnimationFrame(() => requestAnimationFrame(() => hud.setPortrait(view.portrait())));
  // multiplayer: entra no mundo compartilhado com este personagem
  inGame = true;
  void motionWnd.loadTables(); // comandos de emoticon no chat
  net.connect(token, ch.id, () => view.player?.pos ?? [x, 100, z]);
}
