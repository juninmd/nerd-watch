import { addDaysIso, todayIso } from '../lib/date.ts';
import { tmdbEnabled } from '../config/config.ts';
import { anilistPremieres } from '../providers/anilist.ts';
import { tmdbImageUrl, tmdbMovieGenres, tmdbUpcomingMovies } from '../providers/tmdb.ts';
import { tvmazeWebPremieres } from '../providers/tvmaze.ts';
import type { CalendarEntry } from '../repo/calendar.ts';
import { buildInfo, clip, type CalendarInfo } from './info.ts';

/** TVmaze exige uma chamada por dia: o teto mantém a Agenda dentro do limite de 20 chamadas/10 s. */
export const DISCOVER_MAX_DAYS = 14;

export interface DiscoverEntry extends Omit<CalendarEntry, 'titleId' | 'posterPath'> {
  posterUrl: string | null;
  info: CalendarInfo;
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
          info: buildInfo({
            name: s.showName,
            origin: s.extras.anime ? 'anime' : 'serie',
            where: s.extras.channel ? (s.extras.channel.web ? 'stream' : 'tv') : 'desconhecido',
            providers: s.extras.channel ? [{ name: s.extras.channel.name, url: s.extras.channel.url }] : [],
            pageUrl: s.extras.pageUrl,
            officialUrl: s.extras.officialUrl,
            synopsis: clip(s.extras.summary),
            rating: s.extras.rating,
            genres: s.extras.genres,
          }),
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
          info: buildInfo({
            name: a.title,
            origin: 'anime',
            where: a.streaming.length ? 'stream' : 'desconhecido',
            providers: a.streaming,
            pageUrl: a.siteUrl,
            trailerKey: a.trailerKey,
            synopsis: clip(a.overview),
            rating: a.score,
            genres: a.genres,
            backdropUrl: a.bannerUrl,
          }),
        })),
      ),
    ],
  ];
  if (tmdbEnabled()) {
    jobs.push([
      'TMDB',
      Promise.all([tmdbUpcomingMovies(from, to), tmdbMovieGenres().catch(() => new Map<number, string>())]).then(([list, genreNames]) =>
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
          info: buildInfo({
            name: m.title,
            year: m.release_date.slice(0, 4),
            origin: 'filme',
            where: 'cinema',
            pageUrl: `https://www.themoviedb.org/movie/${m.id}`,
            synopsis: clip(m.overview?.trim() || null),
            rating: m.vote_average ? Math.round(m.vote_average * 10) / 10 : null,
            genres: (m.genre_ids ?? []).flatMap((id) => genreNames.get(id) ?? []),
            backdropUrl: tmdbImageUrl(m.backdrop_path ?? null, 'w780'),
          }),
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
