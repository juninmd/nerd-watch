import { getTmdbSeason, type LibraryEntryDto, type TmdbDetailDto } from '../api/index.ts';
import type { EpisodeMarker } from '../library/episode-progress.ts';
import { markThrough } from '../library/mark-progress.ts';
import { playPath } from '../player/episode-play-model.ts';
import { renderEpisodeBrowser } from './episode-browser.ts';
import type { EpisodeView } from './episode-browser-model.ts';

/** Episódios de uma série da TMDB: cada temporada carrega sob demanda; o detalhe e os links abrem no modal. */
export const renderSeasons = (
  container: HTMLElement,
  tmdbId: string,
  seriesTitle: string,
  seasons: TmdbDetailDto['seasons'],
  titleId: string,
  library: LibraryEntryDto | null,
  refreshParent: () => void,
  onMarkerChange: (m: EpisodeMarker | null) => void,
): void => {
  let marker: EpisodeMarker | null = library?.current_season != null && library.current_episode != null ? { season: library.current_season, episode: library.current_episode } : null;
  const browser = renderEpisodeBrowser(container, {
    seriesTitle,
    seasons: seasons.map((s) => ({ number: s.seasonNumber, name: s.name, count: s.episodeCount })),
    initialSeason: marker?.season ?? seasons.find((s) => s.seasonNumber > 0 && s.episodeCount > 0)?.seasonNumber ?? 1,
    load: (n) =>
      getTmdbSeason(tmdbId, n).then((data) =>
        data.episodes.map(
          (ep): EpisodeView => ({ season: n, number: ep.episodeNumber, name: ep.name, airDate: ep.airDate, runtime: ep.runtime, overview: ep.overview || null, stillUrl: ep.stillUrl, rating: null }),
        ),
      ),
    marker: () => marker,
    streams: (ep) => ({ tmdbId: Number(tmdbId), mediaType: 'tv', season: ep.season, episode: ep.number }),
    playPath: (ep) => playPath('tmdb', tmdbId, ep.season, ep.number),
    onMark: (ep) =>
      markThrough(titleId, ep.season, ep.number, (m) => {
        marker = m;
        onMarkerChange(m);
        // Série que não estava na lista entra nela: o cartão "Sua lista" precisa refletir; senão basta repintar os episódios.
        if (!library) refreshParent();
        else browser.refresh();
      }),
  });
};
