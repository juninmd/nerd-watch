import { registerDescriptor, registerSource } from '../sources/registry.ts';
import { serverUrlProblem } from '../sources/media-server.ts';
import { relayMedia } from '../sources/service.ts';
import { type FileSource, SourceError } from '../sources/types.ts';
import { HANDLE_PREFIX, findLibrary, jellyfinConfigured, libraryIdOfHandle, listLibraryItems, normalizeGuid, primaryThumb, streamItem, toItems, validateApiKey } from './api.ts';

export const jellyfinSource: FileSource = {
  mode: 'jellyfin',
  // Sem página pública do item: o servidor é privado, então não há link seguro para devolver.
  link: () => null,

  async resolve(input) {
    const library = await findLibrary(input);
    return { handle: `${HANDLE_PREFIX}${library.id}`, name: library.name };
  },

  async list(handle) {
    const libraryId = libraryIdOfHandle(handle);
    if (!libraryId) throw new SourceError('biblioteca inválida', 404);
    return toItems(await listLibraryItems(libraryId));
  },

  async play({ fileRef, range }) {
    const itemId = normalizeGuid(fileRef);
    if (!itemId) throw new SourceError('vídeo não encontrado nessa biblioteca', 404);
    return relayMedia(await streamItem(itemId, range), 'vídeo não encontrado no Jellyfin');
  },

  async thumb(item) {
    const itemId = normalizeGuid(item.fileRef);
    // Sem `thumbnailUrl` o item não tem capa no servidor: nem pede.
    if (!itemId || !item.thumbnailUrl) return null;
    return primaryThumb(itemId);
  },
};

const GUIDE_SUMMARY = 'A chave de API dá acesso total ao servidor (como um administrador). Guarde como senha.';

export const registerJellyfin = (): void => {
  registerSource(jellyfinSource);
  registerDescriptor({
    id: 'jellyfin',
    title: 'Jellyfin / Emby',
    description: 'Bibliotecas do seu servidor de mídia viram canais. Reproduz o arquivo original, sem transcodificar.',
    icon: 'film',
    fields: [
      { key: 'url', label: 'endereço do servidor', env: 'JELLYFIN_URL', placeholder: 'http://192.168.0.10:8096', required: true, validate: serverUrlProblem },
      { key: 'apiKey', label: 'chave de API', env: 'JELLYFIN_API_KEY', secret: true, placeholder: 'chave criada no painel do servidor', required: true, validate: validateApiKey },
    ],
    guide: {
      summary: GUIDE_SUMMARY,
      steps: [
        'No painel do Jellyfin, abra Painel > Chaves de API e crie uma chave para o nerd-watch.',
        'Cole a chave acima e o endereço do servidor (ex.: http://192.168.0.10:8096).',
        'Em Adicionar, informe o nome da biblioteca (ou o ID dela).',
      ],
    },
    add: { mode: 'jellyfin', label: 'biblioteca (nome ou ID)', placeholder: 'nome da biblioteca, ex.: Séries', hint: 'Use o nome exato da biblioteca no servidor.' },
    configured: jellyfinConfigured,
    connected: jellyfinConfigured,
  });
};
