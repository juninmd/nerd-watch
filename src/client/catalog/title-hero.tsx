import { Artwork, Hero } from '@juninmd/sonido';
import type { ReactNode } from 'react';

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

/** Hero das fichas: o Hero recolhível do Sonido, grudado logo abaixo da barra superior (também sticky). */
const topbarHeight = (): number => document.querySelector<HTMLElement>('.topbar')?.offsetHeight ?? 0;

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
  return (
    <Hero
      className="title-hero"
      collapsible
      stickyOffset={topbarHeight}
      title={title}
      backdrop={backdropUrl ?? posterUrl ?? undefined}
      poster={<Artwork title={title} src={posterUrl ?? undefined} ratio="poster" />}
      meta={meta.filter(Boolean).map((m, i) => (
        <span key={i}>{m}</span>
      ))}
      actions={actions}
    >
      {subtitle && <p className="view-subtitle hero-subtitle">{subtitle}</p>}
      {chips && <div className="tvm-chips">{chips}</div>}
      <p className="hero-overview">{overview || 'Sem sinopse disponível.'}</p>
      {note}
    </Hero>
  );
}
