import type pg from 'pg';
import { query, transaction } from '../common/db/index';
import { EQUIP_PARTS, fitsPart, ItemCatalog, jobCanUse, twoHanded, type ItemDef } from '../common/items';
import { lookList, RIDE_TAG, type LookPiece } from '../../shared/look';
import { MAX_PIERCING, maxPiercing, maxUpgrade } from '../../shared/upgrade';

/**
 * Inventário (`character_items` + `characters.gold`): bolsa = container 0 (slots 0..BAG_SLOTS-1), equipados = container 1
 * (slot = PARTS_*). O cliente só pede ("mover do slot X para o Y") e recebe o estado novo.
 *
 * Personagem ONLINE: o inventário fica na memória do servidor (`attach` ao entrar, `detach` ao sair). Cada ação muda só a
 * memória e marca o que mudou; um único UPDATE agrupado grava o que mudou (a cada ~2 s, ao sair e ao desligar o servidor).
 * Slots são gravados por diferença (upsert/delete só dos slots alterados) e o penya como incremento (`gold = gold + delta`),
 * então mudanças de fora (comandos, painel) no mesmo personagem não são sobrescritas.
 * Personagem OFFLINE (comandos de GM, ferramenta de linha de comando): as mesmas regras, mas carrega do banco, muda e grava
 * na hora, numa transação com as linhas travadas.
 */
export const BAG_SLOTS = 42;
/** canal do PostgreSQL (LISTEN/NOTIFY) avisando que o inventário/penya de um personagem mudou fora do mundo (comandos, painel) */
export const INVENTORY_CHANNEL = 'inventory_changed';
/** avisa o servidor do jogo (payload = id do personagem); quem estiver online recebe o inventário novo na hora */
export const notifyInventory = (characterId: number) => query('SELECT pg_notify($1, $2)', [INVENTORY_CHANNEL, String(characterId)]);
export const BAG = 0, EQUIP = 1;
/** espera antes de gravar uma mudança (agrupa ações em sequência) */
const FLUSH_DELAY_MS = 2000;
const GOLD_MAX = 2_100_000_000;

/** item num espaço; u = enchant (+0–10), e = elemento (0 nenhum, 1 fogo, 2 água, 3 elétrico, 4 vento, 5 terra), el = nível do elemento */
export interface InvItem { c: number; s: number; id: number; n: number; u: number; e: number; el: number; /** piercing: um item de carta por espaço aberto (0 = vazio) */ p?: number[]; /** item de tempo ativado: vale até (ms) */ x?: number }
/** melhorias pedidas ao criar um item (painel de GM) */
export interface ItemUpgrade { u?: number; e?: number; el?: number; /** espaços de piercing abertos (suit: até 4) */ p?: number }
const plain = (i: { u: number; e: number; el: number; p?: number[] }) => !i.u && !i.e && !i.el && !i.p?.length;
const sameUpgrade = (a: InvItem, b: InvItem) => a.u === b.u && a.e === b.e && a.el === b.el && (a.p ?? []).join() === (b.p ?? []).join();
export interface InvState { gold: number; items: InvItem[] }
/** o que um lado põe na janela de trade: espaços da bolsa (com quanto de cada pilha) e penya */
export interface TradeOffer { items: { s: number; n: number; /** item que estava no espaço ao oferecer */ id: number }[]; gold: number }
export const TRADE_SLOTS = 25;
/** quem está equipando: sexo (0/1), nível e classe (JOB_*) */
export interface Who { sex: number; level: number; job: number }

/** espaços das mãos (PARTS_*): esquerda (2ª arma da Blade), direita e escudo */
const LWEAPON = 9, RWEAPON = 10, SHIELD = 11;
/** 2ª classe de origem (Master/Hero/Legend contam como a 2ª classe base, como em combatMotion) */
const baseJob = (job: number) => (job >= 32 && job <= 39 ? job - 26 : job >= 24 && job <= 31 ? job - 18 : job >= 16 && job <= 23 ? job - 10 : job);
/** Blade (JOB_BLADE e Master/Hero dela) usa uma arma em cada mão: espada ou machado de uma mão (IK3_SWD 2 / IK3_AXE 3) */
const isBlade = (job: number) => baseJob(job) === 7;
const dualWieldable = (d: ItemDef) => (d.kind3 === 2 || d.kind3 === 3) && !twoHanded(d);

/** kit do personagem novo (Vagrant): equipados + bolsa, por sexo */
const STARTER = {
  equip: { 0: ['II_ARM_M_VAG_SUIT01', 'II_ARM_M_VAG_GAUNTLET01', 'II_ARM_M_VAG_BOOTS01', 'II_WEA_SWO_WOODEN'], 1: ['II_ARM_F_VAG_SUIT01', 'II_ARM_F_VAG_GAUNTLET01', 'II_ARM_F_VAG_BOOTS01', 'II_WEA_SWO_WOODEN'] } as Record<number, string[]>,
  bag: { 0: [['II_ARM_M_VAG_HELMET02', 1]], 1: [['II_ARM_F_VAG_HELMET02', 1]] } as Record<number, [string, number][]>,
  common: [['II_GEN_POT_DRI_VITAL100', 20], ['II_GEN_POT_POT_ANTIDOTE', 5], ['II_SYS_SYS_EVE_GOLDENAPPLE', 3]] as [string, number][],
  gold: 1000,
};

/** o que mudou desde a última gravação */
interface Pending { slots: Set<string>; gold: number }
const key = (c: number, s: number) => `${c}:${s}`;
/** ferramentas que as regras recebem: marcar slot alterado e mexer no penya */
interface Ctx { state: InvState; touch(c: number, s: number): void; gold(delta: number): void }

/** inventário de um personagem online */
interface Cached { state: InvState; pending: Pending; timer: NodeJS.Timeout | null; writing: Promise<void> }

export class Inventory {
  private cache = new Map<number, Cached>();
  /** chamado quando algo de dentro do servidor (comando de GM, loot) mudou o inventário de um personagem online: quem manda o estado novo ao jogador */
  onLocalChange: ((characterId: number) => void) | null = null;

  constructor(readonly catalog: ItemCatalog) {}

  // ---------- leitura/gravação ----------
  private async read(db: pg.PoolClient | null, characterId: number, lock = false): Promise<InvState> {
    const q = (text: string, params?: unknown[]) => (db ? db.query(text, params) : query(text, params));
    const g = await q(`SELECT gold FROM characters WHERE id = $1${lock ? ' FOR UPDATE' : ''}`, [characterId]);
    const r = await q(
      `SELECT container, slot, item_id, count, upgrade, element, element_level, piercing, (extract(epoch from expires_at) * 1000)::float8 AS expires FROM character_items WHERE character_id = $1 ORDER BY container, slot${lock ? ' FOR UPDATE' : ''}`, [characterId]);
    return { gold: Number(g.rows[0]?.gold ?? 0), items: r.rows.map((x: { container: number; slot: number; item_id: number; count: number; upgrade: number; element: number; element_level: number; piercing: unknown; expires: number | null }) => {
      const p = Array.isArray(x.piercing) ? x.piercing.map((v) => Number(v) || 0).slice(0, MAX_PIERCING) : [];
      return { c: x.container, s: x.slot, id: x.item_id, n: x.count, u: x.upgrade, e: x.element, el: x.element_level, ...(p.length ? { p } : {}), ...(x.expires ? { x: Math.round(x.expires) } : {}) };
    }) };
  }

  /** grava a diferença (slots alterados + incremento de penya) num único comando */
  private async write(db: { query: (text: string, params?: unknown[]) => Promise<unknown> }, characterId: number, st: InvState, slots: Set<string>, goldDelta: number) {
    const ups: InvItem[] = [], dels: [number, number][] = [];
    for (const k of slots) {
      const [c, s] = k.split(':').map(Number);
      const it = st.items.find((i) => i.c === c && i.s === s);
      if (it) ups.push(it); else dels.push([c, s]);
    }
    if (!ups.length && !dels.length && !goldDelta) return;
    await db.query(
      `WITH ups AS (
         INSERT INTO character_items (character_id, container, slot, item_id, count, upgrade, element, element_level, piercing, expires_at)
         SELECT $1, t.c, t.s, t.i, t.n, t.u, t.e, t.el, t.p::jsonb, CASE WHEN t.x IS NULL THEN NULL ELSE to_timestamp(t.x / 1000.0) END
           FROM unnest($2::int[], $3::int[], $4::int[], $5::int[], $6::int[], $7::int[], $8::int[], $12::text[], $13::float8[]) AS t(c, s, i, n, u, e, el, p, x)
         ON CONFLICT (character_id, container, slot) DO UPDATE
           SET item_id = EXCLUDED.item_id, count = EXCLUDED.count, upgrade = EXCLUDED.upgrade, element = EXCLUDED.element, element_level = EXCLUDED.element_level, piercing = EXCLUDED.piercing, expires_at = EXCLUDED.expires_at
         RETURNING 1),
       dels AS (
         DELETE FROM character_items ci USING unnest($9::int[], $10::int[]) AS d(c, s)
         WHERE ci.character_id = $1 AND ci.container = d.c AND ci.slot = d.s RETURNING 1)
       UPDATE characters SET gold = LEAST(GREATEST(gold + $11, 0), ${GOLD_MAX}), updated_at = now() WHERE id = $1 AND $11 <> 0`,
      [characterId, ups.map((i) => i.c), ups.map((i) => i.s), ups.map((i) => i.id), ups.map((i) => i.n), ups.map((i) => i.u), ups.map((i) => i.e), ups.map((i) => i.el),
        dels.map((d) => d[0]), dels.map((d) => d[1]), goldDelta, ups.map((i) => JSON.stringify(i.p ?? [])), ups.map((i) => i.x ?? null)]);
  }

  /**
   * Roda `fn` (regras, síncronas) sobre o estado: na memória se o personagem está online; senão carrega do banco, aplica e grava
   * na hora, na mesma transação.
   */
  private async mutate<T>(characterId: number, fn: (ctx: Ctx) => T): Promise<T> {
    const cached = this.cache.get(characterId);
    if (cached) {
      const r = fn({
        state: cached.state,
        touch: (c, s) => cached.pending.slots.add(key(c, s)),
        gold: (d) => { cached.state.gold = Math.min(GOLD_MAX, Math.max(0, cached.state.gold + d)); cached.pending.gold += d; },
      });
      this.schedule(characterId, cached);
      return r;
    }
    return transaction(async (db) => {
      const st = await this.read(db, characterId, true);
      const slots = new Set<string>();
      let delta = 0;
      const r = fn({ state: st, touch: (c, s) => slots.add(key(c, s)), gold: (d) => { st.gold = Math.min(GOLD_MAX, Math.max(0, st.gold + d)); delta += d; } });
      await this.write(db, characterId, st, slots, delta);
      return r;
    });
  }

  private schedule(characterId: number, c: Cached) {
    if (c.timer) return;
    c.timer = setTimeout(() => { c.timer = null; void this.flush(characterId); }, FLUSH_DELAY_MS);
    c.timer.unref?.();
  }

  /** grava agora o que está pendente deste personagem (se online); falha → volta para a fila e tenta de novo */
  async flush(characterId: number): Promise<void> {
    const c = this.cache.get(characterId);
    if (!c) return;
    if (c.timer) { clearTimeout(c.timer); c.timer = null; }
    const run = async () => {
      await c.writing; // uma gravação por vez, na ordem
      if (!c.pending.slots.size && !c.pending.gold) return;
      const slots = c.pending.slots, gold = c.pending.gold;
      c.pending = { slots: new Set(), gold: 0 };
      try {
        await this.write({ query }, characterId, c.state, slots, gold);
      } catch (e) {
        for (const k of slots) c.pending.slots.add(k);
        c.pending.gold += gold;
        console.error('inventário: falha ao gravar, tentando de novo', characterId, (e as Error).message);
        this.schedule(characterId, c);
      }
    };
    c.writing = run();
    await c.writing;
  }

  /** grava o inventário de todos os online (desligar o servidor) */
  async flushAll() { await Promise.all([...this.cache.keys()].map((id) => this.flush(id))); }

  /** quantos personagens estão na memória e quantas mudanças esperam gravação (para o painel) */
  stats() {
    let pending = 0;
    for (const c of this.cache.values()) pending += c.pending.slots.size + (c.pending.gold ? 1 : 0);
    return { cached: this.cache.size, pending };
  }

  // ---------- entrar / sair ----------
  /** personagem entrou no mundo: entrega o kit inicial (1ª vez), carrega do banco para a memória e devolve o estado */
  async attach(characterId: number, sex: number): Promise<InvState> {
    await this.giveStarter(characterId, sex);
    const old = this.cache.get(characterId);
    if (old) await this.flush(characterId);
    const state = await this.read(null, characterId);
    this.cache.set(characterId, { state, pending: { slots: new Set(), gold: 0 }, timer: null, writing: Promise.resolve() });
    return state;
  }

  /** personagem saiu: grava o que falta e libera a memória */
  async detach(characterId: number): Promise<void> {
    await this.flush(characterId);
    this.cache.delete(characterId);
  }

  /** mudança de fora (NOTIFY): grava o pendente e relê do banco para a memória; devolve o estado */
  async reload(characterId: number): Promise<InvState> {
    const c = this.cache.get(characterId);
    if (!c) return this.read(null, characterId);
    for (;;) {
      await this.flush(characterId);
      const fresh = await this.read(null, characterId);
      if (c.pending.slots.size || c.pending.gold) continue; // mudou durante a leitura: grava de novo e relê
      c.state.items = fresh.items;
      c.state.gold = fresh.gold;
      return c.state;
    }
  }

  /** estado atual (da memória se online), sem entregar nada */
  async state(characterId: number): Promise<InvState> {
    return this.cache.get(characterId)?.state ?? this.read(null, characterId);
  }

  private async giveStarter(characterId: number, sex: number) {
    await transaction(async (db) => {
      const r = await db.query('UPDATE characters SET starter_given = true, gold = gold + $2 WHERE id = $1 AND NOT starter_given RETURNING id', [characterId, STARTER.gold]);
      if (!r.rowCount) return; // já recebeu
      for (const sym of STARTER.equip[sex] ?? []) {
        const d = this.catalog.bySymbol.get(sym);
        if (d && d.parts >= 0) await db.query('INSERT INTO character_items (character_id, container, slot, item_id) VALUES ($1, 1, $2, $3) ON CONFLICT DO NOTHING', [characterId, d.parts, d.id]);
      }
      let slot = 0;
      for (const [sym, n] of [...(STARTER.bag[sex] ?? []), ...STARTER.common]) {
        const d = this.catalog.bySymbol.get(sym);
        if (d) await db.query('INSERT INTO character_items (character_id, container, slot, item_id, count) VALUES ($1, 0, $2, $3, $4) ON CONFLICT DO NOTHING', [characterId, slot++, d.id, Math.min(n, d.packMax)]);
      }
    });
  }

  // ---------- regras (síncronas, sobre o estado) ----------
  /** por que o personagem não pode usar este item no espaço `slot` (null = pode) */
  private cannotEquip(d: ItemDef, slot: number, ch: Who): string | null {
    if (slot === LWEAPON) {
      // mão esquerda: só a Blade, com espada/machado de uma mão (o resto das regras vale igual)
      if (!isBlade(ch.job)) return 'Só a Blade usa uma arma em cada mão.';
      if (d.parts !== RWEAPON || !dualWieldable(d)) return `${d.name} não vai na mão esquerda (só espada ou machado de uma mão).`;
    } else if (d.parts < 0 || !fitsPart(d.parts, slot)) return `${d.name} não vai nesse espaço.`;
    if (d.sex !== -1 && d.sex !== ch.sex) return `${d.name} é para o outro sexo.`;
    if (!jobCanUse(d.job, ch.job)) return `Sua classe não pode usar ${d.name}.`;
    if (d.level > ch.level) return `${d.name} precisa do nível ${d.level}.`;
    // voar (prancha/vassoura, IK3_BOARD/IK3_STICK) só a partir do nível 20, como no cliente
    if ((d.kind3 === 40 || d.kind3 === 41) && ch.level < 20) return 'Você precisa do nível 20 para voar.';
    return null;
  }

  /**
   * Move/equipa/desequipa/empilha. `from`/`to` = [container, slot]. Devolve o estado novo ou uma mensagem de erro
   * (sem mudar nada). Troca de lugar quando o destino está ocupado, se o item de lá couber na origem.
   */
  private applyMove(x: Ctx, ch: Who, from: [number, number], to: [number, number]): { state: InvState } | { error: string } {
    const valid = ([c, s]: [number, number]) => (c === BAG && s >= 0 && s < BAG_SLOTS) || (c === EQUIP && EQUIP_PARTS.has(s));
    if (!valid(from) || !valid(to)) return { error: 'Espaço inválido.' };
    if (from[0] === to[0] && from[1] === to[1]) return { error: '' };
    const st = x.state;
    const at = ([c, s]: [number, number]) => st.items.find((i) => i.c === c && i.s === s);
    const a0 = at(from), d0 = a0 && this.catalog.byId.get(a0.id);
    // Blade: espada/machado solto no espaço do escudo (onde a 2ª arma aparece, como no original) vai para a mão esquerda
    if (to[0] === EQUIP && to[1] === SHIELD && d0 && d0.parts === RWEAPON && isBlade(ch.job) && dualWieldable(d0)) to = [EQUIP, LWEAPON];
    if (from[0] === to[0] && from[1] === to[1]) return { error: '' };
    const a = at(from), b = at(to);
    if (!a) return { error: '' }; // nada para mover (estado do cliente desatualizado)
    const da = this.catalog.byId.get(a.id), db_ = b ? this.catalog.byId.get(b.id) : undefined;
    if (!da || (b && !db_)) return { error: 'Item desconhecido.' };
    if (to[0] === EQUIP) { const e = this.cannotEquip(da, to[1], ch); if (e) return { error: e }; }
    if (b && from[0] === EQUIP) { const e = this.cannotEquip(db_!, from[1], ch); if (e) return { error: to[0] === BAG ? 'Esse espaço da bolsa está ocupado.' : e }; }
    // duas mãos (DoEquip original): arma de duas mãos tira o escudo e a 2ª arma; escudo tira a arma de duas mãos e a 2ª arma;
    // a 2ª arma (Blade) tira o escudo e a arma de duas mãos — o que sai vai para a bolsa (um por vez)
    let bump: InvItem | undefined;
    if (to[0] === EQUIP && to[1] === RWEAPON && twoHanded(da)) bump = at([EQUIP, SHIELD]) ?? at([EQUIP, LWEAPON]);
    if (to[0] === EQUIP && to[1] === SHIELD) { const w = at([EQUIP, RWEAPON]), wd = w && this.catalog.byId.get(w.id); bump = w && wd && twoHanded(wd) ? w : at([EQUIP, LWEAPON]); }
    if (to[0] === EQUIP && to[1] === LWEAPON) { const w = at([EQUIP, RWEAPON]), wd = w && this.catalog.byId.get(w.id); bump = w && wd && twoHanded(wd) ? w : at([EQUIP, SHIELD]); }
    if (bump && bump !== b && bump !== a) {
      const used = new Set(st.items.filter((i) => i.c === BAG && i !== a).map((i) => i.s));
      if (from[0] === BAG && b) used.add(from[1]); // o que estava no destino vai para a origem
      let free = -1;
      for (let s = 0; s < BAG_SLOTS && free < 0; s++) if (!used.has(s)) free = s;
      if (free < 0) return { error: 'A bolsa está cheia para tirar o item da outra mão.' };
      x.touch(bump.c, bump.s);
      bump.c = BAG; bump.s = free;
      x.touch(BAG, free);
    }

    if (b && a.id === b.id && sameUpgrade(a, b) && a.c === BAG && b.c === BAG && da.packMax > 1 && b.n < da.packMax) {
      // empilha o que couber; o resto fica na origem
      const k = Math.min(a.n, da.packMax - b.n);
      b.n += k; x.touch(b.c, b.s);
      if (k === a.n) st.items.splice(st.items.indexOf(a), 1); else a.n -= k;
      x.touch(a.c, a.s);
    } else {
      // troca (ou só leva) de lugar: a vai para `to`; b, se houver, vai para `from`
      a.c = to[0]; a.s = to[1];
      if (b) { b.c = from[0]; b.s = from[1]; }
      x.touch(from[0], from[1]); x.touch(to[0], to[1]);
    }
    return { state: st };
  }

  /** move/equipa/desequipa/empilha (ver `applyMove`) */
  move(characterId: number, ch: Who, from: [number, number], to: [number, number]) {
    return this.mutate(characterId, (x) => this.applyMove(x, ch, from, to));
  }

  /**
   * Ao entrar: tira para a bolsa o que o personagem não pode mais vestir (classe, sexo, nível — ex.: item dado por GM ou
   * classe trocada) e o escudo junto de arma de duas mãos. Sem espaço na bolsa, fica onde está. Devolve os nomes tirados.
   */
  fixEquipped(characterId: number, ch: Who): Promise<string[]> {
    return this.mutate(characterId, (x) => {
      const st = x.state, out: string[] = [];
      const weapon = st.items.find((i) => i.c === EQUIP && i.s === 10);
      for (const it of [...st.items]) {
        if (it.c !== EQUIP) continue;
        const d = this.catalog.byId.get(it.id);
        if (!d) continue;
        const wd = weapon && this.catalog.byId.get(weapon.id);
        const twoHand = (it.s === SHIELD || it.s === LWEAPON) && !!wd && twoHanded(wd) && jobCanUse(wd.job, ch.job);
        if (!this.cannotEquip(d, it.s, ch) && !twoHand) continue;
        const free = this.freeSlot(st);
        if (free < 0) break;
        x.touch(it.c, it.s);
        it.c = BAG; it.s = free;
        x.touch(BAG, free);
        out.push(d.name);
      }
      return out;
    });
  }

  /** primeiro espaço livre da bolsa, ou -1 */
  private freeSlot(st: InvState) {
    const used = new Set(st.items.filter((i) => i.c === BAG).map((i) => i.s));
    for (let s = 0; s < BAG_SLOTS; s++) if (!used.has(s)) return s;
    return -1;
  }

  /** desequipa para o primeiro espaço livre da bolsa (duplo clique num equipado) */
  unequip(characterId: number, ch: Who, part: number) {
    return this.mutate(characterId, (x) => {
      const free = this.freeSlot(x.state);
      if (free < 0) return { error: 'A bolsa está cheia.' } as { error: string };
      return this.applyMove(x, ch, [EQUIP, part], [BAG, free]);
    });
  }

  /** equipa direto do slot da bolsa no espaço do item (duplo clique); anel/brinco vão no 1º espaço livre do par */
  equip(characterId: number, ch: Who, slot: number) {
    return this.mutate(characterId, (x) => {
      const it = x.state.items.find((i) => i.c === BAG && i.s === slot);
      const d = it && this.catalog.byId.get(it.id);
      if (!d) return { error: '' } as { error: string };
      if (d.parts < 0 || !EQUIP_PARTS.has(d.parts)) return { error: `${d.name} não é equipável.` } as { error: string };
      let part = d.parts;
      // Blade: com a mão direita ocupada e a esquerda livre, a espada/machado vai para a esquerda (DoEquip, arma dupla)
      if (part === RWEAPON && isBlade(ch.job) && dualWieldable(d) && x.state.items.some((i) => i.c === EQUIP && i.s === RWEAPON) && !x.state.items.some((i) => i.c === EQUIP && i.s === LWEAPON)) {
        const r = x.state.items.find((i) => i.c === EQUIP && i.s === RWEAPON), rd = r && this.catalog.byId.get(r.id);
        if (rd && dualWieldable(rd)) part = LWEAPON;
      }
      const pair = part === 20 || part === 21 ? [20, 21] : part === 22 || part === 23 ? [22, 23] : null;
      if (pair) part = pair.find((p) => !x.state.items.some((i) => i.c === EQUIP && i.s === p)) ?? pair[0];
      return this.applyMove(x, ch, [BAG, slot], [EQUIP, part]);
    });
  }

  /**
   * Piercing (CDPSrvr::OnPiercing): espeta a carta do espaço `cardSlot` da bolsa no 1º furo vazio da suit do espaço
   * `targetSlot`, também da bolsa — suit equipada não aceita (tire antes). Gasta 1 carta. Nada muda se der erro.
   */
  pierce(characterId: number, cardSlot: number, targetSlot: number) {
    return this.mutate(characterId, (x): { state: InvState; card: ItemDef; suit: ItemDef } | { error: string } => {
      const bag = (s: number) => x.state.items.find((i) => i.c === BAG && i.s === s);
      const card = bag(cardSlot), cd = card && this.catalog.byId.get(card.id);
      if (!card || !cd) return { error: '' };
      if (!this.catalog.isSuitCard(cd)) return { error: `${cd.name} não é uma carta de piercing.` };
      if (cardSlot === targetSlot) return { error: 'Escolha a suit onde aplicar a carta.' };
      const suit = bag(targetSlot), sd = suit && this.catalog.byId.get(suit.id);
      if (!suit || !sd) return { error: 'Escolha uma suit da bolsa (a equipada não serve: tire ela antes).' };
      if (maxPiercing(sd.parts) === 0) return { error: `${sd.name} não aceita cartas: só a suit tem piercing.` };
      const holes = suit.p ?? [];
      if (!holes.length) return { error: `${sd.name} não tem furos de piercing abertos.` };
      const free = holes.indexOf(0);
      if (free < 0) return { error: `Todos os furos de ${sd.name} já têm carta.` };
      suit.p = holes.map((v, i) => (i === free ? cd.id : v));
      if (card.n > 1) card.n--; else x.state.items.splice(x.state.items.indexOf(card), 1);
      x.touch(BAG, cardSlot); x.touch(BAG, targetSlot);
      return { state: x.state, card: cd, suit: sd };
    });
  }

  /** tira até `n` do espaço `slot` da bolsa (venda); devolve o item e quanto saiu, ou null */
  takeFromSlot(characterId: number, slot: number, n: number): Promise<{ item: InvItem; taken: number } | null> {
    return this.mutate(characterId, (x) => {
      const it = x.state.items.find((i) => i.c === BAG && i.s === slot);
      if (!it || n <= 0) return null;
      const taken = Math.min(n, it.n);
      const snapshot = { ...it };
      if (taken < it.n) it.n -= taken; else x.state.items.splice(x.state.items.indexOf(it), 1);
      x.touch(BAG, slot);
      return { item: snapshot, taken };
    });
  }

  /** item de tempo (ticket): começa a contar — vale até `until` (ms); null se não houver item no espaço */
  setExpiry(characterId: number, slot: number, until: number): Promise<InvState | null> {
    return this.mutate(characterId, (x) => {
      const it = x.state.items.find((i) => i.c === BAG && i.s === slot);
      if (!it) return null;
      it.x = until;
      x.touch(BAG, slot);
      return x.state;
    });
  }

  /** gasta 1 do item no espaço `slot` da bolsa (uso de poção/comida); null se não houver */
  consume(characterId: number, slot: number): Promise<InvState | null> {
    return this.mutate(characterId, (x) => {
      const it = x.state.items.find((i) => i.c === BAG && i.s === slot);
      if (!it) return null;
      if (it.n > 1) it.n--; else x.state.items.splice(x.state.items.indexOf(it), 1);
      x.touch(BAG, slot);
      return x.state;
    });
  }

  /**
   * Coloca itens na bolsa (empilha onde der, depois slots livres); devolve quantos não couberam.
   * Com enchant/elemento (só equipamento) cada item vai num slot, sem empilhar.
   */
  async add(characterId: number, itemId: number, count: number, up: ItemUpgrade = {}): Promise<number> {
    const d = this.catalog.byId.get(itemId);
    if (!d) throw new Error(`item ${itemId} não existe`);
    const clamp = (v: number | undefined, max: number) => Math.max(0, Math.min(max, Math.floor(Number(v) || 0)));
    const sockets = clamp(up.p, maxPiercing(d.parts));
    const u = { u: clamp(up.u, maxUpgrade(d.parts)), e: clamp(up.e, 5), el: clamp(up.el, 10), ...(sockets ? { p: new Array<number>(sockets).fill(0) } : {}) };
    if (!u.e) u.el = 0;
    if (!plain(u) && d.parts < 0) throw new Error(`${d.name} não é equipamento: não aceita enchant nem elemento`);
    const pack = plain(u) ? d.packMax : 1;
    const online = this.cache.has(characterId);
    const left = await this.mutate(characterId, (x) => {
      let left = count;
      for (const i of x.state.items) {
        if (left <= 0 || !plain(u)) break;
        if (i.c !== BAG || i.id !== itemId || !plain(i) || i.n >= d.packMax) continue;
        const k = Math.min(left, d.packMax - i.n);
        i.n += k; x.touch(BAG, i.s);
        left -= k;
      }
      const used = new Set(x.state.items.filter((i) => i.c === BAG).map((i) => i.s));
      for (let s = 0; s < BAG_SLOTS && left > 0; s++) {
        if (used.has(s)) continue;
        const k = Math.min(left, pack);
        x.state.items.push({ c: BAG, s, id: itemId, n: k, u: u.u, e: u.e, el: u.el, ...(u.p ? { p: [...u.p] } : {}) });
        x.touch(BAG, s);
        left -= k;
      }
      return left;
    });
    if (online) this.onLocalChange?.(characterId); else await notifyInventory(characterId); // offline: o aviso cobre uma corrida na entrada
    return left;
  }

  /**
   * Trade entre dois personagens online: confere as duas ofertas (o item ainda está no espaço, quantidade, penya) e se o
   * que cada um recebe cabe na bolsa (empilha o que der), e só então aplica nos dois de uma vez e grava na hora. Os itens
   * vão com tudo (enchant, elemento, piercing, tempo). Devolve null ou o motivo de não trocar (nada muda).
   */
  async exchange(a: number, b: number, offerA: TradeOffer, offerB: TradeOffer): Promise<string | null> {
    const ca = this.cache.get(a), cb = this.cache.get(b);
    if (!ca || !cb) return 'O outro jogador saiu.';
    // tira a oferta de uma cópia da bolsa; devolve os itens que saem (cópias) ou o erro
    const takeOut = (st: InvState, o: TradeOffer, items: InvItem[]): InvItem[] | string => {
      if (!Number.isInteger(o.gold) || o.gold < 0 || o.gold > st.gold) return 'Penya insuficiente para a troca.';
      if (o.items.length > TRADE_SLOTS || new Set(o.items.map((x) => x.s)).size !== o.items.length) return 'Oferta inválida.';
      const out: InvItem[] = [];
      for (const { s: slot, n, id } of o.items) {
        const it = items.find((i) => i.c === BAG && i.s === slot);
        if (!it || it.id !== id || !Number.isInteger(n) || n < 1 || n > it.n) return 'Um item da troca mudou de lugar ou acabou.';
        out.push({ ...it, n, ...(it.p ? { p: [...it.p] } : {}) });
        if (n < it.n) it.n -= n; else items.splice(items.indexOf(it), 1);
      }
      return out;
    };
    // põe um item na cópia da bolsa (empilha se for comum e da mesma pilha, senão espaço livre); false se não cabe
    const putIn = (items: InvItem[], it: InvItem): boolean => {
      const d = this.catalog.byId.get(it.id);
      if (!d) return false;
      let left = it.n;
      if (plain(it) && !it.x && d.packMax > 1) {
        for (const i of items) {
          if (left <= 0) break;
          if (i.c !== BAG || i.id !== it.id || !plain(i) || i.x || i.n >= d.packMax) continue;
          const k = Math.min(left, d.packMax - i.n);
          i.n += k; left -= k;
        }
      }
      const used = new Set(items.filter((i) => i.c === BAG).map((i) => i.s));
      for (let slot = 0; slot < BAG_SLOTS && left > 0; slot++) {
        if (used.has(slot)) continue;
        const k = Math.min(left, Math.max(1, d.packMax));
        items.push({ ...it, c: BAG, s: slot, n: k, ...(it.p ? { p: [...it.p] } : {}) });
        left -= k;
      }
      return left <= 0;
    };
    const clone = (st: InvState) => st.items.map((i) => ({ ...i, ...(i.p ? { p: [...i.p] } : {}) }));
    const ia = clone(ca.state), ib = clone(cb.state);
    const outA = takeOut(ca.state, offerA, ia), outB = takeOut(cb.state, offerB, ib);
    if (typeof outA === 'string') return outA;
    if (typeof outB === 'string') return outB;
    for (const it of outB) if (!putIn(ia, it)) return 'Sua bolsa não tem espaço para a troca.';
    for (const it of outA) if (!putIn(ib, it)) return 'A bolsa do outro jogador não tem espaço para a troca.';
    if (ca.state.gold - offerA.gold + offerB.gold > GOLD_MAX || cb.state.gold - offerB.gold + offerA.gold > GOLD_MAX) return 'Penya demais: passaria do limite.';
    // aplica nos dois: a bolsa inteira é marcada para gravar (upsert/delete por espaço) e o penya vai como incremento
    for (const [c, items, delta] of [[ca, ia, offerB.gold - offerA.gold], [cb, ib, offerA.gold - offerB.gold]] as const) {
      c.state.items = items;
      for (let slot = 0; slot < BAG_SLOTS; slot++) c.pending.slots.add(key(BAG, slot));
      if (delta) { c.state.gold = Math.min(GOLD_MAX, Math.max(0, c.state.gold + delta)); c.pending.gold += delta; }
    }
    await Promise.all([this.flush(a), this.flush(b)]);
    return null;
  }

  /** soma (ou tira, com delta negativo) penya; devolve o penya novo */
  async addGold(characterId: number, delta: number): Promise<number> {
    const online = this.cache.has(characterId);
    const gold = await this.mutate(characterId, (x) => { x.gold(delta); return x.state.gold; });
    if (online) this.onLocalChange?.(characterId); else await notifyInventory(characterId);
    return gold;
  }

  /** tira `amount` de penya se houver; false se não tem o bastante (nada muda) */
  spendGold(characterId: number, amount: number): Promise<boolean> {
    return this.mutate(characterId, (x) => {
      if (amount < 0 || x.state.gold < amount) return false;
      x.gold(-amount);
      return true;
    });
  }

  /**
   * Postura de combate (MTI_STAND_NN do mdlDyna) pela arma equipada e pela classe — 0 sem arma nem escudo.
   * 01 espada, 02 varinha, 03 cheerstick, 04 machado, 05 cajado, 06 knuckle hammer, 07 Knight (duas mãos), 08 Blade (duas armas),
   * 09 Ringmaster (stick), 10 Billposter (knuckle), 11 Psykeeper (varinha), 12 Elementor (cajado), 13 arco, 14 ioiô, 15 besta.
   * Classes de 2ª/master/hero contam como a 2ª classe base.
   */
  combatMotion(st: InvState, job: number): number {
    const at = (part: number) => { const i = st.items.find((x) => x.c === EQUIP && x.s === part); return i ? this.catalog.byId.get(i.id) : undefined; };
    const r = at(10), l = at(9), shield = at(11);
    if (!r && !l && !shield) return 0;
    const base = job >= 32 && job <= 39 ? job - 26 : job >= 24 && job <= 31 ? job - 18 : job >= 16 && job <= 23 ? job - 10 : job;
    if (r && l) return 8;
    const w = r ?? l;
    if (!w) return 1; // só escudo
    switch (w.kind3) {
      case 2: return 1; // IK3_SWD
      case 3: return 4; // IK3_AXE
      case 4: return base === 10 ? 9 : 3; // IK3_CHEERSTICK
      case 5: return base === 11 ? 10 : 6; // IK3_KNUCKLEHAMMER
      case 6: return base === 12 ? 11 : 2; // IK3_WAND
      case 7: return base === 13 ? 12 : 5; // IK3_STAFF
      case 8: case 9: return 7; // IK3_THSWD, IK3_THAXE
      case 11: return 14; // IK3_YOYO
      case 12: return 13; // IK3_BOW
      case 14: return 15; // IK3_CROSSBOW
      default: return 1;
    }
  }

  /** mensagem para o cliente: itens + definição (nome/ícone/…) só dos itens presentes */
  view(st: InvState) {
    const defs: Record<number, ReturnType<typeof ItemCatalog.view>> = {};
    for (const i of st.items) {
      const d = this.catalog.byId.get(i.id);
      if (d) defs[i.id] = this.catalog.viewFull(d);
      // cartas espetadas: a dica do item mostra o nome e o bônus de cada uma
      for (const card of i.p ?? []) { const cd = card ? this.catalog.byId.get(card) : undefined; if (cd && !defs[card]) defs[card] = this.catalog.viewFull(cd); }
    }
    return { t: 'inv', gold: st.gold, bag: BAG_SLOTS, items: st.items.map((i) => (i.x ? [i.c, i.s, i.id, i.n, i.u, i.e, i.el, i.p ?? [], i.x] : i.p?.length ? [i.c, i.s, i.id, i.n, i.u, i.e, i.el, i.p] : [i.c, i.s, i.id, i.n, i.u, i.e, i.el])), defs };
  }

  /** símbolos II_* equipados que mudam o visual (para montar o modelo nos clientes): cash por cima, partes escondidas fora, enchant junto (shared/look.ts) */
  looks(st: InvState, hide = 0): string[] {
    const pieces: LookPiece[] = [];
    let ride: string | undefined;
    for (const i of st.items) {
      const d = i.c === EQUIP ? this.catalog.byId.get(i.id) : undefined;
      if (!d) continue;
      pieces.push({ s: i.s, sym: d.symbol, u: i.u, e: i.e, el: i.el });
      if (i.s === 13) ride = d.rideMotion;
    }
    const list = lookList(pieces, hide);
    return ride ? [...list, RIDE_TAG + ride] : list;
  }
}
