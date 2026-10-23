import { storage } from '../playback-service.ts';
import { isValidSpeed, parseSpeed } from '../player-seek.ts';

/** Preferências do player por navegador. O `storage` do app já tolera armazenamento bloqueado (try/catch). */

const SPEED_KEY = 'nw.player.speed';
const AUTOPLAY_KEY = 'nw.player.autoplay';
const ORDER_KEY = 'nw.player.order';

/** Ordem em que o canal é listado e enfileirado: do mais recente ao mais antigo (padrão) ou o contrário. */
export type QueueOrder = 'newest' | 'oldest';
export const getQueueOrder = (): QueueOrder => (storage.getItem(ORDER_KEY) === 'oldest' ? 'oldest' : 'newest');
export const setQueueOrder = (order: QueueOrder): void => storage.setItem(ORDER_KEY, order);
export const getAutoplay = (): boolean => storage.getItem(AUTOPLAY_KEY) !== '0';
export const setAutoplay = (on: boolean): void => storage.setItem(AUTOPLAY_KEY, on ? '1' : '0');

export const getStoredSpeed = (): number => parseSpeed(storage.getItem(SPEED_KEY));

/** Só grava valores dentro de 0,5x–2x: a velocidade 0,25x do menu nativo fica só na sessão atual. */
export const storeSpeed = (rate: number): void => {
  if (isValidSpeed(rate)) storage.setItem(SPEED_KEY, String(rate));
};
