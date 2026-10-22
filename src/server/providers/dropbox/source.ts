import { registerDescriptor, registerSource } from '../sources/registry.ts';
import { type FileSource, SourceError } from '../sources/types.ts';
import { downloadDropboxThumb, FILE_ID_RE, listFolderVideos, NOT_FOUND_FILE, normalizeFolderPath, streamDropboxFile, toItems } from './api.ts';
import { DROPBOX_APP_KEY_ENV, dropboxOAuth } from './oauth.ts';

const HANDLE_PREFIX = 'dropbox:';

const mapError = (err: unknown): never => {
  if (err instanceof SourceError) throw err;
  throw new SourceError('não foi possível falar com o Dropbox agora', 502);
};

/** O handle guarda o caminho em minúsculas (o Dropbox não diferencia caixa); o nome exibido mantém o original. */
const pathOf = (handle: string): string => {
  const parsed = normalizeFolderPath(handle.startsWith(HANDLE_PREFIX) ? handle.slice(HANDLE_PREFIX.length) : '');
  if (!parsed) throw new SourceError('canal do Dropbox inválido', 400);
  return parsed.path;
};

export const dropboxSource: FileSource = {
  mode: 'dropbox',
  link: () => null,

  async resolve(input) {
    const parsed = normalizeFolderPath(input);
    if (!parsed) throw new SourceError('informe o caminho de uma pasta do Dropbox, por exemplo /Vídeos', 400);
    return { handle: `${HANDLE_PREFIX}${parsed.path.toLowerCase()}`, name: parsed.name };
  },

  // async: um handle inválido vira rejeição (não throw síncrono), como o contrato FileSource pede.
  list: async (handle) => listFolderVideos(pathOf(handle)).then(toItems, mapError),

  async play({ fileRef, range }) {
    if (!FILE_ID_RE.test(fileRef)) throw new SourceError(NOT_FOUND_FILE, 404);
    return streamDropboxFile(fileRef, range).catch(mapError);
  },

  thumb: (item) => downloadDropboxThumb(item.fileRef ?? '').catch(() => null),
};

export const registerDropbox = (): void => {
  registerSource(dropboxSource);
  registerDescriptor({
    id: 'dropbox',
    title: 'Dropbox',
    description: 'Pastas do seu Dropbox viram canais.',
    icon: 'folder',
    fields: [
      {
        key: 'appKey',
        label: 'App key',
        env: DROPBOX_APP_KEY_ENV,
        required: true,
        placeholder: 'app key do app do Dropbox',
        validate: (v) => (/^[A-Za-z0-9]{5,64}$/.test(v) ? null : 'use só letras e números (a app key do app)'),
      },
    ],
    guide: {
      summary: 'O app não usa client secret (PKCE). Permissão só de leitura.',
      steps: [
        'Abra https://www.dropbox.com/developers/apps e clique em "Create app".',
        'Escolha a API do Dropbox com acesso com escopo (Scoped access) e "Full Dropbox", para enxergar as pastas do seu Dropbox fora de uma pasta própria do app.',
        'Na aba Permissions, marque files.metadata.read e files.content.read e clique em Submit. Escopo não marcado aqui não pode ser pedido na conexão.',
        'Na aba Settings, em OAuth 2 > Redirect URIs, adicione exatamente {{redirectUri}} e clique em Add. O Dropbox compara a URI caractere por caractere, porta incluída.',
        'Copie o App key (na aba Settings) para o campo acima, salve e clique em Conectar.',
      ],
    },
    add: {
      mode: 'dropbox',
      label: 'pasta do Dropbox (caminho, ex.: /Vídeos)',
      placeholder: '/Vídeos',
      hint: 'Caminho da pasta dentro do seu Dropbox. Cada pasta vira um canal.',
    },
    redirectHost: 'localhost',
    oauth: dropboxOAuth,
    configured: () => dropboxOAuth.configured(),
    connected: () => dropboxOAuth.connected(),
  });
};
