import { getTmdbSeason, getTmdbTitle, getTvmazeMore, getTvmazeTitle, type LibraryEntryDto } from '../api/index.ts';
import type { TitleStreamsQuery } from '../api/stremio.ts';
import type { EpisodeView } from '../catalog/episode-browser-model.ts';
import type { EpisodeMarker } from '../library/episode-progress.ts';
import type { PlaySource, SeasonCount } from './episode-play-model.ts';

/** O que a tela do player precisa de uma série, venha ela da TVmaze ou da TMDB. */
export interface PlayContext {
  source: PlaySource;
  id: string;
  titleId: string;
  seriesTitle: string;
  posterUrl: string | null;
  backHref: string;
  seasons: SeasonCount[];
  marker: EpisodeMarker | null;
  episodes: (season: number) => Promise<EpisodeView[]>;
  query: (ep: EpisodeView) => TitleStreamsQuery | { unavailable: string };
}

const markerOf = (lib: LibraryEntryDto | null): EpisodeMarker | null =>
  lib?.current_season != null && lib.current_episode != null ? { season: lib.current_season, episode: lib.current_episode } : null;

const tvmazeContext = async (id: string): Promise<PlayContext> => {
  // O IMDb vem da segunda carga; sem ele os addons não têm o que buscar, mas a fila de episódios ainda funciona.
  const [d, imdb] = await Promise.all([getTvmazeTitle(id), getTvmazeMore(id).then((m) => m.externals.imdb, () => null)]);
  return {
    source: 'tvmaze',
    id,
    titleId: d.titleId,
    seriesTitle: d.title,
    posterUrl: d.posterUrl,
    backHref: `#/title/tvmaze/tv/${id}`,
    seasons: d.seasons.map((s) => ({ number: s.seasonNumber, count: s.episodes.length })),
    marker: markerOf(d.library),
    episodes: async (n) =>
      (d.seasons.find((s) => s.seasonNumber === n)?.episodes ?? []).map((ep) => ({
        season: n,
        number: ep.episodeNumber,
        name: ep.name,
        airDate: ep.airDate,
        runtime: ep.runtime,
        overview: ep.overview,
        stillUrl: ep.stillUrl,
        rating: null,
      })),
    query: (ep) => (imdb ? { imdbId: imdb, mediaType: 'tv', season: ep.season, episode: ep.number } : { unavailable: 'Sem id do IMDb para esta série: não dá para buscar streams.' }),
  };
};

const tmdbContext = async (id: string): Promise<PlayContext> => {
  const d = await getTmdbTitle('tv', id);
  const cache = new Map<number, Promise<EpisodeView[]>>();
  return {
    source: 'tmdb',
    id,
    titleId: d.titleId,
    seriesTitle: d.title,
    posterUrl: d.posterUrl,
    backHref: `#/title/tmdb/tv/${id}`,
    seasons: d.seasons.map((s) => ({ number: s.seasonNumber, count: s.episodeCount })),
    marker: markerOf(d.library),
    episodes: (n) => {
      const hit = cache.get(n);
      if (hit) return hit;
      const p = getTmdbSeason(id, n).then((r) =>
        r.episodes.map((ep) => ({ season: n, number: ep.episodeNumber, name: ep.name, airDate: ep.airDate, runtime: ep.runtime, overview: ep.overview || null, stillUrl: ep.stillUrl, rating: null })),
      );
      // Falha não fica no cache: a próxima tentativa refaz o pedido.
      p.catch(() => cache.delete(n));
      cache.set(n, p);
      return p;
    },
    query: (ep) => ({ tmdbId: Number(id), mediaType: 'tv', season: ep.season, episode: ep.number }),
  };
};

export const loadPlayContext = (source: PlaySource, id: string): Promise<PlayContext> => (source === 'tvmaze' ? tvmazeContext(id) : tmdbContext(id));
