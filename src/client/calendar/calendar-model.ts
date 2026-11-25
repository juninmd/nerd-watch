import type { BadgeTone } from '@juninmd/sonido';
import type { CalendarEntryDto, CalendarInfoDto, CalendarOrigin } from '../api/index.ts';

/** Regras da Agenda sem DOM: origem, onde assistir, chaves e rótulos dos cartões. */

export type AgendaEntry = Omit<CalendarEntryDto, 'titleId'>;

export const ORIGIN_LABEL: Record<CalendarOrigin, string> = { serie: 'Série', filme: 'Filme', anime: 'Anime' };

export const ORIGIN_TONE: Record<CalendarOrigin, BadgeTone> = { serie: 'violet', filme: 'danger', anime: 'aqua' };

export const WHERE_TONE: Record<CalendarInfoDto['where'], BadgeTone> = {
  stream: 'success',
  cinema: 'gold',
  tv: 'neutral',
  desconhecido: 'neutral',
};

/** Origem conhecida sem rede: a fonte do catálogo e o tipo já dizem se é anime, filme ou série. */
export const originOf = (e: AgendaEntry, info?: CalendarInfoDto | null): CalendarOrigin =>
  info?.origin ?? (e.titleSource === 'anilist' ? 'anime' : e.mediaType === 'movie' ? 'filme' : 'serie');

/** "Streaming · Netflix, Max", "Cinema", "TV · HBO"; vazio enquanto a ficha não chegou. */
export const whereLabel = (info?: CalendarInfoDto | null): string => {
  if (!info) return '';
  const names = info.providers
    .slice(0, 3)
    .map((p) => p.name)
    .join(', ');
  if (info.where === 'cinema') return 'Nos cinemas';
  if (info.where === 'stream') return names ? `Streaming · ${names}` : 'Streaming';
  if (info.where === 'tv') return names ? `TV · ${names}` : 'TV';
  return names;
};

export const entryKey = (e: AgendaEntry): string => `${e.titleSource}:${e.mediaType}:${e.titleSourceId}`;

export const episodeLine = (e: AgendaEntry): string =>
  e.kind === 'episode'
    ? `T${e.seasonNumber} · Ep ${e.episodeNumber}${e.episodeName ? ` — ${e.episodeName}` : ''}`
    : 'Estreia do filme';

export const ratingText = (rating: number | null | undefined): string => (rating ? rating.toFixed(1) : '');

export const dayLabel = (iso: string, weekday = true): string =>
  new Date(`${iso}T00:00:00`).toLocaleDateString(
    'pt-BR',
    weekday ? { weekday: 'long', day: '2-digit', month: 'long' } : { day: '2-digit', month: 'long' },
  );

export const groupByDay = <T extends { date: string }>(entries: T[]): Map<string, T[]> => {
  const map = new Map<string, T[]>();
  for (const e of entries) {
    const list = map.get(e.date) ?? [];
    list.push(e);
    map.set(e.date, list);
  }
  return map;
};
