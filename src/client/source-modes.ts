import type { TelegramChannelMode } from './api.ts';

interface ModeInfo {
  /** Selo do canal ("telegram · bot", "google drive"). */
  badge: string;
  /** Texto do link externo; sem link no canal, o botão some. */
  open: string;
}

const TELEGRAM = (label: string): ModeInfo => ({ badge: `telegram · ${label}`, open: 'Abrir no Telegram' });

export const MODE_INFO: Record<TelegramChannelMode, ModeInfo> = {
  public: TELEGRAM('canal público'),
  personal: TELEGRAM('conta pessoal'),
  bot: TELEGRAM('bot'),
  drive: { badge: 'google drive', open: 'Abrir no Drive' },
  local: { badge: 'pasta local', open: 'Abrir' },
  webdav: { badge: 'webdav', open: 'Abrir no servidor' },
  dropbox: { badge: 'dropbox', open: 'Abrir no Dropbox' },
  onedrive: { badge: 'onedrive', open: 'Abrir no OneDrive' },
  jellyfin: { badge: 'jellyfin / emby', open: 'Abrir no servidor' },
  plex: { badge: 'plex', open: 'Abrir no Plex' },
  peertube: { badge: 'peertube', open: 'Abrir no PeerTube' },
  s3: { badge: 's3', open: 'Abrir' },
  youtube: { badge: 'youtube', open: 'Abrir no YouTube' },
  torrent: { badge: 'torrent', open: 'Abrir' },
};

export const isTelegramMode = (mode: TelegramChannelMode): boolean => mode === 'public' || mode === 'personal' || mode === 'bot';

/** Só o modo bot não tem como reler a origem (recebe mensagens a partir de agora). */
export const canRefreshMode = (mode: TelegramChannelMode): boolean => mode !== 'bot';

/** Texto curto de "de onde vem" para cartões: @canal no Telegram, o nome da fonte nas demais. */
export const originLabel = (mode: TelegramChannelMode, handle: string): string => (isTelegramMode(mode) ? `@${handle}` : MODE_INFO[mode].badge);
