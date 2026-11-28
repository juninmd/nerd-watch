import type { WatchStatus } from '../../server/types.ts';

/** Selo do canto do pôster: o que pede ação vem antes do status (novidade > continuar). Sem DOM. */
export type PosterFlag = { kind: 'new' | 'continue'; label: string };

export const posterFlag = (status: WatchStatus | undefined, newEpisodes = 0): PosterFlag | null => {
  if (newEpisodes > 0) return { kind: 'new', label: newEpisodes === 1 ? '1 ep. novo' : `${newEpisodes} ep. novos` };
  if (status === 'watching') return { kind: 'continue', label: 'continuar' };
  return null;
};

/** Nota de 0 a 10 com uma casa ("7.8"); zero ou ausente é "sem nota" e não vira selo. */
export const scoreLabel = (score: number | null | undefined): string | null =>
  typeof score === 'number' && Number.isFinite(score) && score > 0 ? (Math.round(Math.min(score, 10) * 10) / 10).toFixed(1) : null;
