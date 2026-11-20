import { describe, expect, test } from 'bun:test';
import { episodeCode, episodeState, type EpisodeView, filterEpisodes, progressFromMarker } from '../../src/client/catalog/episode-browser-model.ts';
import { heroProgress } from '../../src/client/ui/collapsing-hero.ts';

const ep = (number: number, over: Partial<EpisodeView> = {}): EpisodeView => ({
  season: 1,
  number,
  name: `Ep ${number}`,
  airDate: null,
  runtime: 30,
  overview: null,
  stillUrl: null,
  rating: null,
  ...over,
});

const ALL = [ep(1, { name: 'Pilot', rating: 7.3 }), ep(2, { name: 'Café da manhã', rating: 8.3 }), ep(3, { overview: 'Doug compra um carro', rating: 7.6 }), ep(4)];

describe('episode-browser-model', () => {
  test('busca ignora acento e caixa, e acha por número ou sinopse', () => {
    const f = { query: '', onlyUnseen: false, sort: 'number' as const };
    expect(filterEpisodes(ALL, { ...f, query: 'CAFE' }, null).map((e) => e.number)).toEqual([2]);
    expect(filterEpisodes(ALL, { ...f, query: '3' }, null).map((e) => e.number)).toEqual([3]);
    expect(filterEpisodes(ALL, { ...f, query: 'carro' }, null).map((e) => e.number)).toEqual([3]);
    expect(filterEpisodes(ALL, { ...f, query: '   ' }, null)).toHaveLength(4);
  });

  test('"só não vistos" mantém o episódio onde a pessoa parou', () => {
    const out = filterEpisodes(ALL, { query: '', onlyUnseen: true, sort: 'number' }, { season: 1, episode: 2 });
    // Ep 1 foi visto; o 2 é o marcador ("onde parou") e continua na lista para retomar.
    expect(out.map((e) => e.number)).toEqual([2, 3, 4]);
  });

  test('ordena por nota (sem nota por último) e por mais recentes sem mexer na lista original', () => {
    const before = ALL.map((e) => e.number);
    expect(filterEpisodes(ALL, { query: '', onlyUnseen: false, sort: 'rating' }, null).map((e) => e.number)).toEqual([2, 3, 1, 4]);
    expect(filterEpisodes(ALL, { query: '', onlyUnseen: false, sort: 'recent' }, null).map((e) => e.number)).toEqual([4, 3, 2, 1]);
    expect(ALL.map((e) => e.number)).toEqual(before);
  });

  test('estado do episódio segue o marcador da biblioteca', () => {
    const m = { season: 2, episode: 3 };
    expect(episodeState(m, { season: 2, number: 3 })).toBe('current');
    expect(episodeState(m, { season: 1, number: 20 })).toBe('watched');
    expect(episodeState(m, { season: 2, number: 4 })).toBe('unseen');
    expect(episodeState(null, { season: 1, number: 1 })).toBe('unseen');
  });

  test('progresso conta até o marcador e deixa especiais fora', () => {
    const seasons = [
      { number: 0, count: 5 },
      { number: 1, count: 25 },
      { number: 2, count: 25 },
    ];
    expect(progressFromMarker(seasons, null)).toEqual({ watched: 0, total: 50 });
    expect(progressFromMarker(seasons, { season: 2, episode: 4 })).toEqual({ watched: 29, total: 50 });
    // Marcador além do fim da temporada não passa do total dela.
    expect(progressFromMarker(seasons, { season: 2, episode: 99 })).toEqual({ watched: 50, total: 50 });
  });

  test('código do episódio com dois dígitos', () => {
    expect(episodeCode({ season: 3, number: 7 })).toBe('T3 · E07');
  });

  test('hero encolhe de 0 a 1 e trava nas pontas', () => {
    expect(heroProgress(-50, 400)).toBe(0);
    expect(heroProgress(200, 400)).toBe(0.5);
    expect(heroProgress(900, 400)).toBe(1);
    // Hero já do tamanho mínimo: qualquer rolagem conta como encolhido.
    expect(heroProgress(10, 0)).toBe(1);
    expect(heroProgress(0, 0)).toBe(0);
    expect(heroProgress(Number.NaN, 400)).toBe(0);
  });
});
