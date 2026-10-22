import type { Database } from 'bun:sqlite';
import type { LibraryEntryRow, TitleRow, WatchStatus } from '../types.ts';
import { SQL_BATCH } from './titles.ts';
import { recordAdded, recordProgress, recordRewatchStarted, recordStatusChange } from './library-history.ts';

export type LibraryItem = LibraryEntryRow & { title: TitleRow };

const JOIN_SELECT = `
  SELECT
    le.id, le.title_id, le.watch_status, le.rating, le.notes,
    le.current_season, le.current_episode, le.rewatch_count, le.added_at, le.updated_at,
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
  rewatch_count: number;
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
  rewatch_count: row.rewatch_count,
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

/** Entradas dos títulos dados, em lotes (uma consulta por lote). */
export const getLibraryEntriesByTitles = (db: Database, titleIds: string[]): LibraryEntryRow[] => {
  const rows: LibraryEntryRow[] = [];
  for (let i = 0; i < titleIds.length; i += SQL_BATCH) {
    const chunk = titleIds.slice(i, i + SQL_BATCH);
    rows.push(...db.query<LibraryEntryRow, string[]>(`SELECT * FROM library_entries WHERE title_id IN (${chunk.map(() => '?').join(',')})`).all(...chunk));
  }
  return rows;
};

/** Títulos marcados como assistidos (origem e id, para a exportação decidir o que falta no Trakt). */
export const listWatchedTitles = (db: Database): Array<Pick<TitleRow, 'source' | 'source_id' | 'media_type'>> =>
  db
    .query<Pick<TitleRow, 'source' | 'source_id' | 'media_type'>, []>(
      `SELECT t.source, t.source_id, t.media_type FROM library_entries le JOIN titles t ON t.id = le.title_id WHERE le.watch_status = 'watched'`,
    )
    .all();

export interface LibraryPatch {
  watchStatus?: WatchStatus;
  rating?: number | null;
  notes?: string | null;
  currentSeason?: number | null;
  currentEpisode?: number | null;
}

const selectItem = (db: Database, titleId: string): LibraryItem => {
  const row = db.query<JoinedRow, [string]>(`${JOIN_SELECT} WHERE le.title_id = ?`).get(titleId);
  if (!row) throw new Error('falha ao gravar item na lista');
  return toLibraryItem(row);
};

/** Grava a entrada e o histórico na mesma transação: sem evento órfão nem mudança sem evento. */
export const upsertLibraryEntry = (db: Database, titleId: string, patch: LibraryPatch): LibraryItem => {
  const now = new Date().toISOString();
  const existing = getLibraryEntryByTitle(db, titleId);
  db.transaction(() => {
    if (!existing) {
      db.query(
        `INSERT INTO library_entries (id, title_id, watch_status, rating, notes, current_season, current_episode, added_at, updated_at)
         VALUES ($id, $titleId, $watchStatus, $rating, $notes, $currentSeason, $currentEpisode, $addedAt, $updatedAt)`,
      ).run({
        $id: crypto.randomUUID(),
        $titleId: titleId,
        $watchStatus: patch.watchStatus ?? 'want',
        $rating: patch.rating ?? null,
        $notes: patch.notes ?? null,
        $currentSeason: patch.currentSeason ?? null,
        $currentEpisode: patch.currentEpisode ?? null,
        $addedAt: now,
        $updatedAt: now,
      });
      recordAdded(db, titleId, now);
      return;
    }
    const watchStatus = patch.watchStatus ?? existing.watch_status;
    const currentSeason = patch.currentSeason !== undefined ? patch.currentSeason : existing.current_season;
    const currentEpisode = patch.currentEpisode !== undefined ? patch.currentEpisode : existing.current_episode;
    db.query(
      `UPDATE library_entries SET
         watch_status = $watchStatus, rating = $rating, notes = $notes,
         current_season = $currentSeason, current_episode = $currentEpisode, updated_at = $updatedAt
       WHERE id = $id`,
    ).run({
      $id: existing.id,
      $watchStatus: watchStatus,
      $rating: patch.rating !== undefined ? patch.rating : existing.rating,
      $notes: patch.notes !== undefined ? patch.notes : existing.notes,
      $currentSeason: currentSeason,
      $currentEpisode: currentEpisode,
      $updatedAt: now,
    });
    recordStatusChange(db, titleId, existing.watch_status, watchStatus, now);
    if (currentSeason !== existing.current_season || currentEpisode !== existing.current_episode) {
      recordProgress(db, titleId, currentSeason, currentEpisode, now);
    }
  })();
  return selectItem(db, titleId);
};

export type RewatchOutcome = { ok: true; item: LibraryItem } | { ok: false; reason: 'not_found' | 'not_finished' };

/** Revisão: só a partir de assistido. Volta para "assistindo", conta a revisão e registra o início. */
export const rewatchLibraryEntry = (db: Database, titleId: string): RewatchOutcome =>
  db.transaction((): RewatchOutcome => {
    const existing = getLibraryEntryByTitle(db, titleId);
    if (!existing) return { ok: false, reason: 'not_found' };
    if (existing.watch_status !== 'watched') return { ok: false, reason: 'not_finished' };
    const now = new Date().toISOString();
    db.query(`UPDATE library_entries SET watch_status = 'watching', rewatch_count = rewatch_count + 1, updated_at = ? WHERE id = ?`).run(now, existing.id);
    recordRewatchStarted(db, titleId, now);
    return { ok: true, item: selectItem(db, titleId) };
  })();

export const removeLibraryEntry = (db: Database, id: string): void => {
  db.query('DELETE FROM library_entries WHERE id = ?').run(id);
};

export const listLibrary = (db: Database, status?: WatchStatus): LibraryItem[] => {
  const rows = status
    ? db.query<JoinedRow, [string]>(`${JOIN_SELECT} WHERE le.watch_status = ? ORDER BY le.updated_at DESC`).all(status)
    : db.query<JoinedRow, []>(`${JOIN_SELECT} ORDER BY le.updated_at DESC`).all();
  return rows.map(toLibraryItem);
};

export type BulkLibraryAction = { type: 'status'; watchStatus: WatchStatus } | { type: 'remove' };

/** Aplica a mesma ação a várias entradas (por título) numa transação só; devolve quantas existiam e foram afetadas. */
export const bulkLibraryAction = (db: Database, titleIds: string[], action: BulkLibraryAction): number => {
  if (titleIds.length === 0) return 0;
  const marks = titleIds.map(() => '?').join(',');
  const run = db.transaction((): number => {
    if (action.type === 'remove') return db.query(`DELETE FROM library_entries WHERE title_id IN (${marks})`).run(...titleIds).changes;
    const now = new Date().toISOString();
    const before = db
      .query<{ title_id: string; watch_status: WatchStatus }, string[]>(`SELECT title_id, watch_status FROM library_entries WHERE title_id IN (${marks})`)
      .all(...titleIds);
    const result = db
      .query(`UPDATE library_entries SET watch_status = ?, updated_at = ? WHERE title_id IN (${marks})`)
      .run(action.watchStatus, now, ...titleIds);
    for (const row of before) recordStatusChange(db, row.title_id, row.watch_status, action.watchStatus, now);
    return result.changes;
  });
  return run();
};
