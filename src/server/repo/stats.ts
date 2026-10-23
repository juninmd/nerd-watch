import type { Database } from 'bun:sqlite';
import { todayIso } from '../date.ts';
import type { MediaType, TitleSource, WatchStatus } from '../types.ts';

export const ACTIVITY_DAYS = 365;
const DAY_MS = 86_400_000;

export interface TopRatedRow {
  titleId: string;
  source: TitleSource;
  sourceId: string;
  mediaType: MediaType;
  title: string;
  posterPath: string | null;
  rating: number;
}

export interface LibraryStats {
  total: number;
  byStatus: Record<WatchStatus, number>;
  byType: Record<MediaType, number>;
  /** Índice = nota (0 a 10), valor = quantos títulos. */
  ratings: number[];
  averageRating: number | null;
  /** Dias com atividade (histórico da biblioteca) nos últimos `ACTIVITY_DAYS`, só os que têm pelo menos um evento. */
  activity: Array<{ date: string; count: number }>;
  streak: { current: number; longest: number };
  /** Títulos concluídos por mês, os 12 últimos meses terminando no atual (`YYYY-MM`). */
  finishedByMonth: Array<{ month: string; count: number }>;
  topRated: TopRatedRow[];
}

const shiftDays = (iso: string, days: number): string => new Date(Date.parse(`${iso}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);

/** Sequências de dias consecutivos com atividade. A atual ainda vale se o último dia ativo foi ontem (o dia de hoje não acabou). */
export const computeStreaks = (activeDates: string[], today: string): { current: number; longest: number } => {
  const days = [...new Set(activeDates)].sort();
  let longest = 0;
  let run = 0;
  let prev: string | null = null;
  for (const d of days) {
    run = prev !== null && shiftDays(prev, 1) === d ? run + 1 : 1;
    longest = Math.max(longest, run);
    prev = d;
  }
  const alive = prev === today || prev === shiftDays(today, -1);
  return { current: alive ? run : 0, longest };
};

const lastMonths = (today: string, n: number): string[] => {
  const [y, m] = today.split('-').map(Number) as [number, number];
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(Date.UTC(y, m - 1 - (n - 1 - i), 1));
    return d.toISOString().slice(0, 7);
  });
};

export const getLibraryStats = (db: Database, today: string = todayIso()): LibraryStats => {
  const byStatus: Record<WatchStatus, number> = { want: 0, watching: 0, watched: 0, dropped: 0 };
  for (const r of db.query('SELECT watch_status s, COUNT(*) n FROM library_entries GROUP BY watch_status').all() as Array<{ s: WatchStatus; n: number }>) {
    byStatus[r.s] = r.n;
  }

  const byType: Record<MediaType, number> = { movie: 0, tv: 0 };
  for (const r of db
    .query('SELECT t.media_type m, COUNT(*) n FROM library_entries le JOIN titles t ON t.id = le.title_id GROUP BY t.media_type')
    .all() as Array<{ m: MediaType; n: number }>) {
    byType[r.m] = r.n;
  }

  const ratings = Array.from({ length: 11 }, () => 0);
  let sum = 0;
  let rated = 0;
  for (const r of db.query('SELECT rating r, COUNT(*) n FROM library_entries WHERE rating IS NOT NULL GROUP BY rating').all() as Array<{ r: number; n: number }>) {
    if (r.r < 0 || r.r > 10) continue;
    ratings[r.r] = r.n;
    sum += r.r * r.n;
    rated += r.n;
  }

  const since = shiftDays(today, -(ACTIVITY_DAYS - 1));
  const activity = (
    db
      .query('SELECT substr(at, 1, 10) d, COUNT(*) n FROM library_history WHERE substr(at, 1, 10) >= $since AND substr(at, 1, 10) <= $today GROUP BY d ORDER BY d')
      .all({ $since: since, $today: today }) as Array<{ d: string; n: number }>
  ).map((r) => ({ date: r.d, count: r.n }));
  const allActive = (db.query('SELECT DISTINCT substr(at, 1, 10) d FROM library_history').all() as Array<{ d: string }>).map((r) => r.d);

  const months = lastMonths(today, 12);
  const finished = new Map(
    (
      db
        .query("SELECT substr(at, 1, 7) m, COUNT(*) n FROM library_history WHERE kind = 'finished' AND substr(at, 1, 7) >= $from GROUP BY m")
        .all({ $from: months[0] ?? today }) as Array<{ m: string; n: number }>
    ).map((r) => [r.m, r.n]),
  );

  const topRated = (
    db
      .query(
        `SELECT t.id, t.source, t.source_id, t.media_type, t.title, t.poster_path, le.rating
         FROM library_entries le JOIN titles t ON t.id = le.title_id
         WHERE le.rating IS NOT NULL ORDER BY le.rating DESC, le.updated_at DESC LIMIT 6`,
      )
      .all() as Array<{ id: string; source: TitleSource; source_id: string; media_type: MediaType; title: string; poster_path: string | null; rating: number }>
  ).map((r) => ({ titleId: r.id, source: r.source, sourceId: r.source_id, mediaType: r.media_type, title: r.title, posterPath: r.poster_path, rating: r.rating }));

  return {
    total: byStatus.want + byStatus.watching + byStatus.watched + byStatus.dropped,
    byStatus,
    byType,
    ratings,
    averageRating: rated > 0 ? Math.round((sum / rated) * 10) / 10 : null,
    activity,
    streak: computeStreaks(allActive, today),
    finishedByMonth: months.map((month) => ({ month, count: finished.get(month) ?? 0 })),
    topRated,
  };
};
