/**
 * Idiomas do jogo: português do Brasil (pt-BR, o idioma em que o código foi escrito) e inglês (en).
 *
 * O texto em português É a chave: `t('Sem conexão com o servidor.')` devolve o inglês quando o idioma é `en` e o próprio texto
 * quando é `pt-BR` ou quando falta a tradução — assim dá para traduzir arquivo por arquivo sem quebrar nada. O dicionário
 * inglês fica em `shared/locales/en.json` (português → inglês). Valores variáveis entram como `{nome}`:
 * `t('Você ainda não aprendeu {name}.', { name })` (a chave tem o `{name}`, nunca o valor já colado).
 *
 * Este módulo é PURO (sem `localStorage`, `document` ou `navigator`): o servidor também o usa, com o idioma de cada conexão
 * como parâmetro. A escolha do jogador no navegador mora em `client/lang.ts`.
 */
export type Lang = 'pt-BR' | 'en';
export type Params = Record<string, string | number>;
export type Dictionary = Record<string, string>;

export const DEFAULT_LANG: Lang = 'pt-BR';
/** rótulos dos botões do seletor (texto puro: bandeiras em emoji não aparecem no Windows) */
export const LANGS: readonly { code: Lang; label: string; name: string }[] = [
  { code: 'pt-BR', label: 'PT-BR', name: 'Português (Brasil)' },
  { code: 'en', label: 'EN', name: 'English' },
];

export const isLang = (v: unknown): v is Lang => v === 'pt-BR' || v === 'en';

/** idioma sugerido pelo navegador (`navigator.language`): qualquer português vira pt-BR, o resto vira inglês */
export const guessLang = (browserLang: string | undefined): Lang => (browserLang && browserLang.toLowerCase().startsWith('pt') ? 'pt-BR' : 'en');

/** troca `{nome}` pelos valores (o que não tem valor fica como está) */
export function format(text: string, params?: Params): string {
  return params ? text.replace(/\{(\w+)\}/g, (m, k: string) => (k in params ? String(params[k]) : m)) : text;
}

/** traduz `key` para `lang` com os dicionários dados (`pt-BR` não precisa de dicionário: a chave já é o texto) */
export function translate(lang: Lang, dicts: Partial<Record<Lang, Dictionary>>, key: string, params?: Params): string {
  return format(dicts[lang]?.[key] ?? key, params);
}
