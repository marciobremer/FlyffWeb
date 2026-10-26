import { itemIcon } from '../shared/tga';
import { askBox, GameWindow, type InventoryWindow, type InvItem } from './ui';

/**
 * Janela do ferreiro, aberta pelo menu dos NPCs que têm as opções no character.inc oficial — Bobochan (Flaris): upgrade seguro,
 * abrir furo, remover carta, remover joia e converter arma; Peach (Flaris): extrair joia, criar orichalcum brilhante e engastar
 * joia. Os itens são escolhidos clicando na bolsa (o inventário abre junto); o servidor confere tudo e responde com o resultado
 * (servers/world/upgrade.ts). Ações que podem destruir o item pedem confirmação.
 */
export type SmithMode = 'safe' | 'pierceSize' | 'pierceRemove' | 'removeGem' | 'trans' | 'makeGem' | 'mixJewel' | 'setGem';
type Slot = 'target' | 'material' | 'gem';

interface ModeInfo { title: string; help: string; slots: Slot[]; option?: { key: 'rate' | 'safe'; label: string }; button: string }
const MODES: Record<SmithMode, ModeInfo> = {
  safe: {
    title: 'Upgrade seguro', button: 'Refinar', slots: ['target', 'material'], option: { key: 'rate', label: 'Usar pergaminho de chance (+10%) se tiver' },
    help: 'Material: Sunstone (arma/armadura), orichalcum brilhante (ultimate), moonstone (joia) ou a carta base do elemento. Cada tentativa gasta 1 material e 1 pergaminho de proteção; se falhar, o item não se perde.',
  },
  pierceSize: {
    title: 'Abrir furo (piercing)', button: 'Abrir furo', slots: ['target'], option: { key: 'safe', label: 'Usar pergaminho de proteção de piercing' },
    help: 'Abre um furo na suit com 1 moonstone e 100.000 de penya. Sem o pergaminho de proteção, se falhar a suit é destruída.',
  },
  pierceRemove: { title: 'Remover carta', button: 'Remover', slots: ['target'], help: 'Tira a última carta espetada por 1.000.000 de penya. A carta se perde.' },
  removeGem: { title: 'Remover joia da ultimate', button: 'Remover', slots: ['target'], help: 'Tira a última joia engastada na arma ultimate gastando 1 moonstone. A joia se perde.' },
  trans: {
    title: 'Converter arma', button: 'Converter', slots: ['target'], option: { key: 'safe', label: 'Usar pergaminho de proteção da ultimate (só unique)' },
    help: 'Arma geral → unique, ou unique +10 → ultimate (volta a +0). Gasta a joia do nível da arma e 1 orichalcum brilhante. Se falhar, a arma é destruída.',
  },
  makeGem: { title: 'Extrair joia', button: 'Extrair', slots: ['target'], help: 'Desmancha uma arma geral ou unique (nível 60+) e tira joias — quanto maior o upgrade, mais joias. A arma sempre se perde.' },
  mixJewel: { title: 'Criar orichalcum brilhante', button: 'Criar', slots: [], help: '5 Sunstone + 5 moonstone = 1 orichalcum brilhante (material do upgrade e da conversão de armas ultimate).' },
  setGem: { title: 'Engastar joia', button: 'Engastar', slots: ['target', 'gem'], help: 'Engasta a joia no 1º espaço livre da arma ultimate (abre 1 espaço por nível do +6 ao +10), com 90% de chance. A habilidade sai sorteada; se falhar, a joia se perde.' },
};
const SLOT_LABEL: Record<Slot, string> = { target: 'Item', material: 'Material', gem: 'Joia' };

/** símbolos dos materiais e pergaminhos (Spec_Item) */
const SUN = ['II_GEN_MAT_ORICHALCUM01', 'II_GEN_MAT_ORICHALCUM01_1'], ORI2 = 'II_GEN_MAT_ORICHALCUM02', MOON = ['II_GEN_MAT_MOONSTONE', 'II_GEN_MAT_MOONSTONE_1'];
const ELE_CARDS = ['II_GEN_MAT_ELE_FLAME', 'II_GEN_MAT_ELE_RIVER', 'II_GEN_MAT_ELE_GENERATOR', 'II_GEN_MAT_ELE_CYCLON', 'II_GEN_MAT_ELE_DESERT'];
const GEMS = ['II_GEN_MAT_TOPAZ', 'II_GEN_MAT_RUBY', 'II_GEN_MAT_SAPPHIRE', 'II_GEN_MAT_EMERALD', 'II_GEN_MAT_DIAMOND', 'II_GEN_MAT_BLACK_DIAMOND'];
const SCROLL = { prot: 'II_SYS_SYS_SCR_SMELPROT', prot3: 'II_SYS_SYS_SCR_SMELPROT3', prot4: 'II_SYS_SYS_SCR_SMELPROT4', piercing: 'II_SYS_SYS_SCR_PIEPROT' };
export const isUpgradeMaterial = (sym: string | undefined) => !!sym && (SUN.includes(sym) || sym === ORI2 || MOON.includes(sym) || ELE_CARDS.includes(sym));

export class SmithWindow extends GameWindow {
  /** manda a operação ao servidor; false = sem conexão */
  onRun: (key: string, op: SmithMode, args: { s?: number; m?: number; g?: number; safe?: boolean; rate?: boolean }) => boolean = () => false;
  private key = '';
  private mode: SmithMode = 'safe';
  private picked: Partial<Record<Slot, number>> = {};
  private helpEl = document.createElement('p');
  private slotsEl = document.createElement('div');
  private infoEl = document.createElement('ul');
  private optionEl = document.createElement('label');
  private optionBox = document.createElement('input');
  private runBtn = document.createElement('button');
  private resultEl = document.createElement('p');
  private busy = false;

  constructor(parent: HTMLElement, private inv: InventoryWindow) {
    super(parent, { id: 'smithWnd', title: 'Ferreiro', store: 'flyff.wnd.smith', initial: { x: 330, y: 140, w: 300, h: 380 }, min: { w: 270, h: 320 } });
    this.body.classList.add('smith');
    this.helpEl.className = 'smith-help';
    this.slotsEl.className = 'smith-slots';
    this.infoEl.className = 'smith-info';
    this.optionBox.type = 'checkbox';
    this.optionEl.className = 'smith-option';
    this.optionBox.addEventListener('change', () => this.render());
    this.runBtn.type = 'button';
    this.runBtn.className = 'gm-btn smith-run';
    this.runBtn.addEventListener('click', () => this.run());
    this.resultEl.className = 'smith-result';
    this.resultEl.setAttribute('role', 'status');
    this.resultEl.setAttribute('aria-live', 'polite');
    this.body.append(this.helpEl, this.slotsEl, this.infoEl, this.optionEl, this.runBtn, this.resultEl);
    this.onClose = () => { this.inv.pick = null; };
  }

  /** abre no modo `mode` para o NPC `key` (o inventário abre junto para escolher os itens) */
  open(key: string, mode: SmithMode) {
    this.ask?.();
    this.key = key;
    this.mode = mode;
    this.picked = {};
    this.busy = false;
    this.resultEl.textContent = '';
    this.resultEl.className = 'smith-result';
    this.optionBox.checked = mode === 'safe';
    this.setTitle(MODES[mode].title);
    this.inv.show();
    this.inv.pick = (c, s) => this.pickItem(c, s);
    this.show();
    this.render();
  }

  hide() { super.hide(); this.inv.pick = null; this.ask?.(); }

  /** inventário mudou: some quem saiu do lugar e redesenha */
  refresh() {
    if (!this.visible) return;
    for (const k of Object.keys(this.picked) as Slot[]) if (!this.inv.item(0, this.picked[k]!)) delete this.picked[k];
    this.render();
  }

  /** resposta do servidor */
  result(ok: boolean, fx: 'success' | 'fail' | null, slot: number | null, text: string) {
    if (!this.visible) return;
    this.busy = false;
    this.resultEl.textContent = text;
    this.resultEl.className = `smith-result ${fx === 'success' ? 'ok' : fx === 'fail' ? 'fail' : 'refused'}`;
    // o item continua (sucesso ou falha protegida) no mesmo espaço; o material/joia gasto pode ter acabado
    if (slot !== null && this.picked.target !== undefined) this.picked.target = slot;
    if (fx && this.picked.gem !== undefined && !this.inv.item(0, this.picked.gem)) delete this.picked.gem;
    this.refresh();
    this.render();
  }

  private sym(it: InvItem | undefined) { return it ? this.inv.def(it.id)?.sym : undefined; }
  private count(syms: string[]) { let n = 0; for (const i of this.inv.bagItems()) if (syms.includes(this.inv.def(i.id)?.sym ?? '')) n += i.n; return n; }

  private pickItem(c: number, s: number) {
    if (c !== 0) { this.resultEl.textContent = 'Escolha itens da bolsa (o equipado não serve: tire antes).'; this.resultEl.className = 'smith-result refused'; return; }
    const it = this.inv.item(0, s), sym = this.sym(it), info = MODES[this.mode];
    if (!it) return;
    let slot: Slot = 'target';
    if (info.slots.includes('material') && isUpgradeMaterial(sym)) slot = 'material';
    else if (info.slots.includes('gem') && GEMS.includes(sym ?? '')) slot = 'gem';
    else if (!info.slots.includes('target')) return;
    this.picked[slot] = s;
    this.resultEl.textContent = '';
    this.render();
  }

  private render() {
    const info = MODES[this.mode];
    this.helpEl.textContent = info.help;
    this.runBtn.textContent = info.button;
    // espaços (item/material/joia): ícone + nome; clicar limpa
    this.slotsEl.replaceChildren();
    for (const slot of info.slots) {
      const s = this.picked[slot], it = s === undefined ? undefined : this.inv.item(0, s), d = it && this.inv.def(it.id);
      const box = document.createElement('button');
      box.type = 'button';
      box.className = `smith-slot${it ? ' has' : ''}`;
      box.title = it ? 'Clique para tirar' : `Clique num item da bolsa para escolher (${SLOT_LABEL[slot].toLowerCase()})`;
      const img = document.createElement('img');
      img.alt = '';
      if (d?.icon) void itemIcon(d.icon).then((u) => { if (u) img.src = u; });
      const label = document.createElement('span');
      label.textContent = d ? `${d.name}${it!.u ? ` +${it!.u}` : ''}${it!.e ? ` · elemento +${it!.el}` : ''}` : `${SLOT_LABEL[slot]}: clique na bolsa`;
      box.append(img, label);
      box.addEventListener('click', () => { delete this.picked[slot]; this.render(); });
      this.slotsEl.appendChild(box);
    }
    // o que vai gastar / o que tem na bolsa
    this.infoEl.replaceChildren();
    const line = (text: string, ok = true) => { const li = document.createElement('li'); li.textContent = text; li.classList.toggle('missing', !ok); this.infoEl.appendChild(li); };
    const target = this.picked.target !== undefined ? this.inv.item(0, this.picked.target) : undefined, td = target && this.inv.def(target.id);
    const matSym = this.sym(this.picked.material !== undefined ? this.inv.item(0, this.picked.material) : undefined);
    const has = (syms: string[], name: string, n = 1) => { const k = this.count(syms); line(`${name}: ${k} na bolsa${n > 1 ? ` (precisa ${n})` : ''}`, k >= n); };
    switch (this.mode) {
      case 'safe': {
        const prot = matSym === ORI2 ? SCROLL.prot3 : matSym && MOON.includes(matSym) ? SCROLL.prot4 : SCROLL.prot;
        const protName = prot === SCROLL.prot3 ? 'Proteção da ultimate (SMELPROT3)' : prot === SCROLL.prot4 ? 'Proteção de joias (SMELPROT4)' : 'Pergaminho de proteção (SMELPROT)';
        has([prot], protName);
        if (matSym) has([matSym], 'Material escolhido');
        if (td && target) line(`Agora: +${target.u}${target.e ? ` · elemento +${target.el}` : ''}`);
        break;
      }
      case 'pierceSize': has(MOON, 'Moonstone'); if (this.optionBox.checked) has([SCROLL.piercing], 'Proteção de piercing'); line('Custo: 100.000 penya'); if (target) line(`Furos agora: ${target.p?.length ?? 0}`); break;
      case 'pierceRemove': line('Custo: 1.000.000 penya'); if (target) line(`Cartas: ${(target.p ?? []).filter((c) => c).length}`); break;
      case 'removeGem': has(MOON, 'Moonstone'); if (target) line(`Joias: ${(target.g ?? []).filter((g) => g).length}/${target.g?.length ?? 0}`); break;
      case 'trans': has([ORI2], 'Orichalcum brilhante'); line('Joia do nível da arma (Topaz 60–70, Ruby 71–85, Sapphire 86–100, Emerald 101–119, Diamond 120–129…)'); if (td?.to) line(`Vira: ${td.to}`); if (this.optionBox.checked) has([SCROLL.prot3], 'Proteção da ultimate'); break;
      case 'makeGem': if (target) line(`Upgrade da arma: +${target.u} (mais upgrade, mais joias)`); break;
      case 'mixJewel': has(SUN, 'Sunstone', 5); has(MOON, 'Moonstone', 5); break;
      case 'setGem': if (target) line(`Espaços livres: ${(target.g ?? []).filter((g) => !g).length}`); break;
    }
    // opção (pergaminho de chance / proteção)
    this.optionEl.hidden = !info.option;
    if (info.option) { this.optionEl.replaceChildren(this.optionBox, document.createTextNode(` ${info.option.label}`)); }
    const ready = info.slots.every((s) => this.picked[s] !== undefined);
    this.runBtn.disabled = !ready || this.busy;
  }

  private run() {
    const info = MODES[this.mode];
    if (this.busy || !info.slots.every((s) => this.picked[s] !== undefined)) return;
    const target = this.picked.target !== undefined ? this.inv.item(0, this.picked.target) : undefined, td = target && this.inv.def(target.id);
    const name = td ? `${td.name}${target!.u ? ` +${target!.u}` : ''}` : '';
    // ações que podem destruir o item: confirma antes
    const risk = this.mode === 'makeGem' ? `${name} vai ser desmanchada para tirar as joias — a arma sempre se perde.`
      : this.mode === 'pierceSize' && !this.optionBox.checked ? `Sem o pergaminho de proteção, se falhar ${name} é destruída.`
      : this.mode === 'trans' && !(this.optionBox.checked && td?.ref === 1) ? `Se falhar, ${name} é destruída.` : '';
    if (!risk) { this.send(); return; }
    this.ask?.();
    const a = askBox(this.body, risk, info.button);
    this.ask = a.close;
    void a.done.then((yes) => { if (this.ask === a.close) this.ask = null; if (yes) this.send(); });
  }

  /** pergunta aberta (fecha ao trocar de modo, fechar a janela ou o servidor responder) */
  private ask: (() => void) | null = null;

  private send() {
    const info = MODES[this.mode];
    if (this.busy || !info.slots.every((s) => this.picked[s] !== undefined)) return;
    const opt = info.option?.key, checked = this.optionBox.checked;
    const ok = this.onRun(this.key, this.mode, { s: this.picked.target, m: this.picked.material, g: this.picked.gem, ...(opt === 'safe' ? { safe: checked } : {}), ...(opt === 'rate' ? { rate: checked } : {}) });
    if (!ok) { this.resultEl.textContent = 'Sem conexão com o servidor.'; return; }
    this.busy = true;
    this.resultEl.textContent = 'Trabalhando…';
    this.resultEl.className = 'smith-result';
    this.render();
  }
}

/** opções do menu do NPC (MMI_* do character.inc) → modo da janela; várias MMI_SMELT_SAFETY_* viram um "Upgrade seguro" só */
export function smithOptions(menus: string[]): { label: string; mode: SmithMode }[] {
  const has = (...k: string[]) => k.some((x) => menus.includes(x));
  const out: { label: string; mode: SmithMode }[] = [];
  if (has('MMI_SMELT_SAFETY_GENERAL', 'MMI_SMELT_SAFETY_ACCESSORY', 'MMI_SMELT_SAFETY_ELEMENT', 'MMI_SMELT_SAFETY_PIERCING')) out.push({ label: 'Upgrade seguro', mode: 'safe' });
  if (has('MMI_PIERCING')) out.push({ label: 'Abrir furo (piercing)', mode: 'pierceSize' });
  if (has('MMI_SMELT_REMOVE_PIERCING', 'MMI_PIERCING_REMOVE')) out.push({ label: 'Remover carta', mode: 'pierceRemove' });
  if (has('MMI_SMELT_REMOVE_JEWEL')) out.push({ label: 'Remover joia da ultimate', mode: 'removeGem' });
  if (has('MMI_SMELT_CHANGEGWEAPON', 'MMI_SMELT_CHANGEUWEAPON')) out.push({ label: 'Converter arma (unique/ultimate)', mode: 'trans' });
  if (has('MMI_SMELT_EXTRACTION')) out.push({ label: 'Extrair joia', mode: 'makeGem' });
  if (has('MMI_SMELT_MIXJEWEL')) out.push({ label: 'Criar orichalcum brilhante', mode: 'mixJewel' });
  if (has('MMI_SMELT_JEWEL')) out.push({ label: 'Engastar joia', mode: 'setGem' });
  return out;
}
