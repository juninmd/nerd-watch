import { describe, expect, test } from 'bun:test';
import type { LibraryItemDto } from '../../src/client/api/index.ts';
import type { SavedViewDto } from '../../src/client/api/saved-views.ts';
import { describeQuery, smartLists } from '../../src/client/lists/smart-lists.ts';

const item = (name: string, watchStatus: LibraryItemDto['watchStatus'], source: LibraryItemDto['title']['source'], rating: number | null, posterUrl: string | null = null): LibraryItemDto =>
  ({ id: name, titleId: name, watchStatus, rating, notes: null, currentSeason: null, currentEpisode: null, rewatchCount: 0, addedAt: '', updatedAt: '', title: { id: name, sourceId: name, source, mediaType: 'tv', title: name, posterUrl, releaseDate: null, voteAverage: null } }) as LibraryItemDto;
const view = (id: string, name: string, query: Partial<SavedViewDto['query']>): SavedViewDto => ({ id, name, createdAt: '', updatedAt: '', query: { status: 'all', source: 'all', layout: 'grid', sort: 'recent', ...query } });

describe('describeQuery', () => {
  test('diz a regra em palavras e omite a origem "todas"', () => {
    expect(describeQuery({ status: 'watching', source: 'all', layout: 'grid', sort: 'rating' })).toBe('Assistindo · melhor nota');
    expect(describeQuery({ status: 'all', source: 'anilist', layout: 'list', sort: 'title' })).toBe('Qualquer status · AniList · por nome');
  });
});

describe('smartLists', () => {
  const items = [item('b', 'watching', 'tmdb', 7, 'p/b'), item('a', 'watching', 'tmdb', 9, 'p/a'), item('c', 'watched', 'archive', null)];
  test('conta e ordena pela regra da visão', () => {
    const [l] = smartLists([view('1', 'Em andamento', { status: 'watching', sort: 'rating' })], items);
    expect(l?.count).toBe(2);
    expect(l?.covers).toEqual(['p/a', 'p/b']);
  });
  test('reavalia sobre a biblioteca atual: lista vazia quando nada casa', () => {
    expect(smartLists([view('1', 'Abandonados', { status: 'dropped' })], items)[0]?.count).toBe(0);
    expect(smartLists([], items)).toEqual([]);
  });
});
