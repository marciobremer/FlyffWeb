import { PLAYER_LABEL_LIFT } from '../shared/rank';
import { Matrix4, Mesh, type Object3D } from 'three';
import type { WorldView } from '../shared/world';
import { MoverInstance, preloadMotions } from '../shared/movers';
import { loadHumanTemplate } from '../shared/humans';
import { applyEnchantGlow } from '../shared/enchantGlow';
import { attachRide, flyMotion, rideOf } from '../shared/ride';
import { objectMatrix } from '../shared/math';
import { OT, type WorldObject } from '../shared/formats/types';
import { motionOf, motionsFor } from '../shared/motions';
import type { GroundRow } from './ground';

/**
 * Multiplayer (fase 2): conexão WebSocket com `/ws` (protocolo em server/realtime.ts) e os outros jogadores no mundo.
 * O próprio jogador manda posição/rumo/estado no máximo 10×/s e só quando muda; os remotos chegam 10×/s e são suavizados
 * a cada quadro (interpolação exponencial da posição e do rumo), com as mesmas animações do jogador local.
 */
export interface PlayerView { /** nome da guild */ guild?: string; id: number; name: string; sex: number; hair: number; head: number; level: number; p: [number, number, number]; h: number; s: string; /** símbolos II_* equipados */ eq?: string[]; /** postura de combate 1–15 (0 = normal) */ mt?: number; /** 'admin' ou 'gm' (cor do nome) */ rank?: string; /** GM invisível (só GMs recebem): translúcido */ iv?: 1 }

/** seus atributos (server/realtime.ts statsMsg) */
export interface PlayerStats {
  hp: number; maxHp: number; mp: number; maxMp: number; fp: number; maxFp: number; exp: number; expMax: number; level: number; atkMs: number; /** velocidade de ataque (multiplicador da animação de golpe) */ aspd?: number; atk: [number, number];
  /** alcance do golpe normal com a arma equipada (2 corpo a corpo; arco/ioiô mais) */
  range?: number;
  def: number; crit: number; str: number; sta: number; dex: number; int: number; points: number; job: number;
  /** bônus de atributo vindo dos equipamentos, precisão extra, esquiva e velocidade de ataque (%) */
  bonus: { str: number; sta: number; dex: number; int: number }; acc: number; dodge: number; spd: number;
  /** classes que dá para escolher agora (nível 15 / 60) */
  jobOpts: number[];
}

/** item como o servidor descreve (server/items.ts ItemCatalog.view) */
/** efeitos de uma skill (ids XI_*, -1 = nenhum): c ao lançar, p projétil, h no alvo, s no lançador, b que dura (buff) por `dur` s */
export interface SkillFx { c: number; h: number; s: number; p?: number; b?: number; dur?: number; mo?: string; sn?: number; sh?: number }

export interface ItemView {
  /** raridade (dwItemGrade): 100 comum, 200 unique, 300 ultimate, 400 baruna */
  gr?: number;
  id: number; sym: string; name: string; icon: string; pack: number; parts: number; sex: number; lv: number; cost?: number;
  /** tipo (IK1/IK2/IK3), ataque/defesa mín–máx, velocidade da arma, raridade, tipo de arma e efeitos [DST, valor][] */
  k1?: number; k2?: number; k3?: number; amin?: number; amax?: number; aspd?: number; rare?: number; wt?: number; fx?: [number, number][];
  /** prancha/vassoura: velocidade, giro lateral e vertical (fFlightSpeed, fFlightLRAngle, fFlightTBAngle) */
  fly?: [number, number, number];
  /** classe exigida (JOB_*, -1/0 = qualquer) e 1/2 mãos */
  job?: number; hand?: number;
  /** conjunto: nome, total de peças e bônus [peças, DST, valor][] (vale com aquela quantidade ou mais equipada) */
  set?: { name: string; pieces: number; avail: [number, number, number][] };
}
/** inventário inteiro (server/inventory.ts Inventory.view): itens [container, slot, itemId, quantidade] */
export interface InvMessage { gold: number; bag: number; items: [number, number, number, number, number?, number?, number?, number[]?, number?][]; defs: Record<number, ItemView> }


interface Remote { view: PlayerView; inst: MoverInstance | null; target: [number, number, number]; cur: [number, number, number]; h: number; curH: number; s: string; gone: boolean; /** último golpe tocado (MTI_ATK1/2 alternando) */ hit?: number }

export class RemotePlayers {
  private list = new Map<number, Remote>();
  constructor(private world: WorldView) {}

  get count() { return this.list.size; }

  add(v: PlayerView) {
    this.remove(v.id);
    const r: Remote = { view: v, inst: null, target: [...v.p], cur: [...v.p], h: v.h, curH: v.h, s: v.s, gone: false };
    this.list.set(v.id, r);
    void this.load(r);
  }

  private async load(r: Remote) {
    const d = this.world.data;
    if (!d) return;
    const sex = r.view.sex === 1 ? 'female' : 'male';
    const miId = d.defines.get(sex === 'male' ? 'MI_MALE' : 'MI_FEMALE');
    const entry = miId === undefined ? undefined : d.dynaModels.get(`${OT.MOVER}:${miId}`);
    if (!entry || miId === undefined) return;
    const tpl = await loadHumanTemplate(entry, { sex, hair: r.view.hair || 1, head: r.view.head || 1, equip: r.view.eq ?? [] }, d, this.world.lib);
    if (!tpl || r.gone) return;
    await preloadMotions(tpl, motionsFor(r.view.mt ?? 0));
    if (r.gone) return;
    const source: WorldObject = { type: OT.MOVER, modelId: miId, pos: [...r.cur], rot: [0, r.curH, 0], scale: [1, 1, 1], motion: 0, ai: 0, ai2: 0, name: r.view.name };
    const inst = new MoverInstance(tpl, source, objectMatrix(source, new Matrix4()));
    inst.owner = 'players';
    inst.blendTime = 0.1;
    applyEnchantGlow(inst, r.view.eq ?? [], sex, d, false);
    inst.setLabel(r.view.name, r.view.rank, PLAYER_LABEL_LIFT);
    inst.setGuildTag(r.view.guild);
    if (this.partyIds.has(r.view.id)) inst.label?.element.classList.add('party');
    if (r.view.iv) inst.setGhost(true); // GM invisível (só GMs recebem)
    inst.play(...motionOf(r.s, r.view.mt ?? 0));
    this.world.playerGroup.add(inst.group);
    this.world.attachSetSfx(inst, r.view.eq ?? []);
    void attachRide(inst, rideOf(d, r.view.eq ?? []), this.world.lib);
    if (r.s.startsWith('fly')) inst.play(this.motionFor(r));
    r.inst = inst;
  }

  /** trocou o equipamento: remonta o modelo na posição atual */
  look(id: number, eq: string[], mt = 0) {
    const r = this.list.get(id);
    if (!r) return;
    this.add({ ...r.view, eq, mt, p: [...r.cur], h: r.curH, s: r.s });
    const n = this.list.get(id)!;
    n.target = r.target; n.h = r.h;
  }

  update(id: number, x: number, y: number, z: number, h: number, s: string) {
    const r = this.list.get(id);
    if (!r) return;
    r.target = [x, y, z];
    r.h = h;
    if (s !== r.s) {
      r.s = s;
      if (s.startsWith('fly')) r.inst?.play(this.motionFor(r));
      // o emote chega à parte (mensagem 'emote'); o golpe toca a cada 'hit' (swing), não só quando o estado muda
      else if (s !== 'emote' && s !== 'atk') r.inst?.play(...motionOf(s, r.view.mt ?? 0));
    }
  }

  remove(id: number) {
    const r = this.list.get(id);
    if (!r) return;
    r.gone = true;
    r.inst?.dispose();
    this.list.delete(id);
  }

  clear() { for (const id of [...this.list.keys()]) this.remove(id); }

  /** GM ficou invisível / visível (só chega a quem é GM/admin): fica translúcido */
  setInvis(id: number, on: boolean) {
    const r = this.list.get(id);
    if (!r) return;
    if (on) r.view.iv = 1; else delete r.view.iv;
    r.inst?.setGhost(on);
  }

  /** golpe normal de outro jogador (cada 'hit' do servidor): toca MTI_ATK1/2 alternando, uma vez */
  swing(id: number) {
    const r = this.list.get(id);
    if (!r?.inst || r.s === 'dead' || r.s.startsWith('fly')) return;
    r.hit = ((r.hit ?? 0) % 2) + 1;
    r.inst.play(motionOf('atk', r.view.mt ?? 0, r.hit)[0], false);
  }

  /** outro jogador lança uma skill: toca o movimento (CASTING01, depois 02) e volta ao estado dele */
  cast(id: number, motion: string) {
    const r = this.list.get(id);
    if (!r?.inst || !motion) return;
    const inst = r.inst;
    inst.play(motion, false);
    const next = /01$/.test(motion) ? motion.replace(/01$/, '02') : null;
    if (next) setTimeout(() => { if (r.inst === inst && !r.gone) inst.play(next, false); }, 700);
    setTimeout(() => { if (r.inst === inst && !r.gone) inst.play(...motionOf(r.s, r.view.mt ?? 0)); }, 1500);
  }

  /** jogador sob o ponto de tela (malha atingida; senão o mais perto a até 30 px da altura do peito) */
  at(ev: { clientX: number; clientY: number }): { id: number; name: string; inst: MoverInstance } | null {
    const all = [...this.list.entries()].filter(([, r]) => r.inst?.group.parent);
    const meshes: Object3D[] = [];
    for (const [, r] of all) r.inst!.group.traverse((o) => { if (o instanceof Mesh && o.visible) meshes.push(o); });
    const hit = this.world.raycast(ev, meshes)[0];
    let best: [number, Remote] | null = null, bestD = 30;
    for (const e of all) {
      for (let o: Object3D | null = hit ?? null; o; o = o.parent) if (o === e[1].inst!.group) return { id: e[0], name: e[1].view.name, inst: e[1].inst! };
      const at = this.world.screenOf(e[1].inst!);
      const d = at ? Math.hypot(at[0] - ev.clientX, at[1] - ev.clientY) : Infinity;
      if (d < bestD) { bestD = d; best = e; }
    }
    return best ? { id: best[0], name: best[1].view.name, inst: best[1].inst! } : null;
  }

  /** movimento da janela de movimentos (0 uma vez, 1 fica na pose final, 2 repete); andar troca o estado e encerra */
  emote(id: number, motion: string, mode: number) {
    const r = this.list.get(id);
    if (!r?.inst) return;
    r.s = 'emote';
    r.inst.restart(motion, mode === 2);
  }
  /** movimento de voo do remoto (conjunto do item de voo do visual: vassoura, prancha, bike, asas) */
  private motionFor(r: Remote) {
    const d = this.world.data, ride = d ? rideOf(d, r.view.eq ?? []) : null;
    return flyMotion(ride?.set ?? 'B', r.s === 'flyrun' ? 'run' : 'idle');
  }

  /** id do jogador de uma instância (null se não é jogador remoto) e se está morto */
  idOf(inst: MoverInstance) { for (const [id, r] of this.list) if (r.inst === inst) return id; return null; }
  isDead(id: number) { return this.list.get(id)?.s === 'dead'; }
  /** revivido por Resurrection: levanta (MTI_GETUP) e volta ao estado dele */
  getup(id: number) {
    const r = this.list.get(id);
    if (!r?.inst) return;
    const inst = r.inst;
    r.s = 'stand';
    inst.restart('MTI_GETUP', false);
    setTimeout(() => { if (r.inst === inst && !r.gone && r.s === 'stand') inst.play(...motionOf('stand', r.view.mt ?? 0)); }, 1600);
  }

  /** instância 3D de um jogador remoto */
  instOf(id: number) { return this.list.get(id)?.inst ?? null; }

  /** a guild de um jogador mudou: nome da guild acima do nome dele */
  guildTag(id: number, g: string | null) {
    const r = this.list.get(id);
    if (!r) return;
    if (g) r.view.guild = g; else delete r.view.guild;
    r.inst?.setGuildTag(g);
  }

  /** membros da sua party: o nome deles fica verde */
  private partyIds = new Set<number>();
  setParty(ids: Set<number>) {
    this.partyIds = ids;
    for (const [id, r] of this.list) r.inst?.label?.element.classList.toggle('party', ids.has(id));
  }

  /** postura de combate (13 = arco, 15 = besta…) */
  stance(id: number) { return this.list.get(id)?.view.mt ?? 0; }

  /** balão de fala acima da cabeça (chat) */
  say(id: number, text: string) { this.list.get(id)?.inst?.say(text); }

  /** posição atual (suavizada) de um jogador remoto */
  pos(id: number): [number, number, number] | null { const r = this.list.get(id); return r ? [...r.cur] : null; }

  /** a cada quadro: aproxima posição/rumo do último recebido (meia-vida ~60 ms) e anima */
  frame(dt: number) {
    const k = 1 - Math.exp(-dt * 12);
    for (const r of this.list.values()) {
      const [tx, ty, tz] = r.target, c = r.cur;
      if (Math.hypot(tx - c[0], tz - c[2]) > 40) { c[0] = tx; c[1] = ty; c[2] = tz; } // teleporte / reconexão
      else { c[0] += (tx - c[0]) * k; c[1] += (ty - c[1]) * k; c[2] += (tz - c[2]) * k; }
      const dh = ((r.h - r.curH + 540) % 360) - 180; // menor ângulo
      r.curH = (r.curH + dh * k + 360) % 360;
      if (r.inst) { r.inst.place([c[0], c[1], c[2]], r.curH); r.inst.update(dt); }
    }
  }
}

export class NetClient {
  private ws: WebSocket | null = null;
  private last = '';
  private lastSent = 0;
  private retry = 0;
  private closing = false;
  private join: { token: string; characterId: number; pos: () => [number, number, number] } | null = null;
  myId = 0;
  online = 0;
  onStatus: (text: string, error?: boolean) => void = () => {};
  /** mobs do servidor perto do jogador: entraram, mudaram, saíram (ver protocolo em server/realtime.ts) */
  onMobs: (add: [number, number, number, number, number, string, number | null, number?][], upd: [number, number, number, number, string, number?][], del: number[]) => void = () => {};
  /** combate: golpe (k 'p' jogador→mob, 'm' mob→jogador), mob morreu, jogador morreu, seus atributos */
  /** `fx` = efeitos da skill usada (ids XI_*): c ao lançar, h no alvo, s no lançador */
  onHit: (k: 'p' | 'm', a: number, d: number, dmg: number, flags: number, hp: number, fx?: SkillFx, sn?: [number, number]) => void = () => {};
  onMobDie: (id: number, killer: number) => void = () => {};
  onPlayerDie: (id: number) => void = () => {};
  onStats: (s: PlayerStats) => void = () => {};
  /** suas skills (pontos, níveis, lista da classe) e skill lançada (espera) */
  onSkills: (points: number, levels: Record<string, number>, list: import('./skillwnd').SkillView[]) => void = () => {};
  onSkillUsed: (id: number, cd: number) => void = () => {};
  onBuffs: (list: import('./buffbar').BuffView[]) => void = () => {};
  /** efeitos de skill de buff/cura (quem lançou e os ids XI_*) */
  onSkillFx: (a: number, fx: SkillFx) => void = () => {};
  /** loja do NPC aberta pelo servidor */
  onShop: (s: import('./shop').ShopView) => void = () => {};
  /** você foi revivido no lugar (Resurrection de um Assist) */
  onGetUp: () => void = () => {};
  /** sua Dark Illusion de GM ligou/desligou */
  onInvis: (on: boolean) => void = () => {};
  /** o servidor mandou trocar de mundo (ticket de Azria, teleporte para outro mapa) */
  onChangeWorld: (w: string, p: [number, number, number]) => void = () => {};
  /** guild: sua guild (null = sem guild), convite recebido, o nome da sua guild mudou */
  onGuildView: (g: import('./guild').GuildView | null) => void = () => {};
  onGuildReq: (id: number, name: string, guild: string) => void = () => {};
  onMyGuildTag: (g: string | null) => void = () => {};
  /** party: sua party (null = sem party), convite recebido, lista de partys */
  onParty: (p: import('./party').PartyView | null) => void = () => {};
  onPartyReq: (id: number, name: string) => void = () => {};
  onPartyList: (list: import('./party').PartyListRow[]) => void = () => {};
  /** Mensageiro: lista de amigos (ao entrar), amigo entrou/saiu, pedido recebido, amizade feita/desfeita, mensagem privada */
  onFriends: (list: import('./friends').FriendView[]) => void = () => {};
  onFriendOn: (id: number, on: boolean) => void = () => {};
  onFriendReq: (id: number, name: string) => void = () => {};
  onFriendNew: (f: import('./friends').FriendView) => void = () => {};
  onFriendDel: (id: number) => void = () => {};
  onPm: (withId: number, withName: string, from: number, name: string, text: string) => void = () => {};
  /** alguém perto fez um movimento / mandou um emoticon (janela de movimentos) */
  onEmote: (id: number, motion: string, mode: number) => void = () => {};
  onEmo: (id: number, index: number) => void = () => {};
  /** o que o NPC clicado oferece (abre o menu do NPC) */
  onNpcMenu: (m: { key: string; name: string; shop: boolean; buff: boolean }) => void = () => {};
  /** item usado (quanto curou, espera) e sua barra de atalhos */
  onUsed: (id: number, gains: { hp: number; mp: number; fp: number }, cd: number) => void = () => {};
  onBar: (slots: ({ k?: 'item' | 'skill'; id: number; icon: string; name: string } | null)[]) => void = () => {};
  /** itens no chão que apareceram/sumiram perto */
  onGround: (a: GroundRow[], d: number[]) => void = () => {};
  /** inventário (ao entrar e a cada mudança), pedido recusado, e o seu próprio equipamento visível ao entrar */
  onInv: (m: InvMessage) => void = () => {};
  onInvError: (error: string) => void = () => {};
  onWelcome: (eq: string[], mt: number) => void = () => {};
  /** a própria aparência mudou no servidor (equipamento/postura), ex.: por GM ou outro aviso */
  onLook: (eq: string[], mt: number) => void = () => {};
  /** painel de GM: abrir, resultado da busca de itens; teleporte feito por um GM */
  onGmOpen: () => void = () => {};
  onGmItems: (list: ItemView[]) => void = () => {};
  onTeleport: (p: [number, number, number], revive: boolean) => void = () => {};
  /** o próprio nível mudou (comando de GM) */
  onLevel: (level: number) => void = () => {};
  /** mensagem de chat (id 0 = aviso do servidor) */
  onChat: (id: number, name: string, text: string) => void = () => {};
  /** anúncio do painel admin (letreiro no meio da tela, `loops` passagens) */
  onAnnounce: (text: string, loops: number) => void = () => {};
  /** conexão caiu ou fechou: limpar o que veio do servidor */
  onReset: () => void = () => {};

  constructor(private remotes: RemotePlayers) {}

  connect(token: string, characterId: number, pos: () => [number, number, number]) {
    this.join = { token, characterId, pos };
    this.closing = false;
    this.open();
  }

  private open() {
    if (!this.join) return;
    const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
    const ws = new WebSocket(url);
    this.ws = ws;
    this.onStatus('Conectando ao servidor…');
    ws.onopen = () => { this.retry = 0; this.last = ''; ws.send(JSON.stringify({ t: 'join', token: this.join!.token, characterId: this.join!.characterId, p: this.join!.pos(), hide: this.hide })); };
    ws.onmessage = (ev) => {
      let m: { t: string; [k: string]: unknown };
      try { m = JSON.parse(String(ev.data)); } catch { return; }
      if (m.t === 'welcome') {
        this.myId = m.id as number;
        this.remotes.clear();
        for (const p of m.players as PlayerView[]) this.remotes.add(p);
        this.online = this.remotes.count + 1;
        this.onStatus('');
        this.onWelcome((m.eq ?? []) as string[], Number(m.mt ?? 0));
      } else if (m.t === 'enter') {
        this.remotes.add(m.player as PlayerView); this.online = this.remotes.count + 1;
      } else if (m.t === 'leave') {
        this.remotes.remove(m.id as number); this.online = this.remotes.count + 1;
      } else if (m.t === 'states') {
        for (const [id, x, y, z, h, s] of m.list as [number, number, number, number, number, string][]) if (id !== this.myId) this.remotes.update(id, x, y, z, h, s);
      } else if (m.t === 'mobs') {
        this.onMobs((m.a ?? []) as never, (m.u ?? []) as never, (m.d ?? []) as number[]);
      } else if (m.t === 'inv') {
        this.onInv(m as unknown as InvMessage);
      } else if (m.t === 'invError') {
        this.onInvError(String(m.error));
      } else if (m.t === 'gmOpen') {
        this.onGmOpen();
      } else if (m.t === 'gmItems') {
        this.onGmItems((m.list ?? []) as ItemView[]);
      } else if (m.t === 'teleport') {
        this.onTeleport(m.p as [number, number, number], !!m.revive);
      } else if (m.t === 'hit') {
        this.onHit(m.k as 'p' | 'm', Number(m.a), Number(m.d), Number(m.dmg), Number(m.f), Number(m.hp), m.fx as SkillFx | undefined, m.sn as [number, number] | undefined);
      } else if (m.t === 'mdie') {
        this.onMobDie(Number(m.id), Number(m.k));
      } else if (m.t === 'pdie') {
        this.onPlayerDie(Number(m.id));
      } else if (m.t === 'skills') {
        this.onSkills(Number(m.points) || 0, (m.levels ?? {}) as Record<string, number>, (m.list ?? []) as never);
      } else if (m.t === 'buffs') {
        this.onBuffs((m.list ?? []) as never);
      } else if (m.t === 'skillfx') {
        this.onSkillFx(Number(m.a), m.fx as SkillFx);
      } else if (m.t === 'skillUsed') {
        this.onSkillUsed(Number(m.id), Number(m.cd) || 1000);
      } else if (m.t === 'getup') {
        const id = Number(m.id);
        if (id === this.myId) this.onGetUp(); else this.remotes.getup(id);
      } else if (m.t === 'invis') {
        const id = Number(m.id);
        if (id === this.myId) this.onInvis(!!m.on); else this.remotes.setInvis(id, !!m.on);
      } else if (m.t === 'changeWorld') {
        this.onChangeWorld(String(m.w), m.p as [number, number, number]);
      } else if (m.t === 'guildView') {
        this.onGuildView((m.g ?? null) as import('./guild').GuildView | null);
      } else if (m.t === 'guildReq') {
        this.onGuildReq(Number(m.id), String(m.name ?? ''), String(m.guild ?? ''));
      } else if (m.t === 'guildTag') {
        const g = m.g == null ? null : String(m.g);
        if (Number(m.id) === this.myId) this.onMyGuildTag(g); else this.remotes.guildTag(Number(m.id), g);
      } else if (m.t === 'party') {
        this.onParty((m.p ?? null) as import('./party').PartyView | null);
      } else if (m.t === 'partyReq') {
        this.onPartyReq(Number(m.id), String(m.name ?? ''));
      } else if (m.t === 'partyList') {
        this.onPartyList((m.list ?? []) as import('./party').PartyListRow[]);
      } else if (m.t === 'friends') {
        this.onFriends((m.list ?? []) as import('./friends').FriendView[]);
      } else if (m.t === 'friendOn') {
        this.onFriendOn(Number(m.id), !!m.on);
      } else if (m.t === 'friendReq') {
        this.onFriendReq(Number(m.id), String(m.name ?? ''));
      } else if (m.t === 'friendNew') {
        this.onFriendNew(m.f as import('./friends').FriendView);
      } else if (m.t === 'friendDel') {
        this.onFriendDel(Number(m.id));
      } else if (m.t === 'pm') {
        this.onPm(Number(m.with), String(m.wname ?? ''), Number(m.from), String(m.name ?? ''), String(m.text ?? ''));
      } else if (m.t === 'emote') {
        this.onEmote(Number(m.id), String(m.m), Number(m.md) || 0);
      } else if (m.t === 'emo') {
        this.onEmo(Number(m.id), Number(m.i));
      } else if (m.t === 'npcMenu') {
        this.onNpcMenu({ key: String(m.key), name: String(m.name ?? ''), shop: !!m.shop, buff: !!m.buff });
      } else if (m.t === 'shop') {
        this.onShop(m as unknown as import('./shop').ShopView);
      } else if (m.t === 'used') {
        this.onUsed(Number(m.id), { hp: Number(m.hp) || 0, mp: Number(m.mp) || 0, fp: Number(m.fp) || 0 }, Number(m.cd) || 1000);
      } else if (m.t === 'bar') {
        this.onBar((m.slots ?? []) as never);
      } else if (m.t === 'ground') {
        this.onGround((m.a ?? []) as GroundRow[], (m.d ?? []) as number[]);
      } else if (m.t === 'stats') {
        this.onStats(m as unknown as PlayerStats);
      } else if (m.t === 'level') {
        if (m.id === this.myId) this.onLevel(Number(m.level));
      } else if (m.t === 'look') {
        if (m.id === this.myId) this.onLook((m.eq ?? []) as string[], Number(m.mt ?? 0));
        else this.remotes.look(m.id as number, (m.eq ?? []) as string[], Number(m.mt ?? 0));
      } else if (m.t === 'chat') {
        this.onChat(Number(m.id), String(m.name ?? ''), String(m.text ?? ''));
      } else if (m.t === 'announce') {
        this.onAnnounce(String(m.text ?? ''), Number(m.loops) || 1);
      } else if (m.t === 'error') {
        this.closing = true; // erro de sessão/personagem: não tenta de novo
        this.onStatus(String(m.error), true);
      }
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.remotes.clear();
      this.onReset();
      this.online = 0;
      if (this.closing) return;
      // queda de rede: tenta de novo com espera crescente (1 s, 2 s, 4 s… até 10 s)
      const wait = Math.min(10000, 1000 * 2 ** this.retry++);
      this.onStatus(`Sem conexão com o servidor — tentando de novo em ${Math.round(wait / 1000)} s…`, true);
      setTimeout(() => { if (!this.closing && this.ws === ws) this.open(); }, wait);
    };
  }

  /** manda o estado local no máximo a cada 100 ms e só quando muda */
  sendState(p: [number, number, number], h: number, s: string, now: number) {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN || !this.myId || now - this.lastSent < 100) return;
    const msg = JSON.stringify({ t: 'state', p: [+p[0].toFixed(2), +p[1].toFixed(2), +p[2].toFixed(2)], h: Math.round(h), s });
    if (msg === this.last) return;
    this.last = msg;
    this.lastSent = now;
    ws.send(msg);
  }

  /** inventário: mover de [container, slot] para outro, ou "usar" (duplo clique: equipa/desequipa) */
  invMove(from: [number, number], to: [number, number]) { return this.raw({ t: 'invMove', from, to }); }
  invUse(c: number, s: number) { return this.raw({ t: 'invUse', c, s }); }
  /** partes do visual escondidas (bits de shared/look.ts); vai também no 'join' ao reconectar */
  hide = 0;
  setHide(m: number) { this.hide = m; return this.raw({ t: 'hide', m }); }
  /** teleporte da janela Teleporter (índice no ZckTeleporteur.inc) */
  zckTeleport(k: number) { return this.raw({ t: 'zckTeleport', k }); }
  /** aprender/subir skills ({ id: nível novo }) e lançar uma skill no mob */
  skillUp(levels: Record<number, number>) { return this.raw({ t: 'skillUp', levels }); }
  castSkill(id: number, target: number) { return this.raw({ t: 'skill', id, target }); }
  /** loja do NPC: abrir (perto dele), comprar, vender */
  shopOpen(key: string) { return this.raw({ t: 'shopOpen', key }); }
  npcMenu(key: string) { return this.raw({ t: 'npcMenu', key }); }
  /** guild: criar, convidar, responder, sair, expulsar, desfazer, ver */
  guild(t: 'guildCreate' | 'guildInvite' | 'guildAnswer' | 'guildLeave' | 'guildKick' | 'guildDisband' | 'guildInfo', extra: Record<string, unknown> = {}) { return this.raw({ t, ...extra }); }
  /** party: convidar, responder convite, sair, expulsar, passar liderança, buff de party, lista */
  party(t: 'partyInvite' | 'partyAnswer' | 'partyLeave' | 'partyKick' | 'partyLead' | 'partySkill' | 'partyList', extra: Record<string, unknown> = {}) { return this.raw({ t, ...extra }); }
  /** Mensageiro: pedir amizade, responder pedido, desfazer, mensagem privada */
  friendAdd(id: number) { return this.raw({ t: 'friendAdd', id }); }
  friendAnswer(id: number, ok: boolean) { return this.raw({ t: 'friendAnswer', id, ok }); }
  friendDel(id: number) { return this.raw({ t: 'friendDel', id }); }
  pm(to: number, text: string) { return this.raw({ t: 'pm', to, text }); }
  /** morto: renascer na cidade / Resurrection (skill `id`) no jogador morto `target` */
  revive() { return this.raw({ t: 'revive' }); }
  /** modo de batalha (janela de movimentos): postura de combate ↔ normal */
  toggleStance() { return this.raw({ t: 'stance' }); }
  resurrect(id: number, target: number) { return this.raw({ t: 'res', id, target }); }
  /** /say Nome mensagem */
  pmName(toName: string, text: string) { return this.raw({ t: 'pm', toName, text }); }
  /** janela de movimentos: movimento (MTI_*, modo do propMotion) e emoticon (índice) */
  emote(m: string, md: number) { return this.raw({ t: 'emote', m, md }); }
  emoticon(i: number) { return this.raw({ t: 'emo', i }); }
  npcBuff(key: string) { return this.raw({ t: 'npcBuff', key }); }
  /** tira o buff da skill `id` */
  removeBuff(id: number) { return this.raw({ t: 'buffOff', id }); }
  shopBuy(key: string, id: number, n: number) { return this.raw({ t: 'buy', key, id, n }); }
  shopSell(key: string, s: number, n: number) { return this.raw({ t: 'sell', key, s, n }); }
  /** usa um item da bolsa pelo id (atalho) / salva a barra de atalhos */
  useItem(id: number) { return this.raw({ t: 'use', id }); }
  saveBar(slots: ({ k: 'item' | 'skill'; id: number } | null)[]) { return this.raw({ t: 'bar', slots }); }
  /** distribui pontos de atributo */
  jobChange(job: number) { return this.raw({ t: 'jobChange', job }); }
  statUp(add: { str: number; sta: number; dex: number; int: number }) { return this.raw({ t: 'statUp', ...add }); }
  /** pega o item `id` do chão */
  pick(id: number) { return this.raw({ t: 'pick', id }); }
  /** golpe no mob `id` (o servidor confere alcance e ritmo) */
  attack(id: number) { return this.raw({ t: 'atk', id }); }
  /** painel de GM: busca no catálogo de itens (nome/símbolo, categoria) */
  gmItems(q: string, k: string, g = 0) { return this.raw({ t: 'gmItems', q, k, g }); }
  private raw(msg: unknown) {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN || !this.myId) return false;
    ws.send(JSON.stringify(msg));
    return true;
  }

  /** manda uma mensagem de chat; false se não estiver conectado */
  sendChat(text: string) {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN || !this.myId) return false;
    ws.send(JSON.stringify({ t: 'chat', text: text.slice(0, 200) }));
    return true;
  }

  /** troca de mundo: fecha a conexão sem tentar reconectar (o servidor já guardou o mundo novo) */
  pause() {
    const ws = this.ws;
    this.ws = null;
    if (ws) { ws.onclose = null; ws.close(); }
    this.remotes.clear();
    this.onReset();
    this.online = 0;
  }
  /** entra de novo (no mundo novo) com o mesmo personagem */
  resume() { if (this.join && !this.ws) { this.retry = 0; this.open(); } }

  close() {
    this.closing = true;
    this.join = null;
    this.myId = 0;
    this.online = 0;
    const ws = this.ws;
    this.ws = null;
    ws?.close();
    this.remotes.clear();
    this.onReset();
  }
}
