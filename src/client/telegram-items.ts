import { type TelegramItemDto, telegramPlayUrl } from './api.ts';
import type { DockItem } from './components/player-dock.ts';

/** Telegram não tem campo de título — usa a 1ª linha da legenda como título e o resto como descrição. */
export const itemTitle = (item: Pick<TelegramItemDto, 'caption' | 'messageId'>, maxLen = 80): string => {
  const firstLine = item.caption?.split('\n').find((l) => l.trim().length > 0);
  return firstLine ? firstLine.trim().slice(0, maxLen) : `Vídeo — mensagem ${item.messageId}`;
};

export const itemDescription = (item: Pick<TelegramItemDto, 'caption'>): string | null => {
  if (!item.caption) return null;
  const rest = item.caption
    .split('\n')
    .filter((l) => l.trim().length > 0)
    .slice(1)
    .join('\n')
    .trim();
  return rest || null;
};

export const watchPath = (channelId: string, messageId: string): string => `/watch/${channelId}/${messageId}`;

export const toDockItem = (channel: { titleId: string; title: string }, item: TelegramItemDto): DockItem => ({
  key: `${channel.titleId}:${item.messageId}`,
  src: telegramPlayUrl(channel.titleId, item.messageId),
  title: itemTitle(item),
  subtitle: channel.title,
  poster: item.thumbnailUrl,
  channelId: channel.titleId,
  messageId: item.messageId,
  durationSeconds: item.durationSeconds,
});
