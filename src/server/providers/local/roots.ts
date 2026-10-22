import { statSync } from 'node:fs';
import { realpath } from 'node:fs/promises';
import path from 'node:path';
import { readSetting } from '../sources/settings.ts';

/** Lista de permissão: só pastas dentro destas raízes podem virar canal ou ser lidas. Vazio = fonte desligada. */
export const LOCAL_ENV = 'LOCAL_MEDIA_DIRS';

const HANDLE_PREFIX = 'local:';

/** Raízes como estão no `.env` (absolutas, normalizadas, sem as vazias). */
export const configuredRoots = (): string[] =>
  (readSetting(LOCAL_ENV) ?? '')
    .split(path.delimiter)
    .map((part) => part.trim())
    .filter((part) => part !== '' && path.isAbsolute(part))
    .map((part) => path.resolve(part));

/** Raízes com symlinks resolvidos. Uma raiz que não existe (mais) é ignorada, nunca vira permissão por engano. */
export const realRoots = async (): Promise<string[]> => {
  const out: string[] = [];
  for (const root of configuredRoots()) {
    const real = await realpath(root).catch(() => null);
    if (real) out.push(real);
  }
  return out;
};

const comparable = (p: string): string => (process.platform === 'win32' ? p.toLowerCase() : p);

/** `target` está em `root` (ou é a própria raiz)? `path.relative` sem `..` evita o falso positivo de `/media-x` em `/media`. */
export const isInside = (root: string, target: string): boolean => {
  const rel = path.relative(comparable(root), comparable(target));
  return rel === '' || (!path.isAbsolute(rel) && rel.split(path.sep)[0] !== '..');
};

export const insideAnyRoot = (roots: string[], target: string): boolean => roots.some((root) => isInside(root, target));

/** Mensagem de erro para o campo `LOCAL_MEDIA_DIRS` (lista separada por `path.delimiter`), ou null se estiver ok. */
export const validateLocalRoots = (value: string): string | null => {
  const parts = value
    .split(path.delimiter)
    .map((part) => part.trim())
    .filter((part) => part !== '');
  if (parts.length === 0) return 'informe pelo menos uma pasta';
  for (const part of parts) {
    if (!path.isAbsolute(part)) return 'cada pasta precisa ser um caminho absoluto';
    if (!statSync(part, { throwIfNoEntry: false })?.isDirectory()) return 'uma das pastas não existe ou não é um diretório';
  }
  return null;
};

/** Handle `local:<caminho real>` -> caminho, ou null se o handle não for desta fonte. */
export const folderOfHandle = (handle: string): string | null => {
  if (!handle.startsWith(HANDLE_PREFIX)) return null;
  const folder = handle.slice(HANDLE_PREFIX.length);
  return path.isAbsolute(folder) ? folder : null;
};

export const handleOf = (realFolder: string): string => `${HANDLE_PREFIX}${realFolder}`;
