import { LANGS, guessLang, isLang, translate, type Dictionary, type Lang, type Params } from '../shared/i18n';
import en from '../shared/locales/en.json';

/**
 * Idioma do jogador no navegador (ver shared/i18n.ts para o formato dos textos):
 *   t(texto, params)            traduz agora (para textos montados na hora: mensagens, avisos, números)
 *   tr(el, texto, params)       põe o texto no elemento E o retraduz sozinho quando o idioma muda (títulos, rótulos de janelas)
 *   trAttr(el, attr, texto)     o mesmo para um atributo (aria-label, title, placeholder)
 *   data-i18n no HTML           traduz o texto do elemento (se ele tem filhos, só o primeiro texto solto, sem mexer nos filhos)
 *   data-i18n-attrs="a b"       traduz esses atributos (o valor escrito no HTML é a chave)
 *   onLang(fn)                  avisa quando o idioma muda (para refazer o que foi montado com t())
 * A escolha fica em localStorage (`flyff.lang`); sem ela vale o idioma do navegador. O seletor é o #langPick do login.
 */
const DICTS: Partial<Record<Lang, Dictionary>> = { en };
const STORE = 'flyff.lang';

let lang: Lang = 'en';
try { const saved = localStorage.getItem(STORE); lang = isLang(saved) ? saved : guessLang(navigator.language); } catch { lang = guessLang(typeof navigator === 'undefined' ? undefined : navigator.language); }

export const getLang = () => lang;
export const t = (key: string, params?: Params) => translate(lang, DICTS, key, params);

const listeners: (() => void)[] = [];
export const onLang = (fn: () => void) => { listeners.push(fn); };

interface Bound { ref: WeakRef<Element>; key: string; params?: Params; attr?: string }
const bound: Bound[] = [];

/** guarda (ou troca) o que o elemento mostra: um elemento tem uma só ligação por texto/atributo, a mais recente vale */
function bind(el: Element, key: string, params: Params | undefined, attr?: string) {
  const i = bound.findIndex((b) => b.attr === attr && b.ref.deref() === el);
  const entry: Bound = { ref: new WeakRef(el), key, params, attr };
  if (i >= 0) bound[i] = entry; else bound.push(entry);
}

/** texto do elemento, retraduzido a cada troca de idioma */
export function tr(el: Element, key: string, params?: Params) {
  el.textContent = t(key, params);
  bind(el, key, params);
}
/** atributo do elemento, retraduzido a cada troca de idioma */
export function trAttr(el: Element, attr: string, key: string, params?: Params) {
  el.setAttribute(attr, t(key, params));
  bind(el, key, params, attr);
}

interface DomKeys { text?: { node: Text; key: string; lead: string; trail: string }; attrs: Record<string, string> }
const dom = new WeakMap<Element, DomKeys>();

/** traduz o que está marcado com data-i18n / data-i18n-attrs (a primeira chamada guarda o texto original em português como chave) */
export function applyDom(root: ParentNode = document) {
  for (const el of root.querySelectorAll<HTMLElement>('[data-i18n], [data-i18n-attrs]')) {
    let st = dom.get(el);
    if (!st) { st = { attrs: {} }; dom.set(el, st); }
    if (el.hasAttribute('data-i18n')) {
      if (!st.text) {
        // sem filhos: o texto todo; com filhos (ex.: <label><input>Texto</label>): só o primeiro texto solto que não é vazio
        const node = [...el.childNodes].find((n): n is Text => n.nodeType === 3 && !!n.nodeValue?.trim());
        if (node) { const v = node.nodeValue ?? ''; st.text = { node, key: v.trim(), lead: v.slice(0, v.length - v.trimStart().length), trail: v.slice(v.trimEnd().length) }; }
      }
      if (st.text) st.text.node.nodeValue = st.text.lead + t(st.text.key) + st.text.trail;
    }
    for (const a of (el.dataset.i18nAttrs ?? '').split(/\s+/).filter(Boolean)) {
      st.attrs[a] ??= el.getAttribute(a) ?? '';
      if (st.attrs[a]) el.setAttribute(a, t(st.attrs[a]));
    }
  }
}

function refresh() {
  document.documentElement.lang = lang;
  applyDom();
  for (let i = bound.length - 1; i >= 0; i--) {
    const b = bound[i], el = b.ref.deref();
    if (!el) { bound.splice(i, 1); continue; }
    if (b.attr) el.setAttribute(b.attr, t(b.key, b.params)); else el.textContent = t(b.key, b.params);
  }
  for (const btn of document.querySelectorAll<HTMLElement>('#langPick [data-lang]')) btn.setAttribute('aria-pressed', String(btn.dataset.lang === lang));
  for (const fn of listeners) fn();
}

export function setLang(next: Lang) {
  if (next === lang) return;
  lang = next;
  try { localStorage.setItem(STORE, lang); } catch { /* sem armazenamento: vale só nesta visita */ }
  refresh();
}

/** liga o seletor #langPick e aplica o idioma ao HTML já na página */
export function initLang() {
  const pick = document.getElementById('langPick');
  if (pick) {
    pick.replaceChildren(...LANGS.map((l) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.lang = l.code;
      b.textContent = l.label;
      b.title = l.name;
      b.lang = l.code;
      b.addEventListener('click', () => setLang(l.code));
      return b;
    }));
  }
  refresh();
}
