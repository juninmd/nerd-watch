import { Artwork, Badge, Button, Dialog, EmptyState } from '@juninmd/sonido';
import { useEffect, useRef, useState } from 'react';
import type { CalendarInfoDto } from '../api/index.ts';
import { TrailerFrame } from '../player/trailer-embed.tsx';
import { Icon } from '../ui/icon.tsx';
import { openOverlay } from '../ui/overlay.tsx';
import { CalendarBadges, ExtLink } from './calendar-card.tsx';
import { type AgendaEntry, dayLabel, episodeLine } from './calendar-model.ts';

function Providers({ info }: { info: CalendarInfoDto }) {
  return (
    <div className="cal-prov">
      <h3>Onde assistir</h3>
      {info.providers.length ? (
        <div className="cal-prov-list">
          {info.providers.map((p) =>
            p.url ? (
              <ExtLink key={p.name} href={p.url}>
                {p.name}
              </ExtLink>
            ) : (
              <Badge key={p.name}>{p.name}</Badge>
            ),
          )}
        </div>
      ) : (
        <p className="cal-dim">
          {info.where === 'cinema' ? 'Em exibição nos cinemas.' : 'Ainda sem serviço confirmado para a sua região.'}
        </p>
      )}
    </div>
  );
}

/** Trailer: o iframe só carrega ao clicar; depois do clique o foco vai para ele. */
function Trailer({ info }: { info: CalendarInfoDto }) {
  const [playing, setPlaying] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (playing) ref.current?.querySelector<HTMLElement>('#trailer')?.focus();
  }, [playing]);
  if (!info.trailerKey) return <ExtLink href={info.trailerSearchUrl}>Buscar trailer no YouTube</ExtLink>;
  return (
    <div ref={ref}>
      {playing ? (
        <TrailerFrame trailerKey={info.trailerKey} />
      ) : (
        <Button variant="primary" iconStart={<Icon name="play" />} onClick={() => setPlaying(true)}>
          Assistir trailer
        </Button>
      )}
    </div>
  );
}

function CalendarDetail({
  entry,
  info,
  onClose,
  onOpenTitle,
}: {
  entry: AgendaEntry;
  info: CalendarInfoDto | null;
  onClose: () => void;
  onOpenTitle: () => void;
}) {
  return (
    <Dialog
      open
      onClose={onClose}
      title={entry.titleName}
      description={`${episodeLine(entry)} · ${dayLabel(entry.date)}`}
      footer={
        <Button
          variant="secondary"
          onClick={() => {
            onClose();
            onOpenTitle();
          }}
        >
          Abrir no nerd-watch
        </Button>
      }
    >
      {info ? (
        <div className="cal-dlg-body">
          {info.backdropUrl && <Artwork title={entry.titleName} src={info.backdropUrl} ratio="wide" />}
          <CalendarBadges entry={entry} info={info}>
            {info.genres.slice(0, 4).map((g) => (
              <Badge key={g}>{g}</Badge>
            ))}
          </CalendarBadges>
          <p className="cal-syn full">{info.synopsis || 'Sem sinopse disponível.'}</p>
          <Providers info={info} />
          <Trailer info={info} />
          <div className="cal-dlg-links">
            {info.pageUrl && <ExtLink href={info.pageUrl}>Página do título</ExtLink>}
            {info.officialUrl && <ExtLink href={info.officialUrl}>Site oficial</ExtLink>}
          </div>
        </div>
      ) : (
        <EmptyState title="não foi possível carregar os detalhes agora" />
      )}
    </Dialog>
  );
}

let closeOpen: (() => void) | null = null;

/** Detalhe do item: capa larga, sinopse, onde assistir, links e trailer. Abrir outro fecha o anterior. */
export const openCalendarDetail = (entry: AgendaEntry, info: CalendarInfoDto | null, onOpenTitle: () => void): void => {
  closeOpen?.();
  const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const close = openOverlay((done) => (
    <CalendarDetail
      entry={entry}
      info={info}
      onOpenTitle={onOpenTitle}
      onClose={() => {
        done();
        if (closeOpen === close) closeOpen = null;
        if (opener?.isConnected) opener.focus();
      }}
    />
  ));
  closeOpen = close;
};
