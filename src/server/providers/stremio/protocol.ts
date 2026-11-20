import { hasControlChar } from '../../lib/text-guards.ts';
import { ValidationError } from '../../lib/validation-error.ts';
import { isFetchableSubtitleUrl } from '../../subtitles/url-guard.ts';
import { addonTorrentRef } from '../../torrent/addon-torrent.ts';
import { getAddonJson } from './client.ts';
import { isNoticeVideo } from './notice-video.ts';
import { decodeEntities } from './text.ts';

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
  /** Gêneros oferecidos em `extra[name=genre].options` (teto de 30). Vazio = não filtra por gênero. */
  genres: string[];
  /** O catálogo declara o filtro `year`. */
  yearFilter: boolean;
}

export interface AddonManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  logo: string | null;
  background: string | null;
  types: string[];
  resources: string[];
  catalogs: AddonCatalog[];
  /** Esquemas de id que o addon aceita (`tt`, `kitsu:`…). Vazio = não declara restrição. */
  idPrefixes: string[];
  /** `behaviorHints.configurable`: o addon tem página de configuração própria. */
  configurable: boolean;
  /** `behaviorHints.configurationRequired`: sem configurar, ele não entrega nada útil. */
  configurationRequired: boolean;
}

const obj = (v: unknown): Record<string, unknown> => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const str = (v: unknown, max = 500): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');
/** Texto exibido: decodifica entidades que o addon manda cruas (`Can&#039;t`) antes de guardar. */
const text = (v: unknown, max = 500): string => decodeEntities(str(v, max));
const list = (v: unknown, max = 100): unknown[] => (Array.isArray(v) ? v.slice(0, max) : []);

/** URL de imagem/stream só se for http(s) pública, sem credenciais nem controle: evita XSS e requisições do browser para a LAN/loopback. */
export const safeHttpUrl = (v: unknown): string | null => {
  if (typeof v !== 'string' || v.length > 2048 || hasControlChar(v)) return null;
  if (!isFetchableSubtitleUrl(v)) return null;
  try {
    return new URL(v).href;
  } catch {
    return null;
  }
};

const resourceName = (r: unknown): string => (typeof r === 'string' ? r : str(obj(r).name, 40));

/**
 * `extra` do catálogo no protocolo: cada filtro é um objeto com `name` (e, no caso de `genre`, uma
 * lista de `options`). `extraSupported` é a forma antiga e só informa nomes — nela o gênero vem sem
 * opções, e aí a interface não tem como montar os chips.
 */
const catalogFlags = (cat: Record<string, unknown>) => {
  const extra = list(cat.extra, 20).map(obj);
  const supported = list(cat.extraSupported, 20).map((v) => str(v, 20));
  const genre = extra.find((entry) => entry.name === 'genre');
  return {
    searchable: extra.some((e) => e.name === 'search') || supported.includes('search'),
    paged: extra.some((e) => e.name === 'skip') || supported.includes('skip'),
    genres: genre ? list(genre.options, 30).map((g) => str(g, 40)).filter(Boolean) : [],
    yearFilter: extra.some((e) => e.name === 'year') || supported.includes('year'),
  };
};

export const parseManifest = (raw: unknown): AddonManifest => {
  const m = obj(raw);
  const id = str(m.id, 200);
  const name = text(m.name, 120);
  if (!id || !name || !Array.isArray(m.resources)) throw new ValidationError('o link não é um manifest de addon do Stremio válido');
  const catalogs = list(m.catalogs, 50).map((c): AddonCatalog | null => {
    const cat = obj(c);
    const type = str(cat.type, 40);
    const catId = str(cat.id, 120);
    if (!type || !catId) return null;
    return {
      type,
      id: catId,
      name: text(cat.name, 120) || catId,
      ...catalogFlags(cat),
    };
  });
  // `idPrefixes` aparece no topo do manifest **ou** dentro de cada recurso (é assim no addon de
  // torrent mais usado: `resources: [{ name: "stream", idPrefixes: ["tt","kitsu"] }]`). A união dos
  // dois lugares é o que a checagem de esquema de id precisa.
  const prefixes = new Set<string>();
  for (const value of list(m.idPrefixes, 20)) {
    const prefix = str(value, 20);
    if (prefix) prefixes.add(prefix);
  }
  for (const entry of list(m.resources, 20)) {
    for (const value of list(obj(entry).idPrefixes, 20)) {
      const prefix = str(value, 20);
      if (prefix) prefixes.add(prefix);
    }
  }
  const hints = obj(m.behaviorHints);
  return {
    id,
    name,
    version: str(m.version, 40),
    description: text(m.description, 500),
    logo: safeHttpUrl(m.logo),
    background: safeHttpUrl(m.background),
    types: list(m.types, 20).map((t) => str(t, 40)).filter(Boolean),
    resources: [...new Set(list(m.resources, 20).map(resourceName).filter(Boolean))],
    catalogs: catalogs.filter((c): c is AddonCatalog => c !== null),
    idPrefixes: [...prefixes],
    configurable: hints.configurable === true,
    configurationRequired: hints.configurationRequired === true,
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
  const name = text(m.name, 200);
  if (!id || !name) return null;
  return {
    id,
    type: str(m.type, 40) || fallbackType,
    name,
    poster: safeHttpUrl(m.poster),
    year: str(m.releaseInfo ?? m.year, 20) || null,
  };
};

export interface CatalogQuery {
  search?: string;
  skip?: number;
  /** Filtros declarados pelo catálogo em `extra`; a rota só deixa passar o que o manifest oferece. */
  genre?: string;
  year?: string;
}

/**
 * `extra` do protocolo vai na própria URL, como segmentos separados por `&`
 * (`/catalog/movie/top/genre=Ação&skip=100.json`). A ordem segue a convenção dos addons: busca,
 * gênero, ano e, por último, a paginação.
 */
export const fetchCatalog = async (baseUrl: string, type: string, catalogId: string, extra: CatalogQuery): Promise<MetaPreview[]> => {
  const parts: string[] = [];
  if (extra.search) parts.push(`search=${encodeURIComponent(extra.search)}`);
  if (extra.genre) parts.push(`genre=${encodeURIComponent(extra.genre)}`);
  if (extra.year) parts.push(`year=${encodeURIComponent(extra.year)}`);
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
  /** Id do YouTube do trailer principal, quando o addon publica um. */
  trailerKey: string | null;
}

const INT_STR = /^\d{1,6}$/;
const YT_ID = /^[\w-]{11}$/;

/**
 * O protocolo publica o trailer de duas formas: `trailers` (o id do YouTube vem em `source`) e
 * `trailerStreams` (vem em `ytId`, com `title`). Só o formato de id do YouTube passa: a chave vai
 * para a URL de um iframe no cliente.
 */
const trailerKeyOf = (raw: Record<string, unknown>): string | null => {
  for (const item of list(raw.trailerStreams, 10)) {
    const id = str(obj(item).ytId, 32);
    if (YT_ID.test(id)) return id;
  }
  for (const item of list(raw.trailers, 10)) {
    const t = obj(item);
    const id = str(t.ytId ?? t.source, 32);
    if (YT_ID.test(id)) return id;
  }
  return null;
};

/** Alguns addons devolvem `season`/`episode` como string (`"1"`) em vez de número: ambos viram inteiro válido. */
const intOrNull = (v: unknown): number | null => {
  if (typeof v === 'number' && Number.isInteger(v) && v >= 0) return v;
  if (typeof v === 'string' && INT_STR.test(v.trim())) return Number(v.trim());
  return null;
};

export const fetchMeta = async (baseUrl: string, type: string, id: string): Promise<MetaDetail | null> => {
  const data = obj(await getAddonJson(`${baseUrl}/meta/${pathSegment(type)}/${pathSegment(id)}.json`));
  const raw = obj(data.meta);
  const base = previewOf({ ...raw, id: raw.id ?? id }, type);
  if (!base) return null;
  return {
    ...base,
    background: safeHttpUrl(raw.background),
    description: text(raw.description, 4000),
    runtime: str(raw.runtime, 40),
    genres: list(raw.genres, 10).map((g) => str(g, 40)).filter(Boolean),
    trailerKey: trailerKeyOf(raw),
    videos: list(raw.videos, 500)
      .map((v): MetaVideo | null => {
        const video = obj(v);
        const vid = str(video.id, 300);
        if (!vid) return null;
        return { id: vid, title: text(video.title ?? video.name, 200) || vid, season: intOrNull(video.season), episode: intOrNull(video.episode ?? video.number) };
      })
      .filter((v): v is MetaVideo => v !== null),
  };
};

/**
 * `url`: arquivo http(s) que o navegador toca; `youtube`: embed; `external`: link para abrir fora;
 * `torrent`: `infoHash` (+ trackers) — toca no engine P2P local, igual a um magnet colado pelo usuário;
 * `error`: o addon devolveu um vídeo de aviso (token de debrid inválido, cache cheio, download em
 * andamento) — não é conteúdo e a interface mostra o texto em vez de um botão de play.
 */
export type StreamKind = 'url' | 'youtube' | 'external' | 'torrent' | 'error';

export interface AddonStream {
  kind: StreamKind;
  /** Rótulo resumido (`name · description`) mantido para compatibilidade e acessibilidade. */
  title: string;
  /** Nome curto enviado pelo addon (ex.: `Torrentio\n1080p`). */
  name: string;
  /** Descrição detalhada enviada pelo addon (`description` ou `title`), preservando quebras de linha. */
  description: string;
  url: string | null;
  /** Só em `torrent`: infohash v1 normalizado (40 hex) e o índice de arquivo sugerido pelo addon. */
  infoHash: string | null;
  fileIdx: number | null;
  /** Nome do arquivo que o addon sugere (`behaviorHints.filename`), mostrado no seletor do player. */
  filename: string | null;
  /** Tamanho em bytes informado em `behaviorHints.videoSize`, quando presente. */
  videoSize: number | null;
  /** `behaviorHints.notWebReady`: sinaliza que o container/codec pode não tocar direto no navegador. */
  notWebReady: boolean;
  /** `behaviorHints.bingeGroup`: grupo/qualidade de continuidade sugerido pelo addon. */
  bingeGroup: string | null;
  /** `behaviorHints.countryWhitelist`: códigos de país permitidos, quando o addon restringe por região. */
  countryWhitelist: string[];
  /** Idiomas de legendas embutidas declarados em `stream.subtitles`. */
  subtitleLangs: string[];
  /** Faixas de legenda que o próprio addon oferece para este stream (URL fica no servidor). */
  subtitles: AddonSubtitle[];
  /** Quantidade de trackers validados (as URLs dos trackers continuam só no servidor). */
  trackerCount: number;
  /** Trackers já validados. Fica no servidor: não entra no DTO que vai para o cliente. */
  trackers: string[];
}

const MAX_VIDEO_SIZE = 1024 * 1024 * 1024 * 1024; // 1 TB

/** Campos de torrent vazios: só o stream do tipo `torrent` carrega infohash. */
const noTorrent = () => ({ infoHash: null, fileIdx: null, filename: null, trackerCount: 0, trackers: [] as string[] });

const videoSizeOrNull = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= MAX_VIDEO_SIZE ? Math.floor(v) : null;

/** Idiomas das faixas que passaram na normalização: faixa descartada não vira selo no card. */
const subtitleLangsOf = (subtitles: readonly AddonSubtitle[]): string[] => [...new Set(subtitles.map((track) => track.lang))];

/** Faixa de legenda publicada pelo addon para o stream. A URL nunca sai do servidor: o cliente pede por índice. */
export interface AddonSubtitle {
  id: string | null;
  url: string;
  lang: string;
}

/**
 * Normaliza `stream.subtitles`. Só entra URL http(s) pública; a mesma URL repetida (o addon costuma
 * mandar uma por episódio de pack) entra uma vez. Sem `lang` a faixa fica com `?` em vez de sumir:
 * é melhor listar "desconhecido" do que esconder a legenda.
 */
const subtitlesOf = (raw: unknown): AddonSubtitle[] => {
  const out: AddonSubtitle[] = [];
  const seen = new Set<string>();
  for (const item of list(raw, 20)) {
    const s = obj(item);
    const url = safeHttpUrl(s.url);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    out.push({ id: str(s.id, 80) || null, url, lang: str(s.lang, 24) || '?' });
  }
  return out;
};

const countriesOf = (raw: unknown): string[] => {
  const out = new Set<string>();
  for (const item of list(raw, 20)) {
    const code = str(item, 8).toUpperCase();
    if (/^[A-Z]{2,3}$/.test(code)) out.add(code);
  }
  return [...out];
};

export const fetchStreams = async (baseUrl: string, type: string, id: string): Promise<AddonStream[]> => {
  const data = obj(await getAddonJson(`${baseUrl}/stream/${pathSegment(type)}/${pathSegment(id)}.json`));
  const out: AddonStream[] = [];
  for (const raw of list(data.streams, 100)) {
    const s = obj(raw);
    const name = text(s.name, 120);
    const description = text(s.description ?? s.title, 800);
    const title = [name.replace(/\s+/g, ' '), description.replace(/\s+/g, ' ').slice(0, 300)].filter(Boolean).join(' · ') || 'stream';
    const url = safeHttpUrl(s.url);
    const external = safeHttpUrl(s.externalUrl);
    const yt = typeof s.ytId === 'string' && YT_ID.test(s.ytId) ? s.ytId : null;
    const hints = obj(s.behaviorHints);
    const filename = str(hints.filename, 300) || null;
    const subtitles = subtitlesOf(s.subtitles);
    const common = {
      title,
      name,
      description,
      videoSize: videoSizeOrNull(hints.videoSize),
      notWebReady: hints.notWebReady === true,
      bingeGroup: str(hints.bingeGroup, 160) || null,
      countryWhitelist: countriesOf(hints.countryWhitelist),
      subtitleLangs: subtitleLangsOf(subtitles),
      subtitles,
    };
    const torrent = addonTorrentRef({ infoHash: s.infoHash, sources: s.sources, name: hints.filename });
    const torrentFields = torrent
      ? {
          infoHash: torrent.infoHash,
          fileIdx: intOrNull(s.fileIdx),
          filename,
          trackerCount: torrent.trackers.length,
          trackers: torrent.trackers,
        }
      : { ...noTorrent(), filename };
    // Vídeo de aviso do addon (`/videos/failed_*`): vira `error`, sem URL — não é conteúdo para tocar.
    const notice = url !== null && isNoticeVideo(url);
    if (url) out.push({ kind: notice ? 'error' : 'url', url: notice ? null : url, ...noTorrent(), filename, ...common });
    else if (yt) out.push({ kind: 'youtube', url: `https://www.youtube-nocookie.com/embed/${yt}`, ...noTorrent(), ...common });
    else if (external) out.push({ kind: 'external', url: external, ...noTorrent(), filename, ...common });
    else if (torrent) out.push({ kind: 'torrent', url: null, ...torrentFields, ...common });
  }
  return out;
};
