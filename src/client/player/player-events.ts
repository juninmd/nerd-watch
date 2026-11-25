import { useSyncExternalStore } from 'react';

/** Avisos do player global para as telas (troca de vídeo ou de modo, fim da fila). */
const listeners = new Set<() => void>();
const endedListeners = new Set<() => void>();
let version = 0;

export const emitPlayer = (): void => {
  version += 1;
  for (const fn of listeners) fn();
};

export const emitEnded = (): void => {
  for (const fn of endedListeners) fn();
};

/** Avisa quando o vídeo atual ou o modo mudam (a tela de reprodução atualiza título e lista). */
export const subscribePlayer = (fn: () => void): (() => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

/** Avisa quando o último vídeo da fila termina. */
export const subscribeEnded = (fn: () => void): (() => void) => {
  endedListeners.add(fn);
  return () => endedListeners.delete(fn);
};

/** Redesenha quando o vídeo atual ou o modo mudam (não a cada `timeupdate`, como `usePlayerUi`). */
export const usePlayerChange = (): number =>
  useSyncExternalStore(
    subscribePlayer,
    () => version,
    () => version,
  );
