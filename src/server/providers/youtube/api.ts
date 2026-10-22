import { fetchCapped, makeFetch } from '../public-http.ts';
import { SourceError } from '../sources/types.ts';
import { parseFeed, type Feed } from './feed.ts';
import { VIDEO_ID } from './ids.ts';

const http = makeFetch();
/** Só para testes: troca o `fetch` por um falso. */
export const setYoutubeFetchForTests = (next?: Parameters<typeof http.set>[0]): void => http.set(next);

const FEED_MAX_BYTES = 2 * 1024 * 1024;
/** A página do @handle tem ~2 MB; o teto é folgado, mas finito. */
const PAGE_MAX_BYTES = 4 * 1024 * 1024;
const THUMB_MAX_BYTES = 2 * 1024 * 1024;
const TEXT_ENCODING = new TextDecoder();

/** Feed público de canal ou playlist (sem chave). O YouTube entrega só os ~15 vídeos mais recentes. */
export const fetchFeed = async (kind: 'channel' | 'playlist', id: string): Promise<Feed> => {
  const param = kind === 'channel' ? 'channel_id' : 'playlist_id';
  const res = await fetchCapped(http.get(), `https://www.youtube.com/feeds/videos.xml?${param}=${id}`, {}, 10_000, FEED_MAX_BYTES).catch(() => {
    throw new SourceError('não foi possível falar com o YouTube agora', 502);
  });
  if (res.status === 404) throw new SourceError('canal ou playlist não encontrado no YouTube (confira o link ou se ele é público)', 404);
  if (res.status !== 200) throw new SourceError(`o YouTube respondeu ${res.status}`, 502);
  if (!res.bytes) throw new SourceError('o feed do YouTube veio grande demais', 502);
  const feed = parseFeed(TEXT_ENCODING.decode(res.bytes));
  if (!feed) throw new SourceError('o feed do YouTube veio em formato inesperado', 502);
  return feed;
};

const CHANNEL_PATTERNS = [
  /<link rel="canonical" href="https:\/\/www\.youtube\.com\/channel\/(UC[A-Za-z0-9_-]{22})"/,
  /"externalId":"(UC[A-Za-z0-9_-]{22})"/,
  /"channelId":"(UC[A-Za-z0-9_-]{22})"/,
];

/** ID do canal numa página `@handle`. Testado com um trecho sintético; se o YouTube mudar o HTML, cai aqui. */
export const extractChannelId = (html: string): string | null => {
  for (const pattern of CHANNEL_PATTERNS) {
    const id = pattern.exec(html)?.[1];
    if (id) return id;
  }
  return null;
};

/** `@handle` → ID `UC…`. A entrada já foi validada; o host é fixo (www.youtube.com). */
export const resolveHandle = async (handle: string): Promise<string> => {
  const res = await fetchCapped(http.get(), `https://www.youtube.com/${handle}`, { headers: { 'Accept-Language': 'en-US,en;q=0.9' } }, 15_000, PAGE_MAX_BYTES).catch(() => {
    throw new SourceError('não foi possível falar com o YouTube agora', 502);
  });
  if (res.status === 404) throw new SourceError(`não encontrei o canal ${handle} no YouTube`, 404);
  if (res.status !== 200 || !res.bytes) throw new SourceError(`o YouTube respondeu ${res.status} ao buscar ${handle}`, 502);
  const id = extractChannelId(TEXT_ENCODING.decode(res.bytes));
  if (!id) throw new SourceError('não achei o ID do canal nessa página do YouTube (o formato pode ter mudado); use o link youtube.com/channel/UC…', 502);
  return id;
};

/** Miniatura do vídeo no host fixo de imagens do YouTube; o ID já está validado. */
export const downloadThumb = async (videoId: string): Promise<Uint8Array | null> => {
  if (!VIDEO_ID.test(videoId)) return null;
  const res = await fetchCapped(http.get(), `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`, {}, 10_000, THUMB_MAX_BYTES).catch(() => null);
  return res?.status === 200 && res.bytes && res.bytes.length > 0 ? res.bytes : null;
};
