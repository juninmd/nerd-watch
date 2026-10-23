import type { TmdbEpisode, TmdbSeasonSummary, TmdbTitleDetails } from '../../src/server/providers/tmdb.ts';

/** Fixtures da TMDB para os testes de refresh. Nada aqui toca a rede: os fakes só devolvem o que o teste preparou. */

export const season = (n: number, episodeCount = 2): TmdbSeasonSummary => ({
  season_number: n,
  name: `Temporada ${n}`,
  overview: '',
  air_date: '2020-01-01',
  poster_path: null,
  episode_count: episodeCount,
});

export const episode = (n: number, airDate: string | null, name = `Episódio ${n}`): TmdbEpisode => ({
  episode_number: n,
  name,
  overview: '',
  air_date: airDate,
  runtime: 45,
  still_path: null,
});

export const tvDetails = (overrides: Partial<TmdbTitleDetails> = {}): TmdbTitleDetails => ({
  id: 1399,
  title: 'Série Fake',
  overview: 'Sinopse',
  poster_path: '/poster.jpg',
  backdrop_path: '/backdrop.jpg',
  release_date: '2020-01-01',
  vote_average: 8.1,
  status: 'Returning Series',
  seasons: [season(1)],
  ...overrides,
});

export const movieDetails = (overrides: Partial<TmdbTitleDetails> = {}): TmdbTitleDetails => ({
  ...tvDetails(),
  id: 603,
  title: 'Filme Fake',
  status: 'Released',
  seasons: undefined,
  ...overrides,
});

/** Provider falso: `state` é mutável, então o teste troca dados ou injeta erro entre uma chamada e outra. */
export interface FakeTmdbState {
  details: TmdbTitleDetails;
  seasons: Record<number, TmdbEpisode[]>;
  /** Erro lançado por qualquer chamada, quando definido. */
  error?: unknown;
  /** Temporada que falha sozinha (erro de uma chamada no meio do refresh). */
  failSeason?: { seasonNumber: number; error: unknown };
}

export const fakeTmdb = (state: FakeTmdbState) => ({
  fetchDetails: async (): Promise<TmdbTitleDetails> => {
    if (state.error) throw state.error;
    return state.details;
  },
  fetchSeasonEpisodes: async (_tvId: number, seasonNumber: number): Promise<TmdbEpisode[]> => {
    if (state.error) throw state.error;
    if (state.failSeason?.seasonNumber === seasonNumber) throw state.failSeason.error;
    return state.seasons[seasonNumber] ?? [];
  },
});
