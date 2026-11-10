import { json } from './http.ts';

/** Arquivo de vídeo tocável dentro do torrent, já ordenado pelo servidor (mais leve primeiro). */
export interface TorrentFileDto {
  index: number;
  name: string;
  length: number;
  preference: number;
  label: string;
}

export interface TorrentOpenResponse {
  infoHash: string;
  identifier: string;
  name: string;
  totalLength: number;
  videoFiles: TorrentFileDto[];
  selected: TorrentFileDto;
  streamUrl: string;
}

export const openTorrent = (identifier: string, fileIndex?: number): Promise<TorrentOpenResponse> =>
  fetch('/api/torrent/open', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(fileIndex === undefined ? { identifier } : { identifier, fileIndex }),
  }).then((r) => json<TorrentOpenResponse>(r));

export interface TorrentStatusDto {
  infoHash: string;
  identifier: string;
  name: string;
  selectedFile: string;
  progress: number;
  downloadSpeed: number;
  numPeers: number;
  downloaded: number;
  totalLength: number;
  streamUrl: string;
}

export const getTorrentStatus = (infoHash: string): Promise<TorrentStatusDto> =>
  fetch(`/api/torrent/${encodeURIComponent(infoHash)}`).then((r) => json<TorrentStatusDto>(r));

export const closeTorrent = (infoHash: string): Promise<{ ok: true }> =>
  fetch(`/api/torrent/${encodeURIComponent(infoHash)}`, { method: 'DELETE' }).then((r) => json<{ ok: true }>(r));
