import { afterEach, describe, expect, test } from 'bun:test';
import { config } from '../src/server/config.ts';
import { anilistDetails } from '../src/server/providers/anilist.ts';
import { fetchTmdbTitleDetails } from '../src/server/providers/tmdb.ts';
import { tvmazeShowDetails } from '../src/server/providers/tvmaze.ts';

/** Mapeamento de gênero e duração de cada provider, com a resposta HTTP fingida (sem rede). */
const realFetch = globalThis.fetch;
const realKey = config.tmdb.apiKey;
const json = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
const respondWith = (body: unknown): void => {
  globalThis.fetch = (async () => json(body)) as unknown as typeof fetch;
};

afterEach(() => {
  globalThis.fetch = realFetch;
  Object.assign(config.tmdb, { apiKey: realKey });
});

describe('TMDB: gêneros e duração do detalhe', () => {
  test('filme usa runtime; gêneros viram nomes', async () => {
    Object.assign(config.tmdb, { apiKey: 'chave-de-teste' });
    respondWith({
      id: 1,
      title: 'Filme',
      overview: '',
      poster_path: null,
      backdrop_path: null,
      release_date: '2020-01-01',
      vote_average: 7,
      status: 'Released',
      runtime: 117,
      genres: [
        { id: 18, name: 'Drama' },
        { id: 53, name: 'Suspense' },
      ],
    });
    const d = await fetchTmdbTitleDetails('movie', 1);
    expect(d.genres).toEqual(['Drama', 'Suspense']);
    expect(d.runtimeMinutes).toBe(117);
  });

  test('série usa o primeiro episode_run_time; resposta sem genres vira lista vazia (não fica pendente)', async () => {
    Object.assign(config.tmdb, { apiKey: 'chave-de-teste' });
    respondWith({
      id: 2,
      name: 'Série',
      overview: '',
      poster_path: null,
      backdrop_path: null,
      first_air_date: '2020-01-01',
      vote_average: 7,
      status: 'Ended',
      episode_run_time: [42, 50],
    });
    const d = await fetchTmdbTitleDetails('tv', 2);
    expect(d.genres).toEqual([]);
    expect(d.runtimeMinutes).toBe(42);
  });
});

describe('TVmaze: gêneros e duração do show', () => {
  test('usa averageRuntime (duração típica) e a lista de gêneros', async () => {
    respondWith({
      id: 91001,
      name: 'Show',
      premiered: '2019-05-01',
      status: 'Running',
      summary: null,
      rating: { average: 8 },
      genres: ['Comedy', 'Drama'],
      averageRuntime: 30,
      runtime: 30,
      _embedded: { episodes: [] },
    });
    const d = await tvmazeShowDetails(91001);
    expect(d.genres).toEqual(['Comedy', 'Drama']);
    expect(d.runtimeMinutes).toBe(30);
  });

  test('sem gêneros nem duração: lista vazia e duração nula, sem exceção', async () => {
    respondWith({
      id: 91002,
      name: 'Show',
      premiered: null,
      status: null,
      summary: null,
      rating: null,
      _embedded: { episodes: [] },
    });
    const d = await tvmazeShowDetails(91002);
    expect(d.genres).toEqual([]);
    expect(d.runtimeMinutes).toBeNull();
  });
});

describe('AniList: gêneros e duração do anime (duration = minutos por episódio)', () => {
  test('mapeia genres e duration do detalhe', async () => {
    respondWith({
      data: {
        Media: {
          id: 93001,
          siteUrl: 'https://anilist.co/anime/93001',
          title: { romaji: 'Teste', english: null, native: null },
          format: 'TV',
          status: 'FINISHED',
          startDate: { year: 2015 },
          coverImage: { large: null },
          averageScore: 80,
          episodes: 24,
          duration: 24,
          genres: ['Action', 'Fantasy'],
          description: null,
          nextAiringEpisode: null,
        },
      },
    });
    const d = await anilistDetails(93001);
    expect(d.genres).toEqual(['Action', 'Fantasy']);
    expect(d.runtimeMinutes).toBe(24);
  });
});
