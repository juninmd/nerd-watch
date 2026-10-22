import { json, type TelegramChannelDto } from './api.ts';

export interface DriveStatusDto {
  clientConfigured: boolean;
  connected: boolean;
}

export type DriveOAuthStateDto = DriveStatusDto & ({ status: 'idle' | 'pending' | 'connected' } | { status: 'error'; error: string });

const post = (path: string, body: unknown = {}): Promise<Response> =>
  fetch(`/api/drive${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

export const getDriveStatus = (): Promise<DriveStatusDto> => fetch('/api/drive').then((r) => json<DriveStatusDto>(r));

export const saveDriveSettings = (settings: { clientId?: string; clientSecret?: string }): Promise<DriveStatusDto> =>
  post('/settings', settings).then((r) => json<DriveStatusDto>(r));

export const startDriveOAuth = (): Promise<{ authUrl: string }> => post('/oauth/start').then((r) => json<{ authUrl: string }>(r));

export const getDriveOAuthState = (): Promise<DriveOAuthStateDto> => fetch('/api/drive/oauth/status').then((r) => json<DriveOAuthStateDto>(r));

export const disconnectDrive = (): Promise<DriveStatusDto> => post('/logout').then((r) => json<DriveStatusDto>(r));

export const addDriveFolder = (folder: string): Promise<TelegramChannelDto> => post('/folders', { folder }).then((r) => json<TelegramChannelDto>(r));
