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

const decodeEntities = (text: string): string =>
  text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'");

const stripTags = (html: string): string => decodeEntities(html.replace(/<[^>]+>/g, '')).trim();

const parseDuration = (text: string | undefined): number | null => {
  if (!text) return null;
  const parts = text.split(':').map(Number);
  if (parts.length === 0 || parts.some(Number.isNaN)) return null;
  return parts.reduce((total, part) => total * 60 + part, 0);
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

export const fetchPublicChannelItems = async (handle: string, beforeMessageId?: string): Promise<TelegramPublicItem[]> => {
  const url = new URL(`${BASE}/s/${encodeURIComponent(handle)}`);
  if (beforeMessageId) url.searchParams.set('before', beforeMessageId);

  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`t.me respondeu ${res.status}`);
  const html = await res.text();
  return parsePublicChannelHtml(html, handle);
};

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
