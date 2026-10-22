import type { Database } from 'bun:sqlite';
import { listWatchedTitles } from '../../repo/library.ts';
import { SourceError } from '../sources/types.ts';
import { traktRequest } from './api.ts';
import { fetchWatchedLists } from './watched.ts';

export interface ExportCounts {
  /** Itens aceitos pelo Trakt nesta execução. */
  exported: number;
  /** Já estavam no histórico do Trakt: não reenviados (é o que impede duplicar). */
  alreadyInTrakt: number;
  /** Assistidos no app sem id TMDB: o Trakt não tem como casá-los. */
  skippedNoTmdb: number;
  /** O Trakt não reconheceu o id TMDB. */
  notFound: number;
}

export interface ExportOptions {
  batchSize?: number;
  /** Pausa entre lotes: o Trakt aceita cerca de 1 POST/s por usuário. Testes passam 0. */
  pauseMs?: number;
}

/** Export que parou no meio: traz as contagens até ali. Rodar de novo é seguro (compara com o Trakt outra vez). */
export class PartialExportError extends SourceError {
  constructor(
    readonly cause: SourceError,
    readonly counts: ExportCounts,
  ) {
    super(cause.message, cause.status);
  }
}

interface Item {
  kind: 'movies' | 'shows';
  tmdbId: number;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Monta o corpo de `POST /sync/history` só com as chaves que têm itens. Ids TMDB, sem `watched_at` (o Trakt usa agora). */
const toHistoryBody = (batch: Item[]): Record<string, Array<{ ids: { tmdb: number } }>> => {
  const body: Record<string, Array<{ ids: { tmdb: number } }>> = {};
  for (const item of batch) {
    const list = body[item.kind] ?? [];
    list.push({ ids: { tmdb: item.tmdbId } });
    body[item.kind] = list;
  }
  return body;
};

/**
 * Envia ao histórico do Trakt os assistidos do app que ainda não estão lá. Compara antes com o que o Trakt já tem,
 * porque `POST /sync/history` não deduplica: sem isso cada execução duplicaria os plays.
 * Série: se já existe qualquer episódio dela no Trakt, a série é considerada presente e não é reenviada (limite documentado).
 */
export const exportWatched = async (db: Database, options: ExportOptions = {}): Promise<ExportCounts> => {
  const batchSize = options.batchSize ?? 100;
  const pauseMs = options.pauseMs ?? 1100;

  const remote = await fetchWatchedLists();
  const remoteMovies = new Set(remote.movies.map((m) => m.tmdbId));
  const remoteShows = new Set(remote.shows.map((s) => s.tmdbId));

  const counts: ExportCounts = { exported: 0, alreadyInTrakt: 0, skippedNoTmdb: 0, notFound: 0 };
  const missing: Item[] = [];
  for (const title of listWatchedTitles(db)) {
    if (title.source !== 'tmdb') {
      counts.skippedNoTmdb++;
      continue;
    }
    const tmdbId = Number(title.source_id);
    if (!Number.isSafeInteger(tmdbId) || tmdbId <= 0) {
      counts.skippedNoTmdb++;
      continue;
    }
    const present = title.media_type === 'movie' ? remoteMovies.has(tmdbId) : remoteShows.has(tmdbId);
    if (present) counts.alreadyInTrakt++;
    else missing.push({ kind: title.media_type === 'movie' ? 'movies' : 'shows', tmdbId });
  }

  for (let i = 0; i < missing.length; i += batchSize) {
    if (i > 0 && pauseMs > 0) await sleep(pauseMs);
    const batch = missing.slice(i, i + batchSize);
    try {
      const res = (await traktRequest('POST', '/sync/history', toHistoryBody(batch))) as { not_found?: Record<string, unknown[] | undefined> };
      const notFound = Object.values(res?.not_found ?? {}).reduce((sum, list) => sum + (Array.isArray(list) ? list.length : 0), 0);
      counts.notFound += notFound;
      counts.exported += batch.length - notFound;
    } catch (err) {
      if (err instanceof SourceError) throw new PartialExportError(err, counts);
      throw err;
    }
  }
  return counts;
};
