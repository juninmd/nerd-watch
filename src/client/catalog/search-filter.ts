import type { SearchResultDto } from '../api/index.ts';

export type SearchKind = 'all' | 'movie' | 'tv' | 'anime' | 'archive' | 'addon';

export const SEARCH_KINDS: ReadonlyArray<{ id: SearchKind; label: string }> = [
  { id: 'all', label: 'Tudo' },
  { id: 'movie', label: 'Filmes' },
  { id: 'tv', label: 'Séries' },
  { id: 'anime', label: 'Anime' },
  { id: 'archive', label: 'Domínio público' },
  { id: 'addon', label: 'Addons' },
];

type Kindable = Pick<SearchResultDto, 'source' | 'mediaType'>;

/** Fonte decide primeiro (anime e acervo são fontes), depois o tipo. Assim cada resultado cai em um só filtro. */
export const kindOf = (r: Kindable): Exclude<SearchKind, 'all' | 'addon'> => {
  if (r.source === 'archive') return 'archive';
  if (r.source === 'anilist') return 'anime';
  return r.mediaType === 'tv' ? 'tv' : 'movie';
};

/** Addons não são títulos de catálogo: `addon` esconde todos os títulos (os itens de addon são mostrados à parte). */
export const filterByKind = <T extends Kindable>(items: T[], kind: SearchKind): T[] => (kind === 'all' ? items : kind === 'addon' ? [] : items.filter((i) => kindOf(i) === kind));

export const countByKind = (items: Kindable[], addonCount = 0): Record<SearchKind, number> => {
  const counts: Record<SearchKind, number> = { all: items.length + addonCount, movie: 0, tv: 0, anime: 0, archive: 0, addon: addonCount };
  for (const i of items) counts[kindOf(i)]++;
  return counts;
};
