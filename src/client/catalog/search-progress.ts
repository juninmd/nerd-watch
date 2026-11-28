import { SEARCH_SOURCES, type SearchResponse, type SearchSource } from '../api/catalog.ts';

/** Busca que chega aos pedaços: o que já respondeu, o que falta e se a TMDB está ligada. Sem DOM. */
export interface SearchProgress {
  parts: Partial<Record<SearchSource, SearchResponse>>;
  pending: SearchSource[];
  failed: SearchSource[];
}

export const startProgress = (): SearchProgress => ({ parts: {}, pending: [...SEARCH_SOURCES], failed: [] });

export const addPart = (p: SearchProgress, source: SearchSource, res: SearchResponse | null): SearchProgress => ({
  parts: res ? { ...p.parts, [source]: res } : p.parts,
  pending: p.pending.filter((s) => s !== source),
  failed: res ? p.failed : [...p.failed, source],
});

/** Junta na ordem fixa das fontes (a grade não pula conforme a ordem de chegada). */
export const mergedResponse = (p: SearchProgress): SearchResponse => {
  const parts = SEARCH_SOURCES.map((s) => p.parts[s]).filter((x): x is SearchResponse => Boolean(x));
  return {
    results: parts.flatMap((x) => x.results),
    addonResults: parts.flatMap((x) => x.addonResults ?? []),
    tmdbEnabled: parts.length ? parts.some((x) => x.tmdbEnabled) : true,
  };
};

export const SOURCE_LABEL: Record<SearchSource, string> = {
  tmdb: 'TMDB',
  tvmaze: 'TVmaze',
  anilist: 'AniList',
  archive: 'Internet Archive',
  addons: 'addons',
};
