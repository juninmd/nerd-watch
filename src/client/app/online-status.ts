import { useSyncExternalStore } from 'react';

/** `navigator.onLine` como store: a faixa offline e a tela de erro reagem quando a rede cai ou volta. */
const subscribe = (fn: () => void): (() => void) => {
  window.addEventListener('online', fn);
  window.addEventListener('offline', fn);
  return () => {
    window.removeEventListener('online', fn);
    window.removeEventListener('offline', fn);
  };
};

const snapshot = (): boolean => (typeof navigator === 'undefined' ? true : navigator.onLine);

export const useOnline = (): boolean => useSyncExternalStore(subscribe, snapshot, () => true);
