import type { LibraryItemDto } from '../api/index.ts';

/** Texto do destaque "Continuar": série com episódio atual mostra "T2 · Ep 7"; sem episódio, o tipo. Sem DOM. */
export const heroMeta = (item: LibraryItemDto): string => {
  const { currentSeason: season, currentEpisode: episode } = item;
  if (season && episode) return `Continuar · T${season} · Ep ${episode}`;
  return item.title.mediaType === 'tv' ? 'Continuar · Série' : 'Continuar · Filme';
};

/** Primeiro título "assistindo" vira o destaque da tela inicial (o que a pessoa largou por último). */
export const pickHero = (watching: LibraryItemDto[]): LibraryItemDto | null => watching[0] ?? null;
