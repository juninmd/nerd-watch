/** Cartão de título (pôster + nome + meta) com os componentes do Sonido. Substitui `renderCard`. */
import { Artwork, Badge, type BadgeTone, Card } from '@juninmd/sonido';
import type { KeyboardEvent } from 'react';
import type { WatchStatus } from '../../server/types.ts';

export const STATUS_LABEL: Record<WatchStatus, string> = {
  want: 'quero ver',
  watching: 'assistindo',
  watched: 'assistido',
  dropped: 'abandonado',
};

const STATUS_TONE: Record<WatchStatus, BadgeTone> = { want: 'violet', watching: 'accent', watched: 'success', dropped: 'neutral' };

export interface PosterCardProps {
  title: string;
  posterUrl: string | null;
  meta?: string;
  status?: WatchStatus;
  isPublicDomain?: boolean;
  /** Modo seleção: o clique alterna a marca em vez de abrir o item. */
  selection?: { selected: boolean; onToggle: () => void };
  onClick: () => void;
}

export function PosterCard({ title, posterUrl, meta, status, isPublicDomain, selection, onClick }: PosterCardProps) {
  const activate = selection ? selection.onToggle : onClick;
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' || (e.key === ' ' && selection)) {
      e.preventDefault();
      activate();
    }
  };
  const badge = status ? (
    <Badge tone={STATUS_TONE[status]} appearance="solid">
      {STATUS_LABEL[status]}
    </Badge>
  ) : isPublicDomain ? (
    <Badge tone="gold" appearance="solid">
      domínio público
    </Badge>
  ) : undefined;
  return (
    <Card
      className={`poster-card${selection?.selected ? ' is-selected' : ''}`}
      interactive
      tilt={!selection}
      padding="none"
      tabIndex={0}
      role={selection ? 'checkbox' : 'link'}
      aria-checked={selection ? selection.selected : undefined}
      aria-label={meta ? `${title} — ${meta}` : title}
      onClick={activate}
      onKeyDown={onKeyDown}
    >
      <Artwork title={title} src={posterUrl ?? undefined} ratio="poster" badge={badge} />
      <div className="poster-card__meta">
        <div className="poster-card__title">{title}</div>
        {meta && <div className="poster-card__sub">{meta}</div>}
      </div>
    </Card>
  );
}
