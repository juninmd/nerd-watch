import type { LibraryViewQuery } from '../../server/saved-views/schema.ts';
import type { LibraryItemDto } from '../api/index.ts';
import type { SavedViewDto } from '../api/saved-views.ts';
import { applyLibraryQuery } from '../library/library-filter.ts';

/**
 * Listas inteligentes: cada visão salva da biblioteca vira uma lista que se atualiza sozinha, porque o filtro é
 * reavaliado sobre a biblioteca atual. Sem tabela nova: criar, renomear e apagar continuam na barra de visões.
 */

const STATUS_TEXT: Record<LibraryViewQuery['status'], string> = {
  all: 'Qualquer status',
  want: 'Quero ver',
  watching: 'Assistindo',
  watched: 'Assistidos',
  dropped: 'Abandonados',
};

const SOURCE_TEXT: Record<LibraryViewQuery['source'], string> = {
  all: '',
  tmdb: 'TMDB',
  archive: 'Domínio público',
  tvmaze: 'TVmaze',
  anilist: 'AniList',
  telegram: 'Telegram',
};

const SORT_TEXT: Record<LibraryViewQuery['sort'], string> = { recent: 'mais recentes', title: 'por nome', rating: 'melhor nota' };

/** "Assistindo · TMDB · melhor nota": a regra em palavras, para a pessoa saber o que a lista pega. */
export const describeQuery = (q: LibraryViewQuery): string => [STATUS_TEXT[q.status], SOURCE_TEXT[q.source], SORT_TEXT[q.sort]].filter(Boolean).join(' · ');

export interface SmartList {
  id: string;
  name: string;
  rule: string;
  count: number;
  covers: Array<string | null>;
}

export const smartLists = (views: SavedViewDto[], items: LibraryItemDto[]): SmartList[] =>
  views.map((v) => {
    const matched = applyLibraryQuery(items, v.query);
    return { id: v.id, name: v.name, rule: describeQuery(v.query), count: matched.length, covers: matched.slice(0, 4).map((i) => i.title.posterUrl) };
  });
