import { CatalogRequestError } from '../lib/catalog-text.ts';
import { tmdbEnabled } from '../config/config.ts';
import { anilistDetails } from '../providers/anilist.ts';
import { tmdbImageUrl, tmdbTitleDetails, tmdbTrailerKey, tmdbTvIdByImdb, tmdbWatchProviders, type TmdbWatchProviders } from '../providers/tmdb.ts';
import { tvmazeShowInfo } from '../providers/tvmaze.ts';
import { todayIso, addDaysIso } from '../lib/date.ts';
import { buildInfo, clip, type CalendarInfo } from './info.ts';

export type DetailMedia = 'movie' | 'tv';
const SOURCES = ['tmdb', 'tvmaze', 'anilist'] as const;
export type DetailSource = (typeof SOURCES)[number];
export const isDetailSource = (v: string): v is DetailSource => (SOURCES as readonly string[]).includes(v);

/** Streaming por assinatura primeiro; sem ele, o que sobrar (aluguel/compra) ainda é uma pista de onde ver. */
const providersOf = (p: TmdbWatchProviders | null) => {
  const pick = p?.flatrate.length ? p.flatrate : [...(p?.rent ?? []), ...(p?.buy ?? [])];
  return { stream: Boolean(p?.flatrate.length), list: pick.map((x) => ({ name: x.provider_name, url: p?.link ?? null })) };
};

const settledValue = <T>(r: PromiseSettledResult<T>): T | null => (r.status === 'fulfilled' ? r.value : null);

const tmdbInfo = async (media: DetailMedia, id: number): Promise<CalendarInfo> => {
  const [details, trailer, watch] = await Promise.allSettled([tmdbTitleDetails(media, id), tmdbTrailerKey(media, id), tmdbWatchProviders(media, id)]);
  const d = settledValue(details);
  if (!d) throw new CatalogRequestError(502, 'TMDB indisponível no momento');
  const prov = providersOf(settledValue(watch));
  // Filme que estreou há pouco ou ainda vai estrear e não está em nenhum streaming: o lugar é o cinema.
  const nearTheaters = media === 'movie' && d.release_date !== null && d.release_date >= addDaysIso(todayIso(), -60);
  return buildInfo({
    name: d.title,
    year: d.release_date?.slice(0, 4),
    origin: media === 'movie' ? 'filme' : 'serie',
    where: prov.stream ? 'stream' : nearTheaters ? 'cinema' : media === 'tv' ? 'tv' : 'desconhecido',
    providers: prov.list,
    pageUrl: `https://www.themoviedb.org/${media}/${id}`,
    trailerKey: settledValue(trailer),
    synopsis: d.overview?.trim() || null,
    rating: d.vote_average ? Math.round(d.vote_average * 10) / 10 : null,
    genres: d.genres,
    backdropUrl: tmdbImageUrl(d.backdrop_path, 'w780'),
  });
};

const tvmazeInfo = async (id: number): Promise<CalendarInfo> => {
  const show = await tvmazeShowInfo(id);
  let trailerKey: string | null = null;
  let providers = show.channel ? [{ name: show.channel.name, url: show.channel.url }] : [];
  let where: CalendarInfo['where'] = show.channel ? (show.channel.web ? 'stream' : 'tv') : 'desconhecido';
  // A TVmaze não tem trailer nem catálogo de streaming por país: se a TMDB está ativa, cruza pelo id do IMDb.
  if (tmdbEnabled() && show.imdbId) {
    const tvId = await tmdbTvIdByImdb(show.imdbId).catch(() => null);
    if (tvId) {
      const [trailer, watch] = await Promise.allSettled([tmdbTrailerKey('tv', tvId), tmdbWatchProviders('tv', tvId)]);
      trailerKey = settledValue(trailer);
      const prov = providersOf(settledValue(watch));
      if (prov.stream) {
        providers = prov.list;
        where = 'stream';
      }
    }
  }
  return buildInfo({
    name: show.name,
    year: show.premiered?.slice(0, 4),
    origin: show.anime ? 'anime' : 'serie',
    where,
    providers,
    pageUrl: show.pageUrl,
    officialUrl: show.officialUrl,
    trailerKey,
    synopsis: clip(show.summary, 900),
    rating: show.rating,
    genres: show.genres,
  });
};

const anilistInfo = async (id: number): Promise<CalendarInfo> => {
  const a = await anilistDetails(id);
  return buildInfo({
    name: a.title,
    year: a.year,
    origin: 'anime',
    where: a.extras.streaming.length ? 'stream' : 'desconhecido',
    providers: a.extras.streaming,
    pageUrl: a.siteUrl,
    trailerKey: a.extras.trailerKey,
    synopsis: a.overview,
    rating: a.averageScore === null ? null : a.averageScore / 10,
    genres: a.genres,
    backdropUrl: a.extras.bannerUrl,
  });
};

/** Ficha completa de um item (trailer, onde assistir, links). Chamada sob demanda pela Agenda: cada fonte já tem cache e limite próprios. */
export const calendarInfoFor = (source: DetailSource, id: number, media: DetailMedia): Promise<CalendarInfo> => {
  if (source === 'tmdb') return tmdbInfo(media, id);
  if (source === 'tvmaze') return tvmazeInfo(id);
  return anilistInfo(id);
};
