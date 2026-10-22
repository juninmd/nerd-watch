import { getSource } from './providers/sources/registry.ts';
import type { TelegramChannel } from './repo/telegram.ts';

/** Link externo do canal: `t.me` para o Telegram; fontes de arquivo dizem o próprio (ou nenhum). */
export const channelLink = (channel: Pick<TelegramChannel, 'mode' | 'handle'>): string | null => {
  const source = getSource(channel.mode);
  return source ? source.link(channel.handle) : `https://t.me/${channel.handle}`;
};

export const toChannelResponse = (channel: TelegramChannel, itemCount: number) => ({
  titleId: channel.id,
  handle: channel.handle,
  mode: channel.mode,
  title: channel.title.title,
  posterUrl: channel.title.poster_path,
  description: channel.title.overview,
  link: channelLink(channel),
  itemCount,
});
