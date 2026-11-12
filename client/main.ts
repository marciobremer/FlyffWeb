import { gameConfirm } from './dialog';
import { DeleteBox } from './delbox';
import { LogoutCountdown } from './logout';
import { WorldView } from '../shared/world';
import { initLang, t, tr } from './lang';
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { keyedImage, themeImage, themeTiles } from '../shared/tga';
import { hasS3tc } from '../shared/dds';
import { setupMobile } from './mobile';
import { ColosseumUi } from './colosseum';
import { OptionsWindow, type Opts } from './options';
import { hairColorOf, hairRgb, type Sex } from '../shared/humans';
import { CharStage } from './charpreview';
import { fmtGameHour, gameHour } from '../shared/gameclock';
import { GameHud, provisionalMax } from './hud';
import { type SkillFx, NetClient, RemotePlayers } from './net';
import { ActionBar, ChatWindow, InventoryWindow, setHammerTheme, type BarItem } from './ui';
import { CraftWindow } from './craft';
import { ItemTimeWindow } from './itemtime';
import { setFailStack, setRarities, setTipPlayer, setTipStaff } from './itemtip';
import { Announcer } from './announce';
import { VersionWatcher } from './version';
import { GmPanel } from './gmpanel';
import { Combat } from './combat';
import { GroundItems } from './ground';
import { CharacterWindow } from './charwnd';
import { MiniMap, WorldMap, type MapDot, type MapView } from './minimap';
import { SmithWindow, smithOptions, isUpgradeMaterial, isAwakeScroll } from './smith';
import { ShopWindow } from './shop';
import { SkillWindow } from './skillwnd';
import { JobWindow } from './jobwnd';
import { CaptionBanner } from './caption';
import { Pets } from './pets';
import { PetFilterWindow } from './petfilter';
import { BuffBar } from './buffbar';
import { PartyBuffs } from './partybuffs';
import { TradeWindow } from './trade';
import { TeleportWindow } from './teleport';
import { QuestDialogWindow, QuestLogWindow } from './quests';
import { Rain } from './weather';
import { MotionWindow } from './motionwnd';
import { hideBit, lookSymbol } from '../shared/look';
import { FriendsWindow, friendRequestPrompt } from './friends';
import { WikiWindow } from './wiki';
import { PartyListWindow, PartyWindow } from './party';
import { GuildWindow } from './guild';
import { NpcMenu, type NpcMenuOption } from './npcmenu';
import { GameAudio } from './audio';
import { MoverInstance } from '../shared/movers';
import { OT } from '../shared/formats/types';
import { PLAYER_LABEL_LIFT, rankOf } from '../shared/rank';
import { lookList, type LookPiece } from '../shared/look';
import { netStats } from '../shared/netstats';

initLang(); // idioma do jogador (client/lang.ts): traduz o HTML da página e liga o seletor PT-BR | EN

/**
 * Cliente do jogo: login (janela no estilo do cliente, imagens de Data/Theme/Default) → seleção de personagem (3 vagas) ou
 * criação (nome, sexo, cabelo, rosto, com prévia 3D) → mundo. Contas e personagens vêm do servidor (PostgreSQL `flyffweb`).
 */
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const WORLD = 'WdMadrigal';
// sem o menu do navegador (voltar, salvar como, inspecionar…) ao apertar o botão direito: o jogo usa esse botão; só os campos de texto o mantêm (colar)
addEventListener('contextmenu', (e) => { const t = e.target as HTMLElement | null; if (!t?.closest('input, textarea, [contenteditable="true"]')) e.preventDefault(); }, true);
/** mundo aberto agora (WdMadrigal; WdKebaras = Azria) e o mundo de cada world_id do banco */
let curWorld = WORLD;
const WORLD_BY_ID: Record<number, string> = { 1: 'WdMadrigal', 2: 'WdKebaras', 3: 'WdCisland', 4: 'WdRartesia', 5: 'WdDarkRartesia' };
/** tela de carregamento de cada mapa (Theme/Default/MapLoading_*.png, como no cliente) e o nome mostrado */
const WORLD_LOADING: Record<string, { img: string; name: string }> = {
  WdMadrigal: { img: 'MapLoading_Madrigal.png', name: 'Madrigal' },
  WdKebaras: { img: 'MapLoading_Azria.png', name: 'Azria' },
  WdCisland: { img: 'MapLoading_Cisland.png', name: 'Coral Island' },
  WdRartesia: { img: 'MapLoading_Rartesia.png', name: 'Traseia' },
  WdDarkRartesia: { img: 'MapLoading_DarkRartesia.png', name: 'Dark Traseia' },
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
      label.textContent = t('Carregando {name}…', { name: info.name });
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
/** criação (CWndCreateChar): cabelo e rosto 1…MAX_BASE_HAIR / MAX_DEFAULT_HEAD (defineNeuz.h, iguais ao servidor) */
const LIMITS = { hair: 5, head: 5 };

interface CharacterInfo {
  /** classe (JOB_*) */ job?: number;
  id: number; slot: number; name: string; sex: number; hairMesh: number; hairColor?: number; headMesh: number; level: number; worldId: number; /** pasta do mapa salvo (World.inc) */ worldName?: string; pos: [number, number, number]; hp: number; mp: number; fp: number; exp: number;
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
const hud = new GameHud(document.body, () => logout.start(), () => inventory.toggle(), () => charWnd.toggle(), () => skillWnd.toggle());
/** contagem de 4 s antes de sair do jogo (Desconectar do menu) */
const logout = new LogoutCountdown(document.body, () => void backToLogin());
/** inventário (tecla I), barra de atalhos (1…0) e chat (Enter) — ver game/ui.ts */
const inventory = new InventoryWindow(document.body);
/** Teleporter (tecla V, como o APP_ZCK_TELEPORTEUR do cliente) */
const teleportWnd = new TeleportWindow(document.body);
const questDlg = new QuestDialogWindow(document.body), questLog = new QuestLogWindow(document.body);
questDlg.onAccept = (d) => { net.quest('accept', d.id, d.key); };
questDlg.onTurnIn = (d) => { net.quest('turnIn', d.id, d.key); };
questLog.onAbandon = (id) => { net.quest('abandon', id); };
hud.onQuests = () => questLog.toggle();
teleportWnd.onTeleport = (k) => { if (!net.zckTeleport(k)) chat.system(t('Sem conexão com o servidor.')); };
teleportWnd.onLoad = () => net.teleports();
/** Heaven Tower (Forsaken Tower Manager): os andares B1…B6 com o preço; o servidor confere a distância do NPC, o penya e o combate */
const towerWnd = new TeleportWindow(document.body, { id: 'towerWnd', title: 'Heaven Tower', store: 'flyff.wnd.tower', go: 'Entrar', filter: false, head: 'Andares', label: (d) => d.name });
towerWnd.onTeleport = (k) => { if (!net.towerGo(k)) chat.system(t('Sem conexão com o servidor.')); };
towerWnd.onLoad = () => net.tower();
/** janela de movimentos (tecla O): movimento no personagem (os outros veem pelo servidor) e emoticon acima da cabeça */
const motionWnd = new MotionWindow(document.body);
hud.onMotion = () => motionWnd.toggle();
motionWnd.onMotion = (m) => {
  const p = view.player;
  if (!p?.active) return;
  // modo de batalha: troca a postura de combate ↔ normal (o servidor avisa todos com 'look')
  if (m.id === 'MOT_BASE_BATTLE') { if (!net.toggleStance()) chat.system(t('Sem conexão com o servidor.')); return; }
  combat.stop();
  if (!p.emote(m.motion, m.play)) { chat.system(t('Pare de pular ou de andar para fazer um movimento.')); return; }
  net.emote(m.motion, m.play);
};
motionWnd.onEmoticon = (i) => { if (!net.emoticon(i)) chat.system(t('Sem conexão com o servidor.')); };
const actionBar = new ActionBar(document.body);
actionBar.onUseItem = (id) => { if (!rideToggle(id)) net.useItem(id); };
actionBar.onChange = (slots) => { net.saveBar(slots); };
actionBar.onUseChat = (text) => chat.send(text);
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
jobWnd.onChoose = (job) => { if (!net.jobChange(job)) chat.system(t('Sem conexão com o servidor.')); };
skillWnd.onApply = (levels) => { if (!net.skillUp(levels)) chat.system(t('Sem conexão com o servidor.')); };
shopWnd.onBuy = (k, id, n) => { if (!net.shopBuy(k, id, n)) chat.system(t('Sem conexão com o servidor.')); };
shopWnd.onSell = (k, s, n) => { if (!net.shopSell(k, s, n)) chat.system(t('Sem conexão com o servidor.')); };
/** NPC que o personagem está indo falar e onde está o NPC da loja aberta */
let npcGoing: { inst: MoverInstance; key: string; next: number; best?: number; since?: number } | null = null;
let shopNpc: [number, number] | null = null;
charWnd.onApply = (add) => { if (!net.statUp(add)) chat.system(t('Sem conexão com o servidor.')); };
charWnd.onPreview = (add) => { net.statPreview(add); };
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
gmPanel.getStats = (name) => net.gmStats(name);
gmPanel.setStatsReq = (name, v) => net.gmSetStats(name, v);
/** outros jogadores (WebSocket /ws) */
const remotes = new RemotePlayers(view);
// pet coletor (o seu e o dos outros): segue o dono e corre até o item que o servidor manda pegar
const pets = new Pets(view, (id) => (id === net.myId ? (view.player ? [...view.player.pos] as [number, number, number] : null) : remotes.pos(id)));
const petFilterWnd = new PetFilterWindow(document.body);
const net = new NetClient(remotes);
let inGame = false;
// versão nova do jogo no servidor: recarrega fora do mundo, avisa dentro dele (client/version.ts)
const versionWatcher = new VersionWatcher(() => inGame);
net.onMobs = (add, upd, del) => {
  const d = view.data, mm = view.moverMgr;
  if (!d) return;
  for (const id of del) mm.removeExternal(id);
  for (const [id, modelId, x, z, h, s, y, hp, ag] of add) {
    const entry = d.dynaModels.get(`${OT.MOVER}:${modelId}`);
    if (entry) mm.addExternal(id, entry, x, z, h, s, y ?? null, hp ?? 1000, false, !!ag);
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
let myMp = 0, myFp = 0;
combat.skillBlock = (id) => {
  const s = skillWnd.get(id), L = s?.levels[skillWnd.levelOf(id) - 1];
  if (!s || !L) return null;
  return L.mp > myMp ? 'MP insuficiente.' : L.fp > myFp ? 'FP insuficiente.' : null;
};
combat.onBlocked = (why) => chat.system(why);
net.onBuffs = (list) => buffBar.set(list);
buffBar.onRemove = (id) => { net.removeBuff(id); };
net.onSkills = (points, levels, list, auto) => { const ch = characters.find((c) => c.slot === selectedSlot); skillWnd.set(points, levels, list, ch?.level ?? 1, !!auto); };
net.onSkillUsed = (id, cd) => {
  actionBar.cooldown(id, cd, 'skill');
  const s = skillWnd.get(id);
  if (s?.kind === 'buff' && s.mo) view.player?.cast(s.mo); // o servidor aceitou: toca o movimento de lançar o buff
  // Dark Illusion: o aviso vermelho na altura da cintura, como o "You use Dark Illusion." do original
  const p = view.player?.pos;
  if (s?.sym === 'SI_ACR_SUP_DARKILLUSION' && p) combat.popup([p[0], p[1] + 0.9, p[2]], t('Você usou Dark Illusion.'), 'notice');
};
/** alcance de lançar: magia 22 u (o servidor aceita 24), debuff 14 (15); golpe corpo a corpo = o da arma */
const skillRange = (s: { kind?: string; hostile?: boolean }) => (s.kind === 'magic' ? 22 : s.hostile ? 14 : undefined);
/** atalho de skill: lança no mob selecionado (anda até o alcance) */
actionBar.onUseSkill = (id) => {
  const s = skillWnd.get(id);
  if (!s) return;
  if (skillWnd.levelOf(id) <= 0) { chat.system(t('Você ainda não aprendeu {name}.', { name: s.name })); return; }
  if (!s.melee) { chat.system(t('{name} ainda não pode ser lançada.', { name: s.name })); return; }
  if (s.sym === 'SI_ASS_HEAL_RESURRECTION') { // Resurrection: no jogador derrotado selecionado
    const tgt = view.target, rid = tgt && tgt.owner === 'players' ? remotes.idOf(tgt) : null;
    if (rid === null || !remotes.isDead(rid)) { chat.system(t('Selecione um jogador derrotado (clique nele) para usar Resurrection.')); return; }
    if (s.mo) view.player?.cast(s.mo);
    if (!net.resurrect(id, rid)) chat.system(t('Sem conexão com o servidor.'));
    return;
  }
  if (s.kind === 'buff' && !s.hostile) { // buff/cura: vale em você, sem alvo
    net.castSkill(id, 0);
    return;
  }
  const why = combat.skillBlock(id);
  if (why) { chat.system(why); return; } // sem MP/FP: só avisa, não anda nem ataca
  if (!combat.attacking) {
    const tgt = view.target;
    if (!tgt || tgt.owner !== 'spawns') { chat.system(t('Selecione um monstro primeiro.')); return; }
    combat.start(tgt);
    if (!combat.attacking) return;
  }
  combat.queueSkill(id, s.mo || s.sym.replace(/^SI_/, 'MTI_'), false, skillRange(s), !!s.hostile);
};
/**
 * Action Slot (CWndTaskBar::UseSkillQueue): clique direito no monstro ou tecla C com ele selecionado — anda até ele e lança
 * as skills da sequência, uma depois da outra; depois segue no golpe normal.
 */
function runActionSlot(inst: MoverInstance | null = view.target) {
  if (!inGame) return;
  if (!inst || inst.owner !== 'spawns') { chat.system(t('Selecione um monstro primeiro.')); return; }
  const list = actionBar.queueSkills.map((it) => skillWnd.get(it.id)).filter((s): s is NonNullable<typeof s> => !!s && s.melee && skillWnd.levelOf(s.id) > 0)
    .map((s) => ({ id: s.id, motion: s.mo || s.sym.replace(/^SI_/, 'MTI_'), buff: s.kind === 'buff' && !s.hostile, range: skillRange(s) }));
  if (!list.length) { chat.system(t('A Action Slot está vazia: arraste skills aprendidas da janela de skills (K) para ela.')); return; }
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
  if (inGame && view.isAttackable(inst) && again) combat.start(inst);
  else if (inGame && view.isAttackable(inst) && combat.attacking && !combat.isTarget(inst) && optionsWnd.values.autoNext) combat.queueNext(inst); // Auto Attack Next Target: depois que o atual morrer, ataca este
  else if (!(inGame && view.isAttackable(inst) && combat.attacking && combat.isTarget(inst))) combat.stop();
  if (inGame && inst.owner === 'movers' && inst.source.characterKey) npcGoing = { inst, key: inst.source.characterKey.trim(), next: 0 };
};
// celular: joystick, ataque, pulo e atalhos na tela (client/mobile.ts; só liga em aparelho de toque ou com ?mobile)
/** seleciona e ataca o monstro vivo mais perto (botões Atacar sem alvo e AUTO do celular) */
const attackNearest = () => {
  const p = view.player;
  if (!inGame || !p) return;
  const inst = view.moverMgr.nearestHostile(p.pos[0], p.pos[2], 25, (i) => view.isAttackable(i));
  if (!inst) { chat.system(t('Nenhum monstro por perto.')); return; }
  view.selectTarget(inst);
  combat.start(inst);
};
const mobileUi = setupMobile(view, {
  attack: () => { const tg = view.target; if (inGame && tg && view.isAttackable(tg)) combat.start(tg); else attackNearest(); },
  autoStep: () => { if (inGame && !combat.attacking) attackNearest(); },
});
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
      if (now - (npcGoing.since ?? now) > 2000) { p.stop(); npcGoing = null; chat.system(t('Não consigo chegar até esse NPC por aqui.')); return; }
      if (now >= npcGoing.next) { p.moveTo(nx, nz); npcGoing.next = now + 250; }
    }
    else { p.stop(); p.face(nx, nz); menuNpc = npcGoing; net.npcMenu(npcGoing.key); shopNpc = [nx, nz]; npcGoing = null; }
  }
  // NPC com o menu, a loja ou o ferreiro aberto para de trabalhar (stand calmo) até fechar
  view.moverMgr.attending = menuNpc && (npcMenu.visible || shopWnd.visible || smithWnd.visible) ? menuNpc.inst : null;
  // fecha o menu ao se afastar além do alcance de conversa do servidor (12 m)
  if (npcMenu.visible && shopNpc && Math.hypot(shopNpc[0] - p.pos[0], shopNpc[1] - p.pos[2]) > 12) npcMenu.hide();
  if (shopWnd.visible && shopNpc && Math.hypot(shopNpc[0] - p.pos[0], shopNpc[1] - p.pos[2]) > 14) { shopWnd.hide(); shopNpc = null; }
}
/** menu do NPC ao chegar perto: Comércio (loja) e Receber Buffs! (Buff Pang) — o servidor diz o que ele tem */
const npcMenu = new NpcMenu(document.body);
let menuNpc: { inst: MoverInstance; key: string } | null = null;
net.onNpcMenu = (m) => {
  const opts: NpcMenuOption[] = [];
  if (m.shop) opts.push({ label: t('Comércio'), run: () => net.shopOpen(m.key) });
  if (m.buff) opts.push({ label: t('Receber Buffs!'), run: () => net.npcBuff(m.key) });
  if (m.tower) opts.push({ label: t('Heaven Tower'), run: () => towerWnd.show() });
  if (m.colosseum) opts.push({ label: t('Colosseum'), run: () => coloUi.open(characters.find((c) => c.slot === selectedSlot)?.level ?? 1) });
  if (m.craft) opts.push({ label: t('Craft'), run: () => craftWnd.show() }); // o servidor só deixa fabricar perto do NPC de craft
  // quests do NPC: ❗ oferece, … em andamento, ✔ pronta para entregar
  for (const q of m.quests) opts.push({ label: `${q.st === 'offer' ? '❗' : q.st === 'ready' ? '✔' : '…'} ${q.name}`, run: () => net.quest('open', q.id, m.key) });
  // ferreiro (Bobochan, Peach…): as opções do character.inc abrem a janela no modo certo
  for (const o of smithOptions(m.smith)) opts.push({ label: o.label, run: () => smithWnd.open(m.key, o.mode) });
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
const PLAYER_MENU = () => [t('Negociar'), t('Adicionar como amigo'), t('Convidar para grupo'), t('Convidar para guild'), t('Seguir'), t('Ver equipamentos'), t('Animar'), t('Couple proposal'), t('Reportar')];
function playerClick(ev: { clientX: number; clientY: number }) {
  if (!inGame) return false;
  const hit = remotes.at(ev);
  if (!hit) return false;
  ground.cancel();
  combat.stop();
  npcGoing = null;
  view.selectTarget(hit.inst);
  const opts: NpcMenuOption[] = PLAYER_MENU().map((label) => ({ label, run: () => chat.system(t('"{label}": função ainda não implementada.', { label })) }));
  opts[0].run = () => { if (!net.trade('tradeReq', { id: hit.id })) chat.system(t('Sem conexão com o servidor.')); };
  opts[1].run = () => { if (!net.friendAdd(hit.id)) chat.system(t('Sem conexão com o servidor.')); };
  opts[2].run = () => { if (!net.party('partyInvite', { id: hit.id })) chat.system(t('Sem conexão com o servidor.')); };
  opts[3].run = () => { if (!net.guild('guildInvite', { id: hit.id })) chat.system(t('Sem conexão com o servidor.')); };
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
    await view.spawnPlayer(p[0], p[2], p[1], sex, look, true);
    if (view.player) view.player.runSpeed = moveSpeed;
    const ch = characters.find((c) => c.slot === selectedSlot);
    if (ch) { view.player?.inst?.setLabel(ch.name, rankOf(account?.authority), PLAYER_LABEL_LIFT); view.player?.inst?.setGuildTag(myGuild, myGuildMaster); }
    void view.player?.setCombat(combatMt);
    view.playerControl = true;
    net.resume();
    mapLoading.hide();
    chat.system(t('Você chegou em {name}.', { name: WORLD_LOADING[w]?.name ?? w }));
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
/**
 * Efeitos do golpe (como o CActionMover::SendActMsg/DPClient do original): errou = sfx_hitMiss01 (escala 2), crítico = sfx_hitCritical01
 * (escala 3), os dois 1,5 m acima dos pés; golpe normal = efeito do alvo da arma (dwSfxObj3) a 1 m do chão e o de quem golpeia (dwSfxObj5).
 */
const hitFx = (foot: [number, number, number], miss: boolean, crit: boolean, hx: [number, number] | undefined, atk: [number, number, number] | null) => {
  const D = view.data?.defines;
  if (!D) return;
  const up = (y: number): [number, number, number] => [foot[0], foot[1] + y, foot[2]];
  if (miss) { const id = D.get('XI_HIT_MISS01'); if (id !== undefined) view.playSfx(id, up(1.5), 0, 2); return; }
  if (crit) { const id = D.get('XI_HIT_CRITICAL01'); if (id !== undefined) view.playSfx(id, up(1.5), 0, 3); }
  if (hx && hx[0] >= 0) view.playSfx(hx[0], up(1));
  if (hx && hx[1] >= 0 && atk) view.playSfx(hx[1], atk);
};
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
function skillFx(a: number, target: [number, number, number] | null, fx: SkillFx, hitDelay = 0) {
  const posOf = () => (a === net.myId ? view.player?.pos ?? null : remotes.pos(a));
  const me = posOf();
  if (!me) return;
  const dx = target ? target[0] - me[0] : 0, dz = target ? target[2] - me[2] : -1;
  const yaw = (Math.atan2(dx, -dz) * 180) / Math.PI;
  // movimento de lançar dos outros jogadores (o seu já tocou ao apertar a skill)
  if (fx.mo && a !== net.myId) remotes.cast(a, fx.mo);
  audio.play(fx.sn, me); // som de lançar (dwSndAttack1)
  const follow = (): [number, number, number] | null => { const q = posOf(); return q ? [q[0], q[1], q[2]] : null; };
  view.playSfxFollowOnce(fx.c, follow, yaw); // efeitos no lançador acompanham quem lança
  const impact = () => {
    audio.play(fx.sh, target); // som do impacto (dwSndAttack2)
    if (target) view.playSfx(fx.h, [target[0], target[1] + 1, target[2]], yaw);
    view.playSfxFollowOnce(fx.s, follow, yaw);
  };
  // magia: o projétil voa até o alvo e o impacto toca na chegada
  if (target && fx.p !== undefined && fx.p >= 0) {
    const dist = Math.hypot(dx, dz);
    view.playSfxMoving(fx.p, [me[0], me[1] + 1.2, me[2]], [target[0], target[1] + 1, target[2]], yaw, Math.max(0.15, Math.min(0.9, dist / 40)), impact);
  } else if (hitDelay > 0) setTimeout(impact, hitDelay); // debuff: o efeito no alvo só depois do movimento de lançar
  else impact();
  // buff: o efeito fica no personagem enquanto durar
  if (fx.b !== undefined && fx.b >= 0 && fx.dur) view.playSfxFollow(fx.b, () => { const p = posOf(); return p ? [p[0], p[1], p[2]] : null; }, fx.dur);
}
/** duração aproximada do movimento de lançar (o efeito no alvo e o ícone do debuff esperam por ele) */
const CAST_MS = 900;
net.onSkillFx = (a, fx, tg) => skillFx(a, tg === undefined ? null : view.moverMgr.externalInfo(tg)?.pos ?? null, fx, tg === undefined ? 0 : CAST_MS);
// debuffs nos mobs (Sneaker…): o ícone com a contagem aparece na janela do alvo
const mobDebuffs = new Map<number, { sk: number; name: string; icon: string; end: number }[]>();
net.onMobDebuff = (id, sk, name, icon, ms) => {
  const end = performance.now() + CAST_MS + ms;
  // o ícone aparece quando o efeito chega no alvo
  setTimeout(() => { const cur = (mobDebuffs.get(id) ?? []).filter((d) => d.sk !== sk); cur.push({ sk, name, icon, end }); mobDebuffs.set(id, cur); }, CAST_MS);
};
setInterval(() => {
  const t = view.target, id = t ? view.moverMgr.externalIdOf(t) : null;
  const now = performance.now();
  for (const [k, l] of mobDebuffs) { const live = l.filter((d) => d.end > now); if (live.length) mobDebuffs.set(k, live); else mobDebuffs.delete(k); }
  view.setTargetDebuffs(id === null ? [] : mobDebuffs.get(id) ?? []);
}, 250);
net.onHit = (k, a, d, dmg, flags, hp, fx, sn, hx) => {
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
      // número de dano (imagens do cliente) e os efeitos do golpe: errou = MISS, crítico = CRITICAL, senão o efeito da arma
      const at = mobHead(d), foot = mm.externalInfo(d)?.pos;
      if (at && !miss) combat.damage(at, dmg, false, crit, a !== net.myId);
      if (foot) hitFx(foot, miss, crit, hx, a === net.myId ? view.player?.pos ?? null : remotes.pos(a));
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
    const at = playerHead(d), foot = d === net.myId ? view.player?.pos ?? null : remotes.pos(d);
    if (at && !miss) combat.damage(at, dmg, d === net.myId, crit, d !== net.myId);
    if (foot) hitFx(foot, miss, crit, undefined, null);
  }
};
net.onMobDie = (id) => { mobDebuffs.delete(id); view.moverMgr.setExternalState(id, 'dead'); if (view.target && view.target === view.moverMgr.externalInfo(id)?.inst) view.setTargetHp(0); };
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
  box.setAttribute('aria-label', t('Você morreu'));
  const h = document.createElement('b'); h.textContent = t('Você morreu');
  const p = document.createElement('p'); p.textContent = t('Renasça na cidade ou espere um Assist usar Resurrection para voltar aqui mesmo.');
  const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'cw-btn'; btn.textContent = t('Reviver na cidade');
  btn.addEventListener('click', () => { if (!net.revive()) chat.system(t('Sem conexão com o servidor.')); });
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
/** velocidade de corrida do personagem (u/s), vinda do servidor; aplicada também ao nascer */
let moveSpeed = 6;
net.onStatPreview = (s) => charWnd.setPreview(s);
net.onStats = (s) => {
  const ch = characters.find((c) => c.slot === selectedSlot);
  if (!ch) return;
  ch.level = s.level;
  setTipPlayer({ sex: ch.sex, job: s.job, level: s.level }); // dica do item: vermelho no que ele não pode usar
  combat.interval = s.atkMs || 1000;
  if (view.player) view.player.attackRate = s.aspd || 1;
  if (s.mv) moveSpeed = s.mv;
  if (view.player) view.player.runSpeed = moveSpeed;
  combat.range = s.range ?? 2;
  if (view.player) view.player.level = s.level;
  myMp = s.mp; myFp = s.fp;
  const expPct = s.expMax > 0 ? (s.exp / s.expMax) * 100 : 0;
  hud.setStatus({ name: ch.name, level: s.level, hp: s.hp, maxHp: s.maxHp, mp: s.mp, maxMp: s.maxMp, fp: s.fp, maxFp: s.maxFp, expPct });
  charWnd.setName(ch.name);
  skillWnd.setCharLevel(s.level);
  charWnd.setStats(s);
  jobWnd.setOptions(s.jobOpts ?? []);
};
net.onReset = () => { deathScreen(false); pets.clear(); view.moverMgr.clearExternal(); ground.clear(); friendsWnd.clear(); partyWnd.set(null, 0); partyBuffs.set(null); guildWnd.set(null, 0); myGuild = null; myGuildMaster = false; myInvis = false; gmPanel.setInvis(false); tradeWnd.close(); };
/** guild (tecla G); o nome da sua guild fica acima do seu nome */
const guildWnd = new GuildWindow(document.body);
let myGuild: string | null = null;
/** você é o mestre da guild (nome da guild dourado) */
let myGuildMaster = false;
hud.onGuild = () => guildWnd.toggle();
guildWnd.onOpen = () => net.guild('guildInfo');
guildWnd.onCreate = (name) => net.guild('guildCreate', { name });
guildWnd.onLeave = () => net.guild('guildLeave');
guildWnd.onKick = (id) => net.guild('guildKick', { id });
guildWnd.onDisband = () => net.guild('guildDisband');
guildWnd.onNotice = (text) => net.guild('guildNotice', { text });
net.onGuildView = (g) => { guildWnd.set(g, net.myId); friendsWnd.setGuild((g?.members ?? []).map((m) => ({ id: m.id, name: m.name, level: m.level, job: m.job, on: m.on }))); net.onMyGuildTag(g?.name ?? null, !!g && g.master === net.myId); };
net.onMyGuildTag = (g, master) => { myGuild = g; myGuildMaster = master; view.player?.inst?.setGuildTag(g, master); };
net.onGuildReq = (id, name, guild) => friendRequestPrompt(document.body, name, (ok) => net.guild('guildAnswer', { id, ok }), `${name} convidou você para a guild ${guild}.`);
/** party (tecla P) e lista de partys (tecla L) */
const partyWnd = new PartyWindow(document.body);
const partyListWnd = new PartyListWindow(document.body);
/** mini mapa (N: abre/fecha; começa aberto ao entrar) e mapa grande (M) */
const miniMap = new MiniMap(document.body);
const worldMap = new WorldMap(document.body);
miniMap.onClose = () => navOpen(false);
// GM/admin: duplo clique no mini mapa teleporta na hora para o ponto (//tp; o servidor confere a autoridade)
miniMap.canTeleport = () => !!rankOf(account?.authority);
miniMap.onTeleport = (x, z) => { if (!net.sendChat(`//tp ${x} ${z}`)) chat.system(t('Sem conexão com o servidor.')); };
/** o mini mapa começa aberto; fechar (N ou ×) fica lembrado neste navegador */
function navOpen(set?: boolean): boolean {
  try { if (set !== undefined) localStorage.setItem('flyff.nav.open', set ? '1' : '0'); return localStorage.getItem('flyff.nav.open') !== '0'; } catch { return set ?? true; }
}
/** o que os dois mapas desenham: mundo, pedaços de terreno, personagem e pontos (NPC, mob, jogadores) */
function mapView(): MapView | null {
  const p = view.player, d = view.data;
  if (!p || !d) return null;
  const dots: MapDot[] = [];
  for (const o of d.movers) dots.push({ x: o.pos[0], z: o.pos[2], kind: 'npc' });
  for (const [x, z] of view.moverMgr.externalPositions()) dots.push({ x, z, kind: 'mob' });
  for (const r of remotes.positions()) dots.push({ x: r.x, z: r.z, kind: r.party ? 'party' : 'player', name: r.name });
  // membros da party fora da área de visão: a posição que vem com a party (a cada 1,5 s)
  for (const m of partyWnd.current?.members ?? []) {
    if (m.on && m.id !== net.myId && m.w === d.name && m.x !== undefined && m.z !== undefined && !remotes.pos(m.id)) dots.push({ x: m.x, z: m.z, kind: 'party', name: m.name });
  }
  return { world: d.name, landW: d.wld.width, landH: d.wld.height, hasTile: (x, z) => d.hasTile(x, z), tileSize: 128 * d.wld.mpu, x: p.pos[0], z: p.pos[2], heading: p.heading, dots };
}
hud.onParty = () => partyWnd.toggle();
hud.onPartyList = () => partyListWnd.toggle();
partyWnd.onLeave = () => net.party('partyLeave');
partyWnd.onKick = (id) => net.party('partyKick', { id });
partyWnd.onLead = (id) => net.party('partyLead', { id });
partyWnd.onSkill = (k) => net.party('partySkill', { k });
partyListWnd.onRefresh = () => net.party('partyList');
net.onParty = (p) => {
  friendsWnd.setParty((p?.members ?? []).map((m) => ({ id: m.id, name: m.name, level: m.level, job: m.job, on: m.on })));
  const was = partyWnd.current;
  partyWnd.set(p, net.myId);
  partyBuffs.set(p);
  remotes.setParty(new Set(p?.members.map((m) => m.id).filter((id) => id !== net.myId) ?? []));
  if (p && !was && !partyWnd.visible) partyWnd.show(); // entrou numa party: abre a janela
};
/** trade com outro jogador (menu do jogador → Negociar) */
const tradeWnd = new TradeWindow(document.body);
tradeWnd.onItem = (s, n) => net.trade('tradeItem', { s, n });
tradeWnd.onRemove = (s) => net.trade('tradeRemove', { s });
tradeWnd.onGold = (gold) => net.trade('tradeGold', { gold });
tradeWnd.onLock = () => net.trade('tradeLock');
tradeWnd.onOk = () => net.trade('tradeOk');
tradeWnd.onCancel = () => { if (tradeWnd.active) net.trade('tradeCancel'); };
net.onTradeReq = (id, name) => friendRequestPrompt(document.body, name, (ok) => net.trade('tradeAnswer', { id, ok }), `${name} quer negociar com você.`);
net.onTrade = (v) => { tradeWnd.set(v); if (!inventory.visible) inventory.show(); };
net.onTradeClose = (text) => { tradeWnd.close(); if (text) chat.system(text); };
net.onPartyReq = (id, name) => friendRequestPrompt(document.body, name, (ok) => net.party('partyAnswer', { id, ok }), `${name} convidou você para a party.`);
net.onPartyList = (list) => partyListWnd.set(list);
/** Mensageiro (tecla E): amigos e conversas privadas */
const friendsWnd = new FriendsWindow(document.body);
hud.onMessenger = () => friendsWnd.toggle();
friendsWnd.onRemove = (id) => net.friendDel(id);
friendsWnd.onSend = (id, text) => { if (!net.pm(id, text)) chat.system(t('Sem conexão com o servidor.')); };
friendsWnd.onNotice = (text) => chat.system(text);
friendsWnd.onAddByName = (name) => { if (!net.friendAddName(name)) chat.system(t('Sem conexão com o servidor.')); };
// Wikipedia de itens (tecla Y ou /wiki) e o painel de GM, que escolhe o item por ela
const itemTimeWnd = new ItemTimeWindow(document.body);
itemTimeWnd.items = () => [...inventory.all.values()].filter((i) => i.x).map((i) => { const d = inventory.def(i.id); return { name: d?.name ?? '?', icon: d?.icon ?? '', left: (i.x ?? 0) - Date.now(), where: i.c === 1 ? 'Equipado' : 'Bolsa' }; });
itemTimeWnd.askDungeons = () => { net.coolOpen(); };
net.onCool = (list) => itemTimeWnd.setDungeons(list);
const craftWnd = new CraftWindow(document.body);
craftWnd.request = () => net.craftOpen();
craftWnd.doCraft = (id) => net.craftDo(id);
craftWnd.notify = (text) => chat.system(text);
net.onCraft = (m) => craftWnd.setAll((m.recipes ?? []) as never, m as never);
net.onCraftResult = (m) => { if (m.denied) { craftWnd.hide(); chat.system(String(m.text ?? '')); return; } craftWnd.setStatus(m as never); craftWnd.result(!!m.ok, String(m.text ?? '')); };
const wikiWnd = new WikiWindow(document.body);
wikiWnd.query = (p) => net.wiki(p);
wikiWnd.tipFor = (id) => { net.wikiTip(id); };
wikiWnd.onPick = (r) => { if (gmPanel.visible) gmPanel.pickRow(r); };
wikiWnd.onActivate = (r) => { if (gmPanel.visible) gmPanel.createRow(r); };
net.onWiki = (m) => wikiWnd.setPage(m);
net.onWikiTip = (v) => wikiWnd.setTip(v);
gmPanel.openCatalog = () => wikiWnd.show();
net.onFriends = (list) => friendsWnd.set(list);
net.onFriendOn = (id, on) => friendsWnd.online(id, on);
net.onFriendNew = (f) => friendsWnd.add(f);
net.onFriendDel = (id) => friendsWnd.remove(id);
net.onFriendReq = (id, name) => friendRequestPrompt(document.body, name, (ok) => net.friendAnswer(id, ok));
net.onPm = (withId, withName, from, name, text) => { friendsWnd.message(withId, withName, from, name, text, from === net.myId); if (from !== net.myId && optionsWnd.values.msgAlarm) audio.beep(); };
net.onChat = (id, name, text) => {
  if (id) {
    chat.message(name, text, id === net.myId);
    const shout = text.startsWith('[Grito] '), say = shout ? text.slice(8) : text; // grito: balão de outro tipo
    if (id === net.myId) view.player?.inst?.say(say, 60, shout ? 8000 : 6000, shout); else remotes.say(id, say, shout);
  }
  else { chat.system(text); if (gmPanel.visible) gmPanel.status(text, /no permission|not found|is not (online|dead)|no connection|error|usage:|invalid|outside|unknown command|too far|could not|did not (understand|fit)|does not (exist|accept)|do not have|unavailable|not available|already (dead|in )|only applies|only the suit|at most/i.test(text)); }
};
// anúncio do painel admin: letreiro no meio da tela e uma cópia no chat (para quem perdeu)
const announcer = new Announcer(document.body);
/** faixa de aviso no alto da tela (Level Up!) */
const caption = new CaptionBanner(document.body);
net.onAnnounce = (text, loops) => { announcer.show(text, loops); chat.system(`[Aviso] ${text}`); };
net.onGmOpen = () => gmPanel.show();
net.onGmItems = (list) => gmPanel.setResults(list);
net.onGmStats = (m) => gmPanel.setStats(m);
net.onTeleport = (p, revive) => { if (revive) { view.player?.revive(); deathScreen(false); } void view.teleportPlayer(p[0], p[2], p[1]); };
chat.onSend = (text) => {
  // comando de emoticon (/laugh, /sad…): mostra a carinha em vez de mandar o texto
  // /say Nome mensagem (ou /s): mensagem privada — se a pessoa está online abre a janela de conversa
  if (/^\/wiki\s*$/i.test(text.trim())) { wikiWnd.show(); return true; }
  if (/^\/craft\s*$/i.test(text.trim())) { craftWnd.show(); return true; }
  const say = /^\/(?:say|s)\s+(\S+)\s+(.+)$/i.exec(text.trim());
  if (say) return net.pmName(say[1], say[2]);
  if (/^\/(?:say|s)(\s|$)/i.test(text.trim())) { chat.system(t('Uso: /say NomeDoJogador mensagem (ou /s NomeDoJogador mensagem)')); return true; }
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
  if (!net.invMove(from, to)) chat.system(t('Sem conexão com o servidor.'));
};
inventory.onUse = (c, s) => {
  const it = inventory.all.get(`${c}:${s}`);
  // com a troca aberta, duplo clique num item da bolsa põe ele na troca
  if (tradeWnd.active) { if (it && c === 0) tradeWnd.offer(s, it.n, inventory.def(it.id)?.name ?? 'Item'); return; }
  if (it && rideToggle(it.id)) return;
  // carta de piercing: martelinho para escolher a suit da bolsa
  if (it && c === 0 && inventory.def(it.id)?.card) { inventory.startPierce(s); pierceFx(); return; }
  // material de upgrade (Sunstone, orichalcum brilhante, moonstone, carta de elemento): o mesmo martelo, para escolher o item
  if (it && c === 0 && (isUpgradeMaterial(inventory.def(it.id)?.sym) || isAwakeScroll(inventory.def(it.id)?.sym))) { inventory.startPierce(s, true); pierceFx(); return; }
  if (!net.invUse(c, s)) chat.system(t('Sem conexão com o servidor.'));
};
/**
 * Martelo de upgrade (sem pergaminho de proteção, como o duplo clique do original): se falhar a partir do +3 — e sempre na
 * ultimate — o item é destruído, então confirma antes.
 */
inventory.onUpgrade = (m, s) => {
  const it = inventory.all.get(`0:${s}`), d = it && inventory.def(it.id), sym = inventory.def(inventory.all.get(`0:${m}`)?.id ?? -1)?.sym ?? '';
  const ultimate = sym === 'II_GEN_MAT_ORICHALCUM02', element = sym.startsWith('II_GEN_MAT_ELE_');
  const risk = it && d && !isAwakeScroll(sym) && (ultimate || (element ? it.el >= 3 : it.u >= 3));
  const send = () => { if (!net.upgrade(s, m)) { chat.system(t('Sem conexão com o servidor.')); inventory.cancelPierce(); } };
  if (!risk) { send(); return; }
  void inventory.confirm(`Sem pergaminho de proteção, se falhar ${d.name}${it.u ? ` +${it.u}` : ''} é destruído. Para não perder o item, use o "Upgrade seguro" do BoBoChan (Flaris).`, 'Melhorar')
    .then((yes) => { if (yes) send(); else inventory.cancelPierce(); });
};
/** janela do ferreiro (menus do Bobochan e da Peach) */
const smithWnd = new SmithWindow(document.body, inventory);
smithWnd.onRun = (key, op, args) => net.smith(key, op, args);
/** resultado do ferreiro/martelo: chat, martelada, som e efeito (SND_INF_UPGRADESUCCESS/FAIL, XI_INT_SUCCESS/FAIL) */
net.onSmith = (ok, fx, s, text) => {
  if (text) chat.system(text);
  inventory.pierced(fx !== null, s ?? undefined);
  smithWnd.result(ok, fx, s, text);
  const me = view.player?.pos;
  if (!fx || !me) return;
  audio.play(fx === 'success' ? 'SND_INF_UPGRADESUCCESS' : 'SND_INF_UPGRADEFAIL', [me[0], me[1], me[2]]);
  const id = view.data?.defines.get(fx === 'success' ? 'XI_INT_SUCCESS' : 'XI_INT_FAIL');
  if (id !== undefined) view.playSfx(id, [me[0], me[1], me[2]]);
};
inventory.onPierce = (card, target) => { if (!net.pierce(card, target)) { chat.system(t('Sem conexão com o servidor.')); inventory.cancelPierce(); } };
inventory.onNotice = (text) => chat.system(text);
inventory.onDiscard = (s, n) => { if (!net.invDrop(s, n)) chat.system(t('Sem conexão com o servidor.')); };
const delBox = new DeleteBox(document.body, inventory);
delBox.confirm = (text) => gameConfirm(text, 'Apagar');
delBox.onDelete = (list) => { for (const x of list) if (!net.invDrop(x.s, x.n)) { chat.system(t('Sem conexão com o servidor.')); break; } };
inventory.onSort = () => { if (!net.invSort()) chat.system(t('Sem conexão com o servidor.')); };
net.onPierced = (ok, s) => {
  inventory.pierced(ok, s);
  // deu certo: som e efeito de sucesso no personagem (CItemUpgrade::OnPiercing: SND_INF_UPGRADESUCCESS e XI_INT_SUCCESS)
  const me = view.player?.pos, id = view.data?.defines.get('XI_INT_SUCCESS');
  if (!ok || !me) return;
  audio.play('SND_INF_UPGRADESUCCESS', [me[0], me[1], me[2]]);
  if (id !== undefined) view.playSfx(id, [me[0], me[1], me[2]]);
};
/** modo martelo: efeito XI_INT_INCHANT em volta do personagem enquanto escolhe a suit, como o CWndInventory do Neuz */
function pierceFx() {
  const id = view.data?.defines.get('XI_INT_INCHANT');
  if (id !== undefined) view.playSfxFollow(id, () => { const p = inventory.piercing ? view.player?.pos : null; return p ? [p[0], p[1], p[2]] : null; }, 600);
}

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
  if (combat.attacking || performance.now() - lastBattleAt < 5000) { chat.system(t('Você está em batalha. Afaste-se da luta para poder voar.')); return true; }
  const bag = [...inventory.all.values()].find((i) => i.c === 0 && i.id === id);
  if (!bag || !p.inst) return true;
  const start = [...p.pos];
  const el = document.createElement('div');
  el.className = 'cast-bar';
  el.setAttribute('role', 'progressbar');
  el.setAttribute('aria-label', t('Preparando a montaria'));
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
    const prog = (performance.now() - t0) / RIDE_CAST_MS;
    const moved = Math.hypot(p.pos[0] - start[0], p.pos[2] - start[2]) > 0.3 || Math.abs(p.pos[1] - start[1]) > 0.5;
    if (!p.active || p.dead || moved || performance.now() - lastBattleAt < 5000) { end(); if (moved) chat.system(t('Preparo da montaria cancelado.')); return; }
    fill.style.width = `${Math.min(100, prog * 100)}%`;
    if (prog >= 1) {
      end();
      const now = [...inventory.all.values()].find((i) => i.c === 0 && i.id === id);
      if (now && !net.invUse(0, now.s)) chat.system(t('Sem conexão com o servidor.'));
      return;
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  return true;
}
net.onInvError = (error) => chat.system(error);
net.onInv = (m) => {
  if (m.rar) setRarities(m.rar);
  if (m.stack) setFailStack(m.stack);
  inventory.setState(m.gold, m.bag, m.items, m.defs, m.chips ?? 0);
  mobileUi?.setGold(m.gold);
  smithWnd.refresh();
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
net.onWelcome = (eq, mt) => {
  combatMt = mt; void restyle(eq); void view.player?.setCombat(mt); net.guild('guildInfo');
  const o = optionsWnd.values; // o servidor precisa saber o que este jogador aceita receber
  net.prefs({ trade: o.trade, whisper: o.whisper, friend: o.friend, guild: o.guild, party: o.party });
};
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
net.onLevel = (level) => {
  const ch = characters.find((c) => c.slot === selectedSlot), up = !!ch && level > ch.level;
  if (ch) ch.level = level;
  if (!up) return;
  // subiu de nível (CMover::SetLevel/AddExperience no cliente): a faixa "Level Up!", o pilar de luz e o movimento
  caption.show('Level Up!');
  levelUpFx(net.myId);
  chat.system(t('Parabéns! Você chegou ao nível {level}.', { level }));
};
/** XI_GEN_LEVEL_UP01 (o pilar de luz) no personagem e MTI_LEVELUP se estiver parado */
function levelUpFx(id: number) {
  const p = id === net.myId ? view.player?.pos ?? null : remotes.pos(id);
  if (!p) return;
  view.playSfxFollowOnce(42, () => { const q = id === net.myId ? view.player?.pos ?? null : remotes.pos(id); return q ? [q[0], q[1], q[2]] : null; }, 0, 3); // o pilar de luz acompanha o personagem; as faixas que o arquivo põe a 5 u de altura ficam na linha do chão
  if (id !== net.myId) remotes.cast(id, 'MTI_LEVELUP');
  else if (view.player?.animState === 'stand') view.player.cast('MTI_LEVELUP');
}
net.onLevelUp = (id) => levelUpFx(id);
/** troca o equipamento visível do personagem local (recoloca o nome na instância nova) */
let combatMt = 0, lookNow: string[] = [];
/** você está invisível (modo invisível de GM ou Dark Illusion): seu boneco fica translúcido */
let myInvis = false;
net.onInvis = (on) => { myInvis = on; view.player?.inst?.setGhost(on); gmPanel.setInvis(on); };
net.onGod = (on) => gmPanel.setGod(on);
net.onGmFly = (on) => { if (view.player) view.player.gmFly = on; gmPanel.setFly(on); };

// ---------- dia e noite (shared/gameclock.ts: dia 6h–19h em 21,6 min e noite em 7,2 min reais, igual para todos) ----------
/** diferença entre o relógio do servidor e o deste computador; hora fixada pelo GM (//time) */
let clockOffset = 0, clockFixed: number | null = null;
net.onTeleports = (list) => teleportWnd.set(list);
net.onTower = (list) => towerWnd.set(list);
/** Colosseum (Marcario): janela de entrada, convite da party e letreiro de estágio/tempo */
const coloUi = new ColosseumUi(document.body);
coloUi.onStart = (diff, menu) => { if (!net.colo('start', { diff, menu })) chat.system(t('Sem conexão com o servidor.')); };
coloUi.onJoin = () => { net.colo('join'); };
coloUi.onGo = () => { net.colo('go'); };
net.onColo = (m) => coloUi.handle(m);
const rain = new Rain(view);
net.onWeather = (on) => { if (on !== rain.raining) chat.system(on ? t('Começou a chover.') : t('A chuva parou.')); lastRain = on; rain.set(on && optionsWnd.values.weather); };
net.onQuestDialog = (d) => questDlg.open(d);
net.onQuests = (list) => questLog.set(list);
net.onPet = (a, m) => pets.set(a, m);
net.onPetGo = (a, x, z, ms) => pets.go(a, x, z, ms);
net.onPetFilter = (f, n) => petFilterWnd.set(f, n);
net.onPetFind = (list) => petFilterWnd.found(list);
petFilterWnd.onSave = (f) => { if (!net.petFilter(f)) chat.system(t('Sem conexão com o servidor.')); };
petFilterWnd.onFind = (q) => { net.petFind(q); };
net.onClock = (now, fixed) => { clockOffset = now - Date.now(); clockFixed = fixed; tickClock(); };
/** a cada minuto do jogo (1,2 s) muda a hora do mundo: céu (dia/entardecer/noite), nuvens, sol/lua, luz, névoa e lampiões */
function tickClock() {
  if (!view.data) return;
  const h = clockFixed ?? gameHour(Date.now() + clockOffset);
  const rounded = Math.floor(h * 60) / 60;
  if (rounded === view.settings.hour) return;
  view.settings.hour = rounded;
  view.refreshEnvironment();
}
setInterval(tickClock, 1000);
async function restyle(eq: string[]) {
  lookNow = eq;
  const inst = await view.player?.restyle(eq);
  const ch = characters.find((c) => c.slot === selectedSlot);
  if (inst && ch) { inst.setLabel(ch.name, rankOf(account?.authority), PLAYER_LABEL_LIFT); inst.setGuildTag(myGuild, myGuildMaster); }
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
  else if (e.code === 'KeyU' && !e.repeat) petFilterWnd.toggle(); // filtro do pet coletor
  else if (e.code === 'KeyJ' && !e.repeat) itemTimeWnd.toggle(); // Duração do Item (a troca de classe abre sozinha no nível certo)
  else if (e.code === 'KeyC' && !e.repeat) runActionSlot();
  else if (e.code === 'KeyV' && !e.repeat) teleportWnd.toggle();
  else if (e.code === 'KeyQ' && !e.repeat) { if (!view.player?.gmFly) questLog.toggle(); } // voando (//fly), o Q desce
  else if (e.code === 'KeyO' && !e.repeat) motionWnd.toggle();
  else if (e.code === 'KeyE' && !e.repeat) { if (!view.player?.gmFly) friendsWnd.toggle(); } // voando (//fly), o E sobe
  else if (e.code === 'KeyY' && !e.repeat) wikiWnd.toggle();
  else if (e.code === 'KeyB' && !e.repeat) craftWnd.toggle();
  else if (e.code === 'KeyP' && !e.repeat) partyWnd.toggle();
  else if (e.code === 'KeyG' && !e.repeat) guildWnd.toggle();
  else if (e.code === 'KeyL' && !e.repeat) partyListWnd.toggle();
  else if (e.code === 'KeyN' && !e.repeat) { miniMap.toggle(); navOpen(miniMap.visible); }
  else if (e.code === 'KeyM' && !e.repeat) { if (worldMap.visible) worldMap.hide(); else worldMap.open(); }
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
/** mensagem de status de uma tela: `key` é o texto em português (ver client/lang.ts) e é retraduzida se o idioma mudar com ela na tela */
const message = (el: HTMLElement) => (key: string, error = false, params?: Record<string, string | number>) => { tr(el, key, params); el.classList.toggle('error', error); };
const sayLogin = message($('loginMsg')), saySelect = message($('selectMsg')), sayCreate = message($('createMsg'));

// ---------- preferências locais (contas salvas: nome + token de lembrar do servidor, NUNCA a senha) ----------
/**
 * Conta salva: o nome e, se foi salva com a senha certa, um token de lembrar (POST /gapi/remember) — o duplo clique entra
 * com ele sem digitar a senha. O token vale 30 dias (renovados a cada entrada), some ao apagar a conta salva ou ao trocar a
 * senha; no servidor fica só o hash dele.
 */
interface SavedLogin { name: string; remember?: string }
const prefs = (() => { try { return JSON.parse(localStorage.getItem('flyff.game') ?? '{}') as { saved?: (SavedLogin | string)[]; last?: string; lastAcc?: string; quality?: string; fps?: number }; } catch { return {}; } })();
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
  const txt = p ? t('Voo · {kmh} km/h', { kmh: Math.round(p.flySpeed * 3.6) }) + (p.flyAcc ? t(' · acelerando') : '') + (p.flyTurbo ? ' · TURBO' : '') + '\n' + t('Espaço acelera/para · W/S desce/sobe · A/D vira · X turbo · desequipe a prancha para pousar') : '';
  if (txt === flyText) return;
  flyText = txt;
  flyEl.hidden = !p;
  flyEl.textContent = txt;
}

// ---------- qualidade ----------
/**
 * alta = sombras e resolução da tela (Retina 2×); média = resolução da tela sem sombras; baixa = menos tiles, sem sombra e
 * resolução 1× (ajuda máquinas fracas, ex.: celular/notebook)
 */
function applyQuality(q: string) {
  const low = q === 'low';
  view.radius = low ? 2 : 3;
  view.settings = { ...view.settings, shadows: q === 'high' };
  view.renderer.setPixelRatio(low ? 1 : Math.min(devicePixelRatio, 2));
  view.resize();
  view.invalidate();
}
applyQuality($<HTMLSelectElement>('quality').value);
$('quality').addEventListener('change', () => { prefs.quality = $<HTMLSelectElement>('quality').value; savePrefs(); optionsWnd.values.quality = prefs.quality as Opts['quality']; applyOpts(optionsWnd.values, 'quality'); });
/** limite de FPS (padrão 60: telas de 120 Hz desenhariam o dobro e esquentam notebooks) */
$<HTMLSelectElement>('fps').value = String(prefs.fps ?? 60);
view.maxFps = Number($<HTMLSelectElement>('fps').value) || 0;
$('fps').addEventListener('change', () => { prefs.fps = Number($<HTMLSelectElement>('fps').value) || 0; savePrefs(); optionsWnd.values.fps = prefs.fps; applyOpts(optionsWnd.values, 'fps'); });

// ---------- carregamento do mundo (atrás da tela de login) ----------
const loginBtn = $<HTMLButtonElement>('loginBtn');
loginBtn.disabled = true;
view.onStatus = (s) => { if (!view.data) { sayLogin(s); bootStep(s); } };

/** na seleção/criação o personagem fica parado no palco, de frente, só com a animação de repouso */
let previewing = false;
const PERF = new URLSearchParams(location.search).has('perf');
let perfAcc = 0, perfGap = 0;
view.onFrame = (dt) => {
  // mostra a porta do servidor: cada servidor (ex.: 8080 do painel e 5173 de desenvolvimento) é um mundo separado
  // rodapé: fps, hora do jogo (relógio do servidor, dia e noite), ping, quem está online e a porta do servidor
  $('hud').textContent = inGame
    ? `${view.fps.toFixed(0)} fps · ${fmtGameHour(clockFixed ?? gameHour(Date.now() + clockOffset))} · ping ${net.ping === null ? '—' : Math.round(net.ping) + ' ms'} · ${t('{n} online', { n: net.online })} · ${t('servidor')} :${location.port || (location.protocol === 'https:' ? 443 : 80)}`
    : `${view.fps.toFixed(0)} fps`;
  if (PERF) {
    // ?perf: chamadas de desenho, triângulos e o maior intervalo entre atualizações de posição (média de 1 s)
    perfAcc += dt;
    if (perfAcc >= 1) { perfAcc = 0; perfGap = net.takeStatesGap(); }
    const inf = view.renderer.info.render;
    $('hud').textContent += ` · s3tc ${hasS3tc() ? 'sim' : 'nao'} · maxTex ${view.renderer.capabilities.maxTextureSize} · ${inf.calls} calls · ${(inf.triangles / 1000).toFixed(0)}k tri · states gap ${perfGap} ms · ${remotes.count} jogadores`;
  }
  if (previewing) view.player?.preview(dt, 0);
  if (inGame) {
    remotes.frame(dt);
    view.setEngaged(combat.attacking ? combat.targetInst : null);
    pets.update(dt);
    const p = view.player;
    combat.frame(performance.now());
    ground.frame(performance.now());
    npcFrame(performance.now());
    if (p?.active) net.sendState(p.pos, p.heading, p.animState, performance.now());
    flyHud(p?.flying ? p : null);
    if (miniMap.visible || worldMap.visible) { const mv = mapView(); miniMap.draw(mv); worldMap.draw(mv); }
  }
};
view.start();
/**
 * Janela de opções (menu "Opções"): cada opção chama `applyOpts` — chave nula = aplicar todas (ao iniciar).
 * Qualidade/sombra/resolução ficam juntas em `applyVideo`, porque uma mexe na outra.
 */
const optionsWnd = new OptionsWindow(document.body);
hud.onOptions = () => optionsWnd.toggle();
optionsWnd.values.quality = (prefs.quality as Opts['quality'] | undefined) ?? optionsWnd.values.quality;
optionsWnd.values.fps = prefs.fps ?? optionsWnd.values.fps;
let lastRain = false;
const gammaSvg = (() => {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('width', '0'); svg.setAttribute('height', '0'); svg.style.position = 'absolute';
  svg.innerHTML = '<filter id="opt-gamma" color-interpolation-filters="sRGB"><feComponentTransfer><feFuncR id="og-r" type="gamma" exponent="1"/><feFuncG id="og-g" type="gamma" exponent="1"/><feFuncB id="og-b" type="gamma" exponent="1"/></feComponentTransfer></filter>';
  document.body.append(svg);
  return svg;
})();
function applyVideo(o: Opts) {
  const low = o.quality === 'low';
  view.radius = Math.min([3, 2, 1][o.field], low ? 2 : 3);
  view.settings = { ...view.settings, shadows: o.quality === 'high' && o.shadow < 2 };
  view.setShadow({ ...view.shadowQuality, res: [2048, 1024, 512][o.shadow] });
  view.renderer.setPixelRatio((low || !o.reduceAA ? 1 : Math.min(devicePixelRatio, 2)) * o.resScale);
  view.resize();
  view.invalidate();
}
function applyColor(o: Opts) {
  // Gamma 0.5 = normal; Brightness e Shade (contraste) 0.5 = normal
  const e = Math.pow(2, (0.5 - o.gamma) * 2).toFixed(3);
  for (const id of ['og-r', 'og-g', 'og-b']) gammaSvg.querySelector(`#${id}`)?.setAttribute('exponent', e);
  const normal = o.gamma === 0.5 && o.brightness === 0.5 && o.shade === 0.5;
  view.canvas.style.filter = normal ? '' : `brightness(${(0.6 + o.brightness * 0.8).toFixed(3)}) contrast(${(0.8 + o.shade * 0.4).toFixed(3)}) url(#opt-gamma)`;
}
function applyOpts(o: Opts, key: keyof Opts | null) {
  const all = key === null, is = (...ks: (keyof Opts)[]) => all || (key !== null && ks.includes(key));
  if (is('quality', 'field', 'shadow', 'resScale', 'reduceAA')) {
    if (key === 'quality' || all) { prefs.quality = o.quality; savePrefs(); $<HTMLSelectElement>('quality').value = o.quality; }
    applyVideo(o);
  }
  if (is('fps')) { prefs.fps = o.fps; savePrefs(); $<HTMLSelectElement>('fps').value = String(o.fps); view.maxFps = o.fps; }
  if (is('objRange')) view.moverMgr.radius = [900, 600, 350][o.objRange];
  if (is('objDetail')) { view.detail = view.moverMgr.detail = [1, 0.7, 0.45][o.objDetail]; }
  if (is('itemFx')) MoverInstance.itemFx = o.itemFx;
  if (is('bgFx')) view.layers = { ...view.layers, sfx: o.bgFx > 0.05 };
  if (is('gamma', 'brightness', 'shade')) applyColor(o);
  if (is('expandCam')) { view.camExpand = o.expandCam ? 1.8 : 1; view.applyCamExpand(); }
  if (is('camFix')) view.cameraFix = o.camFix;
  if (is('npcNames')) document.body.classList.toggle('hide-npc-names', !o.npcNames);
  if (is('damage')) combat.showDamage = o.damage;
  if (is('otherNames')) remotes.showNames = o.otherNames;
  if (is('weather')) rain.set(lastRain && o.weather);
  if (is('aniso')) view.setAnisotropy(o.aniso ? 8 : 1);
  if (is('font')) { document.body.classList.toggle('custom-font', !!o.font); document.documentElement.style.setProperty('--game-font', `"${o.font}", Tahoma, Verdana, sans-serif`); }
  if (is('dmgFormat')) combat.spaces = o.dmgFormat === 1;
  if (is('pets')) { pets.mode = o.pets; pets.selfId = () => net.myId; }
  if (is('cursor')) { view.setCursorTheme(o.cursor); setHammerTheme(o.cursor); }
  if (is('hideChat')) document.body.classList.toggle('hide-chatbox', o.hideChat);
  if (is('hideHeal')) combat.showHeal = !o.hideHeal;
  if (is('roundBuffs')) document.body.classList.toggle('round-buffs', o.roundBuffs);
  if (is('autoAttack')) combat.autoAttack = o.autoAttack;
  if (is('hideNpcBubbles')) document.body.classList.toggle('hide-npc-bubbles', o.hideNpcBubbles);
  if (is('msgTime')) chat.timestamps = o.msgTime;
  if (is('translucency')) document.body.classList.toggle('translucent', o.translucency);
  if (is('trade', 'whisper', 'friend', 'guild', 'party')) net.prefs({ trade: o.trade, whisper: o.whisper, friend: o.friend, guild: o.guild, party: o.party });
  if (is('winOpacity')) document.documentElement.style.setProperty('--wnd-alpha', String(o.winOpacity));
  if (is('showFps')) $('hud').style.visibility = o.showFps ? '' : 'hidden';
  if (is('volume', 'mute')) audio.setVolume(o.mute ? 0 : o.volume);
  if (key === 'muteMin') muteHidden();
  // estas só valem quando a pessoa mexe (precisam de clique do usuário ou do personagem carregado)
  if (key === 'windowMode') { if (!o.windowMode) void document.documentElement.requestFullscreen?.().catch(() => {}); else if (document.fullscreenElement) void document.exitFullscreen().catch(() => {}); }
  if (key === 'viewMask') {
    const bit = hideBit(12), cur = inventory.hidden, next = o.viewMask ? cur & ~bit : cur | bit;
    if (next !== cur) { inventory.setHide(next); inventory.onHide(next); }
  }
}
optionsWnd.onChange = applyOpts;
// "Low Render (Minimized)": com a aba escondida desenha só uns quadros por segundo
document.addEventListener('visibilitychange', () => { view.maxFps = optionsWnd.values.lowRender && document.hidden ? 5 : optionsWnd.values.fps; muteHidden(); });
/** "Mute Sound (Minimized)": sem som com a aba escondida */
function muteHidden() { const o = optionsWnd.values; audio.setVolume(o.muteMin && document.hidden ? 0 : o.mute ? 0 : o.volume); }
// "Show My Name": esconde o nome do próprio personagem
setInterval(() => { const l = view.player?.inst?.label; if (l) l.element.style.visibility = optionsWnd.values.myName ? '' : 'hidden'; }, 500);
optionsWnd.applyAll();
// testes: com `?debug` no endereço, o console enxerga o mundo e a rede (window.__flyff)
if (new URLSearchParams(location.search).has('debug')) (window as unknown as Record<string, unknown>).__flyff = { view, net, combat, inventory, pets };

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
    bootEl.bytes.textContent = t('{done} / {files} arquivos · {mb} de {total} MB', { done: Math.min(netStats.done, bootTotal.files), files: bootTotal.files, mb: mb(Math.min(netStats.bytes, bootTotal.bytes || netStats.bytes)), total: mb(bootTotal.bytes) });
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
    ? t('{done} / {files} arquivos · {mb} de {total} MB', { done: bootTotal.files, files: bootTotal.files, mb: mb(bootTotal.bytes), total: mb(bootTotal.bytes) })
    : t('{mb} MB baixados · {done} arquivos (primeiro carregamento: contando o total…)', { mb: mb(netStats.bytes), done: netStats.done });
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
  bootPhase(t('Lendo os dados do jogo…'), 0, 0.35);
  await view.open(WORLD);
  view.lookAt(FLARIS.x, FLARIS.z, 60);
  bootPhase(t('Carregando Flaris…'), 0.35, 0.2);
  await view.loadTile(Math.floor(FLARIS.x / 512), Math.floor(FLARIS.z / 512));
  view.lookAt(FLARIS.x, FLARIS.z, 60);
  view.camera.position.y -= 25; // vista mais baixa, de cena
  view.controls.update();
  // os modelos, texturas e NPCs em volta são pedidos pelos quadros seguintes: espera tudo chegar
  bootPhase(t('Carregando modelos e texturas…'), 0.55, 0.45);
  await networkIdle();
})();
worldReady.then(() => {
  clearInterval(bootTimer);
  // ainda sem total (primeira vez ou dados mudaram): manda a lista ao servidor — ele só aceita do próprio computador dele
  void bootTotalReady.then(() => {
    if (bootTotal) return;
    void fetch(`/gapi/boot-manifest?q=${bootQuality}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ urls: netStats.urls, bytes: netStats.bytes, count: netStats.done }) }).catch(() => {});
  });
  bootStep(t('Pronto!'));
  bootPaint(1);
  setTimeout(() => { bootEl.screen.classList.add('done'); setTimeout(() => { bootEl.screen.hidden = true; }, 700); }, 250);
  sayLogin('Digite sua conta e senha.');
  loginBtn.disabled = false;
  (user.value ? pass : user).focus();
  $('loginScreen').classList.add('live');
  autoStart();
  view.controls.autoRotate = true;
  view.controls.autoRotateSpeed = 0.35;
}, (e) => {
  clearInterval(bootTimer);
  bootStep(t('Erro ao carregar o mundo: {msg}', { msg: (e as Error).message }));
  bootEl.step.style.color = '#ff8a8a';
  sayLogin('Erro ao carregar o mundo: {msg}', true, { msg: (e as Error).message });
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

/** início automático em andamento: depois do login, entra direto com o último personagem jogado */
let autoEnter = false;
/**
 * Ao abrir o jogo: entra sozinho na última conta usada (com "token de lembrar" salvo) e no último personagem jogado. Esc, clique
 * ou qualquer tecla na tela de login durante os 2 segundos de contagem cancela. Só roda uma vez (Desconectar volta ao login normal).
 */
function autoStart() {
  const withToken = saved.filter((s) => s.remember);
  const target = withToken.find((s) => s.name.toLowerCase() === (prefs.lastAcc ?? prefs.last ?? '').toLowerCase()) ?? withToken[0];
  if (!target) return;
  let cancelled = false;
  const stop = () => { if (cancelled) return; cancelled = true; sayLogin('Entrada automática cancelada.'); };
  const events = ['keydown', 'pointerdown'] as const;
  const off = () => events.forEach((e) => removeEventListener(e, stop, true));
  events.forEach((e) => addEventListener(e, stop, true));
  sayLogin('Entrando como {name}… (Esc ou clique cancela)', false, { name: target.name });
  setTimeout(() => {
    off();
    if (cancelled) return;
    autoEnter = true;
    void useSaved(target.name).then(() => { autoEnter = false; });
  }, 2000);
}

/** entra com senha ou com o token de uma conta salva; devolve se deu certo */
async function doLogin(cred: { username: string; password?: string; remember?: string }): Promise<boolean> {
  loginBtn.disabled = true;
  sayLogin('Conectando…');
  try {
    const reply = await api<LoginReply>('/gapi/login', { method: 'POST', body: JSON.stringify(cred) });
    pass.value = '';
    const keep = $<HTMLInputElement>('saveAccount').checked;
    prefs.last = keep ? reply.account.username : undefined;
    prefs.lastAcc = reply.account.username; // a conta do início automático
    savePrefs();
    // "Salvar conta" marcado ao entrar com a senha: guarda já com o token (próxima vez é só dar dois cliques)
    if (keep && cred.password) await rememberLogin(reply.account.username, reply.token);
    token = reply.token; account = reply.account; characters = reply.characters;
    setTipStaff(!!rankOf(account?.authority)); // só GM/admin veem o ID do item na dica
    view.staffLabels = !!rankOf(account?.authority); // e o ID/nível dos monstros
    try { sessionStorage.setItem('flyff.token', token); } catch { /* sem armazenamento */ }
    await worldReady;
    sayLogin('Carregando personagens…');
    // os bonecos dos 3 quadros carregam ANTES de trocar de tela (com limite de tempo): a seleção já abre com todos preenchidos
    await Promise.race([preloadSlotPreviews(), new Promise((r) => setTimeout(r, 8000))]);
    $('loginScreen').classList.add('leaving');
    setTimeout(() => { $('loginScreen').hidden = true; }, 450);
    $('charScreen').hidden = false;
    if (characters.length) {
      // início automático: escolhe o último personagem jogado nesta conta e já entra
      if (autoEnter) {
        let last = 0;
        try { last = Number(localStorage.getItem(`flyff.lastchar.${reply.account.username.toLowerCase()}`)) || 0; } catch { /* sem armazenamento */ }
        const ch = characters.find((c) => c.id === last);
        if (ch) selectedSlot = ch.slot;
      }
      showSelect();
      if (autoEnter) { autoEnter = false; if (characters.some((c) => c.slot === selectedSlot)) void enter(); }
    } else showCreate(false);
    return true;
  } catch (e) {
    sayLogin((e as Error).message, true);
    pass.select();
    return false;
  } finally { loginBtn.disabled = false; }
}

// ---------- personagens em 3D nas janelas ----------
/** quadros da seleção e boneco da criação: um renderizador só para todos (client/charpreview.ts); o mundo continua girando atrás */
const stage = new CharStage(view);
const cardViews = [0, 1, 2].map((i) => stage.view(`Personagem da vaga ${i + 1}`));
const createView = stage.view('Novo personagem (arraste para girar)');
$('createModel').appendChild(createView.canvas);
/** encolhe as janelas (604×388 / 544×380) para caber em telas pequenas */
function fitCharScreen() { $('charScreen').style.setProperty('--cs', String(Math.max(0.45, Math.min(1, (innerWidth - 16) / 610, (innerHeight - 70) / 400)))); }
addEventListener('resize', fitCharScreen);
void themeImage('WndSelectChar.tga').then((u) => { if (u) $('charSelect').style.backgroundImage = `url(${u})`; });
void themeImage('WndColor.tga').then((u) => { if (u) $('hairColor').style.backgroundImage = `url(${u})`; });
void themeImage('yellowbuttten.tga').then((u) => { if (u) $('hairColor').style.setProperty('--knob', `url(${u})`); });
void themeTiles([3, 4, 5, 6, 7, 8, 9, 10, 11].map((i) => `WndTile${String(i).padStart(2, '0')}.tga`), 3, 3).then((t) => { if (t) $('charCreate').style.borderImageSource = `url(${t.url})`; });

// ---------- seleção ----------
/** partes escondidas nas caixinhas do inventário (guardadas por personagem neste navegador) */
function hideMaskOf(charId: number) { try { return Number(localStorage.getItem(`flyff.hide.${charId}`)) || 0; } catch { return 0; } }
let selectedSlot: number | null = null;
function showSelect() {
  $('charCreate').hidden = true;
  $('charDelete').hidden = true;
  $('charSelect').hidden = false;
  // o vão escolhido pode ser um vazio (habilita Criar); sem escolha, o primeiro personagem (ou o 1º vão, conta sem personagem)
  if (selectedSlot === null || selectedSlot < 0 || selectedSlot > 2) selectedSlot = characters[0]?.slot ?? 0;
  renderSlots();
  saySelect(characters.length ? 'Escolha o personagem e clique em Entrar.' : '');
  // Criar só com um vão vazio escolhido; Entrar e Apagar só com um personagem escolhido
  const hasChar = characters.some((c) => c.slot === selectedSlot);
  $<HTMLButtonElement>('newCharBtn').disabled = hasChar || characters.length >= 3;
  $<HTMLButtonElement>('enterBtn').disabled = !hasChar;
  $<HTMLButtonElement>('deleteCharBtn').disabled = !hasChar;
  fitCharScreen();
  stage.start();
  view.labelRenderer.domElement.hidden = true; // nomes de NPC não passam por cima das janelas
}
/**
 * Os 3 quadros (WIDC_CUSTOM1–3 em x 46/218/390) e os nomes embaixo (WIDC_ST_CHARNAME01–03): o escolhido anima e fica com o
 * nome em azul, os outros parados e em cinza; vaga vazia mostra "- Vazio -".
 */
/** o visual de um personagem para o quadro da seleção */
const slotLook = (ch: (typeof characters)[number]) => ({ sex: ch.sex, hair: ch.hairMesh, head: ch.headMesh, hairColor: ch.hairColor ?? 0, equip: lookList(ch.equip ?? [], hideMaskOf(ch.id)), mt: ch.mt });
/** monta de antemão os bonecos dos quadros (pose e visual iguais aos de renderSlots, que depois só reaproveita) */
async function preloadSlotPreviews() {
  if (selectedSlot === null || selectedSlot < 0 || selectedSlot > 2) selectedSlot = characters[0]?.slot ?? 0;
  await Promise.all(characters.map((ch) => { const v = cardViews[ch.slot]; if (!v) return null; v.setPose(ch.slot === selectedSlot ? 'battle' : 'normal'); return v.set(slotLook(ch)).catch(() => {}); }));
}
function renderSlots() {
  $('slotList').replaceChildren(...[0, 1, 2].flatMap((slot) => {
    const ch = characters.find((c) => c.slot === slot);
    const on = !!ch && slot === selectedSlot;
    const sel = slot === selectedSlot; // o quadro escolhido (com personagem ou vazio) pisca em verde
    const card = document.createElement('div');
    card.className = 'card';
    card.style.left = `${48 + 172 * slot}px`;
    const name = document.createElement('div');
    name.className = 'cname';
    name.style.left = `${46 + 172 * slot}px`;
    const v = cardViews[slot];
    if (ch) {
      card.setAttribute('role', 'option');
      card.setAttribute('aria-selected', String(on));
      card.setAttribute('aria-label', t('{name}, nível {level}', { name: ch.name, level: ch.level }));
      card.tabIndex = 0;
      card.appendChild(v.canvas);
      v.setPose(on ? 'battle' : 'normal'); // não escolhido: em pé normal; escolhido: modo de batalha
      void v.set(slotLook(ch));
      name.textContent = ch.name;
      const small = document.createElement('small');
      small.textContent = t('Nv {level}', { level: ch.level });
      name.appendChild(small);
      name.classList.toggle('on', on);
      const pick = () => { if (selectedSlot !== slot) { selectedSlot = slot; showSelect(); } };
      card.addEventListener('click', pick);
      card.addEventListener('dblclick', () => void enter());
      card.addEventListener('keydown', (e) => { if (e.key === 'Enter') void enter(); else if (e.key === ' ') { e.preventDefault(); pick(); } });
    } else {
      card.classList.add('empty');
      name.classList.add('empty');
      name.textContent = t('- Vazio -');
      void v.set(null);
      card.setAttribute('aria-selected', String(sel));
      card.setAttribute('aria-label', t('Vaga vazia'));
      card.tabIndex = 0;
      const pickEmpty = () => { if (selectedSlot !== slot) { selectedSlot = slot; showSelect(); } };
      card.addEventListener('click', pickEmpty);
      card.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pickEmpty(); } });
    }
    return [card, name];
  }));
  (document.querySelector<HTMLElement>('.card[aria-selected="true"]'))?.focus({ preventScroll: true });
}
$('newCharBtn').addEventListener('click', () => showCreate(true));
$('enterBtn').addEventListener('click', () => void enter());
$('logoutBtn').addEventListener('click', () => void backToLogin());

// ---------- apagar (CWndDeleteChar: pede a senha da conta) ----------
$('deleteCharBtn').addEventListener('click', () => {
  const ch = characters.find((c) => c.slot === selectedSlot);
  if (!ch) return;
  $('deleteQ').textContent = t('Apagar {name} (Nv {level})? Não tem como desfazer.', { name: ch.name, level: ch.level });
  $<HTMLInputElement>('deletePass').value = '';
  $('charDelete').hidden = false;
  $('deletePass').focus();
});
$('deleteCancel').addEventListener('click', () => { $('charDelete').hidden = true; });
$('charDelete').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const ch = characters.find((c) => c.slot === selectedSlot);
  const password = $<HTMLInputElement>('deletePass').value;
  if (!ch || !password) return;
  const btn = $<HTMLButtonElement>('deleteOk');
  btn.disabled = true;
  try {
    const r = await api<{ characters: CharacterInfo[] }>(`/gapi/characters/${ch.id}`, { method: 'DELETE', body: JSON.stringify({ password }) });
    characters = r.characters;
    selectedSlot = null;
    showSelect();
    saySelect('{name} foi apagado.', false, { name: ch.name });
  } catch (e) {
    saySelect((e as Error).message, true);
    $<HTMLInputElement>('deletePass').select();
  } finally { btn.disabled = false; $<HTMLInputElement>('deletePass').value = ''; }
});

/** Encerra a sessão no servidor e volta à tela de login (botão Voltar da seleção e "Desconectar" do menu do jogo). */
async function backToLogin() {
  // sai do mundo primeiro (o servidor salva a posição ao fechar o WebSocket), depois encerra a sessão
  logout.cancel();
  inGame = false;
  document.body.classList.remove('ingame');
  net.close();
  try { await api('/gapi/logout', { method: 'POST' }); } catch { /* sessão já expirada */ }
  token = ''; account = null; characters = []; selectedSlot = null; previewing = false;
  setTipStaff(false);
  view.staffLabels = false;
  stage.stop();
  view.controls.enabled = true;
  try { sessionStorage.removeItem('flyff.token'); } catch { /* sem armazenamento */ }
  view.playerControl = false;
  view.selectTarget(null);
  view.player?.remove();
  view.labelRenderer.domElement.hidden = false;
  hud.hide();
  coloUi.stop();
  inventory.hide(); inventory.clear(); delBox.hide(); actionBar.hide(); chat.hide(); chat.clear(); gmPanel.hide(); charWnd.hide(); miniMap.hide(); worldMap.hide(); smithWnd.hide(); shopWnd.hide(); skillWnd.hide(); teleportWnd.hide(); towerWnd.hide(); questDlg.hide(); questLog.hide(); jobWnd.setOptions([]); buffBar.clear(); partyBuffs.set(null);
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

// ---------- criação (CWndCreateChar) ----------
/** roupa de Vagrant mostrada no boneco da criação (jobItem.inc, JOB_VAGRANT) */
const CREATE_LOOK: Record<number, string[]> = {
  0: ['II_ARM_M_VAG_SUIT01', 'II_ARM_M_VAG_GAUNTLET01', 'II_ARM_M_VAG_BOOTS01'],
  1: ['II_ARM_F_VAG_SUIT01', 'II_ARM_F_VAG_GAUNTLET01', 'II_ARM_F_VAG_BOOTS01'],
};
/** cabelo e rosto 1…5, cor do cabelo RGB 0–255 (__NEW_COLOR_CHANGE: começa na cor padrão do cabelo sorteado) */
const draft = { sex: 0, hair: 1, head: 1, color: [144, 99, 101] };
const draftColor = () => hairColorOf(draft.color[0] / 255, draft.color[1] / 255, draft.color[2] / 255);
const colorInputs = [...document.querySelectorAll<HTMLInputElement>('#hairColor input')];
function renderCreate() {
  $('hairVal').textContent = String(draft.hair);
  $('headVal').textContent = String(draft.head);
  $('maleBtn').setAttribute('aria-pressed', String(draft.sex === 0));
  $('femaleBtn').setAttribute('aria-pressed', String(draft.sex === 1));
  colorInputs.forEach((el, i) => { el.value = String(draft.color[i]); });
}
let previewTimer = 0;
function previewDraft(now = false) {
  clearTimeout(previewTimer);
  const go = () => void createView.set({ sex: draft.sex, hair: draft.hair, head: draft.head, hairColor: draftColor(), equip: CREATE_LOOK[draft.sex] });
  if (now) go(); else previewTimer = window.setTimeout(go, 100); // cliques rápidos: só a última aparência
}
document.querySelectorAll<HTMLButtonElement>('#charCreate button[data-key]').forEach((b) => b.addEventListener('click', () => {
  const k = b.dataset.key as 'hair' | 'head', max = LIMITS[k];
  draft[k] = ((draft[k] - 1 + Number(b.dataset.step) + max) % max) + 1;
  renderCreate();
  previewDraft();
}));
for (const [id, sex] of [['maleBtn', 0], ['femaleBtn', 1]] as const) {
  $(id).addEventListener('click', () => { if (draft.sex === sex) return; draft.sex = sex; renderCreate(); previewDraft(); });
}
colorInputs.forEach((el, i) => el.addEventListener('input', () => { draft.color[i] = Number(el.value); createView.setHairColor(draftColor()); }));
function showCreate(canGoBack: boolean) {
  $('charSelect').hidden = true;
  $('charDelete').hidden = true;
  $('charCreate').hidden = false;
  $<HTMLButtonElement>('createBackBtn').disabled = !canGoBack && !characters.length;
  // como o original: cabelo e rosto sorteados, cor = a padrão desse cabelo
  const hair = 1 + Math.floor(Math.random() * LIMITS.hair), head = 1 + Math.floor(Math.random() * LIMITS.head);
  Object.assign(draft, { sex: 0, hair, head, color: hairRgb(0, 'male', hair).map((v) => Math.round(v * 255)) });
  $<HTMLInputElement>('newName').value = '';
  renderCreate();
  saySelect('');
  sayCreate(characters.length ? '' : 'Sua conta ainda não tem personagem. Crie o primeiro!');
  createView.resetRotation();
  previewDraft(true);
  fitCharScreen();
  stage.start();
  view.labelRenderer.domElement.hidden = true;
  $('newName').focus();
}
$('createBackBtn').addEventListener('click', () => { if (characters.length) showSelect(); });
$('charCreate').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const name = $<HTMLInputElement>('newName').value.trim();
  if (!/^[A-Za-z0-9]{2,16}$/.test(name)) { sayCreate('Nome: 2 a 16 letras ou números, sem espaços.', true); $('newName').focus(); return; }
  const btn = $<HTMLButtonElement>('createBtn');
  btn.disabled = true;
  sayCreate('Criando…');
  try {
    const r = await api<{ character: CharacterInfo; characters: CharacterInfo[] }>('/gapi/characters', { method: 'POST', body: JSON.stringify({ name, sex: draft.sex, hair: draft.hair, head: draft.head, hairColor: draftColor(), slot: selectedSlot }) });
    characters = r.characters;
    selectedSlot = r.character.slot;
    showSelect();
    saySelect('{name} criado! Clique em Entrar.', false, { name: r.character.name });
  } catch (e) {
    sayCreate((e as Error).message, true);
  } finally { btn.disabled = false; }
});

// ---------- entrar no mundo ----------
async function enter() {
  const ch = characters.find((c) => c.slot === selectedSlot);
  if (!ch || !account) return;
  try { localStorage.setItem(`flyff.lastchar.${account.username.toLowerCase()}`, String(ch.id)); } catch { /* sem armazenamento */ }
  $<HTMLButtonElement>('enterBtn').disabled = true;
  saySelect('Entrando como {name}…', false, { name: ch.name });
  previewing = false;
  stage.stop();
  view.controls.enabled = true; // no jogo a câmera volta a girar/dar zoom
  view.controls.autoRotate = false;
  // posição salva só vale no mundo 1 (WdMadrigal) e dentro do mapa; a altura vem do chão
  const savedWorld = WORLD_BY_ID[ch.worldId] ?? ch.worldName ?? WORLD;
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
  await view.spawnPlayer(x, z, inMap ? ch.pos[1] : 100, sex, { hair: ch.hairMesh, head: ch.headMesh, hairColor: ch.hairColor ?? 0, equip }, inMap);
  if (view.player) view.player.runSpeed = moveSpeed;
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
  friendsWnd.setSelf(ch.name, ch.job ?? 0);
  view.player?.inst?.setGuildTag(myGuild, myGuildMaster);
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
  chat.system(t('Bem-vindo, {name}! Enter para conversar · I abre o inventário.', { name: ch.name }));
  // retrato: renderiza o rosto uma vez, depois que o personagem já foi posado na tela
  requestAnimationFrame(() => requestAnimationFrame(() => hud.setPortrait(view.portrait())));
  // multiplayer: entra no mundo compartilhado com este personagem
  inGame = true;
  document.body.classList.add('ingame');
  if (navOpen()) miniMap.show();
  void motionWnd.loadTables(); // comandos de emoticon no chat
  net.connect(token, ch.id, () => view.player?.pos ?? [x, 100, z]);
}
