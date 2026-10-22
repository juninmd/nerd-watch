import { registerDescriptor, registerSource } from '../sources/registry.ts';
import { type FileSource, SourceError } from '../sources/types.ts';
import { downloadOneDriveThumb, getFolder, ITEM_ID_RE, listFolderVideos, NOT_FOUND_FILE, parseFolderPath, streamOneDriveFile, toItems } from './api.ts';
import { ONEDRIVE_CLIENT_ID_ENV, onedriveOAuth } from './oauth.ts';

const HANDLE_PREFIX = 'onedrive:';

const mapError = (err: unknown): never => {
  if (err instanceof SourceError) throw err;
  throw new SourceError('não foi possível falar com o OneDrive agora', 502);
};

/** `onedrive:/` é a raiz; `onedrive:/Vídeos/Filmes` é a pasta. O caminho é validado de novo a cada uso. */
const segmentsOf = (handle: string): string[] => {
  const segments = handle.startsWith(HANDLE_PREFIX) ? parseFolderPath(handle.slice(HANDLE_PREFIX.length)) : null;
  if (!segments) throw new SourceError('canal do OneDrive inválido', 400);
  return segments;
};

export const onedriveSource: FileSource = {
  mode: 'onedrive',
  link: () => null,

  async resolve(input) {
    const segments = parseFolderPath(input);
    if (!segments) throw new SourceError('informe o caminho de uma pasta do OneDrive, por exemplo /Vídeos', 400);
    const folder = await getFolder(segments).catch(mapError);
    return { handle: `${HANDLE_PREFIX}/${segments.join('/')}`, name: folder.name };
  },

  // async: um handle inválido vira rejeição (não throw síncrono), como o contrato FileSource pede.
  list: async (handle) => listFolderVideos(segmentsOf(handle)).then(toItems, mapError),

  async play({ fileRef, range }) {
    if (!ITEM_ID_RE.test(fileRef)) throw new SourceError(NOT_FOUND_FILE, 404);
    return streamOneDriveFile(fileRef, range).catch(mapError);
  },

  thumb: (item) => downloadOneDriveThumb(item.fileRef ?? '').catch(() => null),
};

export const registerOneDrive = (): void => {
  registerSource(onedriveSource);
  registerDescriptor({
    id: 'onedrive',
    title: 'OneDrive',
    description: 'Pastas do seu OneDrive pessoal viram canais.',
    icon: 'folder',
    fields: [
      {
        key: 'clientId',
        label: 'Application (client) ID',
        env: ONEDRIVE_CLIENT_ID_ENV,
        required: true,
        placeholder: 'ID do aplicativo registrado no Entra',
        validate: (v) => (/^[A-Za-z0-9-]{8,64}$/.test(v) ? null : 'use só letras, números e hífens (o Application ID do app)'),
      },
    ],
    guide: {
      summary: 'Conta Microsoft pessoal. O app é público (sem client secret) e só lê arquivos.',
      steps: [
        'Abra https://entra.microsoft.com e vá em Applications > App registrations > New registration.',
        'Em Supported account types, escolha "Personal Microsoft accounts only".',
        'Em Redirect URI, escolha a plataforma "Mobile and desktop applications" e adicione {{redirectUri}}. Para localhost a porta é ignorada, mas o caminho precisa bater.',
        'Em API permissions > Add a permission > Microsoft Graph > Delegated, marque Files.Read.',
        'Na página Overview, copie o Application (client) ID para o campo acima, salve e clique em Conectar.',
      ],
    },
    add: {
      mode: 'onedrive',
      label: 'pasta do OneDrive (caminho, ex.: /Vídeos)',
      placeholder: '/Vídeos',
      hint: 'Caminho da pasta dentro do seu OneDrive. Cada pasta vira um canal.',
    },
    redirectHost: 'localhost',
    oauth: onedriveOAuth,
    configured: () => onedriveOAuth.configured(),
    connected: () => onedriveOAuth.connected(),
  });
};
