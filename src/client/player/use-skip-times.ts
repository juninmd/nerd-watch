import { useEffect } from 'react';
import { getSkipTimes } from '../api/skip-times.ts';
import type { EpisodeView } from '../catalog/episode-browser-model.ts';
import type { PlayContext } from './play-context.ts';
import { setSkipSegments } from './skip-segments.ts';

/** Abertura/créditos do episódio para a barra do player (IntroDB, AniSkip); sair da tela limpa. */
export const useSkipTimes = (ctx: PlayContext, ep: EpisodeView): void => {
  useEffect(() => {
    let alive = true;
    const q = ctx.query(ep);
    if (!('unavailable' in q))
      getSkipTimes({
        imdbId: q.imdbId ?? undefined,
        tmdbId: q.tmdbId,
        mediaType: 'tv',
        season: ep.season,
        episode: ep.number,
        title: ctx.seriesTitle,
        duration: ep.runtime ? ep.runtime * 60 : undefined,
      })
        .then((list) => alive && setSkipSegments(list))
        .catch(() => undefined);
    return () => {
      alive = false;
      setSkipSegments([]);
    };
  }, [ctx, ep]);
};
