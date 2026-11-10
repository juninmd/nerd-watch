import { isFinished, type StoredPosition } from './playback-store.ts';

/**
 * Pergunta "retomar ou começar do início?" antes de pular para um ponto já assistido. Abaixo do mínimo a
 * retomada segue automática, como antes: perguntar por dois minutos seria ruído. Puro, para ser testável.
 */

/** Posição mínima para a pergunta aparecer; menos que isso retoma sem perguntar. */
export const PROMPT_MIN_SECONDS = 120;

/** Formato curto para o botão: "1:02:05" ou "4:07". */
export const formatResumeTime = (seconds: number): string => {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
};

/** Ponto para oferecer, ou null quando não há pergunta a fazer (sem posição, pouco assistido ou já terminado). */
export const resumePromptFor = (p: StoredPosition | undefined): { seconds: number } | null => {
  if (!p || p.seconds < PROMPT_MIN_SECONDS) return null;
  if (isFinished(p.seconds, p.duration)) return null;
  return { seconds: Math.floor(p.seconds) };
};

/** Textos dos dois botões, prontos para o DOM. */
export const resumePromptLabels = (seconds: number): { resume: string; start: string } => ({
  resume: `Retomar de ${formatResumeTime(seconds)}`,
  start: 'Começar do início',
});
