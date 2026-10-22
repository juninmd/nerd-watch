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
  route: watchPath(channel.titleId, item.messageId),
  embedUrl: item.embedUrl ?? null,
});

/**
 * Próximo canal para sugerir ao fim de um: o seguinte na ordem da lista (volta ao início no fim da lista),
 * pulando canais sem vídeo. Null quando não há nenhum outro com vídeos.
 */
export const pickNextChannel = <T extends { titleId: string; itemCount: number }>(channels: T[], currentId: string): T | null => {
  const at = channels.findIndex((c) => c.titleId === currentId);
  for (let step = 1; step < channels.length; step++) {
    const candidate = channels[(at + step + channels.length) % channels.length];
    if (candidate && candidate.titleId !== currentId && candidate.itemCount > 0) return candidate;
  }
  return null;
};

/** Ordena pelo id da mensagem (cresce com o tempo): `newest` = mais recente primeiro. Não altera a lista original. */
export const orderItems = <T extends { messageId: string }>(items: T[], order: 'newest' | 'oldest'): T[] => {
  const sorted = [...items].sort((a, b) => Number(a.messageId) - Number(b.messageId));
  return order === 'newest' ? sorted.reverse() : sorted;
};

/** Minúsculas, sem acento e sem espaços repetidos: "Pânico  na TV" casa com "panico". */
export const normalizeSearch = (text: string): string => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();

/** Busca na legenda (título e descrição): todas as palavras digitadas precisam aparecer, em qualquer ordem. Sem texto devolve a lista. */
export const filterItems = <T extends { caption: string | null }>(items: T[], query: string): T[] => {
  const words = normalizeSearch(query).split(' ').filter(Boolean);
  if (words.length === 0) return items;
  return items.filter((item) => {
    const text = normalizeSearch(item.caption ?? '');
    return words.every((word) => text.includes(word));
  });
};
