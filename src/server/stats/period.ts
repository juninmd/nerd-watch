import type { LibraryHistoryKind } from '../types.ts';
import {
  busiestWeekday,
  type Duration,
  type GenreCount,
  hoursOf,
  longestStreak,
  ratingSummary,
  type Streak,
  topGenres,
  weekdayCounts,
} from './measures.ts';
import { localDate, monthOfDate, yearOfDate } from './time.ts';

/** Evento do histórico da lista, já lido do banco (instante em UTC, ISO). */
export interface HistoryEvent {
  titleId: string;
  kind: LibraryHistoryKind;
  at: string;
}

/** Título com o que o período precisa: gêneros, nota atual e duração já somada pelo repositório. */
export interface ScopeTitle {
  genres: string[] | null;
  rating: number | null;
  duration: Duration;
}

export interface MonthStats {
  month: number;
  finished: number;
  rewatches: number;
  progress: number;
  /** Horas com exibições de duração conhecida; `null` se nenhuma tinha duração. */
  hours: number | null;
}

export interface PeriodStats {
  finished: number;
  rewatches: number;
  progressEvents: number;
  activeDays: number;
  watchTime: { hours: number; knownViewings: number; missingViewings: number };
  months: MonthStats[];
  genres: { top: GenreCount[]; untagged: number };
  ratings: { counts: number[]; average: number | null; rated: number; unrated: number };
  weekdays: number[];
  busiestWeekday: number | null;
  longestStreak: Streak | null;
}

export interface PeriodInput {
  year: number;
  timeZone: string;
  events: HistoryEvent[];
  titles: Map<string, ScopeTitle>;
}

const VIEWING_KINDS: ReadonlySet<LibraryHistoryKind> = new Set(['finished', 'rewatch_started']);

interface MonthAcc {
  finished: number;
  rewatches: number;
  progress: number;
  knownMinutes: number;
  knownViewings: number;
}

/**
 * Agregados de um ano civil. Regras (também explicadas na tela):
 * - "assistir" = `finished` (conclusão) ou `rewatch_started` (revisão); cada um conta uma exibição do título.
 * - Tempo = duração do título por exibição (filme: runtime; série: soma dos episódios conhecidos). Exibição sem
 *   duração conhecida vai para `missingViewings`, nunca para zero.
 * - `progress` é atividade (marcou episódio), não tempo: não soma minutos.
 * - Gêneros, notas e "títulos concluídos" contam cada título uma vez no ano.
 * - Dias ativos: qualquer evento do histórico, no dia civil do fuso dado.
 */
export const buildPeriod = (input: PeriodInput): PeriodStats => {
  const { year, timeZone, titles } = input;
  const local = input.events
    .map((e) => ({ ...e, date: localDate(e.at, timeZone) }))
    .filter((e) => yearOfDate(e.date) === year);

  const acc: MonthAcc[] = Array.from({ length: 12 }, () => ({
    finished: 0,
    rewatches: 0,
    progress: 0,
    knownMinutes: 0,
    knownViewings: 0,
  }));
  let progressEvents = 0;
  let knownViewings = 0;
  let missingViewings = 0;
  let totalMinutes = 0;
  const viewedTitles = new Set<string>();
  const finishedTitles = new Set<string>();

  for (const e of local) {
    const month = acc[monthOfDate(e.date) - 1] as MonthAcc;
    if (e.kind === 'progress') {
      progressEvents++;
      month.progress++;
      continue;
    }
    if (!VIEWING_KINDS.has(e.kind)) continue;

    const minutes = titles.get(e.titleId)?.duration.minutes ?? null;
    if (minutes === null) missingViewings++;
    else {
      knownViewings++;
      totalMinutes += minutes;
      month.knownMinutes += minutes;
      month.knownViewings++;
    }
    viewedTitles.add(e.titleId);
    if (e.kind === 'finished') {
      month.finished++;
      finishedTitles.add(e.titleId);
    } else month.rewatches++;
  }

  const activeDates = local.map((e) => e.date);
  const weekdays = weekdayCounts(activeDates);

  return {
    finished: acc.reduce((n, m) => n + m.finished, 0),
    rewatches: acc.reduce((n, m) => n + m.rewatches, 0),
    progressEvents,
    activeDays: new Set(activeDates).size,
    watchTime: { hours: hoursOf(totalMinutes), knownViewings, missingViewings },
    months: acc.map((m, i) => ({
      month: i + 1,
      finished: m.finished,
      rewatches: m.rewatches,
      progress: m.progress,
      hours: m.knownViewings > 0 ? hoursOf(m.knownMinutes) : null,
    })),
    genres: topGenres([...viewedTitles].map((id) => titles.get(id)?.genres ?? null)),
    ratings: ratingSummary([...finishedTitles].map((id) => titles.get(id)?.rating ?? null)),
    weekdays,
    busiestWeekday: busiestWeekday(weekdays),
    longestStreak: longestStreak(activeDates),
  };
};
