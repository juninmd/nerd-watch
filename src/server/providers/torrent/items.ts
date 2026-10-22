import { posix } from 'node:path';
import type { NewTelegramItem } from '../../repo/telegram.ts';
import type { TorrentFileInfo } from '../../torrent/engine.ts';
import { VIDEO_EXT, titleFromFilename } from '../sources/service.ts';

/** Teto de itens por torrent: um pacote com milhares de arquivos não vira um canal gigante. */
export const LIST_LIMIT = 500;
const CAPTION_MAX_CHARS = 200;
/** Amostra de vídeo: pasta `Sample/` ou `sample` como palavra separada no nome. */
const SAMPLE_WORD = /(^|[^a-z0-9])sample([^a-z0-9]|$)/i;
/** Ordem natural: "Ep 2" antes de "Ep 10". `pt-BR` só afeta acentos; `numeric` é o que importa. */
const NATURAL = new Intl.Collator('pt-BR', { numeric: true, sensitivity: 'base' });

/** Aceita só o que o `VIDEO_EXT` reconhece (o navegador pode não tocar todos; ver docs). */
export const isVideoFile = (name: string): boolean => VIDEO_EXT.test(name);

/** Normaliza separadores antes do `basename`: um nome com `\` não pode esconder a pasta real. */
const baseName = (path: string): string => posix.basename(path.replaceAll('\\', '/'));

export const isSampleFile = (path: string): boolean =>
  path
    .split(/[\\/]/)
    .slice(0, -1)
    .some((segment) => /^samples?$/i.test(segment)) || SAMPLE_WORD.test(baseName(path));

/** Vídeos do torrent, sem amostras, na ordem natural do caminho, até o teto. */
export const selectVideoFiles = (files: readonly TorrentFileInfo[]): TorrentFileInfo[] =>
  files
    .filter((file) => isVideoFile(file.path) && !isSampleFile(file.path))
    .sort((a, b) => NATURAL.compare(a.path, b.path))
    .slice(0, LIST_LIMIT);

/**
 * `messageId` é a posição na ordem natural (1 = primeiro episódio). A ordem depende só dos caminhos,
 * que o infohash fixa: sincronizar de novo dá os mesmos ids. `postedAt` é o momento da importação.
 */
export const toItems = (files: readonly TorrentFileInfo[], postedAt: string): NewTelegramItem[] =>
  selectVideoFiles(files).map((file, rank) => ({
    messageId: String(rank + 1),
    caption: titleFromFilename(baseName(file.path)).slice(0, CAPTION_MAX_CHARS),
    durationSeconds: null,
    thumbnailUrl: null,
    postedAt,
    fileRef: String(file.index),
  }));
