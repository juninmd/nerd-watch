import type { Dirent } from 'node:fs';
import { readFile, readdir, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import type { NewTelegramItem } from '../../repo/telegram.ts';
import { VIDEO_EXT, syntheticMessageId, titleFromFilename } from '../sources/service.ts';
import { insideAnyRoot, realRoots } from './roots.ts';
import { isSafeLocalRelative, locateVideo } from './access.ts';

/** Profundidade 1 = filhos diretos da pasta do canal; a recursão para ao chegar em 3. */
const MAX_DEPTH = 3;
const MAX_ITEMS = 500;
/** Teto de entradas lidas no disco: uma árvore gigante não prende a requisição. */
const MAX_ENTRIES = 20_000;
const SIDECAR_MAX_BYTES = 2 * 1024 * 1024;
const SIDECAR_NAMES = ['poster.jpg', 'poster.png', 'folder.jpg', 'folder.png'];

interface Found {
  rel: string;
  modified: Date;
}

/**
 * Walks the tree collecting videos. Symlinks and junctions are skipped, and a directory is entered only after its
 * realpath is confirmed inside a root, so a junction that points out of the root cannot be read through the scan.
 */
const walk = async (dir: string, relDir: string, depth: number, roots: string[], found: Found[], budget: { left: number }): Promise<void> => {
  const entries: Dirent[] = await readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (budget.left-- <= 0) return;
    if (entry.isSymbolicLink()) continue;
    const rel = relDir ? `${relDir}/${entry.name}` : entry.name;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (depth >= MAX_DEPTH || !isSafeLocalRelative(rel)) continue;
      const real = await realpath(full).catch(() => null);
      if (real && insideAnyRoot(roots, real)) await walk(full, rel, depth + 1, roots, found, budget);
    } else if (entry.isFile() && VIDEO_EXT.test(entry.name) && isSafeLocalRelative(rel)) {
      const info = await stat(full).catch(() => null);
      const real = info ? await realpath(full).catch(() => null) : null;
      if (info && real && insideAnyRoot(roots, real)) found.push({ rel, modified: info.mtime });
    }
  }
};

/** Vídeos do canal, do mais novo (mtime) ao mais antigo, até `MAX_ITEMS`. `fileRef` é o caminho relativo com `/`. */
export const scanFolder = async (folderReal: string): Promise<NewTelegramItem[]> => {
  const roots = await realRoots();
  const found: Found[] = [];
  await walk(folderReal, '', 1, roots, found, { left: MAX_ENTRIES });
  return found
    .sort((a, b) => b.modified.getTime() - a.modified.getTime())
    .slice(0, MAX_ITEMS)
    .map((f) => {
      const iso = f.modified.toISOString();
      return {
        messageId: syntheticMessageId(iso, f.rel),
        caption: titleFromFilename(f.rel.slice(f.rel.lastIndexOf('/') + 1)),
        postedAt: iso,
        fileRef: f.rel,
      };
    });
};

/**
 * Miniatura ao lado do vídeo: `<nome>.jpg|png` ou `poster`/`folder` da mesma pasta. Sem ffmpeg. Só entra se o arquivo
 * continua dentro de uma raiz e tem tamanho razoável; a validação do formato (jpeg/png) fica com `saveThumb`.
 */
export const sidecarThumb = async (handle: string, fileRef: string | null): Promise<Uint8Array | null> => {
  if (!fileRef) return null;
  const video = await locateVideo(handle, fileRef).catch(() => null);
  if (!video) return null;
  const dir = path.dirname(video);
  const stem = path.basename(video).replace(/\.[^.]+$/, '');
  const names = [`${stem}.jpg`, `${stem}.jpeg`, `${stem}.png`, ...SIDECAR_NAMES];
  const roots = await realRoots();
  for (const name of names) {
    const real = await realpath(path.join(dir, name)).catch(() => null);
    if (!real || !insideAnyRoot(roots, real)) continue;
    const info = await stat(real).catch(() => null);
    if (!info?.isFile() || info.size === 0 || info.size > SIDECAR_MAX_BYTES) continue;
    return new Uint8Array(await readFile(real));
  }
  return null;
};
