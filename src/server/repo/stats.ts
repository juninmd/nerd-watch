import type { Database } from 'bun:sqlite';
import { decodeGenres } from '../stats/catalog-fields.ts';
import type { HistoryEvent, ScopeTitle } from '../stats/period.ts';
import { type Duration, UNKNOWN_DURATION } from '../stats/measures.ts';
import { yearWindowUtc } from '../stats/time.ts';
import type { LibraryHistoryKind, WatchStatus } from '../types.ts';

/**
 * Consultas das estatísticas. Quatro leituras no total, todas limitadas (sem N+1):
 *   1. contagem por status (`idx_library_status`, covering: só lê o índice);
 *   2. títulos em escopo: biblioteca assistida/quero ver (`idx_library_status`) UNION títulos com exibições no
 *      ano (`idx_library_history_at`); o UNION já tira duplicatas;
 *   3. episódios das séries do escopo, agregados por título (`idx_seasons_title`, `idx_episodes_season`);
 *   4. eventos do histórico no intervalo do ano (`idx_library_history_at`).
 * Os planos estão em tests/stats-repo.test.ts (EXPLAIN QUERY PLAN).
 */

export const SCOPE_CTE = `
WITH scope AS (
  SELECT t.id AS id, t.media_type AS media_type, t.genres AS genres, le.rating AS rating, le.watch_status AS watch_status,
    t.runtime_minutes AS runtime_minutes
  FROM library_entries le JOIN titles t ON t.id = le.title_id
  WHERE le.watch_status IN ('watched', 'want')
  UNION
  SELECT t.id, t.media_type, t.genres, le.rating, le.watch_status, t.runtime_minutes
  FROM titles t LEFT JOIN library_entries le ON le.title_id = t.id
  WHERE t.id IN (
    SELECT h.title_id FROM library_history h
    WHERE h.at >= $from AND h.at < $to AND h.kind IN ('finished', 'rewatch_started')
  )
)`;

/** Exposta para o teste de EXPLAIN QUERY PLAN: o plano que importa é o desta consulta. */
export const EVENTS_SQL = 'SELECT title_id, kind, at FROM library_history WHERE at >= ? AND at < ?';

type WindowParams = { [name: string]: string };

interface ScopeRow {
  id: string;
  media_type: 'movie' | 'tv';
  genres: string | null;
  rating: number | null;
  watch_status: WatchStatus | null;
  runtime_minutes: number | null;
}

interface EpisodeAggRow {
  title_id: string;
  total: number;
  known: number;
  minutes: number;
}

/** Duração de um título para o tempo assistido: filme = runtime; série = soma dos episódios conhecidos. */
export const durationOf = (
  row: { media_type: 'movie' | 'tv'; runtime_minutes: number | null },
  agg: EpisodeAggRow | undefined,
): Duration => {
  if (row.media_type === 'movie') return { minutes: row.runtime_minutes, episodesWithoutRuntime: 0 };
  if (!agg || agg.total === 0) return UNKNOWN_DURATION;
  const missing = agg.total - agg.known;
  return { minutes: agg.known > 0 ? agg.minutes : null, episodesWithoutRuntime: missing };
};

export interface StatsInputs {
  /** Instante (ISO UTC) do evento mais antigo do histórico; `null` sem histórico. Alimenta o seletor de ano. */
  firstEventAt: string | null;
  statusCounts: Partial<Record<WatchStatus, number>>;
  watched: Duration[];
  wanted: Duration[];
  periodEvents: HistoryEvent[];
  periodTitles: Map<string, ScopeTitle>;
}

/** Lê tudo que o `/api/stats` precisa para um ano. Sem N+1: uma consulta por tipo de dado, não por título. */
export const loadStatsInputs = (db: Database, year: number): StatsInputs => {
  const { from, to } = yearWindowUtc(year);

  const statusCounts: Partial<Record<WatchStatus, number>> = {};
  for (const row of db
    .query<{ watch_status: WatchStatus; n: number }, []>(
      'SELECT watch_status, COUNT(*) AS n FROM library_entries GROUP BY watch_status',
    )
    .all()) {
    statusCounts[row.watch_status] = row.n;
  }

  const bounds = { $from: from, $to: to };
  const scopeRows = db.query<ScopeRow, WindowParams>(`${SCOPE_CTE} SELECT * FROM scope`).all(bounds);
  const episodeRows = db
    .query<EpisodeAggRow, WindowParams>(
      `${SCOPE_CTE}
       SELECT s.title_id AS title_id, COUNT(e.id) AS total, COUNT(e.runtime) AS known, COALESCE(SUM(e.runtime), 0) AS minutes
       FROM seasons s JOIN episodes e ON e.season_id = s.id
       WHERE s.title_id IN (SELECT id FROM scope WHERE media_type = 'tv')
       GROUP BY s.title_id`,
    )
    .all(bounds);
  const episodeByTitle = new Map(episodeRows.map((r) => [r.title_id, r]));

  const watched: Duration[] = [];
  const wanted: Duration[] = [];
  const periodTitles = new Map<string, ScopeTitle>();
  for (const row of scopeRows) {
    const duration = durationOf(row, episodeByTitle.get(row.id));
    if (row.watch_status === 'watched') watched.push(duration);
    if (row.watch_status === 'want') wanted.push(duration);
    periodTitles.set(row.id, { genres: decodeGenres(row.genres), rating: row.rating, duration });
  }

  const periodEvents = db
    .query<{ title_id: string; kind: LibraryHistoryKind; at: string }, [string, string]>(EVENTS_SQL)
    .all(from, to)
    .map((r) => ({ titleId: r.title_id, kind: r.kind, at: r.at }));

  const firstEventAt =
    db.query<{ first: string | null }, []>('SELECT MIN(at) AS first FROM library_history').get()?.first ?? null;

  return { firstEventAt, statusCounts, watched, wanted, periodEvents, periodTitles };
};
