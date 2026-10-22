import type { TitleSource, MediaType } from '../server/types.ts';

/** Rota canônica de detalhe: `#/title/<source>/<mediaType>/<id>` (archive usa `_` no lugar do mediaType). */
export const titlePath = (source: TitleSource, mediaType: MediaType | '_', id: string): string =>
  `/title/${source}/${mediaType}/${encodeURIComponent(id)}`;

/** Canais do Telegram têm página própria (`#/telegram/<titleId>`); o resto usa a rota canônica de título. */
export const libraryItemPath = (item: { titleId: string; title: { source: TitleSource; mediaType: MediaType; sourceId: string } }): string =>
  item.title.source === 'telegram' ? `/telegram/${item.titleId}` : titlePath(item.title.source, item.title.mediaType, item.title.sourceId);
