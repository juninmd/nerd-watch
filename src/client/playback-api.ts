import type { RemotePosition } from './playback-merge.ts';
import type { StoredPosition } from './playback-store.ts';

/** Vídeo de canal vinculado que avançou "Onde parei" ao ser assistido (ver telegram-link-progress no servidor). */
export interface LinkedProgressDto {
  titleId: string;
  seasonNumber: number;
  episodeNumber: number;
  changed: boolean;
  previous: { watchStatus: 'want' | 'watching' | 'watched' | 'dropped'; currentSeason: number | null; currentEpisode: number | null } | null;
  entryId: string | null;
}

export interface PlaybackApi {
  list(offset: number, limit: number): Promise<RemotePosition[]>;
  put(key: string, position: StoredPosition, opts?: { keepalive?: boolean }): Promise<LinkedProgressDto | null>;
  remove(key: string, opts?: { keepalive?: boolean }): Promise<void>;
}

export class PlaybackApiError extends Error {
  constructor(readonly status: number) {
    super(`progresso: resposta ${status}`);
  }
}

/** 4xx (exceto 429) significa que o servidor recusou o dado: insistir não muda nada. Rede e 5xx voltam a tentar. */
export const isPermanentError = (err: unknown): boolean =>
  err instanceof PlaybackApiError && err.status >= 400 && err.status < 500 && err.status !== 429;

const check = (res: Response): Response => {
  if (!res.ok) throw new PlaybackApiError(res.status);
  return res;
};

/** Corpo sem `progress` (o caso comum) ou ilegível vira null: a gravação continua valendo. */
const readLinkedProgress = async (res: Response): Promise<LinkedProgressDto | null> => {
  try {
    const body = (await res.json()) as { progress?: LinkedProgressDto | null };
    return body.progress ?? null;
  } catch {
    return null;
  }
};

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export const createPlaybackApi = (fetchFn: FetchLike = (input, init) => fetch(input, init)): PlaybackApi => ({
  async list(offset, limit) {
    const res = check(await fetchFn(`/api/playback?offset=${offset}&limit=${limit}`));
    const data = (await res.json()) as { entries?: unknown };
    if (!Array.isArray(data.entries)) throw new PlaybackApiError(res.status);
    return data.entries as RemotePosition[];
  },
  async put(key, p, opts) {
    const body = JSON.stringify({ seconds: p.seconds, duration: p.duration, at: p.at, done: p.done === true, meta: p.meta ?? null });
    const res = check(
      await fetchFn(`/api/playback/${encodeURIComponent(key)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body,
        keepalive: opts?.keepalive,
      }),
    );
    return readLinkedProgress(res);
  },
  async remove(key, opts) {
    check(await fetchFn(`/api/playback/${encodeURIComponent(key)}`, { method: 'DELETE', keepalive: opts?.keepalive }));
  },
});
