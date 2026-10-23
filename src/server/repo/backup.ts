import type { Database } from 'bun:sqlite';
import {
  LIBRARY_HISTORY_KINDS,
  type EpisodeRow,
  type LibraryEntryRow,
  type LibraryHistoryRow,
  type SeasonRow,
  type TelegramChannelRow,
  type TelegramItemRow,
  type TitleRow,
} from '../types.ts';
import { InvalidPlaybackError, PLAYBACK_MAX_ROWS, type PlaybackEntry, listPlaybackEntries, parsePlaybackEntry, upsertPlaybackEntry } from './playback.ts';

export interface BackupData {
  version: 1;
  exportedAt: string;
  titles: TitleRow[];
  seasons: SeasonRow[];
  episodes: EpisodeRow[];
  libraryEntries: LibraryEntryRow[];
  telegramChannels?: TelegramChannelRow[];
  telegramItems?: TelegramItemRow[];
  /** Opcional: backups anteriores a esta tabela não têm o campo (e as entradas, o `rewatch_count`). */
  playbackPositions?: PlaybackEntry[];
  libraryHistory?: LibraryHistoryRow[];
}

export class InvalidBackupError extends Error {}

export const exportBackup = (db: Database): BackupData => ({
  version: 1,
  exportedAt: new Date().toISOString(),
  titles: db.query<TitleRow, []>('SELECT * FROM titles').all(),
  seasons: db.query<SeasonRow, []>('SELECT * FROM seasons').all(),
  episodes: db.query<EpisodeRow, []>('SELECT * FROM episodes').all(),
  libraryEntries: db.query<LibraryEntryRow, []>('SELECT * FROM library_entries').all(),
  telegramChannels: db.query<TelegramChannelRow, []>('SELECT * FROM telegram_channels').all(),
  telegramItems: db.query<TelegramItemRow, []>('SELECT * FROM telegram_items').all(),
  playbackPositions: listPlaybackEntries(db, PLAYBACK_MAX_ROWS, 0),
  libraryHistory: db.query<LibraryHistoryRow, []>('SELECT * FROM library_history').all(),
});

const isPlainObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export const validateBackup = (data: unknown): BackupData => {
  if (!isPlainObject(data) || data.version !== 1) throw new InvalidBackupError('formato de backup inválido ou versão incompatível');
  for (const key of ['titles', 'seasons', 'episodes', 'libraryEntries']) {
    if (!Array.isArray(data[key])) throw new InvalidBackupError(`campo "${key}" ausente ou inválido`);
  }
  if (data.telegramChannels !== undefined && !Array.isArray(data.telegramChannels)) {
    throw new InvalidBackupError('campo "telegramChannels" inválido');
  }
  if (data.telegramItems !== undefined && !Array.isArray(data.telegramItems)) {
    throw new InvalidBackupError('campo "telegramItems" inválido');
  }
  for (const entry of data.libraryEntries as unknown[]) {
    const count = (entry as { rewatch_count?: unknown } | null)?.rewatch_count;
    if (count !== undefined && (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0)) {
      throw new InvalidBackupError('libraryEntries: rewatch_count deve ser um inteiro não negativo');
    }
  }
  if (data.libraryHistory !== undefined) {
    if (!Array.isArray(data.libraryHistory)) throw new InvalidBackupError('campo "libraryHistory" inválido');
    for (const row of data.libraryHistory as unknown[]) {
      const kind = (row as { kind?: unknown } | null)?.kind;
      if (typeof kind !== 'string' || !(LIBRARY_HISTORY_KINDS as readonly string[]).includes(kind)) {
        throw new InvalidBackupError('libraryHistory: tipo de evento desconhecido');
      }
    }
  }
  if (data.playbackPositions !== undefined) {
    if (!Array.isArray(data.playbackPositions)) throw new InvalidBackupError('campo "playbackPositions" inválido');
    // Valida tudo antes de abrir a transação: uma linha ruim não pode deixar o import pela metade.
    for (const row of data.playbackPositions as unknown[]) {
      try {
        parsePlaybackEntry((row as { key?: unknown } | null)?.key, row);
      } catch (err) {
        if (err instanceof InvalidPlaybackError) throw new InvalidBackupError(`playbackPositions: ${err.message}`);
        throw err;
      }
    }
  }
  return data as unknown as BackupData;
};

export interface ImportCounts {
  titles: number;
  seasons: number;
  episodes: number;
  libraryEntries: number;
  libraryHistory: number;
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
    `INSERT INTO library_entries (id, title_id, watch_status, rating, notes, current_season, current_episode, rewatch_count, added_at, updated_at)
     VALUES ($id, $title_id, $watch_status, $rating, $notes, $current_season, $current_episode, $rewatch_count, $added_at, $updated_at)
     ON CONFLICT (id) DO UPDATE SET
       title_id = excluded.title_id, watch_status = excluded.watch_status, rating = excluded.rating, notes = excluded.notes,
       current_season = excluded.current_season, current_episode = excluded.current_episode, rewatch_count = excluded.rewatch_count,
       added_at = excluded.added_at, updated_at = excluded.updated_at`,
  );
  // Histórico é só de acréscimo: reimportar o mesmo evento (mesmo id) não duplica.
  const insertLibraryHistory = db.query(
    `INSERT INTO library_history (id, title_id, kind, at, detail)
     VALUES ($id, $title_id, $kind, $at, $detail)
     ON CONFLICT (id) DO NOTHING`,
  );

  const insertTelegramChannel = db.query(
    `INSERT INTO telegram_channels (id, mode, handle, cursor, created_at)
     VALUES ($id, $mode, $handle, $cursor, $created_at)
     ON CONFLICT (id) DO UPDATE SET
       mode = excluded.mode, handle = excluded.handle, cursor = excluded.cursor, created_at = excluded.created_at`,
  );
  const insertTelegramItem = db.query(
    `INSERT INTO telegram_items (id, channel_id, message_id, caption, duration_seconds, thumbnail_url, posted_at, file_ref)
     VALUES ($id, $channel_id, $message_id, $caption, $duration_seconds, $thumbnail_url, $posted_at, $file_ref)
     ON CONFLICT (channel_id, message_id) DO UPDATE SET
       caption = excluded.caption, duration_seconds = excluded.duration_seconds,
       thumbnail_url = excluded.thumbnail_url, posted_at = excluded.posted_at, file_ref = excluded.file_ref`,
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
        // Backups antigos não têm o contador: entram com 0, como uma entrada nova.
        $rewatch_count: l.rewatch_count ?? 0,
        $added_at: l.added_at,
        $updated_at: l.updated_at,
      });
    }
    if (data.libraryHistory) {
      for (const h of data.libraryHistory) {
        insertLibraryHistory.run({ $id: h.id, $title_id: h.title_id, $kind: h.kind, $at: h.at, $detail: h.detail });
      }
    }
    if (data.telegramChannels) {
      for (const c of data.telegramChannels) {
        insertTelegramChannel.run({
          $id: c.id,
          $mode: c.mode,
          $handle: c.handle,
          $cursor: c.cursor,
          $created_at: c.created_at,
        });
      }
    }
    if (data.telegramItems) {
      for (const i of data.telegramItems) {
        insertTelegramItem.run({
          $id: i.id,
          $channel_id: i.channel_id,
          $message_id: i.message_id,
          $caption: i.caption,
          $duration_seconds: i.duration_seconds,
          $thumbnail_url: i.thumbnail_url,
          $posted_at: i.posted_at,
          $file_ref: i.file_ref,
        });
      }
    }
    // LWW: reimportar um backup antigo não regride uma posição mais nova que já está no banco.
    if (data.playbackPositions) {
      for (const p of data.playbackPositions) upsertPlaybackEntry(db, parsePlaybackEntry(p.key, p));
    }
  });
  tx(backup);

  return {
    titles: backup.titles.length,
    seasons: backup.seasons.length,
    episodes: backup.episodes.length,
    libraryEntries: backup.libraryEntries.length,
    libraryHistory: backup.libraryHistory?.length ?? 0,
  };
};
