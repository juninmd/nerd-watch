/** Regras das legendas do player, sem DOM: de onde vêm, qual é a escolha e o que a tecla "c" faz. */

/** Onde o item pode buscar legenda. Sem isto o menu só oferece o arquivo escolhido pelo usuário. */
export interface CaptionContext {
  /** Título para busca textual (só a fonte que aceita texto livre usa). */
  query?: string;
  /** Id da TMDB: a busca por addon converte para IMDb. */
  tmdbId?: number;
  mediaType?: 'movie' | 'tv';
  season?: number | null;
  episode?: number | null;
  /** Item do Internet Archive: a legenda que o próprio arquivo hospeda. */
  archiveId?: string;
  /** Só oferece a legenda do arquivo quando o detalhe do item diz que ela existe. */
  archiveHasSubtitle?: boolean;
}

export const OFF = 'off';
export const ARCHIVE_OPTION = 'archive';
export const LOCAL_OPTION = 'local';
/** Opção de legenda de busca: uma por idioma, a primeira da lista (já ordenada pela preferência do servidor). */
export const languageOption = (code: string): string => `lang:${code}`;

export const canSearch = (ctx: CaptionContext | null): boolean => Boolean(ctx && (ctx.query || ctx.tmdbId));

/** Uma legenda por idioma: a busca traz várias versões (releases) do mesmo idioma, e o menu lista idioma. */
export const firstPerLanguage = <T extends { languageCode: string }>(results: T[]): T[] => {
  const seen = new Set<string>();
  return results.filter((r) => {
    if (seen.has(r.languageCode)) return false;
    seen.add(r.languageCode);
    return true;
  });
};

export interface ToggleState {
  /** Id da opção em exibição, ou `off`. */
  current: string;
  /** Última escolha do usuário nesta sessão (volta com a tecla "c"). */
  last: string | null;
  /** Opções disponíveis agora. */
  available: string[];
}

export type ToggleDecision = { kind: 'off' } | { kind: 'select'; id: string } | { kind: 'none' };

/**
 * Tecla "c": com legenda na tela, desliga; sem, volta à última escolhida, ou à primeira disponível.
 * Sem nenhuma opção, não decide nada (quem chama pode buscar antes).
 */
export const toggleDecision = (state: ToggleState): ToggleDecision => {
  if (state.current !== OFF) return { kind: 'off' };
  if (state.last !== null && state.available.includes(state.last)) return { kind: 'select', id: state.last };
  const first = state.available[0];
  return first ? { kind: 'select', id: first } : { kind: 'none' };
};

/** Legenda no idioma preferido, se a busca trouxe esse idioma. Null quando não trouxe. */
export const preferredOption = (
  available: { id: string; code: string | null }[],
  language: string | null,
): string | null => {
  if (!language) return null;
  return available.find((o) => o.code === language)?.id ?? null;
};
