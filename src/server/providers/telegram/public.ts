/**
 * Canal público do Telegram, sem login: lê a prévia pública `t.me/s/<canal>`. Confirmado ao vivo (curl +
 * navegador) que os posts de vídeo trazem `<video src="https://cdnN.telesco.pe/...mp4?token=...">` já na
 * página estática (sem precisar de JS) — CORS liberado (`Access-Control-Allow-Origin: *`) e `Accept-Ranges:
 * bytes`, então o cliente toca direto nessa URL. O token expira (~3h), por isso `resolvePublicPlayUrl`
 * busca a página da mensagem individual de novo a cada play, pra sempre devolver um link fresco.
 */
import { withCache } from '../../cache.ts';

const BASE = 'https://t.me';
const USER_AGENT = 'Mozilla/5.0 (compatible; nerd-watch/0.1)';

export class TelegramChannelNotFoundError extends Error {
  constructor(handle: string) {
    super(`canal @${handle} não encontrado ou não tem prévia pública habilitada`);
    this.name = 'TelegramChannelNotFoundError';
  }
}

export interface TelegramPublicItem {
  messageId: string;
  videoUrl: string;
  thumbnailUrl: string | null;
  durationSeconds: number | null;
  caption: string | null;
  postedAt: string | null;
}

const NAMED_ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

/** Uma passada só: decodificar em etapas transformaria `&amp;lt;` em `<`. Cobre nomeadas e numéricas (`&#33;`, `&#x21;`). */
export const decodeEntities = (text: string): string =>
  text.replace(/&(?:#(\d{1,7})|#x([0-9a-fA-F]{1,6})|([a-zA-Z]+));/g, (whole, dec?: string, hex?: string, name?: string) => {
    if (name) return NAMED_ENTITIES[name] ?? whole;
    const code = dec ? Number(dec) : Number.parseInt(hex as string, 16);
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
  });

const stripTags = (html: string): string => decodeEntities(html.replace(/<[^>]+>/g, '')).trim();

const parseDuration = (text: string | undefined): number | null => {
  if (!text) return null;
  const parts = text.split(':').map(Number);
  if (parts.length === 0 || parts.some(Number.isNaN)) return null;
  return parts.reduce((total, part) => total * 60 + part, 0);
};

export interface TelegramChannelInfo {
  title: string | null;
  photoUrl: string | null;
  description: string | null;
}

/** Só CDNs do próprio Telegram: a URL da foto vem de HTML de terceiros e o servidor a baixa depois (evita SSRF). */
export const isTelegramPhotoUrl = (raw: string): boolean => {
  try {
    const u = new URL(raw);
    return u.protocol === 'https:' && /(^|\.)(telesco\.pe|cdn-telegram\.org|telegram\.org|t\.me)$/.test(u.hostname);
  } catch {
    return false;
  }
};

/** Nome, foto e descrição do cabeçalho da prévia pública (`t.me/s/<canal>`). Campos ausentes viram null. */
export const parsePublicChannelInfo = (html: string): TelegramChannelInfo => {
  const title = html.match(/tgme_channel_info_header_title"[^>]*>([\s\S]*?)<\/div>/);
  const photo = html.match(/tgme_page_photo_image[^>]*><img src="([^"]+)"/);
  const description = html.match(/tgme_channel_info_description"[^>]*>([\s\S]*?)<\/div>/);
  const photoUrl = photo ? decodeEntities(photo[1] as string) : null;
  return {
    title: title ? stripTags(title[1] as string) || null : null,
    photoUrl: photoUrl && isTelegramPhotoUrl(photoUrl) ? photoUrl : null,
    description: description ? stripTags((description[1] as string).replace(/<br\s*\/?>/gi, '\n')) || null : null,
  };
};

/** Exportado só para teste direto do parser com HTML fixo, sem bater na rede. */
export const parsePublicChannelHtml = (html: string, handle: string): TelegramPublicItem[] => {
  if (!html.includes('tgme_channel_info')) throw new TelegramChannelNotFoundError(handle);

  const startIndexes = [...html.matchAll(/<div class="tgme_widget_message /g)].map((m) => m.index);
  const items: TelegramPublicItem[] = [];

  for (let i = 0; i < startIndexes.length; i++) {
    const block = html.slice(startIndexes[i], startIndexes[i + 1] ?? html.length);
    const post = block.match(/data-post="([^/"]+)\/(\d+)"/);
    if (!post || (post[1] as string).toLowerCase() !== handle.toLowerCase()) continue;

    const videoSrc = block.match(/<video src="([^"]+)"/);
    if (!videoSrc) continue; // post sem vídeo (texto/foto/enquete) — fora do catálogo de "maratonar"

    const thumb = block.match(/tgme_widget_message_video_thumb"[^>]*style="background-image:url\('([^']+)'\)/);
    const duration = block.match(/message_video_duration[^"]*">([0-9:]+)</);
    const captionBlock = block.match(/class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/);
    const postedAt = block.match(/<time datetime="([^"]+)"/);

    items.push({
      messageId: post[2] as string,
      videoUrl: decodeEntities(videoSrc[1] as string),
      thumbnailUrl: thumb ? decodeEntities(thumb[1] as string) : null,
      durationSeconds: parseDuration(duration?.[1]),
      caption: captionBlock ? stripTags(captionBlock[1] as string) || null : null,
      postedAt: postedAt ? (postedAt[1] as string) : null,
    });
  }

  return items;
};

/** Menor id entre todos os posts do canal na página (com vídeo ou não): é de onde a próxima página (`before`) continua. */
export const oldestPostId = (html: string, handle: string): string | null => {
  const ids = [...html.matchAll(/data-post="([^/"]+)\/(\d+)"/g)].filter((m) => (m[1] as string).toLowerCase() === handle.toLowerCase()).map((m) => Number(m[2]));
  return ids.length ? String(Math.min(...ids)) : null;
};

export interface TelegramPublicPage {
  info: TelegramChannelInfo;
  items: TelegramPublicItem[];
  oldestId: string | null;
}

/** `before` pagina pra trás e `query` usa a busca de texto da própria prévia (`?q=`). */
export const fetchPublicChannelPage = async (handle: string, opts: { before?: string; query?: string } = {}): Promise<TelegramPublicPage> => {
  const url = new URL(`${BASE}/s/${encodeURIComponent(handle)}`);
  if (opts.before) url.searchParams.set('before', opts.before);
  if (opts.query) url.searchParams.set('q', opts.query);

  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`t.me respondeu ${res.status}`);
  const html = await res.text();
  return { info: parsePublicChannelInfo(html), items: parsePublicChannelHtml(html, handle), oldestId: oldestPostId(html, handle) };
};

export const fetchPublicChannelItems = async (handle: string, beforeMessageId?: string): Promise<TelegramPublicItem[]> =>
  (await fetchPublicChannelPage(handle, { before: beforeMessageId })).items;

/**
 * Refaz o fetch da mensagem individual pra sempre devolver uma URL de vídeo com token válido no momento do
 * play. Cacheado por alguns minutos: o `<video>` do cliente reaproveita esse mesmo endpoint a cada request
 * de Range durante o seek, e o token do CDN já dura ~3h — sem cache, cada scrub bateria em t.me de novo.
 */
export const resolvePublicPlayUrl = withCache(5 * 60_000, async (handle: string, messageId: string): Promise<string | null> => {
  const res = await fetch(`${BASE}/${encodeURIComponent(handle)}/${encodeURIComponent(messageId)}?embed=1`, {
    headers: { 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) return null;
  const html = await res.text();
  const match = html.match(/<video src="([^"]+)"/);
  return match ? decodeEntities(match[1] as string) : null;
});
