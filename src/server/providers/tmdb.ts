import { withCache } from '../lib/cache.ts';
import { config, tmdbEnabled } from '../config/config.ts';
import { normalizeGenres, normalizeRuntimeMinutes } from '../stats/catalog-fields.ts';
import type { MediaType } from '../types.ts';

const MINUTES = 60_000;

const BASE = 'https://api.themoviedb.org/3';
const IMG_BASE = 'https://image.tmdb.org/t/p';

export class TmdbNotConfiguredError extends Error {
  constructor() {
    super('TMDB_API_KEY não configurada — adicione ao .env para habilitar este catálogo.');
    this.name = 'TmdbNotConfiguredError';
  }
}

export class TmdbRequestError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = 'TmdbRequestError';
  }
}

const TMDB_IMAGE_PATH_RE = /^\/[A-Za-z0-9._-]{1,120}$/;

export const tmdbImageUrl = (path: string | null | undefined, size: 'w342' | 'w500' | 'w780' = 'w500'): string | null =>
  path && TMDB_IMAGE_PATH_RE.test(path) && !path.includes('..') ? `${IMG_BASE}/${size}${path}` : null;

const call = async <T>(path: string, params: Record<string, string | number> = {}): Promise<T> => {
  if (!config.tmdb.apiKey) throw new TmdbNotConfiguredError();
  const url = new URL(`${BASE}${path}`);
  url.searchParams.set('language', config.tmdb.language);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  const isBearer = config.tmdb.apiKey.startsWith('eyJ');
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (isBearer) {
    headers.Authorization = `Bearer ${config.tmdb.apiKey}`;
  } else {
    url.searchParams.set('api_key', config.tmdb.apiKey);
  }
  let res: Response;
  try {
    // `redirect: 'error'` impede enviar `Authorization` ou `api_key` para outro host em caso de redirecionamento.
    res = await fetch(url, { headers, redirect: 'error', signal: AbortSignal.timeout(15000) });
  } catch {
    throw new TmdbRequestError(502, `TMDB ${path} indisponível agora`);
  }
  if (!res.ok) {
    await res.body?.cancel();
    throw new TmdbRequestError(res.status, `TMDB ${path} respondeu ${res.status}`);
  }
  return (await res.json()) as T;
};

export interface TmdbSearchItem {
  id: number;
  media_type: 'movie' | 'tv' | 'person';
  title?: string;
  name?: string;
  overview: string;
  poster_path: string | null;
  release_date?: string;
  first_air_date?: string;
  vote_average: number;
}

export const tmdbSearchMulti = withCache(15 * MINUTES, async (query: string): Promise<TmdbSearchItem[]> => {
  const data = await call<{ results: TmdbSearchItem[] }>('/search/multi', { query, include_adult: 'false' });
  return data.results.filter((r) => r.media_type === 'movie' || r.media_type === 'tv');
});

export interface TmdbSeasonSummary {
  season_number: number;
  name: string;
  overview: string;
  air_date: string | null;
  poster_path: string | null;
  episode_count: number;
}

export interface TmdbTitleDetails {
  id: number;
  title: string;
  overview: string;
  poster_path: string | null;
  backdrop_path: string | null;
  release_date: string | null;
  vote_average: number;
  status: string;
  seasons?: TmdbSeasonSummary[];
  /** Nomes dos gêneros; `[]` quando a resposta não trouxe a lista. */
  genres: string[];
  /** Filme: duração do filme. Série: duração típica do episódio (`episode_run_time[0]`). */
  runtimeMinutes: number | null;
}

/** Sem cache: o refresh de metadados precisa do dado atual, não do que a página já guardou há até 60 min. */
export const fetchTmdbTitleDetails = async (mediaType: MediaType, id: number): Promise<TmdbTitleDetails> => {
  const raw = await call<Record<string, unknown>>(`/${mediaType}/${id}`);
  const episodeRuntimes = Array.isArray(raw.episode_run_time) ? raw.episode_run_time : [];
  return {
    id: raw.id as number,
    title: (raw.title ?? raw.name) as string,
    overview: raw.overview as string,
    poster_path: raw.poster_path as string | null,
    backdrop_path: raw.backdrop_path as string | null,
    release_date: (raw.release_date ?? raw.first_air_date) as string | null,
    vote_average: raw.vote_average as number,
    status: raw.status as string,
    seasons: raw.seasons as TmdbSeasonSummary[] | undefined,
    // Sem a lista (resposta fora do padrão) vira []: `genres` nulo é o sinal de "backfill pendente" e não pode ficar em loop.
    genres: normalizeGenres(Array.isArray(raw.genres) ? raw.genres.map((g) => (g && typeof g === 'object' ? (g as { name?: unknown }).name : null)) : []) ?? [],
    runtimeMinutes: normalizeRuntimeMinutes(mediaType === 'movie' ? raw.runtime : episodeRuntimes[0]),
  };
};

export const tmdbTitleDetails = withCache(60 * MINUTES, fetchTmdbTitleDetails);

/**
 * ID do IMDb de um título da TMDB.
 *
 * É a ponte para o ecossistema de addons do Stremio: o protocolo deles só responde por id do
 * IMDb (`idPrefixes: ["tt"]`), então sem este passo nenhuma busca de legenda por addon funciona.
 * Cache longo (o vínculo filme↔IMDb praticamente não muda).
 */
export const tmdbExternalIds = withCache(24 * 60 * MINUTES, async (mediaType: MediaType, id: number): Promise<string | null> => {
  const data = await call<{ imdb_id?: string | null }>(`/${mediaType}/${id}/external_ids`);
  return data.imdb_id ?? null;
});

export interface TmdbEpisode {  episode_number: number;
  name: string;
  overview: string;
  air_date: string | null;
  runtime: number | null;
  still_path: string | null;
}

export const fetchTmdbSeasonEpisodes = async (tvId: number, seasonNumber: number): Promise<TmdbEpisode[]> => {
  const data = await call<{ episodes: TmdbEpisode[] }>(`/tv/${tvId}/season/${seasonNumber}`);
  return data.episodes;
};

export const tmdbSeasonEpisodes = withCache(60 * MINUTES, fetchTmdbSeasonEpisodes);

export interface TmdbWatchProvider {
  provider_name: string;
  logo_path: string;
}

export interface TmdbWatchProviders {
  link: string | null;
  flatrate: TmdbWatchProvider[];
  rent: TmdbWatchProvider[];
  buy: TmdbWatchProvider[];
}

export const tmdbWatchProviders = withCache(30 * MINUTES, async (mediaType: MediaType, id: number): Promise<TmdbWatchProviders> => {
  const data = await call<{ results: Record<string, TmdbWatchProviders> }>(`/${mediaType}/${id}/watch/providers`);
  const region = data.results[config.tmdb.region];
  return region ?? { link: null, flatrate: [], rent: [], buy: [] };
});

interface TmdbVideo {
  key: string;
  site: string;
  type: string;
  official: boolean;
}

const TRAILER_KEY_RE = /^[A-Za-z0-9_-]{6,32}$/;

export const tmdbTrailerKey = withCache(60 * MINUTES, async (mediaType: MediaType, id: number): Promise<string | null> => {
  const data = await call<{ results: TmdbVideo[] }>(`/${mediaType}/${id}/videos`);
  // A chave vai para a URL de um iframe no cliente: só formato de id do YouTube passa.
  const trailers = data.results.filter((v) => v.site === 'YouTube' && v.type === 'Trailer' && TRAILER_KEY_RE.test(v.key ?? ''));
  const best = trailers.find((v) => v.official) ?? trailers[0];
  return best?.key ?? null;
});

export { tmdbEnabled };

export interface TmdbUpcomingMovie {
  id: number;
  title: string;
  poster_path: string | null;
  backdrop_path?: string | null;
  overview?: string;
  vote_average?: number;
  genre_ids?: number[];
  release_date: string;
}

/** id → nome dos gêneros de filme (a lista do discover só traz ids). */
export const tmdbMovieGenres = withCache(24 * 60 * MINUTES, async (): Promise<Map<number, string>> => {
  const data = await call<{ genres: Array<{ id: number; name: string }> }>('/genre/movie/list');
  return new Map(data.genres.map((g) => [g.id, g.name]));
});

/** Série da TMDB a partir do id do IMDb (ponte para trailer e streaming de séries vindas da TVmaze). */
export const tmdbTvIdByImdb = withCache(24 * 60 * MINUTES, async (imdbId: string): Promise<number | null> => {
  const data = await call<{ tv_results?: Array<{ id: number }> }>(`/find/${imdbId}`, { external_source: 'imdb_id' });
  return data.tv_results?.[0]?.id ?? null;
});

/** Filmes com estreia entre `from` e `to` (YYYY-MM-DD), por popularidade. Alimenta a Agenda sem depender da biblioteca. */
export const tmdbUpcomingMovies = withCache(3 * 60 * MINUTES, async (from: string, to: string): Promise<TmdbUpcomingMovie[]> => {
  const data = await call<{ results: TmdbUpcomingMovie[] }>('/discover/movie', {
    'primary_release_date.gte': from,
    'primary_release_date.lte': to,
    sort_by: 'popularity.desc',
    include_adult: 'false',
  });
  return data.results.filter((m) => m.release_date);
});
