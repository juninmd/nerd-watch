import type { CatalogSource } from './catalog.ts';
import { json } from './http.ts';

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
