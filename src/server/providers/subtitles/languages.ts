/**
 * Idiomas do protocolo de addons.
 *
 * O addon usa ISO 639-2 (três letras: `pob`, `por`, `eng`) e o app usa o código de exibição
 * (`pt-BR`, `pt`, `en`). Esta tabela é a única fonte de verdade das duas grafias, para `normalize`
 * e `canonical` não divergirem.
 *
 * `pob` é "Portuguese (Brazil)" e `por` é português genérico: a distinção importa, porque quem
 * configurou `pt-BR` não quer receber legenda de Portugal sem pedir.
 */
const LANGUAGE_TABLE: Record<string, { code: string; label: string }> = {
  pob: { code: 'pt-BR', label: 'Português (BR)' },
  pb: { code: 'pt-BR', label: 'Português (BR)' },
  'pt-br': { code: 'pt-BR', label: 'Português (BR)' },
  por: { code: 'pt', label: 'Português' },
  pt: { code: 'pt', label: 'Português' },
  eng: { code: 'en', label: 'Inglês' },
  en: { code: 'en', label: 'Inglês' },
  spa: { code: 'es', label: 'Espanhol' },
  es: { code: 'es', label: 'Espanhol' },
};

/** `PT_BR`, `pt-br` e `pob` precisam cair na mesma chave antes de qualquer comparação. */
const lookupKey = (raw: string): string => raw.trim().toLowerCase().replace(/_/g, '-');

/** A entrada da tabela para um código, já resolvendo variante de região (`en-US` → `en`). */
const entryFor = (raw: string): { code: string; label: string } | undefined => {
  const key = lookupKey(raw);
  const direct = LANGUAGE_TABLE[key];
  if (direct) return direct;
  // `en-US`, `es-419`, `pt-BR`…: a base manda, quando é conhecida.
  const base = key.split('-')[0] ?? key;
  return LANGUAGE_TABLE[base];
};

export interface NormalizedLanguage {
  code: string;
  label: string;
}

/**
 * Código desconhecido não é descartado: vira o próprio código, em minúsculas, com rótulo em
 * maiúsculas (`hun` → `{ code: 'hun', label: 'HUN' }`).
 */
export const normalizeLanguage = (raw: string): NormalizedLanguage => {
  const entry = entryFor(raw);
  if (entry) return entry;
  const key = lookupKey(raw);
  return { code: key, label: key.toUpperCase() };
};

/** Reduz qualquer grafia ao código canônico de exibição (`eng` → `en`, `pob` → `pt-BR`, `en-US` → `en`). */
export const canonicalLanguage = (raw: string): string => normalizeLanguage(raw).code;

/**
 * Um idioma configurado aceita o resultado? Semântica de **grupo**.
 *
 * Português é um grupo: quem pede `pt` aceita legenda brasileira e quem pede `pt-BR` aceita
 * portuguesa — exigir igualdade exata faz o usuário não achar nada sem entender por quê.
 *
 * Atenção: isto é filtro, não ordenação. Para ordenar, use `languageRank` — com semântica de grupo
 * os dois códigos empatam, e aí a ordem configurada (`pt-BR` antes de `pt`) não seria respeitada.
 */
export const languageAccepted = (resultCode: string, accepted: readonly string[]): boolean => {
  const result = canonicalLanguage(resultCode);
  const wanted = accepted.map(canonicalLanguage);
  if (wanted.includes(result)) return true;
  const portuguese = ['pt', 'pt-BR'];
  return portuguese.includes(result) && wanted.some((w) => portuguese.includes(w));
};

/**
 * Posição do idioma na lista de preferência. Correspondência exata vence; um código que só casa
 * por grupo (e não está na lista) vai para o fim. É o que faz `pt-BR` vir antes de `pt` quando a
 * configuração é `pt-BR,pt,en`.
 */
export const languageRank = (resultCode: string, preferred: readonly string[]): number => {
  const result = canonicalLanguage(resultCode);
  const exact = preferred.findIndex((wanted) => canonicalLanguage(wanted) === result);
  if (exact !== -1) return exact;
  return languageAccepted(result, preferred) ? preferred.length : preferred.length + 1;
};
