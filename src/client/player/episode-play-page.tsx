import { Button, EmptyState, Kbd, Skeleton, Switch } from '@juninmd/sonido';
import { useCallback, useEffect, useRef, useState } from 'react';
import { streamFacts } from '../addons/stream-filter.ts';
import type { AddonStreamGroup, AddonStreamItem } from '../addons/stream-lookup.ts';
import { navigate } from '../app/router.ts';
import { episodeCode, type EpisodeView } from '../catalog/episode-browser-model.ts';
import { dateLabel } from '../catalog/tvmaze-view.ts';
import { isEpisodeWatched } from '../library/episode-progress.ts';
import { markThrough } from '../library/mark-progress.ts';
import { Icon } from '../ui/icon.tsx';
import {
  hdStill,
  isPlayable,
  neighborEpisode,
  type PlaySource,
  playPath,
  type StreamPick,
} from './episode-play-model.ts';
import { saveStreamPref } from './episode-play-pref.ts';
import { EpisodePlaySide } from './episode-play-side.tsx';
import { loadPlayContext, type PlayContext } from './play-context.ts';
import { usePlayerChange } from './player-events.ts';
import { creditsStart, getSkipSegments } from './skip-segments.ts';
import { SourceCollectorCard } from './source-collector-card.tsx';
import { useEpisodeStreams } from './use-episode-streams.ts';
import { useSkipTimes } from './use-skip-times.ts';
import { getAutoplay, getVideo, setAutoplay, subscribeEnded } from './player-dock.ts';
import { useEndCountdown, WatchEndCard } from './watch-end-card.tsx';

const COUNTDOWN = 10;

interface PlayViewProps {
  ctx: PlayContext;
  list: EpisodeView[];
  ep: EpisodeView;
  explicit: StreamPick | null;
}

function PlayView({ ctx, list, ep, explicit }: PlayViewProps) {
  const [marker, setMarker] = useState(ctx.marker);
  const [autoplay, setAutoplayState] = useState(getAutoplay);
  const [host, setHost] = useState<HTMLElement | null>(null);
  const numbers = list.map((e) => e.number);
  const prev = neighborEpisode(ctx.seasons, ep.season, ep.number, -1, numbers);
  const next = neighborEpisode(ctx.seasons, ep.season, ep.number, 1, numbers);
  const hd = hdStill(ep.stillUrl);
  const go = useCallback(
    (to: { season: number; episode: number } | null) =>
      to && navigate(playPath(ctx.source, ctx.id, to.season, to.episode)),
    [ctx],
  );
  const end = useEndCountdown(() => go(next));
  const query = ctx.query(ep);

  useEffect(() => {
    document.title = `${ctx.seriesTitle} ${episodeCode(ep)} — nerd-watch`;
  }, [ctx, ep]);

  const titleKey = `${ctx.source}:${ctx.id}`;
  const { streams, collect, playNow } = useEpisodeStreams(query, titleKey, explicit);

  const mark = useCallback(
    () =>
      markThrough(ctx.titleId, ep.season, ep.number, setMarker).catch(() => {
        // markThrough já avisou no toast.
      }),
    [ctx.titleId, ep],
  );

  useSkipTimes(ctx, ep);

  // Fim do episódio (ou início dos créditos, quando se sabe): marca como visto e, com a reprodução automática
  // ligada, conta até abrir o próximo. Os créditos disparam uma vez só por episódio.
  const creditsFired = useRef(false);
  // O `<video>` global nasce quando a primeira fonte toca: o efeito religa quando o player muda.
  const playerVersion = usePlayerChange();
  useEffect(() => {
    const video = getVideo();
    const finish = () => {
      if (!isEpisodeWatched(marker, ep.season, ep.number)) void mark();
      if (next) end.start(COUNTDOWN, getAutoplay());
    };
    const onTime = () => {
      if (creditsFired.current || !video || !next) return;
      const at = creditsStart(getSkipSegments(), video.duration);
      if (at === null || video.currentTime < at) return;
      creditsFired.current = true;
      finish();
    };
    // Voltar a tocar (replay, arrastar a barra) cancela a contagem: senão a tela troca no meio do vídeo.
    video?.addEventListener('play', end.stop);
    video?.addEventListener('timeupdate', onTime);
    const unsubscribe = subscribeEnded(finish);
    return () => {
      unsubscribe();
      video?.removeEventListener('play', end.stop);
      video?.removeEventListener('timeupdate', onTime);
    };
  }, [marker, ep, next, mark, end.start, end.stop, playerVersion]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || !e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return;
      const tag = (e.target as HTMLElement | null)?.tagName ?? '';
      if (/^(INPUT|SELECT|TEXTAREA)$/.test(tag)) return;
      const k = e.key.toLowerCase();
      if (k === 'n' && next) go(next);
      else if (k === 'p' && prev) go(prev);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [next, prev, go]);

  /** Fonte escolhida (pelo usuário ou pela preferência): para a contagem e lembra a escolha para o próximo episódio. */
  const onPick = (group: AddonStreamGroup, stream: AddonStreamItem): boolean => {
    end.stop();
    if (isPlayable(stream)) saveStreamPref({ addonId: group.addonId, height: streamFacts(stream).height }, titleKey);
    // O painel toca a fonte e marca qual está tocando.
    return false;
  };

  const pick = streams.kind === 'ready' ? streams.pick : null;
  const status =
    streams.kind === 'loading'
      ? 'Procurando fontes…'
      : streams.kind === 'none'
        ? streams.message
        : pick
          ? ''
          : 'Nenhuma fonte tocável aqui; veja os links externos em “Onde assistir”.';
  const left = end.end?.left ?? null;
  return (
    <div className="watch play">
      <div className="watch-main">
        <div className="play-frame">
          <section className="play-host" ref={setHost} tabIndex={-1} aria-label="Player do stream">
            {hd && <img className="play-poster" src={hd} alt="" />}
            {streams.kind === 'loading' && collect && (
              <SourceCollectorCard collected={collect} onPlayNow={playNow} />
            )}
            {status && !(streams.kind === 'loading' && collect) && (
              <p className="play-status" role="status">
                {status}
              </p>
            )}
          </section>
          {end.end && next && (
            <WatchEndCard
              caption={`Fim de ${episodeCode(ep)}`}
              title={`A seguir: T${next.season} · E${String(next.episode).padStart(2, '0')}`}
              countText={left !== null ? `começa em ${left}s, com a mesma fonte` : ''}
              onGo={() => go(next)}
              onStay={end.stop}
            />
          )}
        </div>
        <a className="btn btn-ghost btn-sm watch-back" href={ctx.backHref}>
          <Icon name="back" size="sm" /> {ctx.seriesTitle}
        </a>
        <p className="eyebrow">
          {ctx.seriesTitle} · {episodeCode(ep)}
        </p>
        <h1 className="watch-title">{ep.name}</h1>
        <p className="hint">
          {[ep.runtime ? `${ep.runtime} min` : '', ep.airDate ? dateLabel(ep.airDate) : ''].filter(Boolean).join(' · ')}
        </p>
        <div className="watch-actions">
          <Button
            variant="ghost"
            size="sm"
            disabled={!prev}
            iconStart={<Icon name="back" size="sm" />}
            onClick={() => go(prev)}
          >
            Anterior
          </Button>
          <Button variant="primary" size="sm" onClick={() => void mark()}>
            Marcar visto até aqui
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={!next}
            iconEnd={<Icon name="forward" size="sm" />}
            onClick={() => go(next)}
          >
            Próximo
          </Button>
          <Switch
            label="próximo episódio automático"
            checked={autoplay}
            onChange={(on) => {
              setAutoplay(on);
              setAutoplayState(on);
            }}
          />
        </div>
        {ep.overview && <p className="watch-desc">{ep.overview}</p>}
        <p className="hint">
          <Kbd>Shift</Kbd>+<Kbd>N</Kbd> próximo · <Kbd>Shift</Kbd>+<Kbd>P</Kbd> anterior · demais teclas do player como
          no YouTube
        </p>
      </div>
      <EpisodePlaySide
        ctx={ctx}
        list={list}
        ep={ep}
        marker={marker}
        streams={streams}
        hd={hd}
        host={host}
        onPick={onPick}
      />
    </div>
  );
}

type Load =
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'missing'; backHref: string }
  | { kind: 'ready'; ctx: PlayContext; list: EpisodeView[]; ep: EpisodeView };

export interface EpisodePlayPageProps {
  source: PlaySource;
  id: string;
  season: number;
  episode: number;
  query: URLSearchParams;
}

/** Player dedicado de um episódio: vídeo grande, fila da temporada e todas as fontes na lateral. */
export function EpisodePlayPage({ source, id, season, episode, query }: EpisodePlayPageProps) {
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  useEffect(() => {
    let alive = true;
    loadPlayContext(source, id)
      .then(async (ctx) => {
        const list = await ctx.episodes(season);
        if (!alive) return;
        // Número fora da temporada (vindo do vizinho de outra temporada): encaixa no primeiro/último que existe.
        const sorted = [...list].sort((a, b) => a.number - b.number);
        const ep =
          list.find((e) => e.number === episode) ??
          (episode < (sorted[0]?.number ?? 0)
            ? sorted[0]
            : episode > (sorted.at(-1)?.number ?? 0)
              ? sorted.at(-1)
              : undefined);
        setLoad(ep ? { kind: 'ready', ctx, list, ep } : { kind: 'missing', backHref: ctx.backHref });
      })
      .catch(() => alive && setLoad({ kind: 'error' }));
    return () => {
      alive = false;
    };
  }, [source, id, season, episode]);

  if (load.kind === 'loading') return <Skeleton media label="carregando o episódio" />;
  if (load.kind === 'error')
    return <EmptyState icon={<Icon name="alert" />} title="não foi possível carregar este episódio" />;
  if (load.kind === 'missing') {
    return (
      <EmptyState
        icon={<Icon name="film" />}
        title="episódio não encontrado"
        action={<a href={load.backHref}>voltar à série</a>}
      />
    );
  }
  const addon = query.get('addon');
  const rawIndex = query.get('i');
  const index = rawIndex === null || rawIndex === '' ? Number.NaN : Number(rawIndex);
  const explicit = addon && Number.isInteger(index) && index >= 0 ? { addonId: addon, index } : null;
  return <PlayView ctx={load.ctx} list={load.list} ep={load.ep} explicit={explicit} />;
}
