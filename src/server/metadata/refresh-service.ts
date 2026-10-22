import type { Database } from 'bun:sqlite';
import { tmdbEnabled } from '../config.ts';
import { getDb } from '../db.ts';
import { fetchTmdbSeasonEpisodes, fetchTmdbTitleDetails } from '../providers/tmdb.ts';
import { listFollowedTmdbTitles } from '../repo/library.ts';
import type { TitleRow } from '../types.ts';
import { type JobHandle, newBackoff, runRefreshTick, startRefreshJob } from './refresh-job.ts';
import { type RefreshResult, refreshTitle } from './refresher.ts';

/** Ligação real: fetchers da TMDB sem cache + SQLite. Os testes usam refreshTitle/runRefreshTick direto. */
export const refreshTitleFromTmdb = (db: Database, title: TitleRow): Promise<RefreshResult> =>
  refreshTitle({ db, fetchDetails: fetchTmdbTitleDetails, fetchSeasonEpisodes: fetchTmdbSeasonEpisodes }, title);

const TICK_INTERVAL_MS = 10 * 60_000;
const FIRST_TICK_DELAY_MS = 30_000;
const MAX_TITLES_PER_TICK = 5;
const CANDIDATE_LIMIT = 500;

/** Liga o refresh automático. Sem TMDB_API_KEY não faz nada (o app segue sem catálogo TMDB). */
export const startMetadataRefreshJob = (): JobHandle => {
  const backoff = newBackoff();
  const log = (message: string) => console.warn(`[nerd-watch] ${message}`);
  return startRefreshJob({
    enabled: tmdbEnabled(),
    intervalMs: TICK_INTERVAL_MS,
    initialDelayMs: FIRST_TICK_DELAY_MS,
    log,
    tick: async () => {
      const db = await getDb();
      return runRefreshTick(
        {
          listCandidates: () => listFollowedTmdbTitles(db, CANDIDATE_LIMIT),
          refresh: (title) => refreshTitleFromTmdb(db, title),
          now: () => new Date(),
          maxPerTick: MAX_TITLES_PER_TICK,
          log,
        },
        backoff,
      );
    },
  });
};
