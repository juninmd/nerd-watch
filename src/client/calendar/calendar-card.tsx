import { Artwork, Badge, Button, Hero } from '@juninmd/sonido';
import { type ReactNode, useEffect, useRef } from 'react';
import type { CalendarInfoDto } from '../api/index.ts';
import { releaseIn } from '../home/home-status.ts';
import { Icon } from '../ui/icon.tsx';
import { localIsoDate } from '../ui/time-format.ts';
import { loadInfo } from './calendar-info.ts';
import {
  type AgendaEntry,
  dayLabel,
  episodeLine,
  ORIGIN_LABEL,
  ORIGIN_TONE,
  originOf,
  ratingText,
  WHERE_TONE,
  whereLabel,
} from './calendar-model.ts';

/** Link externo: sempre em nova aba e sem `opener`/referrer (a URL vem de fonte de terceiros). */
export function ExtLink({
  href,
  children,
  className = 'cal-link',
}: {
  href: string;
  children: string;
  className?: string;
}) {
  return (
    <a className={className} href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  );
}

/** Pílulas de origem, onde assistir e nota; `children` entra no fim (contagem regressiva, gêneros). */
export function CalendarBadges({
  entry,
  info,
  children,
}: {
  entry: AgendaEntry;
  info: CalendarInfoDto | null;
  children?: ReactNode;
}) {
  const origin = originOf(entry, info);
  const where = whereLabel(info);
  return (
    <div className="cal-badges">
      <Badge tone={ORIGIN_TONE[origin]} appearance="solid">
        {ORIGIN_LABEL[origin]}
      </Badge>
      {info && where && (
        <Badge tone={WHERE_TONE[info.where]} appearance="solid">
          {where}
        </Badge>
      )}
      {info?.rating ? (
        <Badge tone="gold" title="Nota">
          ★ {ratingText(info.rating)}
        </Badge>
      ) : null}
      {children}
    </div>
  );
}

export interface CalendarCardProps {
  entry: AgendaEntry;
  /** Nulo = ficha ainda não carregada: o cartão mostra o que já sabe e pede a ficha ao entrar na tela. */
  info: CalendarInfoDto | null;
  onInfo: (entry: AgendaEntry, info: CalendarInfoDto) => void;
  onOpen: (entry: AgendaEntry) => void;
}

/** Cartão rico da Agenda. O cartão não vira botão (há links dentro); o teclado entra pelo botão do título. */
export function CalendarCard({ entry, info, onInfo, onOpen }: CalendarCardProps) {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (info || !el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(
      (hits) => {
        if (!hits.some((h) => h.isIntersecting)) return;
        io.disconnect();
        void loadInfo(entry).then((loaded) => loaded && onInfo(entry, loaded));
      },
      { rootMargin: '200px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [info, entry, onInfo]);

  // "hoje", "amanhã" ou "em N dias"; some depois da data, para não poluir o que já saiu.
  const when = releaseIn(entry.date, localIsoDate(new Date()));
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: atalho de mouse; o teclado usa o botão do título
    <article
      ref={ref}
      className="cal-card"
      onClick={(ev) => {
        if (!(ev.target as HTMLElement).closest('a, button')) onOpen(entry);
      }}
    >
      <div className="cal-poster">
        <Artwork title={entry.titleName} src={entry.posterUrl ?? undefined} ratio="poster" />
      </div>
      <div className="cal-body">
        <CalendarBadges entry={entry} info={info}>
          {when && <Badge tone="accent">{when}</Badge>}
        </CalendarBadges>
        <h3 className="cal-title">
          <Button variant="link" aria-label={`${entry.titleName}: ver detalhes`} onClick={() => onOpen(entry)}>
            {entry.titleName}
          </Button>
        </h3>
        <div className="cal-ep">{episodeLine(entry)}</div>
        {info && info.genres.length > 0 && <div className="cal-genres">{info.genres.slice(0, 3).join(' · ')}</div>}
        {info?.synopsis && <p className="cal-syn">{info.synopsis}</p>}
        <div className="cal-actions">
          {info?.trailerKey ? (
            <Button variant="ghost" size="sm" iconStart={<Icon name="play" size="sm" />} onClick={() => onOpen(entry)}>
              Trailer
            </Button>
          ) : info ? (
            <ExtLink href={info.trailerSearchUrl}>Buscar trailer</ExtLink>
          ) : null}
          {info?.pageUrl && <ExtLink href={info.pageUrl}>Página</ExtLink>}
        </div>
      </div>
    </article>
  );
}

/** Destaque: o primeiro item da lista com capa larga. */
export function CalendarSpotlight({
  entry,
  info,
  onOpen,
}: {
  entry: AgendaEntry;
  info: CalendarInfoDto;
  onOpen: () => void;
}) {
  const where = whereLabel(info);
  return (
    <section className="cal-spot" aria-label="Em destaque">
      <Hero
        title={entry.titleName}
        backdrop={info.backdropUrl ?? undefined}
        meta={
          <>
            <Badge tone={ORIGIN_TONE[info.origin]} appearance="solid">
              {ORIGIN_LABEL[info.origin]}
            </Badge>{' '}
            {episodeLine(entry)} · {dayLabel(entry.date, false)}
            {where ? ` · ${where}` : ''}
            {info.synopsis && <p className="cal-syn">{info.synopsis}</p>}
          </>
        }
        actions={
          <Button variant="primary" size="sm" onClick={onOpen}>
            Ver detalhes
          </Button>
        }
      />
    </section>
  );
}
