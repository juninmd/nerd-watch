import type { WatchStatus } from '../server/types.ts';

/** Fontes de catálogo com página de detalhe própria. Telegram tem outra rota (canais). */
export type CatalogSource = 'tmdb' | 'archive' | 'tvmaze' | 'anilist';

export const json = async <T>(res: Response): Promise<T> => {
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error ?? `erro ${res.status}`);
  }
  return res.json() as Promise<T>;
};

export interface SearchResultDto {
  source: CatalogSource;
  sourceId: string;
  mediaType: 'movie' | 'tv';
  title: string;
  overview: string;
  posterUrl: string | null;
  releaseDate: string | null;
  voteAverage: number | null;
}

export interface SearchResponse {
  results: SearchResultDto[];
  tmdbEnabled: boolean;
}

export const search = (q: string): Promise<SearchResponse> =>
  fetch(`/api/search?q=${encodeURIComponent(q)}`).then((r) => json<SearchResponse>(r));

export interface TmdbDetailDto {
  titleId: string;
  title: string;
  overview: string;
  posterUrl: string | null;
  backdropUrl: string | null;
  releaseDate: string | null;
  voteAverage: number;
  status: string;
  trailerKey: string | null;
  seasons: Array<{
    seasonNumber: number;
    name: string;
    overview: string;
    airDate: string | null;
    posterUrl: string | null;
    episodeCount: number;
  }>;
  watchProviders: {
    link: string | null;
    flatrate: Array<{ name: string; logoUrl: string | null }>;
    rent: Array<{ name: string; logoUrl: string | null }>;
    buy: Array<{ name: string; logoUrl: string | null }>;
  };
  library: LibraryEntryDto | null;
}

export interface LibraryEntryDto {
  id: string;
  title_id: string;
  watch_status: WatchStatus;
  rating: number | null;
  notes: string | null;
  current_season: number | null;
  current_episode: number | null;
  added_at: string;
  updated_at: string;
}

export const getTmdbTitle = (mediaType: 'movie' | 'tv', id: string): Promise<TmdbDetailDto> =>
  fetch(`/api/tmdb/${mediaType}/${id}`).then((r) => json<TmdbDetailDto>(r));

export interface EpisodeDto {
  episodeNumber: number;
  name: string;
  overview: string;
  airDate: string | null;
  runtime: number | null;
  stillUrl: string | null;
}

export interface SeasonResponse {
  episodes: EpisodeDto[];
}

export const getTmdbSeason = (id: string, seasonNumber: number): Promise<SeasonResponse> =>
  fetch(`/api/tmdb/tv/${id}/season/${seasonNumber}`).then((r) => json<SeasonResponse>(r));

export interface ArchiveDetailDto {
  titleId: string;
  identifier: string;
  title: string;
  overview: string;
  year: string | null;
  posterUrl: string;
  embedUrl: string;
  torrentUrl: string;
  detailsUrl: string;
  subtitleUrl: string | null;
  /** `false` quando o item só tem .ogv/.avi/.mkv — aí não faz sentido oferecer o player P2P. */
  hasPlayableVideo?: boolean;
  /** Arquivo MP4/WebM para o player do app; nulo quando só o embed da Archive serve. */
  directVideoUrl?: string | null;
  library: LibraryEntryDto | null;
}

export const getArchiveTitle = (identifier: string): Promise<ArchiveDetailDto> =>
  fetch(`/api/archive/${identifier}`).then((r) => json<ArchiveDetailDto>(r));

export interface AttributionDto {
  name: string;
  url: string;
  license?: string;
}

export interface TvmazeEpisodeDto {
  episodeNumber: number;
  name: string;
  airDate: string | null;
  runtime: number | null;
  overview: string | null;
  stillUrl: string | null;
}

export interface TvmazeDetailDto {
  titleId: string;
  sourceId: string;
  title: string;
  overview: string | null;
  posterUrl: string | null;
  premiered: string | null;
  ended: string | null;
  status: string | null;
  voteAverage: number | null;
  pageUrl: string | null;
  officialUrl: string | null;
  attribution: AttributionDto;
  seasons: Array<{ seasonNumber: number; name: string; episodes: TvmazeEpisodeDto[] }>;
  library: LibraryEntryDto | null;
}

export const getTvmazeTitle = (id: string): Promise<TvmazeDetailDto> => fetch(`/api/tvmaze/${id}`).then((r) => json<TvmazeDetailDto>(r));

export interface AnilistDetailDto {
  titleId: string;
  sourceId: string;
  mediaType: 'movie' | 'tv';
  title: string;
  romaji: string | null;
  english: string | null;
  native: string | null;
  format: string | null;
  status: string | null;
  year: string | null;
  overview: string | null;
  posterUrl: string | null;
  voteAverage: number | null;
  episodes: number | null;
  pageUrl: string | null;
  nextEpisode: { episode: number; airDate: string } | null;
  attribution: AttributionDto;
  library: LibraryEntryDto | null;
}

export const getAnilistTitle = (id: string): Promise<AnilistDetailDto> => fetch(`/api/anilist/${id}`).then((r) => json<AnilistDetailDto>(r));

export interface ArchiveMovieDto {
  identifier: string;
  title: string;
  overview: string;
  year: string | null;
  thumbnailUrl: string;
  embedUrl: string;
  torrentUrl: string;
  detailsUrl: string;
}

export interface ArchiveSearchResponse {
  results: ArchiveMovieDto[];
}

export const searchArchive = (q = ''): Promise<ArchiveSearchResponse> =>
  fetch(`/api/archive/search?q=${encodeURIComponent(q)}`).then((r) => json<ArchiveSearchResponse>(r));

export interface LibraryItemDto {
  id: string;
  titleId: string;
  watchStatus: WatchStatus;
  rating: number | null;
  notes: string | null;
  currentSeason: number | null;
  currentEpisode: number | null;
  addedAt: string;
  updatedAt: string;
  title: {
    id: string;
    sourceId: string;
    source: CatalogSource | 'telegram';
    mediaType: 'movie' | 'tv';
    title: string;
    posterUrl: string | null;
    releaseDate: string | null;
    voteAverage: number | null;
  };
}

export interface LibraryListResponse {
  items: LibraryItemDto[];
}

export const listLibrary = (status?: WatchStatus): Promise<LibraryListResponse> =>
  fetch(`/api/library${status ? `?status=${status}` : ''}`).then((r) => json<LibraryListResponse>(r));

export interface AddToLibraryInput {
  source: CatalogSource;
  sourceId: string;
  mediaType: 'movie' | 'tv';
  title: string;
  overview?: string;
  posterPath?: string | null;
  backdropPath?: string | null;
  releaseDate?: string | null;
  voteAverage?: number | null;
  watchStatus?: WatchStatus;
}

export const addToLibrary = (input: AddToLibraryInput): Promise<LibraryItemDto> =>
  fetch('/api/library', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) }).then((r) =>
    json<LibraryItemDto>(r),
  );

export interface UpNextItemDto {
  titleId: string;
  title: { sourceId: string; source: CatalogSource | 'telegram'; mediaType: 'movie' | 'tv'; title: string; posterUrl: string | null };
  seasonNumber: number;
  episodeNumber: number;
  episodeName: string;
  runtime: number | null;
  activityAt: string;
}

export const listUpNext = (limit = 12): Promise<{ items: UpNextItemDto[] }> =>
  fetch(`/api/library/up-next?limit=${limit}`).then((r) => json<{ items: UpNextItemDto[] }>(r));

export interface PatchLibraryInput {
  watchStatus?: WatchStatus;
  rating?: number | null;
  notes?: string | null;
  currentSeason?: number | null;
  currentEpisode?: number | null;
}

export const patchLibrary = (titleId: string, patch: PatchLibraryInput): Promise<LibraryItemDto> =>
  fetch(`/api/library/${titleId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) }).then(
    (r) => json<LibraryItemDto>(r),
  );

export const removeFromLibrary = (entryId: string): Promise<void> =>
  fetch(`/api/library/${entryId}`, { method: 'DELETE' }).then((res) => {
    if (!res.ok) throw new Error('falha ao remover');
  });

export interface CalendarEntryDto {
  kind: 'episode' | 'movie';
  titleId: string;
  titleSource: CatalogSource;
  titleSourceId: string;
  titleName: string;
  mediaType: 'movie' | 'tv';
  posterUrl: string | null;
  date: string;
  seasonNumber: number | null;
  episodeNumber: number | null;
  episodeName: string | null;
}

export interface CalendarResponse {
  entries: CalendarEntryDto[];
}

export const getCalendar = (days = 60): Promise<CalendarResponse> =>
  fetch(`/api/calendar?days=${days}`).then((r) => json<CalendarResponse>(r));

export interface HealthResponse {
  ok: boolean;
  tmdbEnabled: boolean;
  openSubtitlesEnabled: boolean;
  torrentEnabled: boolean;
  telegramBotEnabled: boolean;
}

export const health = (): Promise<HealthResponse> => fetch('/api/health').then((r) => json<HealthResponse>(r));

/** Arquivo de vídeo tocável dentro do torrent, já ordenado pelo servidor (mais leve primeiro). */
export interface TorrentFileDto {
  index: number;
  name: string;
  length: number;
  preference: number;
  label: string;
}

export interface TorrentOpenResponse {
  infoHash: string;
  identifier: string;
  name: string;
  totalLength: number;
  videoFiles: TorrentFileDto[];
  selected: TorrentFileDto;
  streamUrl: string;
}

export const openTorrent = (identifier: string, fileIndex?: number): Promise<TorrentOpenResponse> =>
  fetch('/api/torrent/open', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(fileIndex === undefined ? { identifier } : { identifier, fileIndex }),
  }).then((r) => json<TorrentOpenResponse>(r));

export interface TorrentStatusDto {
  infoHash: string;
  identifier: string;
  name: string;
  selectedFile: string;
  progress: number;
  downloadSpeed: number;
  numPeers: number;
  downloaded: number;
  totalLength: number;
  streamUrl: string;
}

export const getTorrentStatus = (infoHash: string): Promise<TorrentStatusDto> =>
  fetch(`/api/torrent/${encodeURIComponent(infoHash)}`).then((r) => json<TorrentStatusDto>(r));

export const closeTorrent = (infoHash: string): Promise<{ ok: true }> =>
  fetch(`/api/torrent/${encodeURIComponent(infoHash)}`, { method: 'DELETE' }).then((r) => json<{ ok: true }>(r));

/** Uma legenda, venha de addon (URL direta) ou da OpenSubtitles (precisa de POST). */
export interface SubtitleResultDto {
  source: string;
  id: string;
  languageCode: string;
  language: string;
  release: string;
  downloads: number | null;
  directUrl?: string;
  fileId?: number;
}

export interface SubtitleSearchResponse {
  enabled: boolean;
  /** Por que está desabilitado: sem fonte configurada, ou sem id do IMDb para as fontes. */
  reason?: 'no_sources' | 'no_imdb_id';
  /** Id do IMDb do título — devolvido pelo servidor para o download não precisar traduzir de novo. */
  imdbId: string | null;
  sources: string[];
  unavailable: string[];
  results: SubtitleResultDto[];
}

export interface SubtitleSearchInput {
  query?: string;
  tmdbId?: number;
  mediaType?: 'movie' | 'tv';
  imdbId?: string;
  season?: number | null;
  episode?: number | null;
}

export const searchSubtitles = (opts: SubtitleSearchInput): Promise<SubtitleSearchResponse> => {
  const params = new URLSearchParams();
  if (opts.query) params.set('query', opts.query);
  if (opts.tmdbId) params.set('tmdbId', String(opts.tmdbId));
  if (opts.mediaType) params.set('mediaType', opts.mediaType);
  if (opts.imdbId) params.set('imdbId', opts.imdbId);
  if (opts.season) params.set('season', String(opts.season));
  if (opts.episode) params.set('episode', String(opts.episode));
  return fetch(`/api/subtitles?${params}`).then((r) => json<SubtitleSearchResponse>(r));
};

export type SubtitleDownloadInput =
  | { fileId: number }
  | {
      source: string;
      id: string;
      imdbId?: string;
      tmdbId?: number;
      mediaType?: 'movie' | 'tv';
      season?: number | null;
      episode?: number | null;
    };

export const downloadSubtitle = (input: SubtitleDownloadInput): Promise<{ url: string; remaining?: number }> =>
  fetch('/api/subtitles/download', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  }).then((r) => json<{ url: string; remaining?: number }>(r));

export const exportBackup = (): Promise<unknown> => fetch('/api/backup').then((r) => json<unknown>(r));

export interface ImportBackupResponse {
  imported: { titles: number; seasons: number; episodes: number; libraryEntries: number };
}

export const importBackup = (data: unknown): Promise<ImportBackupResponse> =>
  fetch('/api/backup/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  }).then((r) => json<ImportBackupResponse>(r));

export type TelegramChannelMode = 'public' | 'personal' | 'bot' | 'drive' | 'local' | 'webdav' | 'dropbox' | 'onedrive' | 'jellyfin' | 'plex' | 'peertube' | 's3' | 'youtube' | 'torrent';

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

export interface TelegramSettingsStatus {
  botTokenConfigured: boolean;
  apiCredentialsConfigured: boolean;
  personalConfigured: boolean;
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

export type BulkLibraryInput = { titleIds: string[]; action: 'remove' } | { titleIds: string[]; action: 'status'; watchStatus: WatchStatus };

export const bulkLibrary = (input: BulkLibraryInput): Promise<{ affected: number }> =>
  fetch('/api/library/bulk', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) }).then((r) =>
    json<{ affected: number }>(r),
  );

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
