import type { WatchStatus } from '../server/types.ts';

const json = async <T>(res: Response): Promise<T> => {
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error ?? `erro ${res.status}`);
  }
  return res.json() as Promise<T>;
};

export interface SearchResultDto {
  source: 'tmdb' | 'archive';
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

export interface LibraryEntryDto {
  id: string;
  title_id: string;
  watch_status: WatchStatus;
  rating: number | null;
  notes: string | null;
  current_season: number | null;
  current_episode: number | null;
  added_at: string;
  updated_at: string;
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
  library: LibraryEntryDto | null;
}

export const getArchiveTitle = (identifier: string): Promise<ArchiveDetailDto> =>
  fetch(`/api/archive/${identifier}`).then((r) => json<ArchiveDetailDto>(r));

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

export interface LibraryItemDto {
  id: string;
  titleId: string;
  watchStatus: WatchStatus;
  rating: number | null;
  notes: string | null;
  currentSeason: number | null;
  currentEpisode: number | null;
  addedAt: string;
  updatedAt: string;
  title: {
    id: string;
    sourceId: string;
    source: 'tmdb' | 'archive';
    mediaType: 'movie' | 'tv';
    title: string;
    posterUrl: string | null;
    releaseDate: string | null;
    voteAverage: number | null;
  };
}

export interface LibraryListResponse {
  items: LibraryItemDto[];
}

export const listLibrary = (status?: WatchStatus): Promise<LibraryListResponse> =>
  fetch(`/api/library${status ? `?status=${status}` : ''}`).then((r) => json<LibraryListResponse>(r));

export interface AddToLibraryInput {
  source: 'tmdb' | 'archive';
  sourceId: string;
  mediaType: 'movie' | 'tv';
  title: string;
  overview?: string;
  posterPath?: string | null;
  backdropPath?: string | null;
  releaseDate?: string | null;
  voteAverage?: number | null;
  watchStatus?: WatchStatus;
}

export const addToLibrary = (input: AddToLibraryInput): Promise<LibraryItemDto> =>
  fetch('/api/library', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) }).then((r) =>
    json<LibraryItemDto>(r),
  );

export interface PatchLibraryInput {
  watchStatus?: WatchStatus;
  rating?: number | null;
  notes?: string | null;
  currentSeason?: number | null;
  currentEpisode?: number | null;
}

export const patchLibrary = (titleId: string, patch: PatchLibraryInput): Promise<LibraryItemDto> =>
  fetch(`/api/library/${titleId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) }).then(
    (r) => json<LibraryItemDto>(r),
  );

export const removeFromLibrary = (entryId: string): Promise<void> =>
  fetch(`/api/library/${entryId}`, { method: 'DELETE' }).then((res) => {
    if (!res.ok) throw new Error('falha ao remover');
  });

export interface CalendarEntryDto {
  kind: 'episode' | 'movie';
  titleId: string;
  titleSource: 'tmdb' | 'archive';
  titleSourceId: string;
  titleName: string;
  mediaType: 'movie' | 'tv';
  posterUrl: string | null;
  date: string;
  seasonNumber: number | null;
  episodeNumber: number | null;
  episodeName: string | null;
}

export interface CalendarResponse {
  entries: CalendarEntryDto[];
}

export const getCalendar = (days = 60): Promise<CalendarResponse> =>
  fetch(`/api/calendar?days=${days}`).then((r) => json<CalendarResponse>(r));

export interface HealthResponse {
  ok: boolean;
  tmdbEnabled: boolean;
  openSubtitlesEnabled: boolean;
}

export const health = (): Promise<HealthResponse> => fetch('/api/health').then((r) => json<HealthResponse>(r));

export interface SubtitleResultDto {
  subtitleId: string;
  language: string;
  release: string;
  downloadCount: number;
  fileId: number;
  fileName: string;
}

export interface SubtitleSearchResponse {
  enabled: boolean;
  results: SubtitleResultDto[];
}

export const searchSubtitles = (opts: { query?: string; tmdbId?: number }): Promise<SubtitleSearchResponse> => {
  const params = new URLSearchParams();
  if (opts.query) params.set('query', opts.query);
  if (opts.tmdbId) params.set('tmdbId', String(opts.tmdbId));
  return fetch(`/api/subtitles?${params}`).then((r) => json<SubtitleSearchResponse>(r));
};

export const downloadSubtitle = (fileId: number): Promise<{ url: string; remaining: number }> =>
  fetch('/api/subtitles/download', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fileId }),
  }).then((r) => json<{ url: string; remaining: number }>(r));

export const exportBackup = (): Promise<unknown> => fetch('/api/backup').then((r) => json<unknown>(r));

export interface ImportBackupResponse {
  imported: { titles: number; seasons: number; episodes: number; libraryEntries: number };
}

export const importBackup = (data: unknown): Promise<ImportBackupResponse> =>
  fetch('/api/backup/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  }).then((r) => json<ImportBackupResponse>(r));
