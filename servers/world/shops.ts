import fs from 'node:fs';
import path from 'node:path';
import { parseDyo } from '../../shared/formats/dyo';
import { applyNpcEdits } from '../../shared/worldedits';
import { editsMtime, loadEdits } from '../common/worldedits';
import type { ItemCatalog, ItemDef } from '../common/items';
import { nameTable } from '../common/names';

/**
 * Lojas dos NPCs, lidas dos arquivos do cliente/servidor original:
 * - `character.inc` (CProject::_loadCharacter): bloco `MaFl_X { setting { AddMenu(MMI_TRADE); AddShopItem(aba, II_…, preço); … }
 *   AddVendorSlot(aba, "nome" | IDS_…) }`; `SetVenderType(II_…)` = loja que cobra outra moeda (fichas) — essas ainda não
 *   vendem aqui, só as de penya; nomes IDS_* de `character.txt.txt`;
 *   versões novas: `AddVendorItem(aba, IK3_…, classe, raridadeMín, raridadeMáx, total)` vende a categoria inteira — itens com
 *   aquele dwItemKind3 e dwItemRare na faixa, vendáveis (dwShopAble) e da classe pedida (−1 = qualquer), em ordem de raridade,
 *   no máximo 100 por aba (CMover::GenerateVendorItem); `AddVendorItem2(aba, id)` um item fixo; `SetVenderType(1)` = fichas;
 * - posição dos NPCs pelo `.dyo` do mundo (campo characterKey do CMover), para só abrir/comprar perto do NPC.
 * Venda: dwCost / 4 por unidade, mínimo 1 (CDPSrvr::OnSellItem).
 */
export interface Shop { key: string; name: string; tabs: { name: string; items: { id: number; price: number }[] }[] }

/** MAX_VENDOR_INVENTORY: itens por aba */
const MAX_VENDOR = 100;

/** distância máxima do NPC para usar a loja */
export const SHOP_RANGE = 12;

export class ShopCatalog {
  readonly shops = new Map<string, Shop>();
  /** lojas que cobram outra moeda (nome da moeda), por chave */
  readonly tokenShops = new Map<string, string>();
  /** posições (x, z) dos NPCs por chave (minúsculas) */
  readonly npcPos = new Map<string, [number, number][]>();
  /**
   * NPCs que dão buff (Buff Pang: AddMenu(MMI_NPC_BUFF) + SetBuffSkill(SI_…, nível, nvMín, nvMáx, duração ms)), por chave;
   * e o nome de cada NPC (SetName) para o menu.
   */
  readonly npcBuffs = new Map<string, { skill: number; level: number; minLv: number; maxLv: number; ms: number }[]>();
  readonly npcNames = new Map<string, string>();
  /** menus de ferreiro de cada NPC (AddMenu MMI_PIERCING, MMI_SMELT_*, MMI_CHANGEELEM… do character.inc), por chave */
  readonly npcMenus = new Map<string, Set<string>>();

  constructor(resDir: string, private items: ItemCatalog, world = 'WdMadrigal') {
    const read = (f: string) => {
      try {
        const b = fs.readFileSync(path.join(resDir, f));
        // .txt.txt de texto (nomes) estão em windows-1252 (inglês/francês); os .inc só têm comentários em coreano
        return b[0] === 0xff && b[1] === 0xfe ? new TextDecoder('utf-16le').decode(b.subarray(2)) : new TextDecoder(f.endsWith('.txt.txt') ? 'windows-1252' : 'euc-kr').decode(b);
      } catch { return ''; }
    };
    const names = new Map<string, string>();
    for (const f of ['character.txt.txt', 'character-etc.txt.txt', 'character-school.txt.txt']) {
      for (const line of read(f).split(/\r?\n/)) { const i = line.indexOf('\t'); if (i > 0 && !line.slice(i + 1).trim().startsWith('IDS_')) names.set(line.slice(0, i).trim(), line.slice(i + 1).trim()); }
    }
    for (const f of ['character.inc', 'character-etc.inc', 'character-school.inc']) this.parse(read(f), names);
    try {
      const b = fs.readFileSync(path.join(resDir, 'World', world, `${world}.dyo`));
      this.dyo = parseDyo(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer);
    } catch (e) { console.warn('Lojas: não li o .dyo', (e as Error).message); }
    this.world = world;
    this.indexNpcs();
  }

  private dyo: ReturnType<typeof parseDyo> = [];
  private world = '';
  private editsAt = -1;
  private lastCheck = 0;

  /** posições dos NPCs: o .dyo original com as edições do editor (data/world-edits) por cima */
  private indexNpcs() {
    this.npcPos.clear();
    this.editsAt = editsMtime(this.world);
    for (const o of applyNpcEdits(this.dyo, loadEdits(this.world).npcs)) {
      const k = o.characterKey?.trim().toLowerCase();
      if (!k) continue;
      let a = this.npcPos.get(k);
      if (!a) this.npcPos.set(k, (a = []));
      a.push([o.pos[0], o.pos[2]]);
    }
  }

  /** o editor salvou NPCs novos? relê (confere o arquivo no máximo a cada 2 s) */
  private refreshNpcs() {
    const now = Date.now();
    if (now - this.lastCheck < 2000) return;
    this.lastCheck = now;
    if (editsMtime(this.world) !== this.editsAt) this.indexNpcs();
  }

  private parse(text: string, names: Map<string, string>) {
    const src = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    const tokens = src.match(/"[^"]*"|[A-Za-z_][A-Za-z0-9_]*|-?\d+|[{}(),;=]/g) ?? [];
    let depth = 0, key = '', shop: Shop | null = null, token: string | null = null, npcName = '';
    const tabName = new Map<number, string>();
    const finish = () => {
      if (shop && shop.tabs.some((t) => t.items.length)) {
        shop.name = nameTable()?.npcs[shop.key.toLowerCase()] || npcName || shop.key;
        shop.tabs.forEach((t, i) => { t.name = tabName.get(i) ?? `Aba ${i + 1}`; });
        shop.tabs = shop.tabs.filter((t) => t.items.length);
        if (token) this.tokenShops.set(shop.key.toLowerCase(), token);
        else this.shops.set(shop.key.toLowerCase(), shop);
      }
      shop = null; token = null; npcName = ''; tabName.clear();
    };
    const resolve = (t: string | undefined) => (t ? (t.startsWith('"') ? t.slice(1, -1) : names.get(t) ?? t) : '');
    for (let k = 0; k < tokens.length; k++) {
      const t = tokens[k];
      if (t === '{') { if (depth === 0) { shop = { key, name: '', tabs: [] }; } depth++; continue; }
      if (t === '}') { depth--; if (depth === 0) finish(); continue; }
      if (depth === 0) { if (/^[A-Za-z_]/.test(t)) key = t; continue; }
      if (!shop || tokens[k + 1] !== '(') continue;
      const args: string[] = [];
      let j = k + 2;
      while (j < tokens.length && tokens[j] !== ')') { if (tokens[j] !== ',') args.push(tokens[j]); j++; }
      k = j;
      if (t === 'AddMenu' && /^MMI_(PIERCING|SMELT_|CHANGEELEM)/.test(args[0] ?? '')) {
        const k = shop.key.toLowerCase();
        let set = this.npcMenus.get(k);
        if (!set) this.npcMenus.set(k, (set = new Set()));
        set.add(args[0]);
        continue;
      }
      if (t === 'AddShopItem') {
        const tab = Number(args[0]), id = this.items.defines.get(args[1]), price = Number(args[2]);
        if (!Number.isInteger(tab) || tab < 0 || tab > 7 || id === undefined || !this.items.byId.has(id)) continue;
        while (shop.tabs.length <= tab) shop.tabs.push({ name: '', items: [] });
        if (!shop.tabs[tab].items.some((x) => x.id === id)) shop.tabs[tab].items.push({ id, price: price > 0 ? price : this.items.byId.get(id)!.cost });
      } else if (t === 'AddVendorItem' || t === 'AddVenderItem' || t === 'AddVendorItem2' || t === 'AddVenderItem2') {
        const tab = Number(args[0]);
        if (!Number.isInteger(tab) || tab < 0 || tab > 7) continue;
        while (shop.tabs.length <= tab) shop.tabs.push({ name: '', items: [] });
        const list = shop.tabs[tab].items;
        const add = (id: number) => { const d = this.items.byId.get(id); if (d && list.length < MAX_VENDOR && !list.some((x) => x.id === id)) list.push({ id, price: Math.max(1, d.cost) }); };
        if (t.endsWith('2')) { const id = this.num(args[1]); if (id !== undefined) add(id); continue; }
        const kind3 = this.num(args[1]), job = this.num(args[2]) ?? -1, min = this.num(args[3]) ?? 0, max = this.num(args[4]) ?? min;
        if (kind3 === undefined) continue;
        for (const d of this.byKind3(kind3)) if (d.rare >= min && d.rare <= max && d.shopAble !== -1 && (job === -1 || d.job === job)) add(d.id);
      } else if (t === 'SetBuffSkill') {
        const skill = this.num(args[0]), [level, minLv, maxLv, ms] = args.slice(1, 5).map(Number);
        if (skill === undefined || !(ms > 0)) continue;
        const k = shop.key.toLowerCase();
        let list = this.npcBuffs.get(k);
        if (!list) this.npcBuffs.set(k, (list = []));
        if (!list.some((b) => b.skill === skill)) list.push({ skill, level: level || 1, minLv: minLv || 1, maxLv: maxLv || 999, ms });
      } else if (t === 'AddVendorSlot') tabName.set(Number(args[0]), resolve(args[1]));
      else if (t === 'SetVenderType') {
        // antigo: o item que serve de moeda (II_…); novo: 0 penya, 1 fichas (VENDOR_TYPE_CHIP)
        const v = this.num(args[0]);
        if (/^II_/.test(args[0] ?? '')) token = this.items.bySymbol.get(args[0])?.name ?? args[0];
        else if (v === 1) token = 'Ficha';
      }
      else if (t === 'SetName') { npcName = resolve(args[0]); this.npcNames.set(shop.key.toLowerCase(), nameTable()?.npcs[shop.key.toLowerCase()] || npcName); }
    }
  }

  /** número ou símbolo (IK3_*, JOB_*, II_*) */
  private num(s: string | undefined) { if (!s) return undefined; return /^-?\d+$/.test(s) ? Number(s) : this.items.defines.get(s); }
  /** itens de cada dwItemKind3 em ordem de raridade (CProject::m_itemKindAry) */
  private kind3Index: Map<number, ItemDef[]> | null = null;
  private byKind3(k: number) {
    if (!this.kind3Index) {
      this.kind3Index = new Map();
      for (const d of this.items.byId.values()) { let a = this.kind3Index.get(d.kind3); if (!a) this.kind3Index.set(d.kind3, (a = [])); a.push(d); }
      for (const a of this.kind3Index.values()) a.sort((x, y) => x.rare - y.rare || x.id - y.id);
    }
    return this.kind3Index.get(k) ?? [];
  }

  /** (x, z) perto de algum NPC com essa chave? */
  near(key: string, x: number, z: number) {
    this.refreshNpcs();
    const ps = this.npcPos.get(key.toLowerCase());
    return !!ps?.some(([nx, nz]) => Math.hypot(nx - x, nz - z) <= SHOP_RANGE);
  }

  /** preço de venda ao NPC (por unidade) */
  sellPrice(itemId: number) { const d = this.items.byId.get(itemId); return d ? Math.max(1, Math.floor(d.cost / 4)) : 0; }
}
