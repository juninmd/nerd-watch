import { describe, expect, test } from 'bun:test';
import type { LibraryItemDto } from '../../src/client/api/index.ts';
import { heroHtml, heroMeta, pickHero } from '../../src/client/home/home-hero.ts';

const item = (over: Partial<LibraryItemDto> = {}, title: Partial<LibraryItemDto['title']> = {}): LibraryItemDto => ({
  id: 'l1',
  titleId: 't1',
  watchStatus: 'watching',
  rating: null,
  notes: null,
  currentSeason: 2,
  currentEpisode: 7,
  rewatchCount: 0,
  addedAt: '',
  updatedAt: '',
  title: { id: 't1', sourceId: '1', source: 'tmdb', mediaType: 'tv', title: 'Neon Atlas', posterUrl: null, releaseDate: null, voteAverage: null, ...title },
  ...over,
});

describe('destaque Continuar', () => {
  test('mostra temporada e episódio; sem eles, o tipo', () => {
    expect(heroMeta(item())).toBe('Continuar · T2 · Ep 7');
    expect(heroMeta(item({ currentSeason: null, currentEpisode: null }))).toBe('Continuar · Série');
    expect(heroMeta(item({ currentSeason: null, currentEpisode: null }, { mediaType: 'movie' }))).toBe('Continuar · Filme');
  });

  test('sem título em andamento não há destaque', () => {
    expect(pickHero([])).toBeNull();
    expect(pickHero([item()])?.title.title).toBe('Neon Atlas');
  });

  test('título e pôster vindos de fora são escapados', () => {
    const html = heroHtml(item({}, { title: '<img src=x onerror=alert(1)>', posterUrl: 'x" onerror="alert(1)' }));
    expect(html).not.toContain('<img src=x');
    expect(html).not.toContain('" onerror="alert');
  });
});
