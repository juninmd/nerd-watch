import { mkdirSync } from 'node:fs';
import type { Readable } from 'node:stream';
import WebTorrent from 'webtorrent';
import { config, torrentEnabled } from '../config.ts';
import { isPlayableVideo } from '../media/playable.ts';
import { resolveVideoIndex, rankVideoFiles, type TorrentFileLike, type VideoCandidate } from './select.ts';

/**
 * Engine de torrent P2P em processo, escopado ao acervo de domínio público da Internet Archive.
 *
 * Duas decisões de escopo que valem registro:
 *
 * 1. **A URL do .torrent nunca vem do cliente.** Ela é derivada do `identifier` do item, que
 *    passa por uma allowlist de caracteres. Não existe endpoint que aceite magnet/.torrent
 *    arbitrário — é isso que separa "streaming do acervo livre" de um indexador de catálogo
 *    comercial, e o que mantém o app na linha que o README declara.
 * 2. **Sem semear após uso.** O torrent é destruído por ociosidade (ver `sweepIdleTorrents`),
 *    então nada continua em background depois que você fecha a aba.
 */

const IDENTIFIER_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const ARCHIVE_HOST = 'https://archive.org';

export class TorrentDisabledError extends Error {
  constructor() {
    super('torrent desligado (TORRENT_ENABLED=false)');
    this.name = 'TorrentDisabledError';
  }
}

export class TorrentInvalidIdentifierError extends Error {
  constructor(identifier: string) {
    super(`identifier inválido: ${identifier}`);
    this.name = 'TorrentInvalidIdentifierError';
  }
}

export class TorrentUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TorrentUnavailableError';
  }
}

/** Monta a URL do torrent oficial da Archive. Devolve `null` se o identifier não for seguro. */
export const archiveTorrentUrl = (identifier: string): string | null => {
  if (!IDENTIFIER_RE.test(identifier) || identifier.includes('..')) return null;
  const id = encodeURIComponent(identifier);
  return `${ARCHIVE_HOST}/download/${id}/${id}_archive.torrent`;
};

const CONTENT_TYPES: Record<string, string> = { mp4: 'video/mp4', m4v: 'video/mp4', webm: 'video/webm' };

const contentTypeFor = (name: string): string =>
  CONTENT_TYPES[name.slice(name.lastIndexOf('.') + 1).toLowerCase()] ?? 'application/octet-stream';

type Torrent = ReturnType<InstanceType<typeof WebTorrent>['add']>;

interface Handle {
  infoHash: string;
  identifier: string;
  torrent: Torrent;
  fileIndex: number;
  lastAccess: number;
}

const handles = new Map<string, Handle>();
let client: InstanceType<typeof WebTorrent> | null = null;
let sweeper: ReturnType<typeof setInterval> | null = null;

const getClient = (): InstanceType<typeof WebTorrent> => {
  if (client) return client;
  mkdirSync(config.torrent.downloadPath, { recursive: true });
  client = new WebTorrent({
    maxConns: config.torrent.maxConnections,
    path: config.torrent.downloadPath,
    // Teto modesto de upload: o app é player, não seedbox. `0` bloquearia o upload de vez e os
    // peers nos chocariam (ver comentário em config.ts) — quem encerra o seeding é o sweeper.
    uploadLimit: config.torrent.uploadLimitKbps * 1024,
  });
  // Sem este handler, um erro de rede do client derrubaria o processo inteiro.
  client.on('error', (err: Error) => console.error(`torrent: erro no client — ${err.message}`));
  return client;
};

const filesOf = (torrent: Torrent): TorrentFileLike[] => torrent.files.map((f) => ({ name: f.name, length: f.length }));

const destroyHandle = (handle: Handle): void => {
  handles.delete(handle.infoHash);
  handle.torrent.destroy();
};

/** LRU: mantém no máximo `maxActive` torrents vivos. */
const evictIfNeeded = (): void => {
  while (handles.size >= config.torrent.maxActive) {
    const oldest = [...handles.values()].sort((a, b) => a.lastAccess - b.lastAccess)[0];
    if (!oldest) return;
    destroyHandle(oldest);
  }
};

const waitForMetadata = (torrent: Torrent, identifier: string): Promise<void> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      torrent.destroy();
      reject(new TorrentUnavailableError(`metadata não chegou em ${config.torrent.metadataTimeoutMs / 1000}s (nenhum peer respondeu)`));
    }, config.torrent.metadataTimeoutMs);

    torrent.once('ready', () => {
      clearTimeout(timer);
      resolve();
    });
    torrent.once('error', (err: Error) => {
      clearTimeout(timer);
      torrent.destroy();
      reject(new TorrentUnavailableError(`${identifier}: ${err.message}`));
    });
  });

export interface OpenTorrentResult {
  infoHash: string;
  identifier: string;
  name: string;
  totalLength: number;
  /** Todos os vídeos tocáveis no navegador, do mais leve ao mais pesado. */
  videoFiles: VideoCandidate[];
  selected: VideoCandidate;
  /** `streamUrl` já aponta para o arquivo escolhido — o índice vai na URL, não em estado do servidor. */
  streamUrl: string;
}

const streamUrlFor = (infoHash: string, fileIndex: number): string => `/api/torrent/${infoHash}/stream/${fileIndex}`;

const buildResult = (handle: Handle, selected: VideoCandidate): OpenTorrentResult => ({
  infoHash: handle.infoHash,
  identifier: handle.identifier,
  name: handle.torrent.name,
  totalLength: handle.torrent.length,
  videoFiles: rankVideoFiles(filesOf(handle.torrent)),
  selected,
  streamUrl: streamUrlFor(handle.infoHash, selected.index),
});

/** Abre (ou reaproveita) o torrent de um item da Archive e escolhe o vídeo tocável. */
export const openArchiveTorrent = async (identifier: string, fileIndex?: number): Promise<OpenTorrentResult> => {
  if (!torrentEnabled()) throw new TorrentDisabledError();
  const url = archiveTorrentUrl(identifier);
  if (!url) throw new TorrentInvalidIdentifierError(identifier);

  const existing = [...handles.values()].find((h) => h.identifier === identifier && !h.torrent.destroyed);
  if (existing) {
    const selected = resolveVideoIndex(filesOf(existing.torrent), fileIndex);
    if (!selected) throw new TorrentUnavailableError('este item não tem vídeo tocável no navegador (MP4/WebM)');
    existing.fileIndex = selected.index;
    existing.lastAccess = Date.now();
    return buildResult(existing, selected);
  }

  evictIfNeeded();
  const torrent = getClient().add(url, { strategy: 'sequential' });
  await waitForMetadata(torrent, identifier);

  const selected = resolveVideoIndex(filesOf(torrent), fileIndex);
  if (!selected) {
    torrent.destroy();
    throw new TorrentUnavailableError('este item não tem vídeo tocável no navegador (MP4/WebM)');
  }

  const handle: Handle = {
    infoHash: torrent.infoHash,
    identifier,
    torrent,
    fileIndex: selected.index,
    lastAccess: Date.now(),
  };
  handles.set(handle.infoHash, handle);
  return buildResult(handle, selected);
};

export interface TorrentStatus {
  infoHash: string;
  identifier: string;
  name: string;
  selectedFile: string;
  /** 0..1 do arquivo escolhido. */
  progress: number;
  downloadSpeed: number;
  numPeers: number;
  downloaded: number;
  totalLength: number;
  streamUrl: string;
}

export const torrentStatus = (infoHash: string): TorrentStatus | null => {
  const handle = handles.get(infoHash);
  if (!handle || handle.torrent.destroyed) return null;
  const file = handle.torrent.files[handle.fileIndex];
  if (!file) return null;
  return {
    infoHash,
    identifier: handle.identifier,
    name: handle.torrent.name,
    selectedFile: file.name,
    progress: file.progress,
    downloadSpeed: handle.torrent.downloadSpeed,
    numPeers: handle.torrent.numPeers,
    downloaded: handle.torrent.downloaded,
    totalLength: file.length,
    streamUrl: streamUrlFor(infoHash, handle.fileIndex),
  };
};

export interface TorrentStreamTarget {
  name: string;
  length: number;
  contentType: string;
}

/**
 * Valida que `fileIndex` é um vídeo tocável deste torrent. Fica separado de `openTorrentStream`
 * para a rota decidir 404/416 antes de abrir qualquer socket.
 */
export const resolveStreamTarget = (infoHash: string, fileIndex: number): TorrentStreamTarget | null => {
  const handle = handles.get(infoHash);
  if (!handle || handle.torrent.destroyed) return null;
  const file = handle.torrent.files[fileIndex];
  if (!file || file.length === 0) return null;
  if (!isPlayableVideo(file.name)) return null;
  return { name: file.name, length: file.length, contentType: contentTypeFor(file.name) };
};

/** Abre o stream do trecho [start, end] do arquivo `fileIndex`, marcando o torrent como em uso. */
export const openTorrentStream = (infoHash: string, fileIndex: number, start: number, end: number): Readable | null => {
  const handle = handles.get(infoHash);
  if (!handle || handle.torrent.destroyed) return null;
  const file = handle.torrent.files[fileIndex];
  if (!file || file.length === 0) return null;

  handle.lastAccess = Date.now();
  const safeStart = Math.max(0, Math.min(start, file.length - 1));
  const safeEnd = Math.max(safeStart, Math.min(end, file.length - 1));
  return file.createReadStream({ start: safeStart, end: safeEnd }) as Readable;
};

export const closeTorrent = (infoHash: string): boolean => {
  const handle = handles.get(infoHash);
  if (!handle) return false;
  destroyHandle(handle);
  return true;
};

/** Destrói torrents sem leitura há mais de `idleMs`. Sem isso o app ficaria semeando pra sempre. */
export const sweepIdleTorrents = (now = Date.now()): number => {
  let closed = 0;
  for (const handle of [...handles.values()]) {
    if (now - handle.lastAccess > config.torrent.idleMs) {
      destroyHandle(handle);
      closed++;
    }
  }
  return closed;
};

export const startTorrentSweeper = (): void => {
  if (sweeper || !torrentEnabled()) return;
  sweeper = setInterval(() => sweepIdleTorrents(), 60_000);
  // Não segura o processo vivo por causa do timer.
  sweeper.unref?.();
};

export const stopTorrents = (): void => {
  if (sweeper) {
    clearInterval(sweeper);
    sweeper = null;
  }
  for (const handle of [...handles.values()]) destroyHandle(handle);
  handles.clear();
  client?.destroy();
  client = null;
};

export const activeTorrentCount = (): number => handles.size;
