import { ValidationError } from '../lib/validation-error.ts';
import { hasControlChar } from '../lib/text-guards.ts';
import { withCache } from '../lib/cache.ts';

const MINUTES = 60_000;

/**
 * Wikimedia Commons: acervo de mídia livre (domínio público e licenças Creative Commons), sem chave. Tem filmes
 * antigos e os "open movies" da Blender Foundation. Cada arquivo traz a licença própria; mostramos ela e o autor
 * (a CC-BY exige atribuição). A API pede um User-Agent identificável: https://meta.wikimedia.org/wiki/User-Agent_policy
 */
const API_URL = 'https://commons.wikimedia.org/w/api.php';
const USER_AGENT = 'nerd-watch/1.0 (https://github.com/juninmd/nerd-watch; open-source local media tracker)';
const MEDIA_HOST = 'upload.wikimedia.org';
const DEFAULT_QUERY = 'film';
const VIDEO_MIMES = new Set(['video/webm', 'video/mp4', 'video/ogg', 'application/ogg']);

export interface CommonsVideo {
  /** Título da página no Commons (`File:Nome.webm`): é o id estável. */
  title: string;
  name: string;
  thumbnailUrl: string | null;
  videoUrl: string;
  pageUrl: string;
  description: string;
  license: string;
  licenseUrl: string | null;
  author: string;
}

interface RawMeta {
  value?: string;
}
interface RawImageInfo {
  url?: string;
  thumburl?: string;
  descriptionurl?: string;
  mime?: string;
  extmetadata?: Record<string, RawMeta | undefined>;
}
interface RawPage {
  title?: string;
  imageinfo?: RawImageInfo[];
}

const stripHtml = (html: string | undefined, max: number): string =>
  (html ?? '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);

const httpsUrl = (raw: string | undefined, host?: string): string | null => {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:' || u.username || u.password) return null;
    return !host || u.hostname === host ? u.href : null;
  } catch {
    return null;
  }
};

const toVideo = (page: RawPage): CommonsVideo | null => {
  const info = page.imageinfo?.[0];
  if (!page.title || !info || !VIDEO_MIMES.has((info.mime ?? '').toLowerCase())) return null;
  const videoUrl = httpsUrl(info.url, MEDIA_HOST);
  const pageUrl = httpsUrl(info.descriptionurl, 'commons.wikimedia.org');
  if (!videoUrl || !pageUrl) return null;
  const meta = info.extmetadata ?? {};
  return {
    title: page.title,
    name: page.title.replace(/^File:/, '').replace(/\.[a-z0-9]+$/i, '').replace(/_/g, ' '),
    thumbnailUrl: httpsUrl(info.thumburl, MEDIA_HOST),
    videoUrl,
    pageUrl,
    description: stripHtml(meta.ImageDescription?.value, 1000),
    license: stripHtml(meta.LicenseShortName?.value, 80) || 'licença livre',
    licenseUrl: httpsUrl(meta.LicenseUrl?.value),
    author: stripHtml(meta.Artist?.value, 160),
  };
};

const callApi = async (params: Record<string, string>): Promise<RawPage[]> => {
  const url = new URL(API_URL);
  const all = { action: 'query', format: 'json', formatversion: '2', prop: 'imageinfo', iiprop: 'url|mime|extmetadata', iiurlwidth: '320', iiextmetadatafilter: 'LicenseShortName|LicenseUrl|Artist|ImageDescription', ...params };
  for (const [k, v] of Object.entries(all)) url.searchParams.set(k, v);
  const res = await fetch(url, { headers: { 'user-agent': USER_AGENT, accept: 'application/json' }, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) {
    await res.body?.cancel();
    throw new Error(`Wikimedia Commons respondeu ${res.status}`);
  }
  const data = (await res.json()) as { query?: { pages?: RawPage[] } };
  return data.query?.pages ?? [];
};

/** Sintaxe de busca do CirrusSearch (aspas, `incategory:`, operadores) fica fora do termo do usuário. */
const sanitize = (raw: string): string => raw.replace(/[+\-!(){}[\]^"~*?:\\/|<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100);

export const commonsSearchVideos = withCache(15 * MINUTES, async (query: string, limit = 24): Promise<CommonsVideo[]> => {
  const term = sanitize(query) || DEFAULT_QUERY;
  const pages = await callApi({ generator: 'search', gsrsearch: `${term} filetype:video`, gsrnamespace: '6', gsrlimit: String(limit) });
  return pages.map(toVideo).filter((v): v is CommonsVideo => v !== null);
});

const FILE_TITLE = /^File:[^|]{1,200}$/;

export const commonsVideoDetails = withCache(60 * MINUTES, async (title: string): Promise<CommonsVideo | null> => {
  if (!FILE_TITLE.test(title) || hasControlChar(title)) throw new ValidationError('título de arquivo inválido');
  const pages = await callApi({ titles: title });
  return pages.map(toVideo).find((v): v is CommonsVideo => v !== null) ?? null;
});
