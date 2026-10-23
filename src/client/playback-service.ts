import { createPlaybackApi } from './playback-api.ts';
import { announceLinkedProgress } from './linked-progress.ts';
import { createPlaybackSync, PLAYBACK_CHANGED_EVENT } from './playback-sync.ts';

/** Armazenamento tolerante: navegador com cookies/dados bloqueados não pode quebrar o player. */
export const storage = {
  getItem: (k: string): string | null => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  setItem: (k: string, v: string): void => {
    try {
      localStorage.setItem(k, v);
    } catch {
      // armazenamento bloqueado
    }
  },
};

/** Cache local + sincronização com o servidor (ver playback-sync.ts). Única instância do app. */
export const playbackSync = createPlaybackSync({
  storage,
  api: createPlaybackApi(),
  onRemoteChange: () => window.dispatchEvent(new Event(PLAYBACK_CHANGED_EVENT)),
  onLinkedProgress: announceLinkedProgress,
});
