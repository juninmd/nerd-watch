import { cleanHttpUrl } from '../sources/http.ts';
import { readSetting } from '../sources/settings.ts';
import { SourceError } from '../sources/types.ts';

export const S3_ENV = { endpoint: 'S3_ENDPOINT', region: 'S3_REGION', accessKey: 'S3_ACCESS_KEY', secretKey: 'S3_SECRET_KEY' } as const;

export interface S3Config {
  /** Origem do endpoint (`https://s3.us-east-1.amazonaws.com`, `http://minio.local:9000`...). */
  origin: string;
  /** Caminho base do endpoint sem barra final; vazio quando o serviço fica na raiz. */
  basePath: string;
  region: string;
  accessKey: string;
  secretKey: string;
}

export const validateS3Endpoint = (value: string): string | null => {
  const url = cleanHttpUrl(value);
  if (!url) return 'use uma URL http(s) sem usuário e senha (as chaves vão nos campos abaixo)';
  if (url.search || url.hash) return 'o endpoint não pode ter ? nem #';
  return null;
};

export const validateS3Region = (value: string): string | null => (/^[a-z0-9-]{2,32}$/.test(value) ? null : 'use letras minúsculas, números e hífen (ex.: us-east-1, auto)');

export const validateS3AccessKey = (value: string): string | null => (/^[!-~]{3,128}$/.test(value) ? null : 'chave de acesso inválida (sem espaços)');

export const validateS3SecretKey = (value: string): string | null => (/^[!-~]{8,256}$/.test(value) ? null : 'segredo inválido (sem espaços)');

/** Lê do ambiente a cada chamada: salvar pela UI vale na hora. Lança `SourceError` se faltar algo. */
export const s3Config = (): S3Config => {
  const endpoint = cleanHttpUrl(readSetting(S3_ENV.endpoint) ?? '');
  const region = readSetting(S3_ENV.region);
  const accessKey = readSetting(S3_ENV.accessKey);
  const secretKey = readSetting(S3_ENV.secretKey);
  if (!endpoint || !region || !accessKey || !secretKey) throw new SourceError('configure o endpoint, a região e as chaves do S3 em Conexões', 501);
  return { origin: endpoint.origin, basePath: endpoint.pathname.replace(/\/+$/, ''), region, accessKey, secretKey };
};

export const s3Configured = (): boolean => {
  try {
    s3Config();
    return true;
  } catch {
    return false;
  }
};
