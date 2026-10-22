import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { registerDescriptor, registerSource } from '../sources/registry.ts';
import { type FileSource, SourceError } from '../sources/types.ts';
import { locateVideo, realFolder } from './access.ts';
import { LOCAL_ENV, configuredRoots, handleOf, insideAnyRoot, realRoots, validateLocalRoots } from './roots.ts';
import { serveFile } from './range.ts';
import { scanFolder, sidecarThumb } from './scan.ts';

export const localSource: FileSource = {
  mode: 'local',
  link: () => null,

  async resolve(input) {
    const roots = await realRoots();
    if (roots.length === 0) throw new SourceError(`defina ${LOCAL_ENV} com as pastas liberadas`, 501);
    if (input.includes('\0')) throw new SourceError('caminho inválido', 400);
    // Relativo à primeira raiz configurada; absoluto passa pela mesma checagem de contenção.
    const target = path.isAbsolute(input) ? path.resolve(input) : path.resolve(roots[0] as string, input);
    const real = await realpath(target).catch(() => null);
    if (!real) throw new SourceError('pasta não encontrada (confira o caminho e LOCAL_MEDIA_DIRS)', 404);
    if (!insideAnyRoot(roots, real)) throw new SourceError('a pasta precisa estar dentro de uma das raízes liberadas (LOCAL_MEDIA_DIRS)', 400);
    const info = await stat(real).catch(() => null);
    if (!info?.isDirectory()) throw new SourceError('o caminho não é uma pasta', 400);
    return { handle: handleOf(real), name: path.basename(real) || real };
  },

  async list(handle) {
    return scanFolder(await realFolder(handle));
  },

  async play({ handle, fileRef, range }) {
    return serveFile(await locateVideo(handle, fileRef), range);
  },

  thumb: ({ handle, fileRef }) => sidecarThumb(handle, fileRef),
};

export const registerLocal = (): void => {
  registerSource(localSource);
  registerDescriptor({
    id: 'local',
    title: 'Pasta local',
    description: `Pastas do seu computador viram canais. Só pastas dentro de ${LOCAL_ENV} (definido no .env) podem ser adicionadas.`,
    icon: 'folder',
    fields: [
      {
        key: 'roots',
        label: 'pastas liberadas',
        env: LOCAL_ENV,
        placeholder: 'C:\\Videos;D:\\Series',
        required: true,
        readOnly: true,
        validate: validateLocalRoots,
      },
    ],
    add: { mode: 'local', label: 'pasta dentro das raízes (caminho absoluto ou relativo à 1ª raiz)', placeholder: 'C:\\Videos\\Anime' },
    configured: () => configuredRoots().length > 0,
    connected: () => configuredRoots().length > 0,
  });
};
