import type { WatchStatus } from '../types.ts';
import { type Duration, hoursOf } from './measures.ts';
import { addDays } from './time.ts';

export interface WatchTimeTotal {
  hours: number;
  knownTitles: number;
  missingTitles: number;
  episodesWithoutRuntime: number;
}

/** Soma de durações: o total só conta o que é conhecido, e diz quanto ficou de fora. */
export const sumDurations = (durations: Duration[]): WatchTimeTotal => {
  let minutes = 0;
  let knownTitles = 0;
  let missingTitles = 0;
  let episodesWithoutRuntime = 0;
  for (const d of durations) {
    episodesWithoutRuntime += d.episodesWithoutRuntime;
    if (d.minutes === null) missingTitles++;
    else {
      minutes += d.minutes;
      knownTitles++;
    }
  }
  return { hours: hoursOf(minutes), knownTitles, missingTitles, episodesWithoutRuntime };
};

export interface LibraryTotals {
  byStatus: Record<WatchStatus, number>;
  total: number;
  /** Tempo estimado de tudo que está marcado como assistido hoje (não depende do ano escolhido). */
  watchTime: WatchTimeTotal;
}

export const libraryTotals = (
  statusCounts: Partial<Record<WatchStatus, number>>,
  watched: Duration[],
): LibraryTotals => {
  const byStatus: Record<WatchStatus, number> = {
    want: statusCounts.want ?? 0,
    watching: statusCounts.watching ?? 0,
    watched: statusCounts.watched ?? 0,
    dropped: statusCounts.dropped ?? 0,
  };
  return {
    byStatus,
    total: byStatus.want + byStatus.watching + byStatus.watched + byStatus.dropped,
    watchTime: sumDurations(watched),
  };
};

export interface Backlog {
  titles: number;
  hours: number;
  missingTitles: number;
  hoursPerDay: number;
  /** Dia civil em que a fila termina no ritmo dado; `null` se a fila está vazia ou sem nenhuma duração conhecida. */
  etaDate: string | null;
  etaDays: number | null;
}

/**
 * "Quero ver" → "terminar até": minutos conhecidos divididos pelo ritmo (horas por dia), arredondados para cima.
 * Hoje conta como o primeiro dia de sessão, então "hoje + dias" é a data de término estimada.
 */
export const backlogEstimate = (wanted: Duration[], hoursPerDay: number, today: string): Backlog => {
  const total = sumDurations(wanted);
  const minutes = wanted.reduce((n, d) => n + (d.minutes ?? 0), 0);
  const haveEstimate = total.knownTitles > 0 && minutes > 0;
  const etaDays = haveEstimate ? Math.ceil(minutes / (hoursPerDay * 60)) : null;
  return {
    titles: wanted.length,
    hours: total.hours,
    missingTitles: total.missingTitles,
    hoursPerDay,
    etaDays,
    etaDate: etaDays === null ? null : addDays(today, etaDays),
  };
};
