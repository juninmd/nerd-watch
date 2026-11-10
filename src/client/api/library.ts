import type { LibraryHistoryKind, WatchStatus } from '../../server/types.ts';
import type { CatalogSource } from './catalog.ts';
import { json } from './http.ts';

export interface LibraryEntryDto {
  id: string;
  title_id: string;
  watch_status: WatchStatus;
  rating: number | null;
  notes: string | null;
  current_season: number | null;
  current_episode: number | null;
  rewatch_count: number;
  added_at: string;
  updated_at: string;
}

export interface LibraryItemDto {
  id: string;
  titleId: string;
  watchStatus: WatchStatus;
  rating: number | null;
  notes: string | null;
  currentSeason: number | null;
  currentEpisode: number | null;
  rewatchCount: number;
  addedAt: string;
  updatedAt: string;
  title: {
    id: string;
    sourceId: string;
    source: CatalogSource | 'telegram';
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
  source: CatalogSource;
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

export interface UpNextItemDto {
  titleId: string;
  title: { sourceId: string; source: CatalogSource | 'telegram'; mediaType: 'movie' | 'tv'; title: string; posterUrl: string | null };
  seasonNumber: number;
  episodeNumber: number;
  episodeName: string;
  runtime: number | null;
  activityAt: string;
  /** Vídeo de canal vinculado a este episódio: o card leva para ele, não para a série. */
  channelVideo: { channelId: string; messageId: string } | null;
}

export const listUpNext = (limit = 12): Promise<{ items: UpNextItemDto[] }> =>
  fetch(`/api/library/up-next?limit=${limit}`).then((r) => json<{ items: UpNextItemDto[] }>(r));

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

export interface MarkThroughResult {
  changed: boolean;
  previous: { watchStatus: WatchStatus; currentSeason: number | null; currentEpisode: number | null } | null;
  item: LibraryItemDto;
}

export const markProgressThrough = (titleId: string, seasonNumber: number, episodeNumber: number): Promise<MarkThroughResult> =>
  fetch(`/api/library/${titleId}/progress`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ seasonNumber, episodeNumber }),
  }).then((r) => json<MarkThroughResult>(r));
export interface LibraryHistoryItemDto {
  id: string;
  kind: LibraryHistoryKind;
  at: string;
  detail: string | null;
}

export interface LibraryHistoryPageDto {
  items: LibraryHistoryItemDto[];
  total: number;
  limit: number;
  offset: number;
}

export const getLibraryHistory = (titleId: string, limit: number, offset: number): Promise<LibraryHistoryPageDto> =>
  fetch(`/api/library/${titleId}/history?limit=${limit}&offset=${offset}`).then((r) => json<LibraryHistoryPageDto>(r));

/** Revisão: só funciona com o título marcado como assistido (senão o servidor responde 409). */
export const rewatchLibrary = (titleId: string): Promise<LibraryItemDto> =>
  fetch(`/api/library/${titleId}/rewatch`, { method: 'POST' }).then((r) => json<LibraryItemDto>(r));

export const removeFromLibrary = (entryId: string): Promise<void> =>
  fetch(`/api/library/${entryId}`, { method: 'DELETE' }).then((res) => {
    if (!res.ok) throw new Error('falha ao remover');
  });

export interface RefreshMetadataDto {
  titleId: string;
  seasons: number;
  episodes: number;
  refreshedAt: string;
}

/** Re-busca temporadas, episódios e datas na TMDB. Erro 429 traz a mensagem de espera (cooldown de 60 s). */
export const refreshTitleMetadata = (titleId: string): Promise<RefreshMetadataDto> =>
  fetch(`/api/library/${titleId}/refresh`, { method: 'POST' }).then((r) => json<RefreshMetadataDto>(r));

export type BulkLibraryInput = { titleIds: string[]; action: 'remove' } | { titleIds: string[]; action: 'status'; watchStatus: WatchStatus };

export const bulkLibrary = (input: BulkLibraryInput): Promise<{ affected: number }> =>
  fetch('/api/library/bulk', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) }).then((r) =>
    json<{ affected: number }>(r),
  );
