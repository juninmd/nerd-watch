import { config, tmdbEnabled } from '../config.ts';
import type { MediaType } from '../types.ts';

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

export const tmdbImageUrl = (path: string | null | undefined, size: 'w342' | 'w500' | 'w780' = 'w500'): string | null =>
  path ? `${IMG_BASE}/${size}${path}` : null;

const call = async <T>(path: string, params: Record<string, string | number> = {}): Promise<T> => {
  if (!config.tmdb.apiKey) throw new TmdbNotConfiguredError();
  const url = new URL(`${BASE}${path}`);
  url.searchParams.set('language', config.tmdb.language);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  const res = await fetch(url, { headers: { Authorization: `Bearer ${config.tmdb.apiKey}`, Accept: 'application/json' } });
  if (!res.ok) throw new TmdbRequestError(res.status, `TMDB ${path} respondeu ${res.status}`);
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

export const tmdbSearchMulti = async (query: string): Promise<TmdbSearchItem[]> => {
  const data = await call<{ results: TmdbSearchItem[] }>('/search/multi', { query, include_adult: 'false' });
  return data.results.filter((r) => r.media_type === 'movie' || r.media_type === 'tv');
};

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
}

export const tmdbTitleDetails = async (mediaType: MediaType, id: number): Promise<TmdbTitleDetails> => {
  const raw = await call<Record<string, unknown>>(`/${mediaType}/${id}`);
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
  };
};

export interface TmdbEpisode {
  episode_number: number;
  name: string;
  overview: string;
  air_date: string | null;
  runtime: number | null;
  still_path: string | null;
}

export const tmdbSeasonEpisodes = async (tvId: number, seasonNumber: number): Promise<TmdbEpisode[]> => {
  const data = await call<{ episodes: TmdbEpisode[] }>(`/tv/${tvId}/season/${seasonNumber}`);
  return data.episodes;
};

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

export const tmdbWatchProviders = async (mediaType: MediaType, id: number): Promise<TmdbWatchProviders> => {
  const data = await call<{ results: Record<string, TmdbWatchProviders> }>(`/${mediaType}/${id}/watch/providers`);
  const region = data.results[config.tmdb.region];
  return region ?? { link: null, flatrate: [], rent: [], buy: [] };
};

interface TmdbVideo {
  key: string;
  site: string;
  type: string;
  official: boolean;
}

export const tmdbTrailerKey = async (mediaType: MediaType, id: number): Promise<string | null> => {
  const data = await call<{ results: TmdbVideo[] }>(`/${mediaType}/${id}/videos`);
  const trailers = data.results.filter((v) => v.site === 'YouTube' && v.type === 'Trailer');
  const best = trailers.find((v) => v.official) ?? trailers[0];
  return best?.key ?? null;
};

export { tmdbEnabled };
