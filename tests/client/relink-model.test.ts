import { describe, expect, test } from 'bun:test';
import type { SearchResultDto } from '../../src/client/api/index.ts';
import { RELINK_MAX, relinkCandidates } from '../../src/client/library/relink-model.ts';

const hit = (source: SearchResultDto['source'], sourceId: string): SearchResultDto => ({
  source,
  sourceId,
  mediaType: 'movie',
  title: `T${sourceId}`,
  overview: '',
  posterUrl: null,
  releaseDate: null,
  voteAverage: null,
});

describe('candidatos do "vínculo errado?"', () => {
  test('tira o título atual e itens do acervo, que não são filme/série de catálogo', () => {
    const out = relinkCandidates([hit('tmdb', '1'), hit('tmdb', '2'), hit('archive', 'x'), hit('tvmaze', '1')], { source: 'tmdb', sourceId: '1' });
    expect(out.map((r) => `${r.source}:${r.sourceId}`)).toEqual(['tmdb:2', 'tvmaze:1']);
  });

  test('limita a quantidade', () => {
    const many = Array.from({ length: 20 }, (_, i) => hit('tmdb', String(i + 10)));
    expect(relinkCandidates(many, { source: 'tmdb', sourceId: '1' })).toHaveLength(RELINK_MAX);
  });
});
