import type { SearchResultDto } from '../api/index.ts';

/** Até onde a lista de candidatos vai: o certo costuma estar entre os primeiros. */
export const RELINK_MAX = 8;

/**
 * Candidatos do "vínculo errado?": só fontes com ficha de série/filme (o acervo do Archive é outro tipo de item)
 * e sem o título que já está vinculado. Sem DOM.
 */
export const relinkCandidates = (results: SearchResultDto[], current: { source: string; sourceId: string }): SearchResultDto[] =>
  results
    .filter((r) => r.source !== 'archive' && !(r.source === current.source && r.sourceId === current.sourceId))
    .slice(0, RELINK_MAX);
