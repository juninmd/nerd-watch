import type { TelegramItemDto } from '../api/index.ts';
import { Artwork, Badge, Card, Skeleton } from '@juninmd/sonido';
import type { KeyboardEvent } from 'react';
import { Icon } from '../ui/icon.tsx';
import { formatDuration } from '../ui/time-format.ts';
import { itemDescription, itemTitle, videoFacts } from './telegram-items.ts';

interface VideoCardProps {
  item: TelegramItemDto;
  resumeAt: number | null;
  watched: boolean;
  /** Modo lista: miniatura à esquerda e descrição por extenso. */
  row: boolean;
  onPlay: () => void;
}

/** Card de vídeo do canal (grade e lista): miniatura com selos + título, descrição, nome do arquivo e data de upload. */
export function VideoCard({ item, resumeAt, watched, row, onPlay }: VideoCardProps) {
  const title = itemTitle(item);
  const description = itemDescription(item);
  const facts = videoFacts(item);
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onPlay();
    }
  };
  const badges = (
    <>
      {item.durationSeconds ? <Badge appearance="solid">{formatDuration(item.durationSeconds)}</Badge> : null}
      {resumeAt !== null && (
        <Badge tone="accent" appearance="solid">
          continuar {formatDuration(resumeAt)}
        </Badge>
      )}
      {watched && (
        <Badge tone="success" appearance="solid">
          assistido
        </Badge>
      )}
    </>
  );
  return (
    <Card
      className={`tg-card${row ? ' tg-card--row' : ''}`}
      interactive
      padding="none"
      tabIndex={0}
      role="button"
      aria-label={`reproduzir: ${title}${resumeAt !== null ? ` (continuar de ${formatDuration(resumeAt)})` : ''}`}
      onClick={onPlay}
      onKeyDown={onKeyDown}
    >
      <Artwork title={title} src={item.thumbnailUrl ?? undefined} ratio="wide" badge={badges} />
      <div className="tg-card-meta">
        <div className="tg-card-title">{title}</div>
        {description && <p className="tg-card-desc">{description}</p>}
        {facts.length > 0 && (
          <dl className="tg-facts">
            {facts.map((f) =>
              f.kind === 'file' ? (
                <div key="file" className="tg-fact tg-file" title={f.label}>
                  <Icon name="film" size="sm" />
                  <dt className="sr-only">Arquivo</dt>
                  <dd>{f.label}</dd>
                </div>
              ) : (
                <div key="posted" className="tg-fact">
                  <Icon name="calendar" size="sm" />
                  <dt className="sr-only">Enviado em</dt>
                  <dd>
                    <time dateTime={f.iso}>{f.label}</time>
                  </dd>
                </div>
              ),
            )}
          </dl>
        )}
      </div>
    </Card>
  );
}

/** Esqueleto do canal enquanto carrega. */
export function ChannelSkeleton() {
  return <Skeleton className="tg-skel" label="carregando vídeos" rows={8} media />;
}
