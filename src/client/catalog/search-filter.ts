import type { SearchResultDto } from '../api/index.ts';

export type SearchKind = 'all' | 'movie' | 'tv' | 'anime' | 'archive';

export const SEARCH_KINDS: ReadonlyArray<{ id: SearchKind; label: string }> = [
  { id: 'all', label: 'Tudo' },
  { id: 'movie', label: 'Filmes' },
  { id: 'tv', label: 'Séries' },
  { id: 'anime', label: 'Anime' },
  { id: 'archive', label: 'Domínio público' },
];

type Kindable = Pick<SearchResultDto, 'source' | 'mediaType'>;

/** Fonte decide primeiro (anime e acervo são fontes), depois o tipo. Assim cada resultado cai em um só filtro. */
export const kindOf = (r: Kindable): Exclude<SearchKind, 'all'> => {
  if (r.source === 'archive') return 'archive';
  if (r.source === 'anilist') return 'anime';
  return r.mediaType === 'tv' ? 'tv' : 'movie';
};

export const filterByKind = <T extends Kindable>(items: T[], kind: SearchKind): T[] => (kind === 'all' ? items : items.filter((i) => kindOf(i) === kind));

export const countByKind = (items: Kindable[]): Record<SearchKind, number> => {
  const counts: Record<SearchKind, number> = { all: items.length, movie: 0, tv: 0, anime: 0, archive: 0 };
  for (const i of items) counts[kindOf(i)]++;
  return counts;
};
