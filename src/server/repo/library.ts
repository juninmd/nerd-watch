import type { Database } from 'bun:sqlite';
import type { LibraryEntryRow, TitleRow, WatchStatus } from '../types.ts';

export type LibraryItem = LibraryEntryRow & { title: TitleRow };

const JOIN_SELECT = `
  SELECT
    le.id, le.title_id, le.watch_status, le.rating, le.notes,
    le.current_season, le.current_episode, le.added_at, le.updated_at,
    t.id as t_id, t.source as t_source, t.source_id as t_source_id, t.media_type as t_media_type,
    t.title as t_title, t.original_title as t_original_title, t.overview as t_overview,
    t.poster_path as t_poster_path, t.backdrop_path as t_backdrop_path,
    t.release_date as t_release_date, t.vote_average as t_vote_average, t.created_at as t_created_at
  FROM library_entries le JOIN titles t ON t.id = le.title_id
`;

interface JoinedRow {
  id: string;
  title_id: string;
  watch_status: WatchStatus;
  rating: number | null;
  notes: string | null;
  current_season: number | null;
  current_episode: number | null;
  added_at: string;
  updated_at: string;
  t_id: string;
  t_source: TitleRow['source'];
  t_source_id: string;
  t_media_type: TitleRow['media_type'];
  t_title: string;
  t_original_title: string | null;
  t_overview: string | null;
  t_poster_path: string | null;
  t_backdrop_path: string | null;
  t_release_date: string | null;
  t_vote_average: number | null;
  t_created_at: string;
}

const toLibraryItem = (row: JoinedRow): LibraryItem => ({
  id: row.id,
  title_id: row.title_id,
  watch_status: row.watch_status,
  rating: row.rating,
  notes: row.notes,
  current_season: row.current_season,
  current_episode: row.current_episode,
  added_at: row.added_at,
  updated_at: row.updated_at,
  title: {
    id: row.t_id,
    source: row.t_source,
    source_id: row.t_source_id,
    media_type: row.t_media_type,
    title: row.t_title,
    original_title: row.t_original_title,
    overview: row.t_overview,
    poster_path: row.t_poster_path,
    backdrop_path: row.t_backdrop_path,
    release_date: row.t_release_date,
    vote_average: row.t_vote_average,
    created_at: row.t_created_at,
  },
});

export const getLibraryEntryByTitle = (db: Database, titleId: string): LibraryEntryRow | null =>
  db.query<LibraryEntryRow, [string]>('SELECT * FROM library_entries WHERE title_id = ?').get(titleId);

export interface LibraryPatch {
  watchStatus?: WatchStatus;
  rating?: number | null;
  notes?: string | null;
  currentSeason?: number | null;
  currentEpisode?: number | null;
}

export const upsertLibraryEntry = (db: Database, titleId: string, patch: LibraryPatch): LibraryItem => {
  const now = new Date().toISOString();
  const existing = getLibraryEntryByTitle(db, titleId);
  if (!existing) {
    const id = crypto.randomUUID();
    db.query(
      `INSERT INTO library_entries (id, title_id, watch_status, rating, notes, current_season, current_episode, added_at, updated_at)
       VALUES ($id, $titleId, $watchStatus, $rating, $notes, $currentSeason, $currentEpisode, $addedAt, $updatedAt)`,
    ).run({
      $id: id,
      $titleId: titleId,
      $watchStatus: patch.watchStatus ?? 'want',
      $rating: patch.rating ?? null,
      $notes: patch.notes ?? null,
      $currentSeason: patch.currentSeason ?? null,
      $currentEpisode: patch.currentEpisode ?? null,
      $addedAt: now,
      $updatedAt: now,
    });
  } else {
    db.query(
      `UPDATE library_entries SET
         watch_status = $watchStatus, rating = $rating, notes = $notes,
         current_season = $currentSeason, current_episode = $currentEpisode, updated_at = $updatedAt
       WHERE id = $id`,
    ).run({
      $id: existing.id,
      $watchStatus: patch.watchStatus ?? existing.watch_status,
      $rating: patch.rating !== undefined ? patch.rating : existing.rating,
      $notes: patch.notes !== undefined ? patch.notes : existing.notes,
      $currentSeason: patch.currentSeason !== undefined ? patch.currentSeason : existing.current_season,
      $currentEpisode: patch.currentEpisode !== undefined ? patch.currentEpisode : existing.current_episode,
      $updatedAt: now,
    });
  }
  const row = db
    .query<JoinedRow, [string]>(`${JOIN_SELECT} WHERE le.title_id = ?`)
    .get(titleId);
  if (!row) throw new Error('falha ao gravar item na lista');
  return toLibraryItem(row);
};

export const removeLibraryEntry = (db: Database, id: string): void => {
  db.query('DELETE FROM library_entries WHERE id = ?').run(id);
};

export const listLibrary = (db: Database, status?: WatchStatus): LibraryItem[] => {
  const rows = status
    ? db.query<JoinedRow, [string]>(`${JOIN_SELECT} WHERE le.watch_status = ? ORDER BY le.updated_at DESC`).all(status)
    : db.query<JoinedRow, []>(`${JOIN_SELECT} ORDER BY le.updated_at DESC`).all();
  return rows.map(toLibraryItem);
};
