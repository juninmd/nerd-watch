import type { Database } from 'bun:sqlite';
import { isWithinWindow, todayIso } from '../date.ts';

export interface CalendarEntry {
  kind: 'episode' | 'movie';
  titleId: string;
  titleSource: 'tmdb' | 'archive';
  titleSourceId: string;
  titleName: string;
  mediaType: 'movie' | 'tv';
  posterPath: string | null;
  date: string;
  seasonNumber: number | null;
  episodeNumber: number | null;
  episodeName: string | null;
}

interface EpisodeCandidateRow {
  title_id: string;
  title_source: 'tmdb' | 'archive';
  title_source_id: string;
  title_name: string;
  media_type: 'movie' | 'tv';
  poster_path: string | null;
  air_date: string;
  season_number: number;
  episode_number: number;
  episode_name: string;
}

interface MovieCandidateRow {
  title_id: string;
  title_source: 'tmdb' | 'archive';
  title_source_id: string;
  title_name: string;
  media_type: 'movie' | 'tv';
  poster_path: string | null;
  release_date: string;
}

/** Só entra no calendário quem está na lista (`library_entries`) — não é um "lançamentos da semana" genérico. */
export const listUpcoming = (db: Database, days = 60, from = todayIso()): CalendarEntry[] => {
  const episodeRows = db
    .query<EpisodeCandidateRow, []>(
      `SELECT t.id as title_id, t.source as title_source, t.source_id as title_source_id, t.title as title_name, t.media_type, t.poster_path,
              e.air_date, s.season_number, e.episode_number, e.name as episode_name
       FROM episodes e
       JOIN seasons s ON s.id = e.season_id
       JOIN titles t ON t.id = s.title_id
       JOIN library_entries le ON le.title_id = t.id
       WHERE e.air_date IS NOT NULL`,
    )
    .all();

  const movieRows = db
    .query<MovieCandidateRow, []>(
      `SELECT t.id as title_id, t.source as title_source, t.source_id as title_source_id, t.title as title_name, t.media_type, t.poster_path, t.release_date
       FROM titles t
       JOIN library_entries le ON le.title_id = t.id
       WHERE t.media_type = 'movie' AND t.release_date IS NOT NULL`,
    )
    .all();

  const entries: CalendarEntry[] = [];

  for (const row of episodeRows) {
    if (!isWithinWindow(row.air_date, from, days)) continue;
    entries.push({
      kind: 'episode',
      titleId: row.title_id,
      titleSource: row.title_source,
      titleSourceId: row.title_source_id,
      titleName: row.title_name,
      mediaType: row.media_type,
      posterPath: row.poster_path,
      date: row.air_date,
      seasonNumber: row.season_number,
      episodeNumber: row.episode_number,
      episodeName: row.episode_name,
    });
  }

  for (const row of movieRows) {
    if (!isWithinWindow(row.release_date, from, days)) continue;
    entries.push({
      kind: 'movie',
      titleId: row.title_id,
      titleSource: row.title_source,
      titleSourceId: row.title_source_id,
      titleName: row.title_name,
      mediaType: row.media_type,
      posterPath: row.poster_path,
      date: row.release_date,
      seasonNumber: null,
      episodeNumber: null,
      episodeName: null,
    });
  }

  return entries.sort((a, b) => a.date.localeCompare(b.date));
};
