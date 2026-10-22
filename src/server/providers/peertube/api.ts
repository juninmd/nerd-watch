import { withCache } from '../../cache.ts';
import type { NewTelegramItem } from '../../repo/telegram.ts';
import { type FetchFn, fetchCapped, makeFetch } from '../public-http.ts';
import { syntheticMessageId } from '../sources/service.ts';
import { SourceError } from '../sources/types.ts';
import { type ChannelRef, parseInstanceHost } from './host.ts';

const http = makeFetch();
/** Só para testes: troca o `fetch` por um falso (nunca sai da rede durante `bun test`). */
export const setPeertubeFetchForTests = (next?: Parameters<typeof http.set>[0]): void => http.set(next);
export const currentFetch = (): FetchFn => http.get();

const JSON_MAX_BYTES = 2 * 1024 * 1024;
const THUMB_MAX_BYTES = 2 * 1024 * 1024;
const PAGE_SIZE = 100;
const MAX_ITEMS = 500;
const MAX_PAGES = 10;
const MAX_FILE_HEIGHT = 1080;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const THUMB_PATH = /^\/lazy-static\/thumbnails\/[A-Za-z0-9-]+\.(?:jpg|jpeg|png)$/;
const VIDEO_EXT = /\.(mp4|webm)$/i;

export const isVideoUuid = (value: string): boolean => UUID.test(value);

export const embedUrlOf = (host: string, uuid: string): string => `https://${host}/videos/embed/${uuid}`;

/** GET JSON da API da instância. Toda falha vira mensagem nossa; o corpo cru do serviço nunca sai daqui. */
const getJson = async (host: string, path: string): Promise<unknown> => {
  const res = await fetchCapped(http.get(), `https://${host}/api/v1${path}`, { headers: { Accept: 'application/json' } }, 15_000, JSON_MAX_BYTES).catch(() => {
    throw new SourceError('não foi possível falar com essa instância do PeerTube agora', 502);
  });
  if (res.status === 404) throw new SourceError('canal ou vídeo não encontrado nessa instância do PeerTube', 404);
  if (res.status < 200 || res.status >= 300) throw new SourceError(`a instância do PeerTube respondeu ${res.status}`, 502);
  if (!res.bytes) throw new SourceError('resposta grande demais da instância do PeerTube', 502);
  try {
    return JSON.parse(new TextDecoder().decode(res.bytes)) as unknown;
  } catch {
    throw new SourceError('resposta inesperada da instância do PeerTube', 502);
  }
};

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** Nome que aparece no app: o `displayName` do canal, ou o nome de login se ele não existir. */
export const fetchChannelName = async (ref: ChannelRef): Promise<string> => {
  const body = await getJson(ref.host, `/video-channels/${encodeURIComponent(ref.name)}`);
  if (!isRecord(body)) throw new SourceError('resposta inesperada da instância do PeerTube', 502);
  const display = typeof body.displayName === 'string' ? body.displayName.trim() : '';
  return display || ref.name;
};

/** Miniatura só pelo caminho padrão do PeerTube, no mesmo host da instância (nada de URL arbitrária vinda da API). */
export const thumbUrlOf = (host: string, path: unknown): string | null =>
  typeof path === 'string' && THUMB_PATH.test(path) ? `https://${host}${path}` : null;

const toItem = (host: string, video: Record<string, unknown>): NewTelegramItem | null => {
  const uuid = typeof video.uuid === 'string' && isVideoUuid(video.uuid) ? video.uuid : null;
  if (!uuid) return null;
  const name = typeof video.name === 'string' ? video.name.trim() : '';
  const duration = typeof video.duration === 'number' ? Math.round(video.duration) : null;
  const published = typeof video.publishedAt === 'string' && Number.isFinite(Date.parse(video.publishedAt)) ? video.publishedAt : null;
  return {
    messageId: syntheticMessageId(published, uuid),
    caption: name || 'Vídeo sem título',
    durationSeconds: duration !== null && duration > 0 ? duration : null,
    thumbnailUrl: thumbUrlOf(host, video.thumbnailPath),
    postedAt: published,
    fileRef: uuid,
  };
};

/** Vídeos públicos do canal, do mais novo ao mais antigo, em páginas de 100 e no máximo 500 itens. */
export const listChannelVideos = async (ref: ChannelRef): Promise<NewTelegramItem[]> => {
  const items: NewTelegramItem[] = [];
  // Página sem vídeo válido não aumenta `items`: sem teto próprio, uma instância hostil mantém o laço até o fim do `total` que ela mesma declara.
  for (let page = 0, start = 0; items.length < MAX_ITEMS && page < MAX_PAGES; page++, start += PAGE_SIZE) {
    const body = await getJson(ref.host, `/video-channels/${encodeURIComponent(ref.name)}/videos?start=${start}&count=${PAGE_SIZE}&sort=-publishedAt`);
    if (!isRecord(body) || !Array.isArray(body.data)) throw new SourceError('resposta inesperada da instância do PeerTube', 502);
    for (const video of body.data) {
      if (!isRecord(video)) continue;
      const item = toItem(ref.host, video);
      if (item) items.push(item);
    }
    const total = typeof body.total === 'number' ? body.total : 0;
    if (body.data.length < PAGE_SIZE || start + PAGE_SIZE >= total) break;
  }
  return items.slice(0, MAX_ITEMS);
};

export type VideoChoice = { kind: 'file'; url: string } | { kind: 'embed' };

/** Arquivo MP4/WebM direto no mesmo host da instância, até 1080p; sem ele o vídeo só toca pelo embed (HLS). */
export const chooseFile = (host: string, files: unknown): VideoChoice => {
  if (!Array.isArray(files)) return { kind: 'embed' };
  const candidates: Array<{ url: string; height: number }> = [];
  for (const file of files) {
    if (!isRecord(file) || typeof file.fileUrl !== 'string' || !isRecord(file.resolution)) continue;
    const height = typeof file.resolution.id === 'number' ? file.resolution.id : 0;
    let url: URL;
    try {
      url = new URL(file.fileUrl);
    } catch {
      continue;
    }
    const sameHost = url.protocol === 'https:' && url.hostname === host && !url.username && !url.password && !url.port;
    // Altura 0 é o "áudio apenas" (ex.: tilvids): não serve para o player de vídeo.
    if (sameHost && height > 0 && VIDEO_EXT.test(url.pathname)) candidates.push({ url: url.href, height });
  }
  const within = candidates.filter((c) => c.height <= MAX_FILE_HEIGHT).sort((a, b) => b.height - a.height);
  const best = within[0] ?? candidates.sort((a, b) => a.height - b.height)[0];
  return best ? { kind: 'file', url: best.url } : { kind: 'embed' };
};

const fetchChoice = async (host: string, uuid: string): Promise<VideoChoice> => {
  const body = await getJson(host, `/videos/${uuid}`);
  return chooseFile(host, isRecord(body) ? body.files : undefined);
};

/** Cache curto: o navegador pede o vídeo em muitos Range (um por seek) e cada um não deve refazer a consulta. */
const cachedChoice = withCache(5 * 60_000, fetchChoice, (host, uuid) => `${host}/${uuid}`);

export const videoChoice = (host: string, uuid: string): Promise<VideoChoice> => cachedChoice(host, uuid);

/** Miniatura baixada no servidor: host e caminho revalidados aqui também (a URL veio do banco). */
export const downloadThumb = async (host: string, thumbnailUrl: string): Promise<Uint8Array | null> => {
  let url: URL;
  try {
    url = new URL(thumbnailUrl);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.hostname !== host || !THUMB_PATH.test(url.pathname) || parseInstanceHost(host) === null) return null;
  const res = await fetchCapped(http.get(), url.href, {}, 10_000, THUMB_MAX_BYTES).catch(() => null);
  return res?.status === 200 && res.bytes && res.bytes.length > 0 ? res.bytes : null;
};
