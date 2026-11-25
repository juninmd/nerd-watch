import { useSyncExternalStore } from 'react';

/**
 * Sinal de repintura dos controles do player. O estado de verdade continua no `<video>` e em player-dock.ts; os
 * componentes só precisam saber que algo mudou (tempo, play/pausa, velocidade, modo) para ler de novo.
 */
let version = 0;
const listeners = new Set<() => void>();

export const bumpPlayerUi = (): void => {
  version += 1;
  for (const fn of listeners) fn();
};

const subscribe = (fn: () => void): (() => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

/** Redesenha o componente a cada mudança do player; devolve a versão (útil como dependência de efeito). */
export const usePlayerUi = (): number =>
  useSyncExternalStore(
    subscribe,
    () => version,
    () => version,
  );
