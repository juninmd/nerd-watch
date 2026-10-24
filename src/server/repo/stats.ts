import type { Database } from 'bun:sqlite';
import { decodeGenres } from '../stats/catalog-fields.ts';
import { type Duration, UNKNOWN_DURATION } from '../stats/measures.ts';
import type { HistoryEvent, ScopeTitle } from '../stats/period.ts';
import type { SummaryInput } from '../stats/summary.ts';
import { yearWindowUtc } from '../stats/time.ts';
import type { LibraryHistoryKind, MediaType, WatchStatus } from '../types.ts';

/** O que `buildSummary` precisa do banco; ano, fuso, hoje e ritmo vêm da rota. */
export type StatsInputs = Pick<
  SummaryInput,
  'firstEventAt' | 'statusCounts' | 'watched' | 'wanted' | 'periodEvents' | 'periodTitles'
>;

interface DurationRow {
  title_id: string;
  media_type: MediaType;
  runtime_minutes: number | null;
  episode_minutes: number | null;
  episodes: number;
  episodes_known: number;
}

/**
 * Duração de um título: filme = `runtime_minutes`; série = soma dos episódios com duração conhecida. Sem nenhum
 * episódio com duração, usa a duração típica do catálogo vezes os episódios cadastrados. Nada conhecido = `null`.
 */
const durationOf = (r: DurationRow): Duration => {
  if (r.media_type === 'movie') return r.runtime_minutes === null ? UNKNOWN_DURATION : { minutes: r.runtime_minutes, episodesWithoutRuntime: 0 };
  const missing = r.episodes - r.episodes_known;
  if (r.episodes_known > 0) return { minutes: r.episode_minutes ?? 0, episodesWithoutRuntime: missing };
  if (r.runtime_minutes !== null && r.episodes > 0) return { minutes: r.runtime_minutes * r.episodes, episodesWithoutRuntime: 0 };
  return { minutes: null, episodesWithoutRuntime: r.episodes };
};

const DURATION_SELECT = `
  SELECT t.id AS title_id, t.media_type, t.runtime_minutes,
         SUM(CASE WHEN e.runtime > 0 THEN e.runtime END) AS episode_minutes,
         COUNT(e.id) AS episodes,
         COUNT(CASE WHEN e.runtime > 0 THEN 1 END) AS episodes_known
  FROM titles t
  LEFT JOIN seasons s ON s.title_id = t.id AND s.season_number > 0
  LEFT JOIN episodes e ON e.season_id = s.id`;

const durationsByTitle = (db: Database, where: string, params: Record<string, string>): Map<string, Duration> =>
  new Map(
    db
      .query<DurationRow, Record<string, string>>(`${DURATION_SELECT} ${where} GROUP BY t.id`)
      .all(params)
      .map((r) => [r.title_id, durationOf(r)]),
  );

/** Lê do SQLite os insumos puros das estatísticas do ano. Só agregados: nada além do necessário sai daqui. */
export const loadStatsInputs = (db: Database, year: number): StatsInputs => {
  const statusCounts: Partial<Record<WatchStatus, number>> = {};
  for (const r of db.query<{ s: WatchStatus; n: number }, []>('SELECT watch_status s, COUNT(*) n FROM library_entries GROUP BY watch_status').all()) {
    statusCounts[r.s] = r.n;
  }

  const listed = (status: WatchStatus): Duration[] => {
    const byTitle = durationsByTitle(db, 'WHERE t.id IN (SELECT title_id FROM library_entries WHERE watch_status = $status)', { $status: status });
    return [...byTitle.values()];
  };

  const firstEventAt = db.query<{ at: string | null }, []>('SELECT MIN(at) at FROM library_history').get()?.at ?? null;

  const { from, to } = yearWindowUtc(year);
  const periodEvents = db
    .query<{ title_id: string; kind: LibraryHistoryKind; at: string }, { $from: string; $to: string }>(
      'SELECT title_id, kind, at FROM library_history WHERE at >= $from AND at < $to ORDER BY at',
    )
    .all({ $from: from, $to: to })
    .map((r): HistoryEvent => ({ titleId: r.title_id, kind: r.kind, at: r.at }));

  const periodTitles = new Map<string, ScopeTitle>();
  const ids = [...new Set(periodEvents.map((e) => e.titleId))];
  if (ids.length > 0) {
    const marks = ids.map(() => '?').join(', ');
    const durations = new Map(
      db
        .query<DurationRow, string[]>(`${DURATION_SELECT} WHERE t.id IN (${marks}) GROUP BY t.id`)
        .all(...ids)
        .map((r) => [r.title_id, durationOf(r)]),
    );
    const meta = db
      .query<{ id: string; genres: string | null; rating: number | null }, string[]>(
        `SELECT t.id, t.genres, le.rating FROM titles t LEFT JOIN library_entries le ON le.title_id = t.id WHERE t.id IN (${marks})`,
      )
      .all(...ids);
    for (const m of meta) {
      periodTitles.set(m.id, { genres: decodeGenres(m.genres), rating: m.rating, duration: durations.get(m.id) ?? UNKNOWN_DURATION });
    }
  }

  return {
    firstEventAt,
    statusCounts,
    watched: listed('watched'),
    wanted: listed('want'),
    periodEvents,
    periodTitles,
  };
};
