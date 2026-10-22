import { stat, realpath } from 'node:fs/promises';
import path from 'node:path';
import { isSafeRelativePath } from '../sources/paths.ts';
import { VIDEO_EXT } from '../sources/service.ts';
import { SourceError } from '../sources/types.ts';
import { folderOfHandle, insideAnyRoot, realRoots } from './roots.ts';

const NOT_FOUND = 'vídeo não encontrado nessa pasta';

/** Nome relativo com `/`, sem `..`, sem `:` (drive no Windows) e sem barra invertida. */
const isSafeLocalRelative = (rel: string): boolean => isSafeRelativePath(rel) && !rel.includes(':');

/**
 * Pasta do canal resolvida agora: ainda existe e continua dentro de uma raiz. Revalida a cada uso porque a raiz pode
 * ter mudado no `.env` ou um symlink pode ter sido trocado depois do cadastro.
 */
export const realFolder = async (handle: string): Promise<string> => {
  const folder = folderOfHandle(handle);
  if (!folder) throw new SourceError('canal local inválido', 404);
  const real = await realpath(folder).catch(() => null);
  if (!real || !insideAnyRoot(await realRoots(), real)) throw new SourceError('pasta não encontrada (confira LOCAL_MEDIA_DIRS)', 404);
  return real;
};

/** Arquivo de vídeo do canal, já com o realpath dentro de uma raiz. Qualquer falha vira o mesmo 404 (não revela o disco). */
export const locateVideo = async (handle: string, fileRef: string): Promise<string> => {
  const folder = await realFolder(handle).catch(() => null);
  if (!folder || !isSafeLocalRelative(fileRef) || !VIDEO_EXT.test(fileRef)) throw new SourceError(NOT_FOUND, 404);
  const file = await realpath(path.join(folder, ...fileRef.split('/'))).catch(() => null);
  if (!file || !insideAnyRoot(await realRoots(), file)) throw new SourceError(NOT_FOUND, 404);
  const info = await stat(file).catch(() => null);
  if (!info?.isFile()) throw new SourceError(NOT_FOUND, 404);
  return file;
};

export { isSafeLocalRelative };
