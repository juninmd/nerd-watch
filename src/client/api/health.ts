import { json } from './http.ts';

export interface HealthResponse {
  ok: boolean;
  /** Versão do app (package.json). Ausente em servidor antigo. */
  version?: string;
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

export interface SourceProbeDto {
  id: string;
  label: string;
  ok: boolean;
  ms: number | null;
}

export const healthSources = (): Promise<{ sources: SourceProbeDto[] }> => fetch('/api/health/sources').then((r) => json<{ sources: SourceProbeDto[] }>(r));
