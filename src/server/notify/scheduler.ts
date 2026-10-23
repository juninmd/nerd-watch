import { runNotifyTick, type NotifyTickDeps } from './tick.ts';

/** A cada 15 min basta: o aviso é de dia inteiro, e a janela de lead tem pelo menos 1 dia. */
export const NOTIFY_INTERVAL_MS = 15 * 60_000;

export type NotifySchedulerDeps = Omit<NotifyTickDeps, 'attempts' | 'signal'>;

export interface NotifyScheduler {
  /** Para o timer e aborta envios em andamento. Chamar de novo não faz nada. */
  stop(): void;
}

/**
 * Roda `runNotifyTick` já no boot e depois a cada `intervalMs`. Um ciclo não sobrepõe o anterior, e erro num
 * ciclo é só logado: o timer segue. O timer é `unref`, como o do sweeper de torrent, para não segurar o processo.
 */
export const startNotifyScheduler = (deps: NotifySchedulerDeps, intervalMs: number = NOTIFY_INTERVAL_MS): NotifyScheduler => {
  const attempts = new Map<string, number>();
  const controller = new AbortController();
  let running = false;
  let stopped = false;

  const cycle = (): void => {
    if (running || stopped) return;
    running = true;
    runNotifyTick({ ...deps, attempts, signal: controller.signal })
      .catch((err: unknown) => deps.log(`[notify] ciclo interrompido: ${err instanceof Error ? err.name : 'erro'}`))
      .finally(() => {
        running = false;
      });
  };

  const timer = setInterval(cycle, intervalMs);
  timer.unref?.();
  cycle();

  return {
    stop(): void {
      if (stopped) return;
      stopped = true;
      clearInterval(timer);
      controller.abort();
    },
  };
};
