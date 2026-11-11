import { json } from './http.ts';
import type { LibraryEntryDto } from './library.ts';

export type TelegramChannelMode = 'public' | 'personal' | 'bot' | 'drive' | 'local' | 'webdav' | 'dropbox' | 'onedrive' | 'jellyfin' | 'plex' | 'peertube' | 's3' | 'youtube' | 'torrent' | 'dailymotion' | 'archive';

export interface TelegramChannelDto {
  titleId: string;
  handle: string;
  mode: TelegramChannelMode;
  title: string;
  posterUrl: string | null;
  description: string | null;
  /** Fontes sem página própria (pasta local, torrent) não têm link. */
  link: string | null;
  itemCount: number;
  /** Ainda há vídeos mais antigos no Telegram para carregar. */
  canLoadMore: boolean;
}

export interface TelegramChannelListResponse {
  channels: TelegramChannelDto[];
}

export const listTelegramChannels = (): Promise<TelegramChannelListResponse> =>
  fetch('/api/telegram/channels').then((r) => json<TelegramChannelListResponse>(r));

export const addTelegramChannel = (handle: string, mode: TelegramChannelMode): Promise<TelegramChannelDto> =>
  fetch('/api/telegram/channels', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ handle, mode }),
  }).then((r) => json<TelegramChannelDto>(r));

export interface TelegramItemDto {
  messageId: string;
  caption: string | null;
  durationSeconds: number | null;
  thumbnailUrl: string | null;
  postedAt: string | null;
  /** Iframe de embed quando a fonte só toca assim (YouTube). Ausente: o player do app. */
  embedUrl?: string;
  /** Episódio da biblioteca ao qual o vídeo está vinculado (sugerido ou confirmado). */
  link?: TelegramItemLinkDto | null;
}

export interface TelegramItemLinkDto {
  titleId: string;
  title: string | null;
  posterUrl: string | null;
  seasonNumber: number;
  episodeNumber: number;
  episodeEnd: number | null;
  status: 'suggested' | 'linked';
  source: 'auto' | 'manual';
  confidence: number | null;
}

export interface TelegramChannelDetailDto extends TelegramChannelDto {
  library: LibraryEntryDto | null;
  items: TelegramItemDto[];
}

/** `fillThumbs`: a página do canal espera as miniaturas que faltam; a tela de reprodução só quer a lista. */
export const getTelegramChannel = (titleId: string, opts: { fillThumbs?: boolean } = {}): Promise<TelegramChannelDetailDto> =>
  fetch(`/api/telegram/channels/${titleId}${opts.fillThumbs ? '?thumbs=fill' : ''}`).then((r) => json<TelegramChannelDetailDto>(r));

export const refreshTelegramChannel = (titleId: string): Promise<{ itemCount: number }> =>
  fetch(`/api/telegram/channels/${titleId}/refresh`, { method: 'POST' }).then((r) => json<{ itemCount: number }>(r));

export interface LoadMoreResultDto {
  added: number;
  total: number;
  exhausted: boolean;
}

/** Lê do Telegram a próxima página de vídeos mais antigos do canal. */
export const loadMoreTelegramHistory = (titleId: string): Promise<LoadMoreResultDto> =>
  fetch(`/api/telegram/channels/${titleId}/load-more`, { method: 'POST' }).then((r) => json<LoadMoreResultDto>(r));

export interface SearchChannelResultDto {
  found: number;
  added: number;
  total: number;
}

/** Busca o texto no canal inteiro (no Telegram) e guarda os achados na lista do canal. */
export const searchTelegramHistory = (titleId: string, q: string): Promise<SearchChannelResultDto> =>
  fetch(`/api/telegram/channels/${titleId}/search`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ q }) }).then((r) =>
    json<SearchChannelResultDto>(r),
  );

export const deleteTelegramChannel = (titleId: string): Promise<void> =>
  fetch(`/api/telegram/channels/${titleId}`, { method: 'DELETE' }).then((res) => {
    if (!res.ok) throw new Error('não foi possível remover o canal');
  });

export const bulkDeleteTelegramChannels = (ids: string[]): Promise<{ removed: number }> =>
  fetch('/api/telegram/channels/bulk-delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids }),
  }).then((r) => json<{ removed: number }>(r));

export interface MyTelegramChannelDto {
  title: string;
  /** `usuario` (público) ou `c/<id>` (privado). */
  handle: string;
  members: number | null;
  kind: 'channel' | 'group';
  added: boolean;
}

export const listMyTelegramChannels = (): Promise<{ channels: MyTelegramChannelDto[] }> =>
  fetch('/api/telegram/my-channels').then((r) => json<{ channels: MyTelegramChannelDto[] }>(r));

export const telegramPlayUrl =(titleId: string, messageId: string): string =>
  `/api/telegram/channels/${titleId}/items/${encodeURIComponent(messageId)}/play`;

export interface TelegramPersonalAccount {
  name: string;
  username: string | null;
}

export interface TelegramSettingsStatus {
  botTokenConfigured: boolean;
  apiCredentialsConfigured: boolean;
  personalConfigured: boolean;
  /** Conta da session pessoal; `null` sem session ou antes da primeira verificação. */
  personalAccount: TelegramPersonalAccount | null;
}

/** `verify` pergunta ao Telegram se a sessão ainda vale (mais lento); sem ele a leitura é só local. */
export const getTelegramSettings = (verify = false): Promise<TelegramSettingsStatus> =>
  fetch(`/api/telegram/settings${verify ? '?verify=1' : ''}`).then((r) => json<TelegramSettingsStatus>(r));

export const saveTelegramSettings = (input: { botToken?: string; apiId?: number; apiHash?: string }): Promise<TelegramSettingsStatus> =>
  fetch('/api/telegram/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) }).then(
    (r) => json<TelegramSettingsStatus>(r),
  );

export type TelegramLoginState =
  | { status: 'idle' }
  | { status: 'pending'; token: string; expires: number }
  | { status: 'need_password'; hint: string }
  | { status: 'success' }
  | { status: 'error'; message: string };

export const startTelegramLogin = (): Promise<{ ok: true }> =>
  fetch('/api/telegram/settings/login/start', { method: 'POST' }).then((r) => json<{ ok: true }>(r));

export const getTelegramLoginStatus = (): Promise<TelegramLoginState> =>
  fetch('/api/telegram/settings/login/status').then((r) => json<TelegramLoginState>(r));

export const submitTelegramLoginPassword = (password: string): Promise<{ ok: true }> =>
  fetch('/api/telegram/settings/login/password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  }).then((r) => json<{ ok: true }>(r));

export const cancelTelegramLogin = (): Promise<{ ok: true }> =>
  fetch('/api/telegram/settings/login/cancel', { method: 'POST' }).then((r) => json<{ ok: true }>(r));

/** Encerra a sessão da conta pessoal (no Telegram e localmente). */
export const logoutTelegram = (): Promise<TelegramSettingsStatus> =>
  fetch('/api/telegram/settings/login/logout', { method: 'POST' }).then((r) => json<TelegramSettingsStatus>(r));


export interface TelegramRecentItemDto extends TelegramItemDto {
  channelId: string;
  channelTitle: string;
  handle: string;
}

export const listRecentTelegramItems = (limit = 12): Promise<{ items: TelegramRecentItemDto[] }> =>
  fetch(`/api/telegram/recent?limit=${limit}`).then((r) => json<{ items: TelegramRecentItemDto[] }>(r));

/** Completa nome, foto e descrição dos canais adicionados só pelo @. */
export const refreshTelegramChannelInfo = (): Promise<{ checked: number; updated: number }> =>
  fetch('/api/telegram/channels/refresh-info', { method: 'POST' }).then((r) => json<{ checked: number; updated: number }>(r));

/** Vínculo de um vídeo do canal com um episódio da biblioteca: sugestão para confirmar, ou confirmado. */
const postLink = (channelId: string, path: string, method: 'POST' | 'DELETE', body?: unknown) =>
  fetch(`/api/telegram/channels/${channelId}/${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }).then((r) => json<unknown>(r));

export const linkTelegramItem = (
  channelId: string,
  messageId: string,
  link: { titleId: string; seasonNumber: number; episodeNumber: number },
): Promise<{ link: TelegramItemLinkDto | null }> =>
  postLink(channelId, `items/${encodeURIComponent(messageId)}/link`, 'POST', link) as Promise<{ link: TelegramItemLinkDto | null }>;

/** "Sem vínculo": o automático respeita essa decisão e não volta a sugerir o vídeo. */
export const unlinkTelegramItem = (channelId: string, messageId: string): Promise<{ link: null }> =>
  postLink(channelId, `items/${encodeURIComponent(messageId)}/link`, 'DELETE') as Promise<{ link: null }>;

export const refreshTelegramLinks = (channelId: string): Promise<{ linked: number; suggested: number; unlinked: number }> =>
  postLink(channelId, 'links/refresh', 'POST') as Promise<{ linked: number; suggested: number; unlinked: number }>;

export const acceptTelegramSuggestions = (channelId: string): Promise<{ accepted: number }> =>
  postLink(channelId, 'links/accept-suggestions', 'POST') as Promise<{ accepted: number }>;
