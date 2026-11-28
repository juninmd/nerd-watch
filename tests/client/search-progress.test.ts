import { describe, expect, test } from 'bun:test';
import type { SearchResponse, SearchResultDto } from '../../src/client/api/catalog.ts';
import { pushRecent, RECENT_MAX } from '../../src/client/catalog/search-history.ts';
import { addPart, mergedResponse, startProgress } from '../../src/client/catalog/search-progress.ts';

const hit = (source: SearchResultDto['source'], id: string): SearchResultDto => ({
  source,
  sourceId: id,
  mediaType: 'tv',
  title: id,
  overview: '',
  posterUrl: null,
  releaseDate: null,
  voteAverage: null,
});
const res = (results: SearchResultDto[], tmdbEnabled = false): SearchResponse => ({ results, addonResults: [], tmdbEnabled });

describe('busca aos pedaços', () => {
  test('a grade segue a ordem das fontes, não a de chegada', () => {
    let p = startProgress();
    p = addPart(p, 'archive', res([hit('archive', 'a1')]));
    p = addPart(p, 'tmdb', res([hit('tmdb', 't1')], true));
    expect(mergedResponse(p).results.map((r) => r.sourceId)).toEqual(['t1', 'a1']);
    expect(mergedResponse(p).tmdbEnabled).toBe(true);
    expect(p.pending).toEqual(['tvmaze', 'anilist', 'addons']);
  });

  test('fonte que falha sai da espera e fica marcada', () => {
    const p = addPart(startProgress(), 'anilist', null);
    expect(p.pending).not.toContain('anilist');
    expect(p.failed).toEqual(['anilist']);
    expect(mergedResponse(p).results).toEqual([]);
  });
});

describe('buscas recentes', () => {
  test('a mais nova vai ao topo, sem duplicar por caixa, com limite', () => {
    expect(pushRecent(['dune', 'Frieren'], 'frieren')).toEqual(['frieren', 'dune']);
    expect(pushRecent(['a'], '   ')).toEqual(['a']);
    const many = Array.from({ length: 20 }, (_, i) => `q${i}`);
    expect(pushRecent(many, 'nova')).toHaveLength(RECENT_MAX);
  });
});
