import type { SkipKind, SkipSegmentDto } from '../api/skip-times.ts';

/**
 * Trechos do vídeo tocando agora, lidos pela barra do player (botão "Pular" e marcas na linha do tempo).
 * Quem sabe o que está tocando (a tela do episódio) grava; trocar de vídeo limpa. Lógica sem DOM.
 */
let current: SkipSegmentDto[] = [];
const listeners = new Set<() => void>();

export const setSkipSegments = (list: SkipSegmentDto[]): void => {
  current = list;
  for (const fn of listeners) fn();
};
export const getSkipSegments = (): SkipSegmentDto[] => current;
export const subscribeSkipSegments = (fn: () => void): (() => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

/** O botão some no último segundo do trecho: pular ali não ganha nada e o botão piscaria. */
export const activeSegment = (list: SkipSegmentDto[], t: number): SkipSegmentDto | null =>
  list.find((s) => t >= s.start && t < s.end - 1) ?? null;

export const SKIP_LABEL: Record<SkipKind, string> = {
  intro: 'Pular abertura',
  recap: 'Pular recapitulação',
  credits: 'Pular créditos',
};

/** Início dos créditos finais (só os que ficam no último terço: créditos de abertura não contam). */
export const creditsStart = (list: SkipSegmentDto[], duration: number): number | null => {
  const c = list.find((s) => s.kind === 'credits' && (!duration || s.start >= duration * (2 / 3)));
  return c ? c.start : null;
};
