import { Badge, Button } from '@juninmd/sonido';
import { useEffect, useMemo, useRef, useState } from 'react';
import { getTvmazeMore, getTvmazeTitle, type TvmazeDetailDto, type TvmazeMoreDto } from '../api/index.ts';
import type { EpisodeMarker } from '../library/episode-progress.ts';
import { markThrough } from '../library/mark-progress.ts';
import { RelinkButton } from '../library/relink-dialog.tsx';
import { StatusActions } from '../library/status-actions.tsx';
import { playPath } from '../player/episode-play-model.ts';
import { BackLink } from '../ui/back.tsx';
import { Icon } from '../ui/icon.tsx';
import { pluralize } from '../ui/pluralize.ts';
import { EpisodeBrowser } from './episode-browser.tsx';
import { type EpisodeView, progressFromMarker } from './episode-browser-model.ts';
import { openPersonModal } from './person-modal.tsx';
import { LinkButton, SideCard } from './side-card.tsx';
import { TitleError, TitleSkeleton } from './title-error.tsx';
import { TitleHero } from './title-hero.tsx';
import { CastCard, ProgressCard, SeasonsCard, seasonRows } from './title-side-view.tsx';
import { Agenda, Akas, Channels, Crew, ExternalLinks, Facts, Gallery } from './tvmaze-sections.tsx';
import { episodeTypeTag, metaByEpisode, seasonSummaryText } from './tvmaze-view.ts';
import { useLoad } from './use-load.ts';

const markerOf = (d: TvmazeDetailDto): EpisodeMarker | null =>
  d.library?.current_season != null && d.library.current_episode != null
    ? { season: d.library.current_season, episode: d.library.current_episode }
    : null;

/** Segunda carga (elenco, equipe, galeria…): falha aqui só esconde as seções extras, a ficha básica já está na tela. */
const useMore = (id: string): TvmazeMoreDto | null => {
  const [more, setMore] = useState<TvmazeMoreDto | null>(null);
  useEffect(() => {
    let live = true;
    getTvmazeMore(id)
      .then((m) => live && setMore(m))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [id]);
  return more;
};

function TvmazeDetail({ id, d, reload }: { id: string; d: TvmazeDetailDto; reload: () => void }) {
  const more = useMore(id);
  const [marker, setMarker] = useState(() => markerOf(d));
  const [season, setSeason] = useState(
    () => markerOf(d)?.season ?? d.seasons.find((s) => s.seasonNumber > 0)?.seasonNumber ?? 1,
  );
  const episodes = useRef<HTMLElement>(null);
  useEffect(() => setMarker(markerOf(d)), [d]);
  const meta = useMemo(() => metaByEpisode(more?.episodes ?? []), [more]);
  const counts = useMemo(() => new Map(d.seasons.map((s) => [s.seasonNumber, s.episodes.length])), [d]);
  const { watched, total } = progressFromMarker(
    [...counts].map(([number, count]) => ({ number, count })),
    marker,
  );
  const next = more?.nextEpisode
    ? `T${more.nextEpisode.season} · E${more.nextEpisode.number ?? '?'} — ${more.nextEpisode.name}`
    : marker
      ? `parou em T${marker.season} · Ep ${marker.episode}`
      : null;
  const focusEpisodes = () => {
    const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
    episodes.current?.scrollIntoView({ behavior: calm ? 'auto' : 'smooth', block: 'start' });
    episodes.current?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.focus({ preventScroll: true });
  };
  const year = d.premiered?.slice(0, 4) ?? '—';
  const episodeTotal = d.seasons.reduce((n, s) => n + s.episodes.length, 0);

  return (
    <div>
      <BackLink href="#/library" label="Voltar" useHistory />
      <TitleHero
        title={d.title}
        posterUrl={d.posterUrl}
        meta={[
          'Série',
          year,
          d.voteAverage ? `⭐ ${d.voteAverage.toFixed(1)}` : null,
          d.status,
          pluralize(episodeTotal, 'episódio', 'episódios'),
        ]}
        chips={more?.genres.map((g) => <Badge key={g}>{g}</Badge>)}
        overview={d.overview}
        actions={
          <Button iconStart={<Icon name="play" size="sm" />} onClick={focusEpisodes}>
            Episódios
          </Button>
        }
      />
      <div className="detail-grid">
        <div>
          <EpisodeBrowser
            sectionRef={episodes}
            seriesTitle={d.title}
            seasons={d.seasons.map((s) => ({ number: s.seasonNumber, name: s.name, count: s.episodes.length }))}
            season={season}
            onSeasonChange={setSeason}
            // As notas por episódio chegam na segunda carga: a temporada aberta recarrega com elas.
            loadKey={more ? 'more' : ''}
            load={(n) =>
              Promise.resolve(
                (d.seasons.find((s) => s.seasonNumber === n)?.episodes ?? []).map((ep): EpisodeView => {
                  const m = meta.get(`${n}:${ep.episodeNumber}`);
                  return {
                    season: n,
                    number: ep.episodeNumber,
                    name: ep.name,
                    airDate: ep.airDate,
                    runtime: ep.runtime,
                    overview: ep.overview,
                    stillUrl: ep.stillUrl,
                    rating: m?.rating ?? null,
                    tag: episodeTypeTag(m),
                  };
                }),
              )
            }
            marker={marker}
            streams={(ep) =>
              more?.externals.imdb
                ? { imdbId: more.externals.imdb, mediaType: 'tv', season: ep.season, episode: ep.number }
                : {
                    unavailable: more
                      ? 'Sem id do IMDb para esta série: não dá para buscar streams.'
                      : 'Ainda carregando os dados da série; tente de novo em instantes.',
                  }
            }
            onMark={(ep) => markThrough(d.titleId, ep.season, ep.number, setMarker)}
            seasonNote={more ? seasonSummaryText(more, season) : ''}
            playPath={(ep) => playPath('tvmaze', id, ep.season, ep.number)}
          />
          {more && <Crew crew={more.crew} />}
          {more && <Gallery images={more.images} />}
        </div>
        <div>
          <ProgressCard watched={watched} total={total} next={next} />
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
                <RelinkButton titleId={d.titleId} current={{ source: 'tvmaze', sourceId: id }} initialQuery={d.title} />
              </div>
            )}
          </SideCard>
          {more && (
            <>
              <CastCard
                cast={more.cast}
                onPerson={(c) =>
                  openPersonModal({
                    id: c.person.id,
                    name: c.person.name,
                    imageUrl: c.person.imageUrl,
                    role: c.character?.name ?? null,
                    seriesTitle: d.title,
                    currentShowId: Number(id),
                  })
                }
              />
              <SeasonsCard
                rows={seasonRows(more, counts)}
                onJump={(n) => {
                  setSeason(n);
                  focusEpisodes();
                }}
              />
              <Agenda more={more} />
              <Channels more={more} />
              <Facts more={more} />
              <Akas more={more} />
            </>
          )}
          <SideCard title="Fonte" className="side-card--stack">
            {more && <ExternalLinks more={more} />}
            <LinkButton href={d.pageUrl ?? d.attribution.url} block>
              ver na TVmaze
            </LinkButton>
            {d.officialUrl && (
              <LinkButton href={d.officialUrl} block>
                site oficial da série
              </LinkButton>
            )}
            <p className="hint">
              Dados:{' '}
              <a href={d.attribution.url} target="_blank" rel="noopener noreferrer">
                TVmaze
              </a>
              , licença {d.attribution.license ?? 'CC BY-SA'}.
            </p>
          </SideCard>
        </div>
      </div>
    </div>
  );
}

/** Ficha de série da TVmaze: episódios completos, elenco, equipe, agenda e ficha técnica. */
export function TvmazeTitle({ id }: { id: string }) {
  const { data: d, error, retry, reload } = useLoad(() => getTvmazeTitle(id), id);
  if (error) return <TitleError onRetry={retry} />;
  if (!d) return <TitleSkeleton />;
  return <TvmazeDetail id={id} d={d} reload={reload} />;
}
