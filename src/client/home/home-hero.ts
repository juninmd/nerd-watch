import type { LibraryItemDto } from '../api/index.ts';

/** Texto do destaque "Continuar": série com episódio atual mostra "T2 · Ep 7"; sem episódio, o tipo. Sem DOM. */
export const heroMeta = (item: LibraryItemDto): string => {
  const { currentSeason: season, currentEpisode: episode } = item;
  if (season && episode) return `Continuar · T${season} · Ep ${episode}`;
  return item.title.mediaType === 'tv' ? 'Continuar · Série' : 'Continuar · Filme';
};

/** Quantos títulos o destaque gira (stream-goat usa os primeiros do 1º catálogo). */
export const HERO_MAX = 5;
/** Tempo de cada slide do destaque, em ms. */
export const HERO_INTERVAL_MS = 9000;

export interface HeroSlide {
  item: LibraryItemDto;
  meta: string;
  /** Linha de destaque ("3 ep. novos", "Nº 1 em andamento"). */
  kicker: string;
}

/**
 * Slides do destaque: quem tem episódio novo vem antes (é a novidade), depois a ordem de atividade (o que a pessoa
 * largou por último). O primeiro continua sendo o "Continuar" de antes quando nada é novo.
 */
export const heroSlides = (watching: LibraryItemDto[], newEpisodes: ReadonlyMap<string, number> = new Map()): HeroSlide[] => {
  const ranked = watching.map((item, rank) => ({ item, rank, fresh: newEpisodes.get(item.titleId) ?? 0 }));
  ranked.sort((a, b) => Number(b.fresh > 0) - Number(a.fresh > 0) || a.rank - b.rank);
  return ranked.slice(0, HERO_MAX).map(({ item, rank, fresh }) => ({
    item,
    meta: heroMeta(item),
    kicker: fresh > 0 ? (fresh === 1 ? '1 episódio novo' : `${fresh} episódios novos`) : `Nº ${rank + 1} em andamento`,
  }));
};

/** Próximo slide com volta ao início; lista vazia fica em 0. */
export const nextSlide = (index: number, count: number, dir: 1 | -1 = 1): number => (count ? (index + dir + count) % count : 0);
