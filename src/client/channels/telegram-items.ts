import { type TelegramItemDto, telegramPlayUrl } from '../api/index.ts';
import type { DockItem } from '../player/player-dock.ts';

/**
 * Telegram não tem campo de título — usa a 1ª linha da legenda como título e o resto como descrição.
 * Sem corte: a tela do canal e a de reprodução mostram a mensagem inteira (o layout quebra a linha).
 */
export const itemTitle = (item: { caption?: string | null; messageId: string } & { fileName?: string | null }): string => {
  const firstLine = item.caption?.split('\n').find((l) => l.trim().length > 0);
  if (firstLine) return firstLine.trim();
  // Sem legenda: o nome do arquivo (sem extensão) é melhor título que o id da mensagem.
  const file = item.fileName?.trim().replace(/\.[A-Za-z0-9]{2,5}$/, '').trim();
  return file || `Vídeo — mensagem ${item.messageId}`;
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

/** Nome do arquivo no Telegram (conta pessoal/bot preenchem; origem sem nome devolve null). */
export const itemFileName = (item: Pick<TelegramItemDto, 'fileName'>): string | null => item.fileName?.trim() || null;

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

export type ItemOrder = 'newest' | 'oldest' | 'name' | 'name-desc';

/**
 * Ordena por data de postagem (`postedAt`; sem data cai para o id da mensagem, que cresce com o tempo) ou por nome
 * (título, sem acento, com números naturais). Não altera a lista original.
 */
export const orderItems = <T extends { messageId: string; postedAt?: string | null; caption?: string | null; fileName?: string | null }>(
  items: T[],
  order: ItemOrder,
): T[] => {
  if (order === 'name' || order === 'name-desc') {
    const key = (i: T) => normalizeSearch(itemTitle(i));
    const sorted = [...items].sort((a, b) => key(a).localeCompare(key(b), 'pt-BR', { numeric: true }) || Number(a.messageId) - Number(b.messageId));
    return order === 'name' ? sorted : sorted.reverse();
  }
  const time = (i: T) => {
    const t = i.postedAt ? Date.parse(i.postedAt) : Number.NaN;
    return Number.isFinite(t) ? t : null;
  };
  const sorted = [...items].sort((a, b) => {
    const ta = time(a);
    const tb = time(b);
    if (ta !== null && tb !== null && ta !== tb) return ta - tb;
    return Number(a.messageId) - Number(b.messageId);
  });
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
