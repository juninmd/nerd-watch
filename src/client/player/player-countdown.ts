/** Contagem do próximo vídeo da fila (sem timers: quem chama faz um `setInterval` de 1 s e chama `tickCountdown`). */

export const UP_NEXT_SECONDS = 5;

export interface Countdown {
  remaining: number;
  status: 'running' | 'done' | 'cancelled';
}

/** Zero (ou inválido) já começa encerrada: quem chama troca de vídeo na hora. */
export const startCountdown = (seconds: number): Countdown => {
  const remaining = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  return { remaining, status: remaining > 0 ? 'running' : 'done' };
};

export const tickCountdown = (c: Countdown): Countdown => {
  if (c.status !== 'running') return c;
  const remaining = c.remaining - 1;
  return remaining > 0 ? { remaining, status: 'running' } : { remaining: 0, status: 'done' };
};

/** Cancelar só vale enquanto a contagem corre; depois de terminada, o estado não muda. */
export const cancelCountdown = (c: Countdown): Countdown =>
  c.status === 'running' ? { ...c, status: 'cancelled' } : c;
