import { describe, expect, test } from 'bun:test';
import { resultMeta } from '../../src/client/catalog/search-results.tsx';

describe('resultMeta', () => {
  test('TMDB diz o tipo; as demais fontes dizem de onde vêm (a nota fica no selo do pôster)', () => {
    expect(resultMeta({ source: 'tmdb', mediaType: 'tv', releaseDate: '2008-01-20' })).toBe('série · 2008');
    expect(resultMeta({ source: 'anilist', mediaType: 'tv', releaseDate: null })).toBe('anime · AniList');
  });
});
