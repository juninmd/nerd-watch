import { SEEK_SECONDS, seekTarget } from './player-seek.ts';

/** Estado da Media Session (barra da tela de bloqueio) e erros de reprodução. Sem DOM: testável. */

export interface PositionInput {
  duration: number;
  currentTime: number;
  playbackRate: number;
}

export interface PositionState {
  duration: number;
  position: number;
  playbackRate: number;
}

/** Ao vivo (duração infinita) ou sem metadados não há barra: null. `setPositionState` lança se position > duration. */
export const positionState = (v: PositionInput): PositionState | null => {
  if (!Number.isFinite(v.duration) || v.duration <= 0) return null;
  const position = Number.isFinite(v.currentTime) ? Math.min(v.duration, Math.max(0, v.currentTime)) : 0;
  const playbackRate = v.playbackRate > 0 && Number.isFinite(v.playbackRate) ? v.playbackRate : 1;
  return { duration: v.duration, position, playbackRate };
};

/** seekbackward/seekforward: o sistema pode pedir um deslocamento próprio; sem ele (ou inválido), 10 s. */
export const sessionSeekTarget = (
  action: 'seekbackward' | 'seekforward',
  offset: number | undefined,
  current: number,
  duration: number,
): number | null => {
  const seconds = offset !== undefined && Number.isFinite(offset) && offset > 0 ? offset : SEEK_SECONDS;
  return seekTarget(current, action === 'seekbackward' ? -seconds : seconds, duration);
};

/** seekto: tempo absoluto pedido pelo sistema, limitado ao vídeo. */
export const seekToTarget = (seekTime: number | undefined, duration: number): number | null => {
  if (seekTime === undefined || !Number.isFinite(seekTime)) return null;
  return seekTarget(seekTime, 0, duration);
};

/**
 * `play()` rejeitado com NotAllowedError é o bloqueio de autoplay: precisa de um toque do usuário. Outros erros
 * (AbortError quando outro `src` entra no meio, NotSupportedError quando o formato não toca) têm tratamento próprio.
 */
export const isAutoplayBlocked = (err: unknown): boolean =>
  typeof err === 'object' && err !== null && (err as { name?: unknown }).name === 'NotAllowedError';
