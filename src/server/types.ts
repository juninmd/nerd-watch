export type MediaType = 'movie' | 'tv';
export type TitleSource = 'tmdb' | 'archive' | 'telegram' | 'tvmaze' | 'anilist';
export type WatchStatus = 'want' | 'watching' | 'watched' | 'dropped';
export const WATCH_STATUSES: WatchStatus[] = ['want', 'watching', 'watched', 'dropped'];
/** Telegram + as fontes de arquivo (cada uma é um `FileSource`, ver providers/sources). A lista também vira o CHECK do banco. */
export const TELEGRAM_CHANNEL_MODES = ['public', 'personal', 'bot', 'drive', 'local', 'webdav', 'dropbox', 'onedrive', 'jellyfin', 'plex', 'peertube', 's3', 'youtube', 'torrent'] as const;
export type TelegramChannelMode = (typeof TELEGRAM_CHANNEL_MODES)[number];

export interface TitleRow {
  id: string;
  source: TitleSource;
  source_id: string;
  media_type: MediaType;
  title: string;
  original_title: string | null;
  overview: string | null;
  poster_path: string | null;
  backdrop_path: string | null;
  release_date: string | null;
  vote_average: number | null;
  created_at: string;
  /** Status da série na TMDB ("Returning Series", "Ended"…); guia a frequência do refresh automático. */
  metadata_status: string | null;
  /** Instante (ISO) do último refresh de metadados bem-sucedido; nulo = nunca atualizado. */
  metadata_refreshed_at: string | null;
}

export interface SeasonRow {
  id: string;
  title_id: string;
  season_number: number;
  name: string;
  overview: string | null;
  air_date: string | null;
  poster_path: string | null;
}

export interface EpisodeRow {
  id: string;
  season_id: string;
  episode_number: number;
  name: string;
  overview: string | null;
  air_date: string | null;
  runtime: number | null;
  still_path: string | null;
}

export interface LibraryEntryRow {
  id: string;
  title_id: string;
  watch_status: WatchStatus;
  rating: number | null;
  notes: string | null;
  current_season: number | null;
  current_episode: number | null;
  rewatch_count: number;
  added_at: string;
  updated_at: string;
}

export const LIBRARY_HISTORY_KINDS = ['added', 'started', 'finished', 'dropped', 'rewatch_started', 'status_changed', 'progress'] as const;
export type LibraryHistoryKind = (typeof LIBRARY_HISTORY_KINDS)[number];

export interface LibraryHistoryRow {
  id: string;
  title_id: string;
  kind: LibraryHistoryKind;
  at: string;
  detail: string | null;
}

export interface TelegramChannelRow {
  id: string;
  mode: TelegramChannelMode;
  handle: string;
  cursor: string | null;
  created_at: string;
}

export interface TelegramItemRow {
  id: string;
  channel_id: string;
  message_id: string;
  caption: string | null;
  duration_seconds: number | null;
  thumbnail_url: string | null;
  posted_at: string | null;
  file_ref: string | null;
}

export interface SearchResult {
  source: TitleSource;
  sourceId: string;
  mediaType: MediaType;
  title: string;
  overview: string;
  posterUrl: string | null;
  releaseDate: string | null;
  voteAverage: number | null;
}
