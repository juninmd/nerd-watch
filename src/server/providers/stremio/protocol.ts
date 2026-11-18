import { hasControlChar } from '../../lib/text-guards.ts';
import { ValidationError } from '../../lib/validation-error.ts';
import { addonTorrentRef } from '../../torrent/addon-torrent.ts';
import { getAddonJson } from './client.ts';

/**
 * Protocolo de addons do Stremio (https://stremio-addons.net/): `manifest.json` e os recursos
 * `catalog`, `meta`, `stream` e `subtitles`, todos `GET {base}/{recurso}/{tipo}/{id}.json`.
 * Aqui só normalização: o que vem do addon é dado de terceiro e sai já filtrado (URLs http(s), textos curtos).
 */

export interface AddonCatalog {
  type: string;
  id: string;
  name: string;
  searchable: boolean;
  /** `skip` é a paginação padrão do protocolo. */
  paged: boolean;
}

export interface AddonManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  logo: string | null;
  types: string[];
  resources: string[];
  catalogs: AddonCatalog[];
}

const obj = (v: unknown): Record<string, unknown> => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const str = (v: unknown, max = 500): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const list = (v: unknown, max = 100): unknown[] => (Array.isArray(v) ? v.slice(0, max) : []);

/** URL de imagem só se for http(s): `javascript:`/`data:` de addon nunca chega ao CSS ou ao `<img>`. */
export const safeHttpUrl = (v: unknown): string | null => {
  if (typeof v !== 'string' || v.length > 2048) return null;
  try {
    const u = new URL(v);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null;
  } catch {
    return null;
  }
};

const resourceName = (r: unknown): string => (typeof r === 'string' ? r : str(obj(r).name, 40));

export const parseManifest = (raw: unknown): AddonManifest => {
  const m = obj(raw);
  const id = str(m.id, 200);
  const name = str(m.name, 120);
  if (!id || !name || !Array.isArray(m.resources)) throw new ValidationError('o link não é um manifest de addon do Stremio válido');
  const catalogs = list(m.catalogs, 50).map((c): AddonCatalog | null => {
    const cat = obj(c);
    const type = str(cat.type, 40);
    const catId = str(cat.id, 120);
    if (!type || !catId) return null;
    const extra = list(cat.extra, 20).map(obj);
    return {
      type,
      id: catId,
      name: str(cat.name, 120) || catId,
      searchable: extra.some((e) => e.name === 'search') || list(cat.extraSupported).includes('search'),
      paged: extra.some((e) => e.name === 'skip') || list(cat.extraSupported).includes('skip'),
    };
  });
  return {
    id,
    name,
    version: str(m.version, 40),
    description: str(m.description, 500),
    logo: safeHttpUrl(m.logo),
    types: list(m.types, 20).map((t) => str(t, 40)).filter(Boolean),
    resources: [...new Set(list(m.resources, 20).map(resourceName).filter(Boolean))],
    catalogs: catalogs.filter((c): c is AddonCatalog => c !== null),
  };
};

export const fetchManifestFrom = async (manifestUrl: string): Promise<AddonManifest> => parseManifest(await getAddonJson(manifestUrl));

const SEGMENT = /^[^/\\?#]{1,300}$/;
/** Tipo e id viram segmento de caminho no addon; barra e controle ficam de fora, o resto é codificado. */
export const pathSegment = (value: string): string => {
  if (!SEGMENT.test(value) || hasControlChar(value)) throw new ValidationError('parâmetro inválido');
  return encodeURIComponent(value);
};

export interface MetaPreview {
  id: string;
  type: string;
  name: string;
  poster: string | null;
  year: string | null;
}

const previewOf = (raw: unknown, fallbackType: string): MetaPreview | null => {
  const m = obj(raw);
  const id = str(m.id, 300);
  const name = str(m.name, 200);
  if (!id || !name) return null;
  return {
    id,
    type: str(m.type, 40) || fallbackType,
    name,
    poster: safeHttpUrl(m.poster),
    year: str(m.releaseInfo ?? m.year, 20) || null,
  };
};

export const fetchCatalog = async (baseUrl: string, type: string, catalogId: string, extra: { search?: string; skip?: number }): Promise<MetaPreview[]> => {
  const parts: string[] = [];
  if (extra.search) parts.push(`search=${encodeURIComponent(extra.search)}`);
  if (extra.skip) parts.push(`skip=${extra.skip}`);
  const tail = parts.length ? `/${parts.join('&')}` : '';
  const data = obj(await getAddonJson(`${baseUrl}/catalog/${pathSegment(type)}/${pathSegment(catalogId)}${tail}.json`));
  return list(data.metas, 100)
    .map((m) => previewOf(m, type))
    .filter((m): m is MetaPreview => m !== null);
};

export interface MetaVideo {
  id: string;
  title: string;
  season: number | null;
  episode: number | null;
}

export interface MetaDetail extends MetaPreview {
  background: string | null;
  description: string;
  runtime: string;
  genres: string[];
  videos: MetaVideo[];
}

const intOrNull = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : null);

export const fetchMeta = async (baseUrl: string, type: string, id: string): Promise<MetaDetail | null> => {
  const data = obj(await getAddonJson(`${baseUrl}/meta/${pathSegment(type)}/${pathSegment(id)}.json`));
  const raw = obj(data.meta);
  const base = previewOf({ ...raw, id: raw.id ?? id }, type);
  if (!base) return null;
  return {
    ...base,
    background: safeHttpUrl(raw.background),
    description: str(raw.description, 4000),
    runtime: str(raw.runtime, 40),
    genres: list(raw.genres, 10).map((g) => str(g, 40)).filter(Boolean),
    videos: list(raw.videos, 500)
      .map((v): MetaVideo | null => {
        const video = obj(v);
        const vid = str(video.id, 300);
        if (!vid) return null;
        return { id: vid, title: str(video.title ?? video.name, 200) || vid, season: intOrNull(video.season), episode: intOrNull(video.episode ?? video.number) };
      })
      .filter((v): v is MetaVideo => v !== null),
  };
};

/**
 * `url`: arquivo http(s) que o navegador toca; `youtube`: embed; `external`: link para abrir fora;
 * `torrent`: `infoHash` (+ trackers) — toca no engine P2P local, igual a um magnet colado pelo usuário.
 */
export type StreamKind = 'url' | 'youtube' | 'external' | 'torrent';

export interface AddonStream {
  kind: StreamKind;
  title: string;
  url: string | null;
  /** Só em `torrent`: infohash v1 normalizado (40 hex) e o índice de arquivo sugerido pelo addon. */
  infoHash: string | null;
  fileIdx: number | null;
  /** Nome do arquivo que o addon sugere (`behaviorHints.filename`), mostrado no seletor do player. */
  filename: string | null;
  /** Trackers já validados. Fica no servidor: não entra no DTO que vai para o cliente. */
  trackers: string[];
}

const YT_ID = /^[\w-]{11}$/;

/** Campos de torrent vazios: só o stream do tipo `torrent` carrega infohash. */
const noTorrent = () => ({ infoHash: null, fileIdx: null, filename: null, trackers: [] as string[] });

export const fetchStreams = async (baseUrl: string, type: string, id: string): Promise<AddonStream[]> => {
  const data = obj(await getAddonJson(`${baseUrl}/stream/${pathSegment(type)}/${pathSegment(id)}.json`));
  const out: AddonStream[] = [];
  for (const raw of list(data.streams, 100)) {
    const s = obj(raw);
    const title = [str(s.name, 80), str(s.title ?? s.description, 300)].filter(Boolean).join(' · ') || 'stream';
    const url = safeHttpUrl(s.url);
    const external = safeHttpUrl(s.externalUrl);
    const yt = typeof s.ytId === 'string' && YT_ID.test(s.ytId) ? s.ytId : null;
    const hints = obj(s.behaviorHints);
    const torrent = addonTorrentRef({ infoHash: s.infoHash, sources: s.sources, name: hints.filename });
    const torrentFields = torrent
      ? { infoHash: torrent.infoHash, fileIdx: intOrNull(s.fileIdx), filename: str(hints.filename, 300) || null, trackers: torrent.trackers }
      : noTorrent();
    if (url) out.push({ kind: 'url', title, url, ...noTorrent() });
    else if (yt) out.push({ kind: 'youtube', title, url: `https://www.youtube-nocookie.com/embed/${yt}`, ...noTorrent() });
    else if (external) out.push({ kind: 'external', title, url: external, ...noTorrent() });
    else if (torrent) out.push({ kind: 'torrent', title, url: null, ...torrentFields });
  }
  return out;
};
