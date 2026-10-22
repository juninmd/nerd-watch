import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { config } from './config.ts';
import { isTelegramPhotoUrl } from './providers/telegram/public.ts';

/** Fotos dos canais ficam em disco, ao lado do banco: o navegador nunca pede imagem a terceiros e o app segue local-first. */
export const photoStore = {
  dir: (): string | null => (config.dbPath === ':memory:' ? null : join(dirname(config.dbPath), 'telegram-photos')),
};

export interface Photo {
  bytes: Uint8Array;
  type: 'image/jpeg' | 'image/png';
}

const EXT: Record<Photo['type'], string> = { 'image/jpeg': 'jpg', 'image/png': 'png' };
const MAX_BYTES = 2 * 1024 * 1024;
/** Só ids de canal gerados pelo app (UUID) chegam ao caminho do arquivo — nada de `..` vindo da URL. */
const ID_RE = /^[0-9a-f-]{36}$/;

const sniff = (bytes: Uint8Array): Photo['type'] | null => {
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'image/jpeg';
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
  return null;
};

export const savePhoto = async (id: string, bytes: Uint8Array): Promise<Photo['type'] | null> => {
  const dir = photoStore.dir();
  const type = sniff(bytes);
  if (!dir || !type || !ID_RE.test(id) || bytes.length === 0 || bytes.length > MAX_BYTES) return null;
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `${id}.${EXT[type]}`), bytes);
  return type;
};

export const readPhoto = async (id: string): Promise<Photo | null> => {
  const dir = photoStore.dir();
  if (!dir || !ID_RE.test(id)) return null;
  for (const type of Object.keys(EXT) as Photo['type'][]) {
    try {
      return { bytes: await readFile(join(dir, `${id}.${EXT[type]}`)), type };
    } catch {
      // tenta a próxima extensão
    }
  }
  return null;
};

/** Baixa a foto de um CDN do Telegram (host na lista, sem seguir redirects, 2 MB no máximo). */
export const downloadPhoto = async (url: string): Promise<Uint8Array | null> => {
  if (!isTelegramPhotoUrl(url)) return null;
  const res = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(10_000) });
  if (!res.ok) return null;
  const bytes = new Uint8Array(await res.arrayBuffer());
  return bytes.length > 0 && bytes.length <= MAX_BYTES ? bytes : null;
};

const MESSAGE_ID_RE = /^\d{1,19}$/;

const thumbPath = (channelId: string, messageId: string, type: Photo['type']): string | null => {
  const dir = photoStore.dir();
  if (!dir || !ID_RE.test(channelId) || !MESSAGE_ID_RE.test(messageId)) return null;
  return join(dir, 'thumbs', channelId, `${messageId}.${EXT[type]}`);
};

export const thumbUrl = (channelId: string, messageId: string): string => `/api/telegram/channels/${channelId}/items/${messageId}/thumb`;

/** Miniatura de um vídeo, guardada em disco como a foto do canal (mesmas regras: só imagem, até 2 MB, ids validados). */
export const saveThumb = async (channelId: string, messageId: string, bytes: Uint8Array): Promise<boolean> => {
  const type = sniff(bytes);
  const path = type ? thumbPath(channelId, messageId, type) : null;
  if (!type || !path || bytes.length === 0 || bytes.length > MAX_BYTES) return false;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, bytes);
  return true;
};

export const readThumb = async (channelId: string, messageId: string): Promise<Photo | null> => {
  for (const type of Object.keys(EXT) as Photo['type'][]) {
    const path = thumbPath(channelId, messageId, type);
    if (!path) return null;
    try {
      return { bytes: await readFile(path), type };
    } catch {
      // tenta a próxima extensão
    }
  }
  return null;
};
