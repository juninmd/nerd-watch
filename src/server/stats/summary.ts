import type { WatchStatus } from '../types.ts';
import type { Duration } from './measures.ts';
import type { PeriodStats, HistoryEvent, ScopeTitle } from './period.ts';
import { buildPeriod } from './period.ts';
import { backlogEstimate, type Backlog, type LibraryTotals, libraryTotals } from './totals.ts';

export interface StatsSummary {
  year: number;
  timezone: string;
  /** `false` quando não há nada a mostrar (biblioteca vazia e nenhuma exibição no ano): a tela mostra o estado vazio. */
  hasData: boolean;
  library: LibraryTotals;
  period: PeriodStats;
  backlog: Backlog;
}

export interface SummaryInput {
  year: number;
  timeZone: string;
  today: string;
  hoursPerDay: number;
  statusCounts: Partial<Record<WatchStatus, number>>;
  watched: Duration[];
  wanted: Duration[];
  periodEvents: HistoryEvent[];
  periodTitles: Map<string, ScopeTitle>;
}

/** Junta as partes puras no formato que `/api/stats` devolve. Nenhuma leitura de banco aqui. */
export const buildSummary = (input: SummaryInput): StatsSummary => {
  const period = buildPeriod({
    year: input.year,
    timeZone: input.timeZone,
    events: input.periodEvents,
    titles: input.periodTitles,
  });
  const library = libraryTotals(input.statusCounts, input.watched);
  const backlog = backlogEstimate(input.wanted, input.hoursPerDay, input.today);
  const hasData = library.total > 0 || period.activeDays > 0;
  return { year: input.year, timezone: input.timeZone, hasData, library, period, backlog };
};
