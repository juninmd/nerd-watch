import type { TorrentOpenResponse } from './torrent.ts';
import { json } from './http.ts';

export interface AddonCatalogDto {
  type: string;
  id: string;
  name: string;
  searchable: boolean;
  paged: boolean;
}

/** O servidor nunca devolve o link do manifest (pode ter token no caminho): só o domínio. */
export interface AddonDto {
  id: string;
  host: string;
  name: string;
  version: string;
  description: string;
  logo: string | null;
  types: string[];
  resources: string[];
  catalogs: AddonCatalogDto[];
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
  videos: Array<{ id: string; title: string; season: number | null; episode: number | null }>;
}

export interface AddonStreamDto {
  kind: 'url' | 'youtube' | 'external' | 'torrent';
  title: string;
  url: string | null;
  /** Só em `torrent`: infohash normalizado e o índice de arquivo sugerido pelo addon. */
  infoHash: string | null;
  fileIdx: number | null;
  /** Nome do arquivo sugerido, quando o addon manda `behaviorHints.filename`. */
  filename: string | null;
}

const seg = encodeURIComponent;

export const listAddons = (): Promise<AddonDto[]> => fetch('/api/stremio/addons').then((r) => json<{ addons: AddonDto[] }>(r)).then((d) => d.addons);

export const installAddon = (url: string): Promise<AddonDto> =>
  fetch('/api/stremio/addons', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }) }).then((r) => json<AddonDto>(r));

export const removeAddon = (id: string): Promise<void> => fetch(`/api/stremio/addons/${seg(id)}`, { method: 'DELETE' }).then((r) => json<unknown>(r).then(() => undefined));

export const getAddonCatalog = (id: string, type: string, catalogId: string, opts: { search?: string; skip?: number } = {}): Promise<AddonItemDto[]> => {
  const q = new URLSearchParams();
  if (opts.search) q.set('search', opts.search);
  if (opts.skip) q.set('skip', String(opts.skip));
  return fetch(`/api/stremio/addons/${seg(id)}/catalog/${seg(type)}/${seg(catalogId)}?${q}`).then((r) => json<{ items: AddonItemDto[] }>(r)).then((d) => d.items);
};

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
