import { traktOAuth } from '../src/server/providers/trakt/oauth.ts';
import type { TmdbLookup } from '../src/server/providers/trakt/import.ts';
import type { TmdbTitleDetails } from '../src/server/providers/tmdb.ts';

/*
 * Fixtures de teste, sem rede. O formato segue os objetos padrão do Trakt (movie/show com `ids`, watched com
 * `seasons[].episodes[].number`). Não são respostas reais de uma conta.
 */

export const TOKEN_URL = 'https://auth.trakt.tv/oauth/token';

export interface RemoteLists {
  movies: unknown[];
  shows: unknown[];
}

export interface FakeCall {
  method: string;
  url: string;
  body: Record<string, unknown> | undefined;
}

export const movieWatched = (tmdb: number, title = 'Filme Fake') => ({
  plays: 1,
  last_watched_at: '2026-01-02T10:00:00.000Z',
  movie: { title, year: 2001, ids: { trakt: tmdb + 1000, slug: `filme-${tmdb}`, imdb: `tt${tmdb}`, tmdb } },
});

export const showWatched = (tmdb: number, episodes: Record<number, number[]>, title = 'Série Fake') => ({
  plays: 3,
  last_watched_at: '2026-01-05T10:00:00.000Z',
  reset_at: null,
  show: { title, year: 2010, ids: { trakt: tmdb + 2000, slug: `serie-${tmdb}`, tvdb: tmdb, imdb: `tt${tmdb}`, tmdb } },
  seasons: Object.entries(episodes).map(([season, eps]) => ({
    number: Number(season),
    episodes: eps.map((number) => ({ number, plays: 1, last_watched_at: '2026-01-05T10:00:00.000Z' })),
  })),
});

/** O token endpoint recebe formulário; a API recebe JSON. O fake aceita os dois. */
const parseBody = (raw: string): Record<string, unknown> => {
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return Object.fromEntries(new URLSearchParams(raw));
  }
};

/**
 * Trakt falso: serve as listas assistidas (e as atualiza quando recebe POST /sync/history, como o real faz),
 * registra cada chamada e deixa o teste escolher a resposta do history.
 */
export const installFakeTrakt = (remote: RemoteLists, opts: { history?: () => Response; tokenError?: boolean } = {}) => {
  const calls: FakeCall[] = [];
  const fetchFn = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const body = typeof init?.body === 'string' ? parseBody(init.body) : undefined;
    calls.push({ method, url, body });
    if (url === TOKEN_URL) {
      if (opts.tokenError) return Response.json({ error: 'invalid_grant' }, { status: 400 });
      return Response.json({ access_token: 'fake-access', refresh_token: 'fake-refresh-2', expires_in: 604800 });
    }
    if (url.endsWith('/sync/watched/movies')) return Response.json(remote.movies);
    if (url.endsWith('/sync/watched/shows')) return Response.json(remote.shows);
    if (url.endsWith('/sync/history') && method === 'POST') {
      if (opts.history) return opts.history();
      const movies = (body?.movies as Array<{ ids: { tmdb: number } }> | undefined) ?? [];
      const shows = (body?.shows as Array<{ ids: { tmdb: number } }> | undefined) ?? [];
      for (const m of movies) remote.movies.push(movieWatched(m.ids.tmdb));
      for (const s of shows) remote.shows.push(showWatched(s.ids.tmdb, {}));
      return Response.json({ added: { movies: movies.length, episodes: 0 }, existing: {}, not_found: {} });
    }
    return new Response('rota falsa não prevista', { status: 404 });
  };
  traktOAuth.resetForTests();
  traktOAuth.setFetchForTests(fetchFn);
  return { calls, fetchFn };
};

export const connectEnv = (): void => {
  process.env.TRAKT_CLIENT_ID = 'fake-client';
  process.env.TRAKT_CLIENT_SECRET = 'fake-secret';
  process.env.TRAKT_REFRESH_TOKEN = 'fake-refresh';
};

export const disconnectEnv = (): void => {
  delete process.env.TRAKT_CLIENT_ID;
  delete process.env.TRAKT_CLIENT_SECRET;
  delete process.env.TRAKT_REFRESH_TOKEN;
  traktOAuth.setFetchForTests();
  traktOAuth.resetForTests();
};

export const details = (title: string, seasons?: Array<{ season_number: number; episode_count: number }>): TmdbTitleDetails => ({
  id: 1,
  title,
  overview: 'Sinopse fictícia.',
  poster_path: '/fake-poster.jpg',
  backdrop_path: null,
  release_date: '2001-01-01',
  vote_average: 7,
  status: 'Ended',
  seasons: seasons?.map((s) => ({ ...s, name: `Temporada ${s.season_number}`, overview: '', air_date: null, poster_path: null })),
});

/** TMDB falsa: `catalog` indexado por `movie:ID` / `tv:ID`; id ausente lança como a TMDB faria (404). */
export const fakeTmdb = (catalog: Record<string, TmdbTitleDetails>, enabled = true): TmdbLookup & { requested: string[] } => {
  const requested: string[] = [];
  return {
    requested,
    enabled: () => enabled,
    details: async (mediaType, id) => {
      requested.push(`${mediaType}:${id}`);
      const found = catalog[`${mediaType}:${id}`];
      if (!found) throw new Error('TMDB 404');
      return found;
    },
  };
};
