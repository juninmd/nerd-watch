import type { TelegramChannel } from './repo/telegram.ts';

/** Link externo do canal: `t.me` para o Telegram; para o Drive o `handle` é o ID da pasta. */
export const channelLink = (channel: Pick<TelegramChannel, 'mode' | 'handle'>): string =>
  channel.mode === 'drive' ? `https://drive.google.com/drive/folders/${channel.handle}` : `https://t.me/${channel.handle}`;

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
