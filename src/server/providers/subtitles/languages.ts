/**
 * Idiomas do protocolo de addons.
 *
 * O addon usa ISO 639-2 (três letras: `pob`, `por`, `eng`) e o resto do app usa o código de
 * exibição (`pt-BR`, `pt`, `en`). Esta tabela é a ponte — e é a única fonte de verdade das duas
 * grafias, para `normalize` e `canonical` não divergirem.
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

export interface NormalizedLanguage {
  code: string;
  label: string;
}

/** Código desconhecido não é descartado: vira o próprio código, em minúsculas, com rótulo em maiúsculas. */
export const normalizeLanguage = (raw: string): NormalizedLanguage => {
  const key = lookupKey(raw);
  return LANGUAGE_TABLE[key] ?? { code: key, label: key.toUpperCase() };
};

/** Reduz qualquer grafia ao código canônico de exibição (`eng` → `en`, `pob` → `pt-BR`). */
export const canonicalLanguage = (raw: string): string => {
  const key = lookupKey(raw);
  return LANGUAGE_TABLE[key]?.code ?? key;
};

/**
 * Um idioma configurado aceita o resultado?
 *
 * Português é tratado como grupo: quem pede `pt` aceita legenda brasileira e quem pede `pt-BR`
 * aceita portuguesa — a alternativa (exigir igualdade exata) faz o usuário não achar nada sem
 * entender por quê, que era o erro mais fácil de cometer aqui.
 */
export const languageAccepted = (resultCode: string, accepted: readonly string[]): boolean => {
  const result = canonicalLanguage(resultCode);
  const wanted = accepted.map(canonicalLanguage);
  if (wanted.includes(result)) return true;
  const portuguese = ['pt', 'pt-BR'];
  return portuguese.includes(result) && wanted.some((w) => portuguese.includes(w));
};
