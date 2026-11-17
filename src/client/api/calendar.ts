import type { CatalogSource } from './catalog.ts';
import { json } from './http.ts';

export type CalendarOrigin = 'serie' | 'filme' | 'anime';
export type CalendarWhere = 'stream' | 'cinema' | 'tv' | 'desconhecido';

export interface CalendarInfoDto {
  origin: CalendarOrigin;
  where: CalendarWhere;
  providers: Array<{ name: string; url: string | null }>;
  pageUrl: string | null;
  officialUrl: string | null;
  trailerKey: string | null;
  trailerSearchUrl: string;
  synopsis: string | null;
  rating: number | null;
  genres: string[];
  backdropUrl: string | null;
}

export interface CalendarEntryDto {
  kind: 'episode' | 'movie';
  titleId: string;
  titleSource: CatalogSource;
  titleSourceId: string;
  titleName: string;
  mediaType: 'movie' | 'tv';
  posterUrl: string | null;
  date: string;
  seasonNumber: number | null;
  episodeNumber: number | null;
  episodeName: string | null;
  /** Presente nas estreias para descobrir; os itens da biblioteca buscam a ficha sob demanda. */
  info?: CalendarInfoDto;
}

export interface CalendarResponse {
  entries: CalendarEntryDto[];
}

export const getCalendar = (days = 60): Promise<CalendarResponse> =>
  fetch(`/api/calendar?days=${days}`).then((r) => json<CalendarResponse>(r));

export interface DiscoverResponse {
  days: number;
  entries: Omit<CalendarEntryDto, 'titleId'>[];
  failed: string[];
}

export const getCalendarDiscover = (days = 14): Promise<DiscoverResponse> =>
  fetch(`/api/calendar/discover?days=${days}`).then((r) => json<DiscoverResponse>(r));

export const getCalendarInfo = (source: CatalogSource, id: string, media: 'movie' | 'tv'): Promise<CalendarInfoDto> =>
  fetch(`/api/calendar/detail?source=${encodeURIComponent(source)}&id=${encodeURIComponent(id)}&media=${media}`)
    .then((r) => json<{ info: CalendarInfoDto }>(r))
    .then((d) => d.info);
