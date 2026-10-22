import { json, type TelegramChannelDto, type TelegramChannelMode } from './api.ts';

export interface SourceFieldDto {
  key: string;
  label: string;
  secret: boolean;
  placeholder: string;
  required: boolean;
  /** Segredos nunca voltam do servidor: só `set`. */
  set: boolean;
  value: string;
}

export interface SourceDto {
  id: string;
  title: string;
  description: string;
  icon: string;
  ownCard: boolean;
  guide?: { summary: string; steps: string[] };
  fields: SourceFieldDto[];
  configured: boolean;
  connected: boolean;
  oauth: boolean;
  redirectUri: string | null;
  add: { mode: TelegramChannelMode; label: string; placeholder: string; hint?: string } | null;
}

export type SourceOAuthStateDto = { configured: boolean; connected: boolean } & ({ status: 'idle' | 'pending' | 'connected' } | { status: 'error'; error: string });

const post = (path: string, body: unknown = {}): Promise<Response> =>
  fetch(`/api/sources${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

export const listSources = (): Promise<SourceDto[]> => fetch('/api/sources').then((r) => json<{ sources: SourceDto[] }>(r)).then((d) => d.sources);

export const saveSourceSettings = (id: string, values: Record<string, string>): Promise<SourceDto> => post(`/${id}/settings`, { values }).then((r) => json<SourceDto>(r));

export const startSourceOAuth = (id: string): Promise<{ authUrl: string }> => post(`/${id}/oauth/start`).then((r) => json<{ authUrl: string }>(r));

export const getSourceOAuthState = (id: string): Promise<SourceOAuthStateDto> => fetch(`/api/sources/${id}/oauth/status`).then((r) => json<SourceOAuthStateDto>(r));

export const disconnectSource = (id: string): Promise<SourceDto> => post(`/${id}/oauth/disconnect`).then((r) => json<SourceDto>(r));

export const addSourceChannel = (mode: TelegramChannelMode, input: string): Promise<TelegramChannelDto> => post(`/${mode}/channels`, { input }).then((r) => json<TelegramChannelDto>(r));
