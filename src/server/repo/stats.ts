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

/**
 * Uma consulta só para tudo que as estatísticas precisam por título: duração (soma dos episódios), gêneros, nota
 * e status. O alvo é a união de "assistido", "quero ver" e quem teve evento na janela do ano; antes eram três
 * somas sobrepostas mais uma leitura de gêneros. `COUNT(e.season_id)` (e não `e.id`) deixa a soma ser respondida
 * só pelo índice `idx_episodes_season_runtime`, sem tocar a tabela de episódios.
 */
const SCOPE_SQL = `
  SELECT t.id AS title_id, t.media_type, t.runtime_minutes, t.genres, le.rating, le.watch_status,
         SUM(CASE WHEN e.runtime > 0 THEN e.runtime END) AS episode_minutes,
         COUNT(e.season_id) AS episodes,
         COUNT(CASE WHEN e.runtime > 0 THEN 1 END) AS episodes_known
  FROM titles t
  LEFT JOIN library_entries le ON le.title_id = t.id
  LEFT JOIN seasons s ON s.title_id = t.id AND s.season_number > 0
  LEFT JOIN episodes e ON e.season_id = s.id
  WHERE t.id IN (
    SELECT title_id FROM library_entries WHERE watch_status IN ('watched', 'want')
    UNION
    SELECT title_id FROM library_history WHERE at >= $from AND at < $to
  )
  GROUP BY t.id`;

interface ScopeRow extends DurationRow {
  genres: string | null;
  rating: number | null;
  watch_status: WatchStatus | null;
}

/** Lê do SQLite os insumos puros das estatísticas do ano. Só agregados: nada além do necessário sai daqui. */
export const loadStatsInputs = (db: Database, year: number): StatsInputs => {
  const statusCounts: Partial<Record<WatchStatus, number>> = {};
  for (const r of db.query<{ s: WatchStatus; n: number }, []>('SELECT watch_status s, COUNT(*) n FROM library_entries GROUP BY watch_status').all()) {
    statusCounts[r.s] = r.n;
  }

  const firstEventAt = db.query<{ at: string | null }, []>('SELECT MIN(at) at FROM library_history').get()?.at ?? null;

  const window = yearWindowUtc(year);
  const range = { $from: window.from, $to: window.to };
  const periodEvents = db
    .query<{ title_id: string; kind: LibraryHistoryKind; at: string }, typeof range>(
      'SELECT title_id, kind, at FROM library_history WHERE at >= $from AND at < $to ORDER BY at',
    )
    .all(range)
    .map((r): HistoryEvent => ({ titleId: r.title_id, kind: r.kind, at: r.at }));
  const inPeriod = new Set(periodEvents.map((e) => e.titleId));

  const watched: Duration[] = [];
  const wanted: Duration[] = [];
  const periodTitles = new Map<string, ScopeTitle>();
  for (const r of db.query<ScopeRow, typeof range>(SCOPE_SQL).all(range)) {
    const duration = durationOf(r);
    if (r.watch_status === 'watched') watched.push(duration);
    else if (r.watch_status === 'want') wanted.push(duration);
    if (inPeriod.has(r.title_id)) periodTitles.set(r.title_id, { genres: decodeGenres(r.genres), rating: r.rating, duration });
  }

  return { firstEventAt, statusCounts, watched, wanted, periodEvents, periodTitles };
};
