import { storage } from '../player/playback-service.ts';

const KEY = 'nw.channel.list';

/** Modo de exibição dos vídeos do canal: grade de cards (padrão) ou lista com descrição por extenso. */
export const getListMode = (): boolean => storage.getItem(KEY) === '1';
export const setListMode = (on: boolean): void => storage.setItem(KEY, on ? '1' : '0');
