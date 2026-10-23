import type { LibraryViewQuery, SavedViewSort } from '../server/saved-views/schema.ts';
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

type Sortable = { rating: number | null; title: { title: string } };

/** "recentes" é a ordem que o servidor já manda (atividade). Os demais ordenam uma cópia; empate fica na ordem original. */
export const sortLibraryItems = <T extends Sortable>(items: T[], sort: SavedViewSort): T[] => {
  if (sort === 'recent') return [...items];
  if (sort === 'title') return [...items].sort((a, b) => a.title.title.localeCompare(b.title.title, 'pt-BR', { sensitivity: 'base' }));
  // Sem nota vira -1: fica depois de qualquer nota, inclusive 0.
  return [...items].sort((a, b) => (b.rating ?? -1) - (a.rating ?? -1));
};

/** Aplica uma visão inteira (origem, status, ordem). O layout é da tela, não do filtro. */
export const applyLibraryQuery = <T extends Filterable & Sortable>(items: T[], query: Pick<LibraryViewQuery, 'status' | 'source' | 'sort'>): T[] =>
  sortLibraryItems(filterByStatus(filterBySource(items, query.source), query.status), query.sort);

export const countByStatus = (items: Array<Pick<LibraryItemDto, 'watchStatus'>>): Record<StatusFilter, number> => {
  const counts: Record<StatusFilter, number> = { all: items.length, want: 0, watching: 0, watched: 0, dropped: 0 };
  for (const item of items) counts[item.watchStatus]++;
  return counts;
};
