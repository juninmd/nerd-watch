import { Button, EmptyState } from '@juninmd/sonido';
import { useEffect, useRef, useState } from 'react';
import { TitleStreams } from '../addons/title-streams-panel.tsx';
import { getTmdbTitle, type TmdbDetailDto } from '../api/index.ts';
import type { EpisodeMarker } from '../library/episode-progress.ts';
import { RefreshMetadata } from '../library/refresh-metadata.tsx';
import { RelinkButton } from '../library/relink-dialog.tsx';
import { StatusActions } from '../library/status-actions.tsx';
import { AddToList } from '../lists/add-to-list.tsx';
import { stopIfOnPageIn } from '../player/player-dock.ts';
import { SubtitlesPanel } from '../player/subtitles.tsx';
import { releaseTorrentPlayers } from '../player/torrent-player.tsx';
import { TrailerFrame } from '../player/trailer-embed.tsx';
import { BackLink } from '../ui/back.tsx';
import { Icon } from '../ui/icon.tsx';
import { progressFromMarker } from './episode-browser-model.ts';
import { SideCard } from './side-card.tsx';
import { SourceCompare } from './source-compare-card.tsx';
import { TitleError, TitleSkeleton } from './title-error.tsx';
import { jumpTo, TitleHero } from './title-hero.tsx';
import { TmdbSeasons } from './title-page-seasons.tsx';
import { ProgressCard } from './title-side-view.tsx';
import { useLoad } from './use-load.ts';
import { WhereToWatch } from './where-to-watch.tsx';

const markerOf = (d: TmdbDetailDto): EpisodeMarker | null =>
  d.library?.current_season != null && d.library.current_episode != null
    ? { season: d.library.current_season, episode: d.library.current_episode }
    : null;

/** Anel "seu progresso" pelo marcador da biblioteca; especiais (temporada 0) ficam fora da conta. */
function TmdbProgress({ d, marker }: { d: TmdbDetailDto; marker: EpisodeMarker | null }) {
  const { watched, total } = progressFromMarker(
    d.seasons.map((s) => ({ number: s.seasonNumber, count: s.episodeCount })),
    marker,
  );
  return (
    <ProgressCard
      watched={watched}
      total={total}
      next={marker ? `T${marker.season} · Ep ${marker.episode} é onde você parou` : null}
    />
  );
}

/** Ficha de filme ou série da TMDB. */
export function TmdbTitle({ mediaType, id }: { mediaType: 'movie' | 'tv'; id: string }) {
  const { data: d, error, retry, reload } = useLoad(() => getTmdbTitle(mediaType, id), `${mediaType}/${id}`);
  const root = useRef<HTMLDivElement>(null);
  const where = useRef<HTMLDivElement>(null);
  // O cartão dos streams fica na coluna lateral; o vídeo vai para a principal, acima dos episódios.
  const [playerHost, setPlayerHost] = useState<HTMLDivElement | null>(null);
  const [marker, setMarker] = useState<EpisodeMarker | null>(null);
  useEffect(() => {
    if (d) setMarker(markerOf(d));
  }, [d]);
  // Sair da ficha fecha torrent e vídeo desta página, sem tocar no player minimizado.
  useEffect(() => {
    const el = root.current;
    return () => {
      if (!el) return;
      releaseTorrentPlayers(el);
      stopIfOnPageIn(el);
    };
  }, []);

  const body = error ? <TitleError onRetry={retry} /> : !d ? <TitleSkeleton /> : null;
  if (body || !d) return <div ref={root}>{body}</div>;
  const tv = mediaType === 'tv';
  const year = d.releaseDate?.slice(0, 4) ?? null;
  // Para série, os addons exigem `tt…:temporada:episódio`; usamos onde você parou.
  const season = tv ? (d.library?.current_season ?? null) : null;
  const episode = tv ? (d.library?.current_episode ?? null) : null;
  return (
    <div ref={root}>
      <BackLink href="#/library" label="Voltar" useHistory />
      <TitleHero
        title={d.title}
        posterUrl={d.posterUrl}
        backdropUrl={d.backdropUrl}
        meta={[tv ? 'Série' : 'Filme', year ?? '—', d.voteAverage ? `⭐ ${d.voteAverage.toFixed(1)}` : null, d.status]}
        overview={d.overview}
        actions={
          <>
            <Button onClick={() => jumpTo(where.current)}>Onde assistir</Button>
            {d.trailerKey && (
              <Button variant="ghost" onClick={() => jumpTo(root.current?.querySelector<HTMLElement>('#trailer'))}>
                Trailer
              </Button>
            )}
          </>
        }
      />
      <div className="detail-grid">
        <div>
          <TrailerFrame trailerKey={d.trailerKey} />
          <div ref={setPlayerHost} />
          {tv && (
            <TmdbSeasons
              tmdbId={id}
              seriesTitle={d.title}
              seasons={d.seasons}
              titleId={d.titleId}
              inLibrary={Boolean(d.library)}
              marker={marker}
              onMarkerChange={setMarker}
              refreshParent={reload}
            />
          )}
          {!tv && (
            <EmptyState
              icon={<Icon name="film" />}
              title="filmes protegidos por direitos autorais não são reproduzidos dentro do app"
              description={
                <>
                  use os streamings ao lado, ou confira o acervo de <a href="#/public-domain">domínio público</a> se
                  este título já for livre.
                </>
              }
            />
          )}
        </div>
        <div>
          {tv && <TmdbProgress d={d} marker={marker} />}
          <div className="side-card" id="where-card" tabIndex={-1} ref={where}>
            <WhereToWatch providers={d.watchProviders} />
          </div>
          <SideCard title="Sua lista">
            <StatusActions
              titleId={d.titleId}
              entryId={d.library?.id ?? null}
              watchStatus={d.library?.watch_status ?? null}
              rating={d.library?.rating ?? null}
              rewatchCount={d.library?.rewatch_count ?? 0}
              onChange={reload}
            />
            {d.library && (
              <div className="side-card__row">
                <RelinkButton titleId={d.titleId} current={{ source: 'tmdb', sourceId: id }} initialQuery={d.title} />
              </div>
            )}
            <div className="side-card__row">
              <AddToList titleId={d.titleId} />
            </div>
            <div className="side-card__row">
              <RefreshMetadata titleId={d.titleId} onDone={reload} />
            </div>
          </SideCard>
          {tv && (
            <SideCard title="Fontes">
              <SourceCompare tmdbId={id} />
            </SideCard>
          )}
          <TitleStreams
            // Nome/ano permitem achar o item em addons que só entendem id próprio (`afhd:…`).
            query={{ tmdbId: Number(id), mediaType, season, episode, title: d.title, year }}
            title={d.title}
            posterUrl={d.posterUrl}
            playerHost={playerHost}
          />
          <SideCard title="Legendas">
            <SubtitlesPanel tmdbId={Number(id)} mediaType={mediaType} season={season} episode={episode} />
          </SideCard>
        </div>
      </div>
    </div>
  );
}
