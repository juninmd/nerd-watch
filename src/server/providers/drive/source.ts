import { driveClientConfigured, driveConnected } from '../../config.ts';
import { registerDescriptor, registerSource } from '../sources/registry.ts';
import { type FileSource, SourceError } from '../sources/types.ts';
import { DriveFolderNotFoundError, downloadDriveThumb, folderLink, getFolderName, listFolderVideos, parseFolderInput, streamDriveFile, toItems } from './api.ts';
import { DriveNotConnectedError, DriveReauthRequiredError } from './oauth.ts';

const FILE_REF_RE = /^[A-Za-z0-9_-]{10,100}$/;

/** Erros do Drive -> erro de domínio genérico (status certo, mensagem nossa, nunca o corpo cru do Google). */
const mapError = (err: unknown): never => {
  if (err instanceof SourceError) throw err;
  if (err instanceof DriveNotConnectedError) throw new SourceError(err.message, 501);
  if (err instanceof DriveReauthRequiredError) throw new SourceError(err.message, 409);
  if (err instanceof DriveFolderNotFoundError) throw new SourceError(err.message, 404);
  throw new SourceError('não foi possível falar com o Google Drive agora', 502);
};

export const driveSource: FileSource = {
  mode: 'drive',
  link: folderLink,

  async resolve(input) {
    const folderId = parseFolderInput(input);
    if (!folderId) throw new SourceError('informe o link da pasta do Google Drive (…/drive/folders/ID) ou o ID dela', 400);
    return getFolderName(folderId).then((name) => ({ handle: folderId, name }), mapError);
  },

  list: (handle) => listFolderVideos(handle).then(toItems, mapError),

  async play({ fileRef, range }) {
    if (!FILE_REF_RE.test(fileRef)) throw new SourceError('vídeo não encontrado nessa pasta', 404);
    return streamDriveFile(fileRef, range).catch(mapError);
  },

  thumb: (item) => (item.thumbnailUrl ? downloadDriveThumb(item.thumbnailUrl) : Promise.resolve(null)),
};

export const registerDrive = (): void => {
  registerSource(driveSource);
  registerDescriptor({
    id: 'drive',
    title: 'Google Drive',
    description: 'Pastas do seu Drive viram canais.',
    icon: 'folder',
    fields: [],
    ownCard: true,
    add: { mode: 'drive', label: 'pasta do Google Drive (link ou ID)', placeholder: 'link da pasta do Google Drive' },
    configured: driveClientConfigured,
    connected: driveConnected,
  });
};
