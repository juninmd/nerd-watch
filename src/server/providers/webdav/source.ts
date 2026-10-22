import { registerDescriptor, registerSource } from '../sources/registry.ts';
import { type FileSource, SourceError } from '../sources/types.ts';
import { webdavConfig, webdavConfigured, WEBDAV_ENV, validateWebdavUrl } from './config.ts';
import { folderOfHandle, listVideos, openVideo, resolveFolder } from './api.ts';

const folderOrFail = (handle: string): string => {
  const folder = folderOfHandle(handle);
  if (!folder) throw new SourceError('canal WebDAV inválido', 404);
  return folder;
};

export const webdavSource: FileSource = {
  mode: 'webdav',
  link: () => null,
  resolve: resolveFolder,
  async list(handle) {
    return listVideos(webdavConfig(), folderOrFail(handle));
  },
  async play({ handle, fileRef, range }) {
    return openVideo(folderOrFail(handle), fileRef, range);
  },
};

const validateUser = (value: string): string | null => (value.includes(':') ? 'não pode conter ":" (regra do HTTP Basic)' : null);

export const registerWebdav = (): void => {
  registerSource(webdavSource);
  registerDescriptor({
    id: 'webdav',
    title: 'WebDAV',
    description: 'Pastas de um servidor WebDAV (Nextcloud, ownCloud, NAS) viram canais. Autenticação Basic; Digest não é suportado.',
    icon: 'folder',
    fields: [
      { key: 'url', label: 'endereço WebDAV', env: WEBDAV_ENV.url, placeholder: 'https://nas.local/remote.php/dav/files/usuario', required: true, validate: validateWebdavUrl },
      { key: 'user', label: 'usuário', env: WEBDAV_ENV.user, required: true, validate: validateUser },
      { key: 'password', label: 'senha ou senha de aplicativo', env: WEBDAV_ENV.password, secret: true, required: true },
    ],
    guide: {
      summary: 'Use um usuário dedicado. No Nextcloud, crie uma senha de aplicativo em Configurações > Segurança.',
      steps: [
        'Copie o endereço WebDAV completo da sua conta (no Nextcloud termina em /remote.php/dav/files/SEU_USUARIO).',
        'Cole o endereço, o usuário e a senha acima e salve.',
        'Em "Adicionar canal", informe o caminho da pasta na raiz do servidor, por exemplo /Videos/Anime.',
      ],
    },
    add: { mode: 'webdav', label: 'pasta na raiz do servidor (caminho começando com /)', placeholder: '/Videos/Anime' },
    configured: webdavConfigured,
    connected: webdavConfigured,
  });
};
