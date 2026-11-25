import { MAX_START_SECONDS } from '../app/deep-link.ts';
import type { DockItem } from './dock-item.ts';
import { isFinished, resolveStart, resumePoint, type StoredPosition } from './playback-store.ts';

/** `startAt` vem de um link (`?t=`): vale como ponto de partida, mas só se for um segundo plausível. */
export const validStart = (seconds: number | null | undefined): number | null =>
  typeof seconds === 'number' && Number.isFinite(seconds) && seconds >= 0 && seconds <= MAX_START_SECONDS
    ? Math.floor(seconds)
    : null;

/**
 * Ponto de partida de um item: posição salva, `t` pedido (assistido, perto do fim ou fora do vídeo já resolvidos) e a
 * melhor duração conhecida (a do catálogo, a salva ou a do `<video>` aberto).
 */
export const resumeFor = (
  item: DockItem,
  entry: StoredPosition | undefined,
  requested: number | null,
  liveDuration: number | null = null,
): { saved: number | null; resumeAt: number | null; linkAt: number | null } => {
  const saved = resumePoint(entry);
  const duration = item.durationSeconds ?? entry?.duration ?? liveDuration;
  return { saved, ...resolveStart({ saved, done: entry?.done === true, requested, duration }) };
};

/** Duração do `<video>` só quando é um número de verdade (sem metadata vem NaN; ao vivo, Infinity). */
export const finiteDuration = (el: HTMLVideoElement | null): number | null =>
  el && Number.isFinite(el.duration) ? el.duration : null;

/** Metadata chegou: aplica o ponto de partida com a duração real em mãos. */
export const seekOnMetadata = (
  el: HTMLVideoElement,
  resumeAt: number | null,
  saved: number | null,
  linkAt: number | null,
): void => {
  if (resumeAt === null) return;
  // Duração só descoberta agora: não deixa um `t` fora do vídeo cair no início e apagar o progresso.
  if (Number.isFinite(el.duration) && resumeAt >= el.duration) {
    if (saved !== null && saved < el.duration) el.currentTime = saved;
    return;
  }
  // Um `t` colado no fim não pode marcar como assistido só por abrir: nesse caso volta ao ponto salvo.
  const linkNearEnd = linkAt !== null && resumeAt === linkAt && isFinished(resumeAt, el.duration);
  el.currentTime = linkNearEnd ? (saved !== null && saved < el.duration ? saved : 0) : resumeAt;
};
