import type { TorrentOpenResponse } from './torrent.ts';
import { json } from './http.ts';

export interface AddonCatalogDto {
  type: string;
  id: string;
  name: string;
  searchable: boolean;
  paged: boolean;
  /** Gêneros que o catálogo declara em `extra`; vazio = não filtra por gênero. */
  genres: string[];
  yearFilter: boolean;
}

/** Um catálogo de um addon instalado, já com o nome do addon: é o que a tela Descobrir lista. */
export interface AddonBoardDto {
  key: string;
  addonId: string;
  addonName: string;
  logo: string | null;
  host: string;
  type: string;
  catalogId: string;
  name: string;
  searchable: boolean;
  paged: boolean;
  genres: string[];
  yearFilter: boolean;
}

/** O servidor nunca devolve o link do manifest (pode ter token no caminho): só o domínio. */
export interface AddonDto {
  id: string;
  host: string;
  name: string;
  version: string;
  description: string;
  logo: string | null;
  background: string | null;
  types: string[];
  resources: string[];
  catalogs: AddonCatalogDto[];
  /** Esquemas de id aceitos (`tt`, `kitsu:`…). Vazio = não declara restrição. */
  idPrefixes: string[];
  configurable: boolean;
  configurationRequired: boolean;
  /** Desligado continua instalado, mas fora das consultas automáticas (título, busca, quadros, legenda). */
  enabled: boolean;
  addedAt: string;
}

export interface AddonItemDto {
  id: string;
  type: string;
  name: string;
  poster: string | null;
  year: string | null;
}

export interface AddonMetaDto extends AddonItemDto {
  background: string | null;
  description: string;
  runtime: string;
  genres: string[];
  /** Trailer publicado pelo addon (id do YouTube), quando existe. */
  trailerKey: string | null;
  videos: Array<{ id: string; title: string; season: number | null; episode: number | null }>;
}

export interface AddonStreamDto {
  kind: 'url' | 'youtube' | 'external' | 'torrent' | 'error';
  title: string;
  name?: string;
  description?: string;
  url: string | null;
  /** Só em `torrent`: infohash normalizado e o índice de arquivo sugerido pelo addon. */
  infoHash: string | null;
  fileIdx: number | null;
  /** Nome do arquivo sugerido, quando o addon manda `behaviorHints.filename`. */
  filename: string | null;
  videoSize?: number | null;
  notWebReady?: boolean;
  bingeGroup?: string | null;
  countryWhitelist?: string[];
  subtitleLangs?: string[];
  /** Faixas de legenda do próprio addon para este stream (sem URL: o servidor baixa por índice). */
  subtitles?: Array<{ id: string | null; lang: string }>;
  trackerCount?: number;
}

const seg = encodeURIComponent;

export const listAddons = (): Promise<AddonDto[]> => fetch('/api/stremio/addons').then((r) => json<{ addons: AddonDto[] }>(r)).then((d) => d.addons);

export const installAddon = (url: string): Promise<AddonDto> =>
  fetch('/api/stremio/addons', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }) }).then((r) => json<AddonDto>(r));

export const removeAddon = (id: string): Promise<void> => fetch(`/api/stremio/addons/${seg(id)}`, { method: 'DELETE' }).then((r) => json<unknown>(r).then(() => undefined));

/** Liga/desliga sem remover: desligado não entra em título, busca, quadros nem legenda. */
export const setAddonEnabled = (id: string, enabled: boolean): Promise<AddonDto> =>
  fetch(`/api/stremio/addons/${seg(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled }),
  }).then((r) => json<AddonDto>(r));

export const getAddonCatalog = (
  id: string,
  type: string,
  catalogId: string,
  opts: { search?: string; skip?: number; genre?: string; year?: string } = {},
): Promise<AddonItemDto[]> => {
  const q = new URLSearchParams();
  if (opts.search) q.set('search', opts.search);
  if (opts.genre) q.set('genre', opts.genre);
  if (opts.year) q.set('year', opts.year);
  if (opts.skip) q.set('skip', String(opts.skip));
  return fetch(`/api/stremio/addons/${seg(id)}/catalog/${seg(type)}/${seg(catalogId)}?${q}`).then((r) => json<{ items: AddonItemDto[] }>(r)).then((d) => d.items);
};

/** Catálogos de todos os addons instalados (sem rede no servidor: sai do manifest guardado). */
export const listBoards = (): Promise<AddonBoardDto[]> => fetch('/api/stremio/boards').then((r) => json<{ boards: AddonBoardDto[] }>(r)).then((d) => d.boards);

export const getAddonMeta = (id: string, type: string, itemId: string): Promise<AddonMetaDto> =>
  fetch(`/api/stremio/addons/${seg(id)}/meta/${seg(type)}/${seg(itemId)}`).then((r) => json<AddonMetaDto>(r));

export const getAddonStreams = (id: string, type: string, itemId: string): Promise<AddonStreamDto[]> =>
  fetch(`/api/stremio/addons/${seg(id)}/streams/${seg(type)}/${seg(itemId)}`).then((r) => json<{ streams: AddonStreamDto[] }>(r)).then((d) => d.streams);

/**
 * Abre o torrent de um stream no engine P2P local. O servidor reconsulta o addon e usa o infohash
 * que ele responder — o cliente só manda a posição na lista (e, opcionalmente, outro arquivo).
 */
export const openAddonStream = (id: string, type: string, itemId: string, streamIndex: number, fileIndex?: number): Promise<TorrentOpenResponse> => {
  const q = fileIndex === undefined ? '' : `?fileIndex=${fileIndex}`;
  return fetch(`/api/stremio/addons/${seg(id)}/streams/${seg(type)}/${seg(itemId)}/${streamIndex}/open${q}`, { method: 'POST' }).then((r) =>
    json<TorrentOpenResponse>(r),
  );
};

/**
 * Legenda que o addon publica para o stream. O cliente manda a posição (stream e faixa), não a URL:
 * o servidor reconsulta o addon e baixa o arquivo com a barreira de host público.
 */
export const fetchAddonSubtitleVtt = (id: string, type: string, itemId: string, streamIndex: number, subIndex: number): Promise<string> =>
  fetch(`/api/stremio/addons/${seg(id)}/subtitles/${seg(type)}/${seg(itemId)}/${streamIndex}/${subIndex}`).then((r) => {
    if (!r.ok) return json<{ error?: string }>(r).then((d) => Promise.reject(new Error(d.error ?? 'não foi possível carregar a legenda do addon')));
    return r.text();
  });

export interface AddonStatusDto {
  ok: boolean;
  error: string | null;
}

export const getAddonStatus = (id: string): Promise<AddonStatusDto> => fetch(`/api/stremio/addons/${seg(id)}/status`).then((r) => json<AddonStatusDto>(r));

/** `index` é a posição na lista daquele addon; o servidor a usa ao abrir o torrent. */
export interface TitleStreamDto extends AddonStreamDto {
  index: number;
}

export interface TitleStreamsDto {
  imdbId: string | null;
  addons: Array<{
    addonId: string;
    name: string;
    host: string;
    /** Tipo e id do protocolo usados na consulta, necessários para abrir o torrent. */
    type: string;
    contentId: string;
    streams: TitleStreamDto[];
    error: string | null;
    /** Quando o id veio do catálogo do addon (ele não aceita o id do app), o nome que ele deu ao item. */
    matchedTitle?: string;
  }>;
}

export interface TitleStreamsQuery {
  /** Informe `tmdbId` (TMDB) ou `imdbId` (`tt…`, ex.: títulos da TVmaze). */
  tmdbId?: number;
  imdbId?: string;
  mediaType: 'movie' | 'tv';
  season?: number | null;
  episode?: number | null;
  /** Título e ano: usados para achar o item no catálogo de addons que só entendem id próprio (`afhd:…`). */
  title?: string;
  year?: string | null;
  /** Item aberto no catálogo de um addon: os streams próprios entram pelo id original. */
  addonId?: string;
  type?: string;
  itemId?: string;
  /** Consulta só este addon (a tela de carregamento pede um por um). */
  only?: string;
}

export const getTitleStreams = (opts: TitleStreamsQuery): Promise<TitleStreamsDto> => {
  const q = new URLSearchParams({ mediaType: opts.mediaType });
  if (opts.tmdbId) q.set('tmdbId', String(opts.tmdbId));
  if (opts.imdbId) q.set('imdbId', opts.imdbId);
  if (opts.season) q.set('season', String(opts.season));
  if (opts.episode) q.set('episode', String(opts.episode));
  if (opts.title) q.set('title', opts.title);
  if (opts.year) q.set('year', opts.year);
  if (opts.addonId && opts.type && opts.itemId) {
    q.set('addonId', opts.addonId);
    q.set('type', opts.type);
    q.set('itemId', opts.itemId);
  }
  if (opts.only) q.set('only', opts.only);
  return fetch(`/api/stremio/streams?${q}`).then((r) => json<TitleStreamsDto>(r));
};
