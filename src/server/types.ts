export type MediaType = 'movie' | 'tv';
export type TitleSource = 'tmdb' | 'archive' | 'telegram';
export type WatchStatus = 'want' | 'watching' | 'watched' | 'dropped';
export type TelegramChannelMode = 'public' | 'personal' | 'bot';

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
  added_at: string;
  updated_at: string;
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
