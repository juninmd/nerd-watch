import { Button } from '@juninmd/sonido';
import { useRef } from 'react';
import { type AnilistDetailDto, getAnilistTitle } from '../api/index.ts';
import { StatusActions } from '../library/status-actions.tsx';
import { TrailerFrame } from '../player/trailer-embed.tsx';
import { BackLink } from '../ui/back.tsx';
import { pluralize } from '../ui/pluralize.ts';
import { LinkButton, SideCard } from './side-card.tsx';
import { TitleError, TitleSkeleton } from './title-error.tsx';
import { jumpTo, TitleHero } from './title-hero.tsx';
import { useLoad } from './use-load.ts';

const FORMAT_LABEL: Record<string, string> = {
  TV: 'Série',
  TV_SHORT: 'Série curta',
  MOVIE: 'Filme',
  OVA: 'OVA',
  ONA: 'ONA',
  SPECIAL: 'Especial',
  MUSIC: 'Música',
};

const STATUS_LABEL: Record<string, string> = {
  FINISHED: 'concluído',
  RELEASING: 'em exibição',
  NOT_YET_RELEASED: 'ainda não estreou',
  CANCELLED: 'cancelado',
  HIATUS: 'em hiato',
};

const dateLabel = (iso: string): string =>
  new Date(`${iso}T00:00:00`).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });

function NextEpisode({ d }: { d: AnilistDetailDto }) {
  if (!d.nextEpisode) return null;
  return (
    <p className="hint hero-note">
      Próximo episódio: <strong>{d.nextEpisode.episode}</strong> em {dateLabel(d.nextEpisode.airDate)} (horário local)
    </p>
  );
}

/** Ficha de anime do AniList. */
export function AnilistTitle({ id }: { id: string }) {
  const { data: d, error, retry, reload } = useLoad(() => getAnilistTitle(id), id);
  const root = useRef<HTMLDivElement>(null);
  if (error) return <TitleError onRetry={retry} />;
  if (!d) return <TitleSkeleton />;
  const format = d.format ? (FORMAT_LABEL[d.format] ?? d.format) : d.mediaType === 'movie' ? 'Filme' : 'Anime';
  const status = d.status ? (STATUS_LABEL[d.status] ?? d.status.toLowerCase()) : null;
  return (
    <div ref={root}>
      <BackLink href="#/library" label="Voltar" useHistory />
      <TitleHero
        title={d.title}
        posterUrl={d.posterUrl}
        subtitle={d.romaji && d.romaji !== d.title ? d.romaji : null}
        meta={[
          format,
          d.year,
          d.voteAverage ? `⭐ ${d.voteAverage.toFixed(1)}` : null,
          status,
          d.episodes ? pluralize(d.episodes, 'episódio', 'episódios') : null,
        ]}
        overview={d.overview}
        note={<NextEpisode d={d} />}
        actions={
          d.trailerKey ? (
            <Button variant="ghost" onClick={() => jumpTo(root.current?.querySelector<HTMLElement>('#trailer'))}>
              Trailer
            </Button>
          ) : undefined
        }
      />
      <div className="detail-grid">
        <div>
          <TrailerFrame trailerKey={d.trailerKey} />
          <p className="view-subtitle">
            Anime com dados do AniList. O AniList informa só o próximo episódio; a lista de episódios não está
            disponível aqui.
          </p>
        </div>
        <div>
          <SideCard title="Sua lista">
            <StatusActions
              titleId={d.titleId}
              entryId={d.library?.id ?? null}
              watchStatus={d.library?.watch_status ?? null}
              rating={d.library?.rating ?? null}
              rewatchCount={d.library?.rewatch_count ?? 0}
              onChange={reload}
            />
          </SideCard>
          <SideCard title="Fonte">
            <LinkButton href={d.pageUrl ?? d.attribution.url} block>
              ver no AniList
            </LinkButton>
          </SideCard>
        </div>
      </div>
    </div>
  );
}
