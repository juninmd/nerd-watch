import { json } from './http.ts';

export interface LanInterfaceDto {
  name: string;
  address: string;
  score: number;
}

export interface CastDeviceDto {
  id: string;
  name: string;
  manufacturer: string;
  model: string;
  host: string;
}

export interface CastDiscoverResponse {
  interfaces: LanInterfaceDto[];
  defaultHost: string | null;
  devices: CastDeviceDto[];
}

export interface CastSessionDto {
  id: string;
  title: string;
  subtitle: string;
  host: string;
  port: number;
  watchUrl: string;
  mediaUrl: string;
  subtitleUrl: string | null;
  qrDataUrl: string;
  device: CastDeviceDto | null;
  createdAt: number;
}

export type DlnaTransportState = 'PLAYING' | 'PAUSED_PLAYBACK' | 'STOPPED' | 'TRANSITIONING' | 'NO_MEDIA_PRESENT' | 'UNKNOWN';

export interface CastPlaybackDto {
  state: DlnaTransportState;
  positionSeconds: number | null;
  durationSeconds: number | null;
}

export interface StartCastPayload {
  src: string;
  title: string;
  subtitle?: string;
  poster?: string | null;
  subtitleVtt?: string | null;
  startAt?: number;
  host?: string;
  deviceId?: string;
}

export type CastControlPayload =
  | { action: 'play' }
  | { action: 'pause' }
  | { action: 'stop' }
  | { action: 'seek'; seconds: number };

export const discoverCastDevices = (): Promise<CastDiscoverResponse> =>
  fetch('/api/cast/devices').then((r) => json<CastDiscoverResponse>(r));

export const startCastSession = (payload: StartCastPayload): Promise<{ session: CastSessionDto }> =>
  fetch('/api/cast/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).then((r) => json<{ session: CastSessionDto }>(r));

export const getCastSession = (id: string): Promise<{ session: CastSessionDto; playback: CastPlaybackDto | null }> =>
  fetch(`/api/cast/sessions/${encodeURIComponent(id)}`).then((r) =>
    json<{ session: CastSessionDto; playback: CastPlaybackDto | null }>(r),
  );

export const controlCastSession = (
  id: string,
  payload: CastControlPayload,
): Promise<{ ok: true; playback: CastPlaybackDto | null }> =>
  fetch(`/api/cast/sessions/${encodeURIComponent(id)}/control`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).then((r) => json<{ ok: true; playback: CastPlaybackDto | null }>(r));

export const stopCastSession = (id: string): Promise<{ ok: true }> =>
  fetch(`/api/cast/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' }).then((r) => json<{ ok: true }>(r));
