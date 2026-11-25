import type { DockItem } from './dock-item.ts';
import { playbackSync } from './playback-service.ts';
import type { ResumeMeta, StoredPosition } from './playback-store.ts';
import { PLAYBACK_CHANGED_EVENT } from './playback-sync.ts';

/** Posições salvas dos vídeos (continuar assistindo). Sem DOM além do aviso de mudança para as telas. */
const store = playbackSync.store;

export const savedPosition = (key: string): StoredPosition | undefined => store.get(key);
export const continueWatching = (limit?: number) => store.inProgress(limit);
/** Só a posição salva some (e o apagamento é sincronizado); o vídeo continua no canal/biblioteca. */
export const removeFromContinueWatching = (key: string): void => store.clear(key);

/** Apaga todas as posições em andamento e avisa as telas (os cards de "continuar" se redesenham). */
export const clearContinueWatching = (): number => {
  const removed = store.clearInProgress();
  if (removed > 0) window.dispatchEvent(new Event(PLAYBACK_CHANGED_EVENT));
  return removed;
};

export const metaOf = (item: DockItem): ResumeMeta => ({
  title: item.title,
  subtitle: item.subtitle,
  poster: item.poster,
  channelId: item.channelId,
  messageId: item.messageId,
  route: item.route,
});
