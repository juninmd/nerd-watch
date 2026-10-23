/** Atraso ou adiantamento da legenda, em milissegundos. Puro: o controlador reescreve os tempos dos cues. */

export const OFFSET_STEP_MS = 100;
export const OFFSET_BIG_STEP_MS = 500;
/** Um minuto de deslocamento já é erro de sincronia, não ajuste fino. */
export const OFFSET_LIMIT_MS = 60_000;

export const nextOffset = (current: number, deltaMs: number): number => {
  const next = Math.round(current + deltaMs);
  return Math.min(OFFSET_LIMIT_MS, Math.max(-OFFSET_LIMIT_MS, next));
};

/**
 * Tempo do cue deslocado: nunca antes de 0 s. Um cue que sai inteiro do início fica com duração zero (some),
 * em vez de ter tempo negativo, que o navegador ignoraria de forma inconsistente.
 */
export const shiftedCue = (start: number, end: number, offsetMs: number): { start: number; end: number } => {
  const offset = offsetMs / 1000;
  const s = Math.max(0, start + offset);
  const e = Math.max(s, end + offset);
  return { start: s, end: e };
};

/** Texto para leitor de tela e para o rótulo: "+0,5 s", "−0,1 s" ou "0 s". */
export const formatOffset = (offsetMs: number): string => {
  if (offsetMs === 0) return '0 s';
  const sign = offsetMs > 0 ? '+' : '−';
  const seconds = (Math.abs(offsetMs) / 1000).toFixed(1).replace('.', ',');
  return `${sign}${seconds} s`;
};
