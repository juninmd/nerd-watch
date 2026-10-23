import { stat } from 'node:fs/promises';
import path from 'node:path';
import { locateVideo } from '../providers/local/access.ts';
import { SourceError } from '../providers/sources/types.ts';
import { getDb } from '../db.ts';
import { getTelegramChannel, getTelegramItem } from '../repo/telegram.ts';
import { MediaError, type LocatedFile } from './service.ts';

/**
 * Resolve um item de pasta local até o arquivo real, com as mesmas checagens da reprodução (realpath dentro de uma
 * raiz liberada). Itens de outras fontes devolvem `null`: a conversão não toca em nada remoto.
 */
export const localLocator = async (channelId: string, messageId: string): Promise<LocatedFile | null> => {
  const db = await getDb();
  const channel = getTelegramChannel(db, channelId);
  if (channel?.mode !== 'local') return null;
  const item = getTelegramItem(db, channel.id, messageId);
  if (!item?.file_ref) throw new MediaError(404, 'vídeo não encontrado nesse canal');
  let file: string;
  try {
    file = await locateVideo(channel.handle, item.file_ref);
  } catch (err) {
    if (err instanceof SourceError) throw new MediaError(404, err.message);
    throw err;
  }
  const info = await stat(file);
  return { file, name: path.basename(file), size: info.size, mtimeMs: info.mtimeMs };
};
