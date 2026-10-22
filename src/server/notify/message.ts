import type { CalendarEntry } from '../repo/calendar.ts';

/** Conteúdo do aviso. Só título e datas: nada de conta, e-mail ou identificador do usuário. */
export interface NotifyMessage {
  kind: 'episode' | 'movie';
  title: string;
  date: string;
  seasonNumber: number | null;
  episodeNumber: number | null;
  daysUntil: number;
  text: string;
}

export const buildMessage = (entry: CalendarEntry, daysUntil: number): NotifyMessage => {
  const when = daysUntil === 0 ? 'hoje' : `em ${daysUntil} dia${daysUntil === 1 ? '' : 's'}`;
  const what = entry.kind === 'episode' ? `T${entry.seasonNumber}E${entry.episodeNumber}` : 'estreia';
  return {
    kind: entry.kind,
    title: entry.titleName,
    date: entry.date,
    seasonNumber: entry.seasonNumber,
    episodeNumber: entry.episodeNumber,
    daysUntil,
    text: `${entry.titleName}: ${what} sai ${when} (${entry.date})`,
  };
};
