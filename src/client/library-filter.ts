import type { WatchStatus } from '../server/types.ts';
import type { LibraryItemDto } from './api.ts';

export type StatusFilter = WatchStatus | 'all';
export type SourceFilter = LibraryItemDto['title']['source'] | 'all';

type Filterable = Pick<LibraryItemDto, 'watchStatus'> & { title: Pick<LibraryItemDto['title'], 'source'> };

/** Origem primeiro, status depois: as contagens das abas descrevem só o que a origem escolhida mostra. */
export const filterBySource = <T extends Filterable>(items: T[], source: SourceFilter): T[] =>
  source === 'all' ? items : items.filter((i) => i.title.source === source);

export const filterByStatus = <T extends Filterable>(items: T[], status: StatusFilter): T[] =>
  status === 'all' ? items : items.filter((i) => i.watchStatus === status);

export const countByStatus = (items: Array<Pick<LibraryItemDto, 'watchStatus'>>): Record<StatusFilter, number> => {
  const counts: Record<StatusFilter, number> = { all: items.length, want: 0, watching: 0, watched: 0, dropped: 0 };
  for (const item of items) counts[item.watchStatus]++;
  return counts;
};
