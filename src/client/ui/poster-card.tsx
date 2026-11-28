/** Cartão de título (pôster + nome + meta) com os componentes do Sonido. Substitui `renderCard`. */
import { Artwork, Badge, type BadgeTone, Card, Stamp } from '@juninmd/sonido';
import type { KeyboardEvent } from 'react';
import type { WatchStatus } from '../../server/types.ts';
import { type PosterFlag, scoreLabel } from './poster-badges.ts';

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
  /** Nota 0–10 do catálogo, mostrada no canto de baixo do pôster. */
  score?: number | null;
  /** Selo de ação ("novos ep.", "continuar"); toma o lugar do selo de status. */
  flag?: PosterFlag | null;
  /** Modo seleção: o clique alterna a marca em vez de abrir o item. */
  selection?: { selected: boolean; onToggle: () => void };
  onClick: () => void;
}

export function PosterCard({ title, posterUrl, meta, status, isPublicDomain, score, flag, selection, onClick }: PosterCardProps) {
  const activate = selection ? selection.onToggle : onClick;
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' || (e.key === ' ' && selection)) {
      e.preventDefault();
      activate();
    }
  };
  const scoreText = scoreLabel(score);
  const watched = status === 'watched';
  const badge = flag ? (
    <Badge tone={flag.kind === 'new' ? 'warning' : 'aqua'} appearance="solid">
      {flag.label}
    </Badge>
  ) : status && !watched ? (
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
      aria-label={[title, meta, flag?.label, watched ? STATUS_LABEL.watched : null].filter(Boolean).join(' — ')}
      onClick={activate}
      onKeyDown={onKeyDown}
    >
      <div className={`poster-card__art${watched ? ' is-watched' : ''}`}>
        <Artwork title={title} src={posterUrl ?? undefined} ratio="poster" badge={badge} />
        {watched && (
          <span className="poster-card__stamp" aria-hidden="true">
            <Stamp tone="true">assistido</Stamp>
          </span>
        )}
        {scoreText && (
          <span className="poster-card__score" aria-label={`nota ${scoreText}`}>
            ★ {scoreText}
          </span>
        )}
      </div>
      <div className="poster-card__meta">
        <div className="poster-card__title">{title}</div>
        {meta && <div className="poster-card__sub">{meta}</div>}
      </div>
    </Card>
  );
}
