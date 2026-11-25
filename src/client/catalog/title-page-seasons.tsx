import { useState } from 'react';
import { getTmdbSeason, type TmdbDetailDto } from '../api/index.ts';
import type { EpisodeMarker } from '../library/episode-progress.ts';
import { markThrough } from '../library/mark-progress.ts';
import { playPath } from '../player/episode-play-model.ts';
import { EpisodeBrowser } from './episode-browser.tsx';
import type { EpisodeView } from './episode-browser-model.ts';

export interface TmdbSeasonsProps {
  tmdbId: string;
  seriesTitle: string;
  seasons: TmdbDetailDto['seasons'];
  titleId: string;
  /** Série já está na sua lista? Fora dela, marcar um episódio a adiciona e a ficha recarrega. */
  inLibrary: boolean;
  marker: EpisodeMarker | null;
  onMarkerChange: (m: EpisodeMarker | null) => void;
  refreshParent: () => void;
}

/** Episódios de uma série da TMDB: cada temporada carrega sob demanda; o detalhe e os links abrem no modal. */
export function TmdbSeasons({
  tmdbId,
  seriesTitle,
  seasons,
  titleId,
  inLibrary,
  marker,
  onMarkerChange,
  refreshParent,
}: TmdbSeasonsProps) {
  const [season, setSeason] = useState(
    () => marker?.season ?? seasons.find((s) => s.seasonNumber > 0 && s.episodeCount > 0)?.seasonNumber ?? 1,
  );
  return (
    <EpisodeBrowser
      seriesTitle={seriesTitle}
      seasons={seasons.map((s) => ({ number: s.seasonNumber, name: s.name, count: s.episodeCount }))}
      season={season}
      onSeasonChange={setSeason}
      load={(n) =>
        getTmdbSeason(tmdbId, n).then((data) =>
          data.episodes.map(
            (ep): EpisodeView => ({
              season: n,
              number: ep.episodeNumber,
              name: ep.name,
              airDate: ep.airDate,
              runtime: ep.runtime,
              overview: ep.overview || null,
              stillUrl: ep.stillUrl,
              rating: null,
            }),
          ),
        )
      }
      marker={marker}
      streams={(ep) => ({
        tmdbId: Number(tmdbId),
        mediaType: 'tv',
        season: ep.season,
        episode: ep.number,
        title: seriesTitle,
      })}
      playPath={(ep) => playPath('tmdb', tmdbId, ep.season, ep.number)}
      onMark={(ep) =>
        markThrough(titleId, ep.season, ep.number, (m) => {
          onMarkerChange(m);
          // Série que não estava na lista entra nela: o cartão "Sua lista" precisa refletir.
          if (!inLibrary) refreshParent();
        })
      }
    />
  );
}
