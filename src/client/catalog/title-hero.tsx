import { Artwork } from '@juninmd/sonido';
import { type ReactNode, useRef } from 'react';
import { posterCssUrl } from '../ui/poster-css.ts';
import { useCollapsingHero } from '../ui/use-collapsing-hero.ts';

export interface TitleHeroProps {
  title: string;
  posterUrl: string | null;
  /** Fundo próprio (TMDB); sem ele, o pôster desfocado faz o fundo. */
  backdropUrl?: string | null;
  subtitle?: string | null;
  /** Itens da linha de metadados (tipo, ano, nota…); vazios são omitidos. */
  meta: ReactNode[];
  chips?: ReactNode;
  overview: string | null;
  /** Linha extra sob a sinopse (ex.: próximo episódio do AniList). */
  note?: ReactNode;
  actions?: ReactNode;
}

/** Leva a seção alvo ao centro da tela e põe o foco nela; respeita "reduzir movimento". */
export const jumpTo = (target: HTMLElement | null | undefined): void => {
  const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
  target?.scrollIntoView({ behavior: calm ? 'auto' : 'smooth', block: 'center' });
  target?.focus({ preventScroll: true });
};

/**
 * Hero das fichas: grudento e encolhendo ao rolar (`useCollapsingHero`). O Hero do Sonido não expõe `ref`
 * nem pôster/sinopse, então o layout fica aqui; o pôster usa o Artwork do Sonido.
 */
export function TitleHero({
  title,
  posterUrl,
  backdropUrl,
  subtitle,
  meta,
  chips,
  overview,
  note,
  actions,
}: TitleHeroProps) {
  const ref = useRef<HTMLDivElement>(null);
  useCollapsingHero(ref);
  const bg = backdropUrl ?? posterUrl;
  // Via CSSOM + posterCssUrl: escapa aspas/barras e a URL nunca é parseada como marcação.
  const backdropClass = `backdrop${backdropUrl ? '' : bg ? ' backdrop-blur' : ' placeholder'}`;
  return (
    <div className="hero" ref={ref}>
      <div className={backdropClass} style={bg ? { backgroundImage: posterCssUrl(bg) } : undefined} />
      <div className="scrim" />
      <div className="hero-content">
        <div className="hero-poster">
          <Artwork title={title} src={posterUrl ?? undefined} ratio="poster" />
        </div>
        <div className="hero-info">
          <h1>{title}</h1>
          {subtitle && <p className="view-subtitle hero-subtitle">{subtitle}</p>}
          <div className="hero-meta">
            {meta.filter(Boolean).map((m, i) => (
              <span key={i}>{m}</span>
            ))}
          </div>
          {chips && <div className="tvm-chips">{chips}</div>}
          <p className="hero-overview">{overview || 'Sem sinopse disponível.'}</p>
          {note}
          {actions && <div className="hero-actions">{actions}</div>}
        </div>
      </div>
    </div>
  );
}
