import { isWithinWindow, todayIso } from '../date.ts';
import type { CalendarEntry } from '../repo/calendar.ts';

/** Lógica pura (sem I/O): quais lançamentos já pedem aviso agora. O banco entra só como `alreadySent`. */

export interface DueNotification {
  key: string;
  entry: CalendarEntry;
  daysUntil: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Chave estável por título + episódio + data: mudar a data (reagendamento) gera um novo aviso, mas mudar o
 * `leadDays` não — por isso a antecedência não entra na chave.
 */
export const notificationKey = (entry: CalendarEntry): string =>
  entry.kind === 'episode'
    ? `episode:${entry.titleId}:S${entry.seasonNumber}E${entry.episodeNumber}:${entry.date}`
    : `movie:${entry.titleId}:${entry.date}`;

/**
 * Lançamentos dentro de [hoje, hoje + leadDays] (dia local de `now`) que ainda não foram avisados. Lançamento já
 * passado não entra: a lista é do futuro.
 */
export const dueNotifications = (
  entries: readonly CalendarEntry[],
  now: Date,
  leadDays: number,
  alreadySent: ReadonlySet<string>,
): DueNotification[] => {
  const today = todayIso(now);
  const due: DueNotification[] = [];
  for (const entry of entries) {
    if (!isWithinWindow(entry.date, today, leadDays)) continue;
    const key = notificationKey(entry);
    if (alreadySent.has(key)) continue;
    due.push({ key, entry, daysUntil: daysBetween(today, entry.date) });
  }
  return due;
};

/** Diferença em dias de calendário entre duas datas `AAAA-MM-DD`, em UTC para não depender do fuso. */
const daysBetween = (fromIso: string, toIso: string): number => {
  const from = Date.parse(`${fromIso.slice(0, 10)}T00:00:00Z`);
  const to = Date.parse(`${toIso.slice(0, 10)}T00:00:00Z`);
  return Math.round((to - from) / DAY_MS);
};
