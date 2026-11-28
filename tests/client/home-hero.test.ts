import { describe, expect, test } from 'bun:test';
import type { LibraryItemDto } from '../../src/client/api/index.ts';
import { HERO_MAX, heroMeta, heroSlides, nextSlide } from '../../src/client/home/home-hero.ts';

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
    expect(heroSlides([])).toEqual([]);
  });

  test('episódio novo sobe para o primeiro slide; o resto segue a ordem de atividade', () => {
    const list = [item({ titleId: 'a' }), item({ titleId: 'b' }), item({ titleId: 'c' })];
    const slides = heroSlides(list, new Map([['c', 2]]));
    expect(slides.map((s) => s.item.titleId)).toEqual(['c', 'a', 'b']);
    expect(slides[0]?.kicker).toBe('2 episódios novos');
    expect(slides[1]?.kicker).toBe('Nº 1 em andamento');
  });

  test('gira no máximo HERO_MAX títulos e dá a volta', () => {
    const many = Array.from({ length: 9 }, (_, i) => item({ titleId: String(i) }));
    expect(heroSlides(many)).toHaveLength(HERO_MAX);
    expect(nextSlide(4, 5)).toBe(0);
    expect(nextSlide(0, 5, -1)).toBe(4);
    expect(nextSlide(0, 0)).toBe(0);
  });
});
