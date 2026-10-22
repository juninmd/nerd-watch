import type { Database } from 'bun:sqlite';
import { telegramPersonalEnabled } from './config.ts';
import { fetchPersonalChannelInfo } from './providers/telegram/personal-info.ts';
import { getSource } from './providers/sources/registry.ts';
import { fetchPublicChannelPage, type TelegramChannelInfo } from './providers/telegram/public.ts';
import { isPrivateHandle } from './providers/telegram/ref.ts';
import { type TelegramChannel, updateTelegramChannelInfo } from './repo/telegram.ts';
import { downloadPhoto, savePhoto } from './telegram-photos.ts';

interface ResolvedInfo {
  title: string | null;
  description: string | null;
  photo: Uint8Array | null;
}

/** Grava nome/descrição e, se houver foto, guarda o arquivo e aponta `poster_path` para a rota que a serve. */
export const applyChannelInfo = async (db: Database, channel: TelegramChannel, info: ResolvedInfo): Promise<boolean> => {
  const saved = info.photo ? await savePhoto(channel.id, info.photo) : null;
  const posterPath = saved ? `/api/telegram/channels/${channel.id}/photo?v=${Date.now()}` : null;
  if (!info.title && !info.description && !posterPath) return false;
  updateTelegramChannelInfo(db, channel.id, { title: info.title, description: info.description, posterPath });
  return true;
};

/** Do cabeçalho da prévia pública já lida: baixa a foto (se vier) e aplica. Falha na foto não perde nome/descrição. */
export const applyPublicInfo = async (db: Database, channel: TelegramChannel, info: TelegramChannelInfo): Promise<boolean> => {
  const photo = info.photoUrl ? await downloadPhoto(info.photoUrl).catch(() => null) : null;
  return applyChannelInfo(db, channel, { title: info.title, description: info.description, photo });
};

/**
 * Busca de novo nome, descrição e foto do canal. Conta pessoal quando o canal é dela (cobre canais privados);
 * caso contrário a prévia pública, que existe para qualquer canal público. Nunca lança: é um enriquecimento.
 */
export const syncChannelInfo = async (db: Database, channel: TelegramChannel): Promise<boolean> => {
  if (getSource(channel.mode)) return false;
  try {
    if (channel.mode === 'personal' && telegramPersonalEnabled()) {
      return await applyChannelInfo(db, channel, await fetchPersonalChannelInfo(channel.handle));
    }
    // Canal privado não tem prévia pública: sem a conta pessoal não há de onde tirar nome nem foto.
    if (isPrivateHandle(channel.handle)) return false;
    return await applyPublicInfo(db, channel, (await fetchPublicChannelPage(channel.handle)).info);
  } catch {
    return false;
  }
};
