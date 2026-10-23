import type { Database } from 'bun:sqlite';
import type { WatchStatus } from '../types.ts';
import { getLibraryEntryByTitle, getLibraryItemByTitle, type LibraryItem, upsertLibraryEntry } from './library.ts';

export class ProgressNotFoundError extends Error {}
export class InvalidProgressError extends Error {}

/** Estado de progresso antes da marcação; `null` quando o título não estava na biblioteca. */
export interface ProgressSnapshot {
  watchStatus: WatchStatus;
  currentSeason: number | null;
  currentEpisode: number | null;
}

export interface MarkThroughResult {
  /** false quando o marcador já estava nesse episódio (repetição ou duplo clique): nada foi gravado. */
  changed: boolean;
  previous: ProgressSnapshot | null;
  item: LibraryItem;
}

/**
 * Marca o episódio como "onde parei". Os anteriores ficam vistos pelo próprio marcador (ver `isEpisodeWatched`),
 * então não há uma linha por episódio para gravar. Lê o estado anterior e grava na mesma transação: o desfazer
 * restaura exatamente o que havia, sem depender de um estado que o cliente leu antes.
 */
export const markProgressThrough = (db: Database, titleId: string, seasonNumber: number, episodeNumber: number): MarkThroughResult =>
  db.transaction((): MarkThroughResult => {
    const title = db.query<{ media_type: string }, [string]>('SELECT media_type FROM titles WHERE id = ?').get(titleId);
    if (!title) throw new ProgressNotFoundError('título não encontrado');
    if (title.media_type !== 'tv') throw new InvalidProgressError('só séries têm temporadas e episódios');

    const episode = db
      .query<{ id: string }, [string, number, number]>(
        `SELECT e.id FROM seasons s JOIN episodes e ON e.season_id = s.id
         WHERE s.title_id = ? AND s.season_number = ? AND e.episode_number = ?`,
      )
      .get(titleId, seasonNumber, episodeNumber);
    if (!episode) throw new ProgressNotFoundError('episódio não encontrado; abra a temporada antes de marcar');

    const existing = getLibraryEntryByTitle(db, titleId);
    const previous = existing
      ? { watchStatus: existing.watch_status, currentSeason: existing.current_season, currentEpisode: existing.current_episode }
      : null;
    if (existing && existing.current_season === seasonNumber && existing.current_episode === episodeNumber) {
      const item = getLibraryItemByTitle(db, titleId);
      if (!item) throw new ProgressNotFoundError('título não está na biblioteca');
      return { changed: false, previous, item };
    }

    const item = upsertLibraryEntry(db, titleId, {
      watchStatus: existing?.watch_status ?? 'watching',
      currentSeason: seasonNumber,
      currentEpisode: episodeNumber,
    });
    return { changed: true, previous, item };
  })();
