import { json } from './http.ts';

export type SkipKind = 'intro' | 'recap' | 'credits';
export interface SkipSegmentDto {
  kind: SkipKind;
  start: number;
  end: number;
}

export interface SkipTimesQuery {
  imdbId?: string;
  tmdbId?: number;
  mediaType?: 'movie' | 'tv';
  season?: number;
  episode?: number;
  title?: string;
  duration?: number;
}

/** Abertura, recapitulação e créditos (IntroDB/AniSkip, resolvidos no servidor). */
export const getSkipTimes = (q: SkipTimesQuery): Promise<SkipSegmentDto[]> => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== '') p.set(k, String(v));
  return fetch(`/api/skip-times?${p}`)
    .then((r) => json<{ segments: SkipSegmentDto[] }>(r))
    .then((d) => d.segments);
};
