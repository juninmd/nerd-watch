import type { NewTelegramItem } from '../../repo/telegram.ts';
import { fetchCapped, makeFetch } from '../public-http.ts';
import { syntheticMessageId } from '../sources/service.ts';
import { SourceError } from '../sources/types.ts';
import { type DailymotionRef, VIDEO_ID } from './ids.ts';

const http = makeFetch();
/** Só para testes: troca o `fetch` por um falso. */
export const setDailymotionFetchForTests = (next?: Parameters<typeof http.set>[0]): void => http.set(next);

const API = 'https://api.dailymotion.com';
const JSON_MAX_BYTES = 2 * 1024 * 1024;
const THUMB_MAX_BYTES = 2 * 1024 * 1024;
const PAGE_SIZE = 100;
const MAX_ITEMS = 300;
const MAX_PAGES = 5;
/** Miniaturas ficam sempre no CDN do Dailymotion; nada de URL arbitrária vinda da API. */
const THUMB_HOST = /^(?:[a-z0-9-]+\.)*dmcdn\.net$/;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

const getJson = async (path: string): Promise<unknown> => {
  const res = await fetchCapped(http.get(), `${API}${path}`, { headers: { Accept: 'application/json' } }, 15_000, JSON_MAX_BYTES).catch(() => {
    throw new SourceError('não foi possível falar com o Dailymotion agora', 502);
  });
  if (res.status === 404) throw new SourceError('canal ou playlist não encontrado no Dailymotion (confira o link ou se ele é público)', 404);
  if (res.status < 200 || res.status >= 300) throw new SourceError(`o Dailymotion respondeu ${res.status}`, 502);
  if (!res.bytes) throw new SourceError('resposta grande demais do Dailymotion', 502);
  try {
    return JSON.parse(new TextDecoder().decode(res.bytes)) as unknown;
  } catch {
    throw new SourceError('resposta inesperada do Dailymotion', 502);
  }
};

const base = (ref: DailymotionRef): string => `/${ref.kind}/${encodeURIComponent(ref.id)}`;

export const fetchChannelName = async (ref: DailymotionRef): Promise<string> => {
  const body = await getJson(`${base(ref)}?fields=${ref.kind === 'user' ? 'screenname' : 'name'}`);
  if (!isRecord(body)) throw new SourceError('resposta inesperada do Dailymotion', 502);
  const name = body.screenname ?? body.name;
  return (typeof name === 'string' && name.trim()) || (ref.kind === 'user' ? ref.id : 'Playlist do Dailymotion');
};

/** Só miniatura https do CDN do Dailymotion. */
export const safeThumbUrl = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port && THUMB_HOST.test(url.hostname) ? url.href : null;
  } catch {
    return null;
  }
};

const toItem = (video: unknown): NewTelegramItem | null => {
  if (!isRecord(video) || typeof video.id !== 'string' || !VIDEO_ID.test(video.id)) return null;
  const created = typeof video.created_time === 'number' && video.created_time > 0 ? new Date(video.created_time * 1000).toISOString() : null;
  const duration = typeof video.duration === 'number' ? Math.round(video.duration) : null;
  const title = typeof video.title === 'string' ? video.title.trim() : '';
  return {
    messageId: syntheticMessageId(created, video.id),
    caption: title || 'Vídeo sem título',
    durationSeconds: duration !== null && duration > 0 ? duration : null,
    thumbnailUrl: safeThumbUrl(video.thumbnail_480_url),
    postedAt: created,
    fileRef: video.id,
  };
};

/** Vídeos públicos do canal/playlist, mais novos primeiro, em páginas de 100 e no máximo 300 itens. */
export const listVideos = async (ref: DailymotionRef): Promise<NewTelegramItem[]> => {
  const items: NewTelegramItem[] = [];
  const fields = 'id,title,duration,created_time,thumbnail_480_url';
  for (let page = 1; page <= MAX_PAGES && items.length < MAX_ITEMS; page++) {
    const body = await getJson(`${base(ref)}/videos?fields=${fields}&sort=recent&limit=${PAGE_SIZE}&page=${page}`);
    if (!isRecord(body) || !Array.isArray(body.list)) throw new SourceError('resposta inesperada do Dailymotion', 502);
    for (const video of body.list) {
      const item = toItem(video);
      if (item) items.push(item);
    }
    if (body.has_more !== true) break;
  }
  return items.slice(0, MAX_ITEMS);
};

export const downloadThumb = async (thumbnailUrl: string): Promise<Uint8Array | null> => {
  const safe = safeThumbUrl(thumbnailUrl);
  if (!safe) return null;
  const res = await fetchCapped(http.get(), safe, {}, 10_000, THUMB_MAX_BYTES).catch(() => null);
  return res?.status === 200 && res.bytes && res.bytes.length > 0 ? res.bytes : null;
};
