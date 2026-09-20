import type { TitleSource, MediaType } from '../server/types.ts';

/** Rota canônica de detalhe: `#/title/<source>/<mediaType>/<id>` (archive usa `_` no lugar do mediaType). */
export const titlePath = (source: TitleSource, mediaType: MediaType | '_', id: string): string =>
  `/title/${source}/${mediaType}/${encodeURIComponent(id)}`;
