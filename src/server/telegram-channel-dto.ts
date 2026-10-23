import { posterUrl } from './routes/library.ts';
import { getSource } from './providers/sources/registry.ts';
import { isPrivateHandle } from './providers/telegram/ref.ts';
import { HISTORY_END } from './repo/telegram.ts';
import { type LinkedTitleInfo, itemLinkFromRow } from './repo/telegram-links.ts';
import type { TelegramItemRow } from './types.ts';
import { hasHistory } from './telegram-history.ts';
import type { TelegramChannel } from './repo/telegram.ts';

/** Link externo do canal: `t.me` para o Telegram; fontes de arquivo dizem o próprio (ou nenhum). */
export const channelLink = (channel: Pick<TelegramChannel, 'mode' | 'handle'>): string | null => {
  const source = getSource(channel.mode);
  if (source) return source.link(channel.handle);
  // `t.me/c/<id>` sem número de mensagem não abre nada: canal privado fica sem link do canal.
  return isPrivateHandle(channel.handle) ? null : `https://t.me/${channel.handle}`;
};

/** Só fontes que tocam por embed (YouTube) entregam `embedUrl`; o resto usa o player do app (ou o fallback de embed do próprio provider). */
export const itemEmbedUrl = (channel: Pick<TelegramChannel, 'mode'>, fileRef: string | null): string | undefined =>
  fileRef ? (getSource(channel.mode)?.embedUrl?.(fileRef) ?? undefined) : undefined;

export const toChannelResponse =(channel: TelegramChannel, itemCount: number) => ({
  titleId: channel.id,
  handle: channel.handle,
  mode: channel.mode,
  title: channel.title.title,
  posterUrl: channel.title.poster_path,
  description: channel.title.overview,
  link: channelLink(channel),
  itemCount,
  /** Ainda há vídeos mais antigos no Telegram para carregar (o bot e as fontes de arquivo não têm). */
  canLoadMore: hasHistory(channel.mode) && channel.cursor !== HISTORY_END,
});

/** Vínculo do vídeo com o título da biblioteca (nome e pôster para a lista do canal); nulo sem vínculo. */
export const itemLinkDto = (row: TelegramItemRow, titles: Map<string, LinkedTitleInfo>) => {
  const link = itemLinkFromRow(row);
  if (!link) return null;
  const title = titles.get(link.titleId);
  return { ...link, title: title?.title ?? null, posterUrl: title ? posterUrl(title.source, title.posterPath) : null };
};
