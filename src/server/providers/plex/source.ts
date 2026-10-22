import { serverUrlProblem } from '../sources/media-server.ts';
import { registerDescriptor, registerSource } from '../sources/registry.ts';
import { relayMedia } from '../sources/service.ts';
import { type FileSource, SourceError } from '../sources/types.ts';
import { listPlexHandle, plexConfigured, plexThumb, resolvePlexInput, streamPlexItem, toItems, validateToken } from './api.ts';

const RATING_KEY_RE = /^\d{1,12}$/;

export const plexSource: FileSource = {
  mode: 'plex',
  // Sem página pública do item: o servidor é privado, então não há link seguro para devolver.
  link: () => null,

  resolve: resolvePlexInput,

  async list(handle) {
    return toItems(await listPlexHandle(handle));
  },

  async play({ fileRef, range }) {
    if (!RATING_KEY_RE.test(fileRef)) throw new SourceError('vídeo não encontrado nessa biblioteca', 404);
    return relayMedia(await streamPlexItem(fileRef, range), 'vídeo não encontrado no Plex');
  },

  thumb: (item) => plexThumb(item.thumbnailUrl),
};

export const registerPlex = (): void => {
  registerSource(plexSource);
  registerDescriptor({
    id: 'plex',
    title: 'Plex',
    description: 'Seções de filmes e séries do seu Plex viram canais. Reproduz o arquivo original, sem transcodificar.',
    icon: 'film',
    fields: [
      { key: 'url', label: 'endereço do servidor', env: 'PLEX_URL', placeholder: 'http://192.168.0.10:32400', required: true, validate: serverUrlProblem },
      { key: 'token', label: 'token (X-Plex-Token)', env: 'PLEX_TOKEN', secret: true, placeholder: 'token do Plex', required: true, validate: validateToken },
    ],
    guide: {
      summary: 'O token dá acesso à sua conta Plex. Trate como senha e não cole em lugar público.',
      steps: [
        'Siga a página oficial do Plex "Finding an authentication token / X-Plex-Token" (support.plex.tv/articles/204059436) para achar o token.',
        'Cole o token e o endereço do servidor (ex.: http://192.168.0.10:32400) acima.',
        'Em Adicionar, informe o nome da seção (ex.: Filmes) ou show:<ID> para uma série.',
      ],
    },
    add: {
      mode: 'plex',
      label: 'seção (nome ou número) ou série (show:ID)',
      placeholder: 'nome da seção, ex.: Filmes',
      hint: 'Para uma série use show: seguido do ID do item (ratingKey) que aparece na URL dele.',
    },
    configured: plexConfigured,
    connected: plexConfigured,
  });
};
