import type { TelegramItemRow } from './types.ts';

export interface TelegramItemMediaDto {
  width: number | null;
  height: number | null;
  supportsStreaming: boolean | null;
  fileName: string | null;
}

/** Atributos do vídeo no MTProto, na forma que a API expõe (booleano, não 0/1). Ausentes ficam nulos. */
export const itemMediaDto = (row: Pick<TelegramItemRow, 'width' | 'height' | 'supports_streaming' | 'file_name'>): TelegramItemMediaDto => ({
  width: row.width ?? null,
  height: row.height ?? null,
  supportsStreaming: row.supports_streaming === null || row.supports_streaming === undefined ? null : row.supports_streaming === 1,
  fileName: row.file_name ?? null,
});
