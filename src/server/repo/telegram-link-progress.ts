import type { Database } from 'bun:sqlite';
import { getLibraryEntryByTitle } from './library.ts';
import {
  InvalidProgressError,
  markProgressThrough,
  ProgressNotFoundError,
  type ProgressSnapshot,
} from './library-progress.ts';
import { getTelegramItem } from './telegram.ts';

/**
 * Limiar de "assistido" de um vídeo: 95% da duração. Espelha `FINISHED_RATIO` do cliente (`playback-store.ts`):
 * o mesmo corte que marca o vídeo como terminado na lista "continuar" também avança "Onde parei".
 */
export const PLAYED_RATIO = 0.95;

export const isPlayed = (seconds: number, duration: number | null, done: boolean): boolean =>
  done || (duration !== null && duration > 0 && seconds / duration >= PLAYED_RATIO);

interface Marker {
  season: number | null;
  episode: number | null;
}

/**
 * O alvo está depois do marcador? Mesma regra de `UP_NEXT_SQL`: temporada 0 (especiais) é trilha própria.
 * Sem marcador, qualquer alvo avança. Igual ou anterior nunca regride o progresso.
 */
export const isAheadOf = (marker: Marker, season: number, episode: number): boolean => {
  if (marker.season === null || marker.episode === null) return true;
  if (season === 0 || marker.season === 0) return season === marker.season && episode > marker.episode;
  return season > marker.season || (season === marker.season && episode > marker.episode);
};

export interface LinkedProgress {
  titleId: string;
  seasonNumber: number;
  episodeNumber: number;
  /** false quando o marcador já estava nesse episódio ou além: nada foi gravado. */
  changed: boolean;
  previous: ProgressSnapshot | null;
  /** Entrada da lista criada ou atualizada: o desfazer precisa dela quando o título não estava na lista antes. */
  entryId: string | null;
}

/**
 * Avança "Onde parei" pelo vídeo vinculado (o episódio, ou o último do intervalo). Não regride: se o marcador já
 * está no alvo ou além, não grava. Reusa `markProgressThrough`, então o histórico da lista é registrado do mesmo jeito.
 * Devolve null quando o vídeo não tem vínculo confirmado ou o episódio não está mais no banco.
 */
export const advanceLinkedProgress = (db: Database, channelId: string, messageId: string): LinkedProgress | null => {
  const item = getTelegramItem(db, channelId, messageId);
  if (item?.link_status !== 'linked' || !item.title_id || item.season_number === null || item.episode_number === null) return null;

  const season = item.season_number;
  const episode = item.episode_end ?? item.episode_number;
  const entry = getLibraryEntryByTitle(db, item.title_id);
  // Título fora da lista: não recria a entrada (markProgressThrough faria isso por upsert).
  if (!entry) return null;
  const marker = { season: entry?.current_season ?? null, episode: entry?.current_episode ?? null };
  if (!isAheadOf(marker, season, episode)) {
    const previous = entry
      ? { watchStatus: entry.watch_status, currentSeason: entry.current_season, currentEpisode: entry.current_episode }
      : null;
    return { titleId: item.title_id, seasonNumber: season, episodeNumber: episode, changed: false, previous, entryId: entry?.id ?? null };
  }

  try {
    const result = markProgressThrough(db, item.title_id, season, episode);
    return {
      titleId: item.title_id,
      seasonNumber: season,
      episodeNumber: episode,
      changed: result.changed,
      previous: result.previous,
      entryId: result.item.id,
    };
  } catch (err) {
    // Título saiu da biblioteca ou o episódio sumiu: nada a marcar. O vídeo continua vinculado, só não avança.
    if (err instanceof ProgressNotFoundError || err instanceof InvalidProgressError) return null;
    throw err;
  }
};
