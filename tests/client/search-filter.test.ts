import { describe, expect, test } from 'bun:test';
import { countByKind, filterByKind, kindOf } from '../../src/client/catalog/search-filter.ts';

const r = (source: 'tmdb' | 'tvmaze' | 'anilist' | 'archive', mediaType: 'movie' | 'tv') => ({ source, mediaType });
const items = [r('tmdb', 'movie'), r('tmdb', 'tv'), r('tvmaze', 'tv'), r('anilist', 'tv'), r('archive', 'movie')];

describe('search-filter', () => {
  test('anime e acervo têm prioridade sobre o tipo de mídia', () => {
    expect(kindOf(r('anilist', 'tv'))).toBe('anime');
    expect(kindOf(r('archive', 'movie'))).toBe('archive');
  });

  test('cada resultado cai em um único filtro e a soma bate com o total', () => {
    const c = countByKind(items);
    expect(c).toEqual({ all: 5, movie: 1, tv: 2, anime: 1, archive: 1 });
    expect(c.movie + c.tv + c.anime + c.archive).toBe(c.all);
  });

  test('"all" devolve tudo e um filtro vazio devolve lista vazia', () => {
    expect(filterByKind(items, 'all')).toHaveLength(5);
    expect(filterByKind([r('tmdb', 'movie')], 'anime')).toEqual([]);
  });
});
