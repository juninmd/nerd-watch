import type { Database } from 'bun:sqlite';
import { tmdbEnabled } from '../../config.ts';
import { getLibraryEntriesByTitles, upsertLibraryEntry } from '../../repo/library.ts';
import { findTmdbTitles, upsertTitle } from '../../repo/titles.ts';
import type { LibraryEntryRow, MediaType, TitleRow } from '../../types.ts';
import { tmdbTitleDetails, type TmdbTitleDetails } from '../tmdb.ts';
import { type CurrentEntry, isFrozen, isSeriesComplete, planMovie, planShow } from './import-plan.ts';
import { fetchWatchedLists, type SeasonMap } from './watched.ts';

/** Acesso à TMDB injetável: os testes trocam por uma versão falsa, sem rede. */
export interface TmdbLookup {
  enabled(): boolean;
  details(mediaType: MediaType, id: number): Promise<TmdbTitleDetails>;
}

export const liveTmdb: TmdbLookup = { enabled: tmdbEnabled, details: tmdbTitleDetails };

export interface ImportCounts {
  /** Entradas novas na lista. */
  imported: number;
  /** Entradas que já existiam e mudaram (status ou ponteiro de episódio). */
  updated: number;
  /** Nada a mudar: já estava igual ou mais avançado. */
  unchanged: number;
  /** Sem id TMDB, ou título ausente e sem TMDB_API_KEY: não dá para criar, então ignora. */
  skippedNoTmdb: number;
  /** Falhou a consulta à TMDB para criar o título, ou o id colide com um título de outro tipo. */
  failed: number;
}

interface Work {
  mediaType: MediaType;
  tmdbId: number;
  seasons: SeasonMap | null;
}

/** Consultas à TMDB em paralelo, com teto: rápido sem estourar o limite da TMDB. */
const DETAIL_CONCURRENCY = 4;

const keyOf = (w: { mediaType: MediaType; tmdbId: number }): string => `${w.mediaType}:${w.tmdbId}`;

const mapLimit = async <T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> => {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      out[index] = await fn(items[index] as T);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
};

const toCurrent = (entry: LibraryEntryRow | undefined): CurrentEntry | null =>
  entry ? { status: entry.watch_status, season: entry.current_season, episode: entry.current_episode } : null;

/**
 * Importa o que foi assistido no Trakt para a lista do app. Idempotente: rodar de novo não muda nada.
 * Lê tudo em lotes, consulta a TMDB só quando precisa (criar título ou checar se a série está completa) e grava
 * numa transação só. Nunca rebaixa status nem apaga entradas.
 */
export const importWatched = async (db: Database, tmdb: TmdbLookup = liveTmdb): Promise<ImportCounts> => {
  const lists = await fetchWatchedLists();
  const works: Work[] = [
    ...lists.movies.map((m) => ({ mediaType: 'movie' as const, tmdbId: m.tmdbId, seasons: null })),
    ...lists.shows.map((s) => ({ mediaType: 'tv' as const, tmdbId: s.tmdbId, seasons: s.seasons })),
  ];

  const titleById = new Map(findTmdbTitles(db, works.map((w) => String(w.tmdbId))).map((t) => [t.source_id, t]));
  const entryByTitle = new Map(getLibraryEntriesByTitles(db, [...titleById.values()].map((t) => t.id)).map((e) => [e.title_id, e]));

  // Só consulta a TMDB quando a resposta muda algo: criar título, ou decidir se uma série não-finalizada está completa.
  const needsDetails = (w: Work): boolean => {
    if (!tmdb.enabled()) return false;
    const title = titleById.get(String(w.tmdbId));
    if (!title) return true;
    if (title.media_type !== w.mediaType || w.seasons === null) return false;
    const entry = entryByTitle.get(title.id);
    return !entry || !isFrozen(entry.watch_status);
  };
  const detailed = await mapLimit(works.filter(needsDetails), DETAIL_CONCURRENCY, async (w) => {
    try {
      return { key: keyOf(w), details: await tmdb.details(w.mediaType, w.tmdbId) };
    } catch {
      return { key: keyOf(w), details: null };
    }
  });
  const detailsByKey = new Map(detailed.map((d) => [d.key, d.details]));

  const counts: ImportCounts = { imported: 0, updated: 0, unchanged: 0, skippedNoTmdb: lists.withoutTmdb, failed: 0 };
  db.transaction(() => {
    for (const w of works) {
      const details = detailsByKey.get(keyOf(w)) ?? null;
      let title: TitleRow | undefined = titleById.get(String(w.tmdbId));
      if (!title) {
        if (!tmdb.enabled()) {
          counts.skippedNoTmdb++;
          continue;
        }
        if (!details) {
          counts.failed++;
          continue;
        }
        title = upsertTitle(db, {
          source: 'tmdb',
          sourceId: String(w.tmdbId),
          mediaType: w.mediaType,
          title: details.title,
          overview: details.overview || null,
          posterPath: details.poster_path,
          backdropPath: details.backdrop_path,
          releaseDate: details.release_date,
          voteAverage: details.vote_average,
        });
      }
      // Dois tipos com o mesmo id TMDB caem no mesmo título (chave é só source+id): não mexe no que não é deste tipo.
      if (title.media_type !== w.mediaType) {
        counts.failed++;
        continue;
      }

      const entry = entryByTitle.get(title.id);
      const plan = w.seasons
        ? planShow(toCurrent(entry), w.seasons, isSeriesComplete(w.seasons, (details?.seasons ?? []).map((s) => ({ seasonNumber: s.season_number, episodeCount: s.episode_count }))))
        : planMovie(toCurrent(entry));
      if (!plan) {
        counts.unchanged++;
        continue;
      }
      upsertLibraryEntry(db, title.id, { watchStatus: plan.watchStatus, currentSeason: plan.pointer?.season, currentEpisode: plan.pointer?.episode });
      if (entry) counts.updated++;
      else counts.imported++;
    }
  })();
  return counts;
};
