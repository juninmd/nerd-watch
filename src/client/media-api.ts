import { json } from './api.ts';
import type { MediaPath } from './media-seek.ts';

/** Forma de `GET /api/media/:canal/:item/plan` (sem caminhos do disco). */
export interface PlanDto {
  path: MediaPath;
  reason?: string;
  audio?: 'copy' | 'aac' | 'none';
  deinterlace?: boolean;
  durationSeconds: number | null;
  audioOrdinal: number | null;
  audioTracks: { ordinal: number; codec: string; language: string | null; channels: number }[];
  subtitleTracks: { ordinal: number; codec: string; language: string | null; text: boolean }[];
}

export interface PrepStatus {
  state: 'idle' | 'running' | 'ready' | 'error';
  progress: number;
  error?: string;
}

const base = (channel: string, item: string): string => `/api/media/${encodeURIComponent(channel)}/${encodeURIComponent(item)}`;

export const fetchPlan = async (channel: string, item: string): Promise<PlanDto> => json<PlanDto>(await fetch(`${base(channel, item)}/plan`));

/** `'busy'` quando o servidor está com todos os processos de conversão ocupados (503). */
export const startPrepare = async (channel: string, item: string): Promise<PrepStatus | 'busy'> => {
  const res = await fetch(`${base(channel, item)}/prepare`, { method: 'POST' });
  if (res.status === 503) return 'busy';
  return json<PrepStatus>(res);
};

export const fetchPrepStatus = async (channel: string, item: string): Promise<PrepStatus> => json<PrepStatus>(await fetch(`${base(channel, item)}/status`));

export const preparedFileUrl = (channel: string, item: string): string => `${base(channel, item)}/file`;

export const liveUrl = (channel: string, item: string): string => `${base(channel, item)}/live`;
