import { cleanHttpUrl } from '../sources/http.ts';
import { readSetting } from '../sources/settings.ts';
import { SourceError } from '../sources/types.ts';

export const WEBDAV_ENV = { url: 'WEBDAV_URL', user: 'WEBDAV_USER', password: 'WEBDAV_PASSWORD' } as const;

export interface WebdavConfig {
  /** Origem do servidor; a única para onde o usuário e a senha podem ser enviados. */
  origin: string;
  /** Caminho base da URL configurada, sem barra final (ex.: `/remote.php/dav/files/ana`); vazio na raiz. */
  basePath: string;
  user: string;
  password: string;
}

export const validateWebdavUrl = (value: string): string | null => {
  const url = cleanHttpUrl(value);
  if (!url) return 'use uma URL http(s) sem usuário e senha (eles vão nos campos abaixo)';
  if (url.search || url.hash) return 'a URL não pode ter ? nem #';
  return null;
};

/** Lê do ambiente a cada chamada: salvar pela UI vale na hora. Lança `SourceError` se faltar algo. */
export const webdavConfig = (): WebdavConfig => {
  const base = cleanHttpUrl(readSetting(WEBDAV_ENV.url) ?? '');
  const user = readSetting(WEBDAV_ENV.user);
  const password = readSetting(WEBDAV_ENV.password);
  if (!base || !user || !password) throw new SourceError('configure o endereço, o usuário e a senha do WebDAV em Conexões', 501);
  return { origin: base.origin, basePath: base.pathname.replace(/\/+$/, ''), user, password };
};

export const webdavConfigured = (): boolean => {
  try {
    webdavConfig();
    return true;
  } catch {
    return false;
  }
};
