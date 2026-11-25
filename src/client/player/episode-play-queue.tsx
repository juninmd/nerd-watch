import { useLayoutEffect, useRef } from 'react';
import { episodeCode, type EpisodeView } from '../catalog/episode-browser-model.ts';
import { isEpisodeWatched } from '../library/episode-progress.ts';
import { Icon } from '../ui/icon.tsx';
import { playPath } from './episode-play-model.ts';
import type { PlayContext } from './play-context.ts';

interface EpisodeQueueProps {
  ctx: PlayContext;
  list: EpisodeView[];
  current: EpisodeView;
  marker: PlayContext['marker'];
  hidden: boolean;
}

/** Fila da temporada na lateral do player do episódio: o atual em destaque e os vistos esmaecidos. */
export function EpisodeQueue({ ctx, list, current, marker, hidden }: EpisodeQueueProps) {
  const panel = useRef<HTMLDivElement>(null);
  // Rola só a lista (não a página): no celular a lista fica abaixo do vídeo e o player precisa continuar à vista.
  useLayoutEffect(() => {
    const now = panel.current?.querySelector<HTMLElement>('[aria-current="true"]');
    if (panel.current && now) panel.current.scrollTop = now.offsetTop - 8;
  }, []);
  return (
    <div
      ref={panel}
      id="play-tabs-panel-q"
      role="tabpanel"
      aria-labelledby="play-tabs-q"
      className="play-panel"
      hidden={hidden}
    >
      {list.map((ep) => {
        const now = ep.season === current.season && ep.number === current.number;
        const seen = isEpisodeWatched(marker, ep.season, ep.number);
        const status = now ? 'tocando agora' : seen ? 'visto' : ep.runtime ? `${ep.runtime} min` : '';
        return (
          <a
            key={`${ep.season}x${ep.number}`}
            className={`next-item play-q${seen && !now ? ' is-seen' : ''}`}
            href={`#${playPath(ctx.source, ctx.id, ep.season, ep.number)}`}
            aria-current={now ? 'true' : undefined}
          >
            <span className="next-thumb">
              {ep.stillUrl ? (
                <img className="next-thumb-img" src={ep.stillUrl} alt="" loading="lazy" decoding="async" />
              ) : (
                <Icon name="film" />
              )}
              {now && <small className="play-now">tocando</small>}
            </span>
            <span className="next-text">
              <small className="mono">{episodeCode(ep)}</small>
              <b>{ep.name}</b>
              <small>{status}</small>
            </span>
          </a>
        );
      })}
    </div>
  );
}
