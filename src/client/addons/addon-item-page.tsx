import { Alert, Artwork, Button, Card, EmptyState, Hero, Skeleton } from '@juninmd/sonido';
import { useEffect, useRef, useState } from 'react';
import { type AddonMetaDto, getAddonMeta, getTitleStreams, type TitleStreamsDto } from '../api/stremio.ts';
import { stopIfOnPage } from '../player/player-dock.ts';
import { SubtitlesPanel } from '../player/subtitles.tsx';
import { releaseTorrentPlayers } from '../player/torrent-player.tsx';
import { TrailerFrame } from '../player/trailer-embed.tsx';
import { BackButton } from '../ui/back.tsx';
import { Icon } from '../ui/icon.tsx';
import { AddonEpisodes } from './addon-episodes.tsx';
import { episodeLabel, isSeriesRoot, listEpisodes, parseImdbEpisodeId } from './addon-episode.ts';
import { addonItemPath, addonPath } from './addon-links.ts';
import { StreamsPanel } from './title-streams-panel.tsx';

interface ItemProps {
  addonId: string;
  type: string;
  itemId: string;
}

/** Uma linha só com o que o addon mandou: ano · duração · gêneros. */
const metaLine = (meta: AddonMetaDto): string => [meta.year, meta.runtime, meta.genres.join(', ')].filter((x): x is string => Boolean(x)).join(' · ');

type StreamsState = 'loading' | 'pick-episode' | 'error' | 'empty' | TitleStreamsDto;

const jumpToTrailer = () => {
  const target = document.getElementById('trailer');
  const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
  target?.scrollIntoView({ behavior: calm ? 'auto' : 'smooth', block: 'center' });
  target?.focus({ preventScroll: true });
};

function StreamsBody({ state, ...panel }: { state: StreamsState } & Omit<Parameters<typeof StreamsPanel>[0], 'dto'>) {
  if (state === 'loading') return <Skeleton label="Carregando streams…" rows={2} />;
  if (state === 'pick-episode') return <p className="hint">Escolha um episódio abaixo para carregar os streams.</p>;
  if (state === 'error') return <Alert tone="danger">não foi possível consultar os addons agora; tente de novo mais tarde.</Alert>;
  if (state === 'empty') return <p className="hint">nenhum stream para este título.</p>;
  return <StreamsPanel dto={state} {...panel} />;
}

function AddonItem({ addonId, type, itemId, meta }: ItemProps & { meta: AddonMetaDto }) {
  const [episodes] = useState(() => listEpisodes(meta));
  /** Episódio aberto agora; começa no próprio item (filme ou raiz da série). */
  const [current, setCurrent] = useState(itemId);
  const [streams, setStreams] = useState<StreamsState>('loading');
  const [playerHost, setPlayerHost] = useState<HTMLDivElement | null>(null);
  const streamsCard = useRef<HTMLDivElement>(null);

  const ep = episodes.find((v) => v.id === current);
  const label = ep ? `${meta.name} · ${episodeLabel(ep)}` : meta.name;
  const imdb = parseImdbEpisodeId(current);
  const mediaType: 'movie' | 'tv' = type === 'movie' || meta.type === 'movie' ? 'movie' : 'tv';

  useEffect(() => {
    let alive = true;
    const isRootOfSeries = isSeriesRoot(meta, episodes.length, current, itemId);
    const id = parseImdbEpisodeId(current);
    setStreams('loading');
    // O addon do item entra pelo id original; os outros addons de stream (Torrentio etc.) entram
    // pelo IMDb, então o item aberto no catálogo mostra torrents além dos streams do próprio addon.
    getTitleStreams({
      addonId,
      type,
      itemId: current,
      mediaType,
      ...(id && !isRootOfSeries ? { imdbId: id.imdbId, season: id.season, episode: id.episode } : {}),
    })
      .catch(() => null)
      .then((dto) => {
        if (!alive) return;
        // Grupos que responderam "nada" (sem erro) só poluem a lista quando outro addon trouxe streams.
        const groups = dto?.addons.filter((g) => g.streams.length > 0 || g.error !== null) ?? [];
        const hasStreams = groups.some((g) => g.streams.length > 0);
        if (dto && groups.length > 0 && (!isRootOfSeries || hasStreams)) setStreams({ ...dto, addons: groups });
        else setStreams(isRootOfSeries ? 'pick-episode' : dto === null ? 'error' : 'empty');
      });
    return () => {
      alive = false;
    };
  }, [addonId, type, itemId, meta, episodes.length, current, mediaType]);

  const pickEpisode = (id: string) => {
    stopIfOnPage();
    releaseTorrentPlayers();
    setCurrent(id);
    streamsCard.current?.scrollIntoView({ block: 'nearest' });
  };

  return (
    <>
      <Hero
        title={meta.name}
        backdrop={meta.background ?? undefined}
        aside={<Artwork title={meta.name} src={meta.poster ?? undefined} ratio="poster" />}
        meta={
          <>
            <span>{metaLine(meta)}</span>
            <p className="hero-overview">{meta.description || 'Sem sinopse disponível.'}</p>
          </>
        }
        actions={
          meta.trailerKey ? (
            <Button variant="ghost" onClick={jumpToTrailer}>
              Trailer
            </Button>
          ) : undefined
        }
      />
      <div className="detail-grid">
        <div>
          <TrailerFrame trailerKey={meta.trailerKey} />
          <div ref={setPlayerHost} />
        </div>
        <div>
          <div ref={streamsCard}>
            <Card className="side-card">
              <h3>{ep ? `Streams — ${episodeLabel(ep)}` : 'Streams'}</h3>
              <div aria-busy={streams === 'loading' || undefined}>
                <StreamsBody
                  state={streams}
                  title={label}
                  posterUrl={meta.poster}
                  route={addonItemPath(addonId, type, itemId)}
                  playerHost={playerHost}
                  captions={{
                    query: meta.name,
                    mediaType,
                    season: imdb?.season ?? null,
                    episode: imdb?.episode ?? null,
                  }}
                />
              </div>
            </Card>
          </div>
          {episodes.length > 0 && <AddonEpisodes episodes={episodes} current={current} onPick={pickEpisode} />}
          <Card className="side-card">
            <h3>Legendas</h3>
            <SubtitlesPanel query={meta.name} />
          </Card>
        </div>
      </div>
    </>
  );
}

export function AddonItemPage({ addonId, type, itemId }: ItemProps) {
  const [meta, setMeta] = useState<AddonMetaDto | 'loading' | 'error'>('loading');
  useEffect(() => {
    let alive = true;
    getAddonMeta(addonId, type, itemId)
      .then((m) => {
        if (alive) setMeta(m);
      })
      .catch(() => {
        if (alive) setMeta('error');
      });
    return () => {
      alive = false;
    };
  }, [addonId, type, itemId]);

  return (
    <div className="addon-item">
      <BackButton fallback={addonPath(addonId)} />
      {meta === 'loading' ? (
        <Skeleton label="Carregando item…" rows={5} media />
      ) : meta === 'error' ? (
        <div role="alert">
          <EmptyState icon={<Icon name="alert" />} title="não foi possível carregar este item do addon" />
        </div>
      ) : (
        <AddonItem addonId={addonId} type={type} itemId={itemId} meta={meta} />
      )}
    </div>
  );
}
