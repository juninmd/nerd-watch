import { registerDescriptor, registerSource } from '../sources/registry.ts';
import { type FileSource, SourceError } from '../sources/types.ts';
import { S3_ENV, s3Config, s3Configured, validateS3AccessKey, validateS3Endpoint, validateS3Region, validateS3SecretKey } from './config.ts';
import { checkLocation, handleOf, listVideos, locationOfHandle, openVideo, parseLocation } from './api.ts';

const locate = (handle: string) => {
  const location = locationOfHandle(handle);
  if (!location) throw new SourceError('canal S3 inválido', 404);
  return location;
};

export const s3Source: FileSource = {
  mode: 's3',
  link: () => null,

  async resolve(input) {
    const location = parseLocation(input);
    if (!location) throw new SourceError('informe o bucket ou bucket/prefixo/ (ex.: meu-bucket/anime/)', 400);
    await checkLocation(s3Config(), location.bucket, location.prefix);
    const folder = location.prefix.replace(/\/$/, '');
    const name = folder ? (folder.slice(folder.lastIndexOf('/') + 1) as string) : location.bucket;
    return { handle: handleOf(location.bucket, location.prefix), name };
  },

  async list(handle) {
    const { bucket, prefix } = locate(handle);
    return listVideos(s3Config(), bucket, prefix);
  },

  async play({ handle, fileRef, range }) {
    const { bucket, prefix } = locate(handle);
    return openVideo(bucket, prefix, fileRef, range);
  },
};

export const registerS3 = (): void => {
  registerSource(s3Source);
  registerDescriptor({
    id: 's3',
    title: 'S3 compatível',
    description: 'Buckets de AWS S3, MinIO, Backblaze B2 ou Cloudflare R2. Cada prefixo (pasta) vira um canal.',
    icon: 'folder',
    fields: [
      { key: 'endpoint', label: 'endpoint', env: S3_ENV.endpoint, placeholder: 'https://s3.us-east-1.amazonaws.com', required: true, validate: validateS3Endpoint },
      { key: 'region', label: 'região', env: S3_ENV.region, placeholder: 'us-east-1 (R2: auto)', required: true, validate: validateS3Region },
      { key: 'accessKey', label: 'chave de acesso', env: S3_ENV.accessKey, required: true, validate: validateS3AccessKey },
      { key: 'secretKey', label: 'segredo', env: S3_ENV.secretKey, secret: true, required: true, validate: validateS3SecretKey },
    ],
    guide: {
      summary: 'Crie uma chave com permissão de leitura só no bucket dos vídeos (ListBucket e GetObject).',
      steps: [
        'No provedor (AWS IAM, MinIO, B2 ou R2), crie uma chave de acesso restrita ao bucket de vídeos, com leitura apenas.',
        'Cole o endpoint, a região, a chave e o segredo acima e salve.',
        'Em "Adicionar canal", informe bucket ou bucket/prefixo/ (ex.: meu-bucket/anime/).',
      ],
    },
    add: { mode: 's3', label: 'bucket ou bucket/prefixo/', placeholder: 'meu-bucket/anime/' },
    configured: s3Configured,
    connected: s3Configured,
  });
};
