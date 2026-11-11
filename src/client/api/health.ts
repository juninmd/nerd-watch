import { json } from './http.ts';

export interface HealthResponse {
  ok: boolean;
  tmdbEnabled: boolean;
  openSubtitlesEnabled: boolean;
  torrentEnabled: boolean;
  telegramBotEnabled: boolean;
  /** Algum destino de aviso (webhook, ntfy, Discord, Telegram) está configurado no `.env`. */
  notifyEnabled: boolean;
  notifyLeadDays: number;
  /** O servidor exige ACCESS_TOKEN (então "Sair" faz sentido). */
  accessEnabled: boolean;
}

export const health = (): Promise<HealthResponse> => fetch('/api/health').then((r) => json<HealthResponse>(r));
