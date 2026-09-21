import type { Database } from 'bun:sqlite';
import type { EpisodeRow, LibraryEntryRow, SeasonRow, TitleRow } from '../types.ts';

export interface BackupData {
  version: 1;
  exportedAt: string;
  titles: TitleRow[];
  seasons: SeasonRow[];
  episodes: EpisodeRow[];
  libraryEntries: LibraryEntryRow[];
}

export class InvalidBackupError extends Error {}

export const exportBackup = (db: Database): BackupData => ({
  version: 1,
  exportedAt: new Date().toISOString(),
  titles: db.query<TitleRow, []>('SELECT * FROM titles').all(),
  seasons: db.query<SeasonRow, []>('SELECT * FROM seasons').all(),
  episodes: db.query<EpisodeRow, []>('SELECT * FROM episodes').all(),
  libraryEntries: db.query<LibraryEntryRow, []>('SELECT * FROM library_entries').all(),
});

const isPlainObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export const validateBackup = (data: unknown): BackupData => {
  if (!isPlainObject(data) || data.version !== 1) throw new InvalidBackupError('formato de backup inválido ou versão incompatível');
  for (const key of ['titles', 'seasons', 'episodes', 'libraryEntries']) {
    if (!Array.isArray(data[key])) throw new InvalidBackupError(`campo "${key}" ausente ou inválido`);
  }
  return data as unknown as BackupData;
};

export interface ImportCounts {
  titles: number;
  seasons: number;
  episodes: number;
  libraryEntries: number;
}

/** Restaura o dump preservando os IDs originais. `ON CONFLICT DO UPDATE` (não `OR REPLACE`) porque `OR REPLACE`
 *  apaga a linha em conflito antes de reinserir, cascateando `ON DELETE CASCADE` e destruindo temporadas/episódios/
 *  entrada de biblioteca criados depois do backup. */
export const importBackup = (db: Database, backup: BackupData): ImportCounts => {
  const insertTitle = db.query(
    `INSERT INTO titles (id, source, source_id, media_type, title, original_title, overview, poster_path, backdrop_path, release_date, vote_average, created_at)
     VALUES ($id, $source, $source_id, $media_type, $title, $original_title, $overview, $poster_path, $backdrop_path, $release_date, $vote_average, $created_at)
     ON CONFLICT (id) DO UPDATE SET
       source = excluded.source, source_id = excluded.source_id, media_type = excluded.media_type, title = excluded.title,
       original_title = excluded.original_title, overview = excluded.overview, poster_path = excluded.poster_path,
       backdrop_path = excluded.backdrop_path, release_date = excluded.release_date, vote_average = excluded.vote_average,
       created_at = excluded.created_at`,
  );
  const insertSeason = db.query(
    `INSERT INTO seasons (id, title_id, season_number, name, overview, air_date, poster_path)
     VALUES ($id, $title_id, $season_number, $name, $overview, $air_date, $poster_path)
     ON CONFLICT (id) DO UPDATE SET
       title_id = excluded.title_id, season_number = excluded.season_number, name = excluded.name,
       overview = excluded.overview, air_date = excluded.air_date, poster_path = excluded.poster_path`,
  );
  const insertEpisode = db.query(
    `INSERT INTO episodes (id, season_id, episode_number, name, overview, air_date, runtime, still_path)
     VALUES ($id, $season_id, $episode_number, $name, $overview, $air_date, $runtime, $still_path)
     ON CONFLICT (id) DO UPDATE SET
       season_id = excluded.season_id, episode_number = excluded.episode_number, name = excluded.name,
       overview = excluded.overview, air_date = excluded.air_date, runtime = excluded.runtime, still_path = excluded.still_path`,
  );
  const insertLibraryEntry = db.query(
    `INSERT INTO library_entries (id, title_id, watch_status, rating, notes, current_season, current_episode, added_at, updated_at)
     VALUES ($id, $title_id, $watch_status, $rating, $notes, $current_season, $current_episode, $added_at, $updated_at)
     ON CONFLICT (id) DO UPDATE SET
       title_id = excluded.title_id, watch_status = excluded.watch_status, rating = excluded.rating, notes = excluded.notes,
       current_season = excluded.current_season, current_episode = excluded.current_episode,
       added_at = excluded.added_at, updated_at = excluded.updated_at`,
  );

  const tx = db.transaction((data: BackupData) => {
    for (const t of data.titles) {
      insertTitle.run({
        $id: t.id,
        $source: t.source,
        $source_id: t.source_id,
        $media_type: t.media_type,
        $title: t.title,
        $original_title: t.original_title,
        $overview: t.overview,
        $poster_path: t.poster_path,
        $backdrop_path: t.backdrop_path,
        $release_date: t.release_date,
        $vote_average: t.vote_average,
        $created_at: t.created_at,
      });
    }
    for (const s of data.seasons) {
      insertSeason.run({
        $id: s.id,
        $title_id: s.title_id,
        $season_number: s.season_number,
        $name: s.name,
        $overview: s.overview,
        $air_date: s.air_date,
        $poster_path: s.poster_path,
      });
    }
    for (const e of data.episodes) {
      insertEpisode.run({
        $id: e.id,
        $season_id: e.season_id,
        $episode_number: e.episode_number,
        $name: e.name,
        $overview: e.overview,
        $air_date: e.air_date,
        $runtime: e.runtime,
        $still_path: e.still_path,
      });
    }
    for (const l of data.libraryEntries) {
      insertLibraryEntry.run({
        $id: l.id,
        $title_id: l.title_id,
        $watch_status: l.watch_status,
        $rating: l.rating,
        $notes: l.notes,
        $current_season: l.current_season,
        $current_episode: l.current_episode,
        $added_at: l.added_at,
        $updated_at: l.updated_at,
      });
    }
  });
  tx(backup);

  return {
    titles: backup.titles.length,
    seasons: backup.seasons.length,
    episodes: backup.episodes.length,
    libraryEntries: backup.libraryEntries.length,
  };
};
