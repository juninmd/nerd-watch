import { addDaysIso, todayIso } from '../lib/date.ts';
import { tmdbEnabled } from '../config/config.ts';
import { anilistPremieres } from '../providers/anilist.ts';
import { tmdbImageUrl, tmdbUpcomingMovies } from '../providers/tmdb.ts';
import { tvmazeWebPremieres } from '../providers/tvmaze.ts';
import type { CalendarEntry } from '../repo/calendar.ts';

/** TVmaze exige uma chamada por dia: o teto mantém a Agenda dentro do limite de 20 chamadas/10 s. */
export const DISCOVER_MAX_DAYS = 14;

export interface DiscoverEntry extends Omit<CalendarEntry, 'titleId' | 'posterPath'> {
  posterUrl: string | null;
}

export interface DiscoverResult {
  entries: DiscoverEntry[];
  /** Fontes que falharam (a Agenda mostra o aviso em vez de uma lista vazia silenciosa). */
  failed: string[];
}

const localDate = (epochSeconds: number): string => todayIso(new Date(epochSeconds * 1000));

/** Estreias públicas dos próximos dias, sem depender da biblioteca: filmes (TMDB, se houver chave), séries de streaming (TVmaze) e anime (AniList). */
export const discoverUpcoming = async (days: number, from = todayIso()): Promise<DiscoverResult> => {
  const span = Math.min(Math.max(Math.ceil(days), 1), DISCOVER_MAX_DAYS);
  const to = addDaysIso(from, span);
  const dates = Array.from({ length: span + 1 }, (_, i) => addDaysIso(from, i));

  const jobs: Array<[string, Promise<DiscoverEntry[]>]> = [
    [
      'TVmaze',
      Promise.all(dates.map((d) => tvmazeWebPremieres(d))).then((days) =>
        days.flat().map((s): DiscoverEntry => ({
          kind: 'episode',
          titleSource: 'tvmaze',
          titleSourceId: String(s.showId),
          titleName: s.showName,
          mediaType: 'tv',
          posterUrl: s.imageUrl,
          date: s.date,
          seasonNumber: s.season,
          episodeNumber: s.number,
          episodeName: s.episodeName || null,
        })),
      ),
    ],
    [
      'AniList',
      anilistPremieres(Math.floor(Date.parse(`${from}T00:00:00`) / 1000), Math.floor(Date.parse(`${to}T23:59:59`) / 1000)).then((list) =>
        list.map((a): DiscoverEntry => ({
          kind: 'episode',
          titleSource: 'anilist',
          titleSourceId: String(a.id),
          titleName: a.title,
          mediaType: 'tv',
          posterUrl: a.imageUrl,
          date: localDate(a.airingAt),
          seasonNumber: 1,
          episodeNumber: 1,
          episodeName: null,
        })),
      ),
    ],
  ];
  if (tmdbEnabled()) {
    jobs.push([
      'TMDB',
      tmdbUpcomingMovies(from, to).then((list) =>
        list.map((m): DiscoverEntry => ({
          kind: 'movie',
          titleSource: 'tmdb',
          titleSourceId: String(m.id),
          titleName: m.title,
          mediaType: 'movie',
          posterUrl: tmdbImageUrl(m.poster_path, 'w342'),
          date: m.release_date,
          seasonNumber: null,
          episodeNumber: null,
          episodeName: null,
        })),
      ),
    ]);
  }

  const settled = await Promise.allSettled(jobs.map(([, p]) => p));
  const entries: DiscoverEntry[] = [];
  const failed: string[] = [];
  settled.forEach((r, i) => {
    if (r.status === 'fulfilled') entries.push(...r.value);
    else failed.push(jobs[i]?.[0] ?? '?');
  });
  entries.sort((a, b) => a.date.localeCompare(b.date) || a.titleName.localeCompare(b.titleName));
  return { entries, failed };
};
