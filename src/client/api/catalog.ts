import type { LibraryEntryDto } from './library.ts';
import { json } from './http.ts';

/** Fontes de catálogo com página de detalhe própria. Telegram tem outra rota (canais). */
export type CatalogSource = 'tmdb' | 'archive' | 'tvmaze' | 'anilist';

export interface SearchResultDto {
  source: CatalogSource;
  sourceId: string;
  mediaType: 'movie' | 'tv';
  title: string;
  overview: string;
  posterUrl: string | null;
  releaseDate: string | null;
  voteAverage: number | null;
}

export interface SearchResponse {
  results: SearchResultDto[];
  tmdbEnabled: boolean;
}

export const search = (q: string): Promise<SearchResponse> =>
  fetch(`/api/search?q=${encodeURIComponent(q)}`).then((r) => json<SearchResponse>(r));

export interface TmdbDetailDto {
  titleId: string;
  title: string;
  overview: string;
  posterUrl: string | null;
  backdropUrl: string | null;
  releaseDate: string | null;
  voteAverage: number;
  status: string;
  trailerKey: string | null;
  seasons: Array<{
    seasonNumber: number;
    name: string;
    overview: string;
    airDate: string | null;
    posterUrl: string | null;
    episodeCount: number;
  }>;
  watchProviders: {
    link: string | null;
    flatrate: Array<{ name: string; logoUrl: string | null }>;
    rent: Array<{ name: string; logoUrl: string | null }>;
    buy: Array<{ name: string; logoUrl: string | null }>;
  };
  library: LibraryEntryDto | null;
}

export const getTmdbTitle = (mediaType: 'movie' | 'tv', id: string): Promise<TmdbDetailDto> =>
  fetch(`/api/tmdb/${mediaType}/${id}`).then((r) => json<TmdbDetailDto>(r));

export interface EpisodeDto {
  episodeNumber: number;
  name: string;
  overview: string;
  airDate: string | null;
  runtime: number | null;
  stillUrl: string | null;
}

export interface SeasonResponse {
  episodes: EpisodeDto[];
}

export const getTmdbSeason = (id: string, seasonNumber: number): Promise<SeasonResponse> =>
  fetch(`/api/tmdb/tv/${id}/season/${seasonNumber}`).then((r) => json<SeasonResponse>(r));

export interface ArchiveDetailDto {
  titleId: string;
  identifier: string;
  title: string;
  overview: string;
  year: string | null;
  posterUrl: string;
  embedUrl: string;
  torrentUrl: string;
  detailsUrl: string;
  subtitleUrl: string | null;
  /** `false` quando o item só tem .ogv/.avi/.mkv — aí não faz sentido oferecer o player P2P. */
  hasPlayableVideo?: boolean;
  /** Arquivo MP4/WebM para o player do app; nulo quando só o embed da Archive serve. */
  directVideoUrl?: string | null;
  library: LibraryEntryDto | null;
}

export const getArchiveTitle = (identifier: string): Promise<ArchiveDetailDto> =>
  fetch(`/api/archive/${identifier}`).then((r) => json<ArchiveDetailDto>(r));

export interface AttributionDto {
  name: string;
  url: string;
  license?: string;
}

export interface TvmazeEpisodeDto {
  episodeNumber: number;
  name: string;
  airDate: string | null;
  runtime: number | null;
  overview: string | null;
  stillUrl: string | null;
}

export interface TvmazeDetailDto {
  titleId: string;
  sourceId: string;
  title: string;
  overview: string | null;
  posterUrl: string | null;
  premiered: string | null;
  ended: string | null;
  status: string | null;
  voteAverage: number | null;
  pageUrl: string | null;
  officialUrl: string | null;
  attribution: AttributionDto;
  seasons: Array<{ seasonNumber: number; name: string; episodes: TvmazeEpisodeDto[] }>;
  library: LibraryEntryDto | null;
}

export const getTvmazeTitle = (id: string): Promise<TvmazeDetailDto> => fetch(`/api/tvmaze/${id}`).then((r) => json<TvmazeDetailDto>(r));

export interface AnilistDetailDto {
  titleId: string;
  sourceId: string;
  mediaType: 'movie' | 'tv';
  title: string;
  romaji: string | null;
  english: string | null;
  native: string | null;
  format: string | null;
  status: string | null;
  year: string | null;
  overview: string | null;
  posterUrl: string | null;
  voteAverage: number | null;
  episodes: number | null;
  pageUrl: string | null;
  nextEpisode: { episode: number; airDate: string } | null;
  attribution: AttributionDto;
  library: LibraryEntryDto | null;
}

export const getAnilistTitle = (id: string): Promise<AnilistDetailDto> => fetch(`/api/anilist/${id}`).then((r) => json<AnilistDetailDto>(r));

export interface ArchiveMovieDto {
  identifier: string;
  title: string;
  overview: string;
  year: string | null;
  thumbnailUrl: string;
  embedUrl: string;
  torrentUrl: string;
  detailsUrl: string;
}

export interface ArchiveSearchResponse {
  results: ArchiveMovieDto[];
}

export const searchArchive = (q = ''): Promise<ArchiveSearchResponse> =>
  fetch(`/api/archive/search?q=${encodeURIComponent(q)}`).then((r) => json<ArchiveSearchResponse>(r));

