import { describe, expect, test } from 'bun:test';
import { resultMeta } from '../../src/client/catalog/search-results.tsx';

describe('resultMeta', () => {
  test('TMDB diz o tipo; as demais fontes dizem de onde vêm', () => {
    expect(resultMeta({ source: 'tmdb', mediaType: 'tv', releaseDate: '2008-01-20', voteAverage: 8.94 })).toBe(
      'série · 2008 · ⭐ 8.9',
    );
    expect(resultMeta({ source: 'anilist', mediaType: 'tv', releaseDate: null, voteAverage: null })).toBe(
      'anime · AniList',
    );
  });
});
