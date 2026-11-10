import { json } from './http.ts';

export interface HealthResponse {
  ok: boolean;
  tmdbEnabled: boolean;
  openSubtitlesEnabled: boolean;
  torrentEnabled: boolean;
  telegramBotEnabled: boolean;
}

export const health = (): Promise<HealthResponse> => fetch('/api/health').then((r) => json<HealthResponse>(r));
