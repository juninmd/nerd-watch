import { mkdirSync } from 'node:fs';
import WebTorrent from 'webtorrent';
import { config, torrentEnabled } from '../config.ts';
import { isPlayableVideo } from '../media/playable.ts';
import { rankVideoFiles, resolveVideoIndex, type TorrentFileLike, type VideoCandidate } from './select.ts';

/**
 * Engine de torrent P2P em processo, escopado ao acervo de domínio público da Internet Archive.
 *
 * Decisões de escopo que valem registro:
 *
 * 1. **A URL do .torrent nunca vem do cliente.** Ela é derivada do `identifier` do item, que passa
 *    por uma allowlist de caracteres. Não existe endpoint que aceite magnet/.torrent arbitrário —
 *    é isso que separa "streaming do acervo livre" de um indexador de catálogo comercial.
 * 2. **Fontes do torrent são conferidas.** Mesmo com a URL derivada, o conteúdo do .torrent é
 *    dado remoto: ele traz trackers e web seeds que o webtorrent contata sozinho. Conferimos que
 *    todos os hosts são `*.archive.org` e recusamos o item caso contrário (ver
 *    `assertArchiveOnlySources`) — sem isso, um item malicioso no acervo aberto da Archive
 *    conseguiria fazer o servidor local buscar URLs de terceiros.
 * 3. **Sem semear após uso.** O torrent é destruído por ociosidade (ver `sweepIdleTorrents`) e o
 *    store é apagado junto, então nada continua em background nem acumula disco.
 */

const IDENTIFIER_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const ARCHIVE_HOST = 'https://archive.org';
const ARCHIVE_HOST_RE = /(^|\.)archive\.org$/i;

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

export class TorrentUntrustedSourceError extends Error {
  constructor(public hosts: string[]) {
    super(`o torrent aponta para hosts fora do archive.org: ${hosts.join(', ')}`);
    this.name = 'TorrentUntrustedSourceError';
  }
}

export class TorrentNoPlayableVideoError extends Error {
  constructor() {
    super('este item não tem vídeo tocável no navegador (MP4/WebM)');
    this.name = 'TorrentNoPlayableVideoError';
  }
}

export class TorrentBadFileIndexError extends Error {
  constructor(index: number) {
    super(`o arquivo ${index} deste item não é um vídeo tocável`);
    this.name = 'TorrentBadFileIndexError';
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
type TorrentFile = Torrent['files'][number];

interface Handle {
  infoHash: string;
  identifier: string;
  torrent: Torrent;
  fileIndex: number;
  lastAccess: number;
  /** Leituras em andamento. Enquanto houver uma, o handle não pode ser destruído. */
  activeStreams: number;
}

const handles = new Map<string, Handle>();
/** Aberturas em andamento por identifier: deduplica chamadas concorrentes e conta no teto de LRU. */
const opening = new Map<string, Promise<Handle>>();
let client: InstanceType<typeof WebTorrent> | null = null;
let sweeper: ReturnType<typeof setInterval> | null = null;

const hostOf = (url: string): string | null => {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
};

/**
 * O .torrent é dado remoto: além do conteúdo, ele carrega `announce` (trackers HTTP/UDP/wss) e
 * `url-list` (web seeds HTTP), que o webtorrent passa a contatar por conta própria. Sem esta
 * conferência, um item publicado por terceiro no acervo aberto da Archive transformaria o servidor
 * local num cliente que busca URLs escolhidas por quem publicou. Todos os itens legítimos amostrados
 * usam apenas `archive.org` e `bt1.archive.org`.
 */
const assertArchiveOnlySources = (torrent: Torrent): void => {
  const urls = [...torrent.announce, ...torrent.urlList];
  const foreign = [...new Set(urls.map(hostOf).filter((h): h is string => h !== null && !ARCHIVE_HOST_RE.test(h)))];
  if (foreign.length > 0) throw new TorrentUntrustedSourceError(foreign);
};

const getClient = (): InstanceType<typeof WebTorrent> => {
  if (client) return client;
  mkdirSync(config.torrent.downloadPath, { recursive: true });
  client = new WebTorrent({
    maxConns: config.torrent.maxConnections,
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

/** LRU: mantém no máximo `maxActive` torrents vivos. Nunca derruba um que esteja servindo bytes. */
const evictIfNeeded = (): void => {
  while (handles.size + opening.size >= config.torrent.maxActive) {
    const oldest = [...handles.values()]
      .filter((h) => h.activeStreams === 0)
      .sort((a, b) => a.lastAccess - b.lastAccess)[0];
    if (!oldest) return;
    destroyHandle(oldest);
  }
};

const waitForMetadata = (torrent: Torrent, identifier: string): Promise<void> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new TorrentUnavailableError(`metadata não chegou em ${config.torrent.metadataTimeoutMs / 1000}s (nenhum peer respondeu)`));
    }, config.torrent.metadataTimeoutMs);

    torrent.once('ready', () => {
      clearTimeout(timer);
      resolve();
    });
    torrent.once('error', (err: Error) => {
      clearTimeout(timer);
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

/** Troca o derivado de um handle já aberto (ou só descreve o atual, se `fileIndex` for omitido). */
const applyFileIndex = (handle: Handle, fileIndex: number | undefined): OpenTorrentResult => {
  const candidates = rankVideoFiles(filesOf(handle.torrent));
  if (candidates.length === 0) throw new TorrentNoPlayableVideoError();

  const selected = resolveVideoIndex(filesOf(handle.torrent), fileIndex);
  if (!selected) throw new TorrentBadFileIndexError(fileIndex ?? -1);

  handle.fileIndex = selected.index;
  handle.lastAccess = Date.now();
  return {
    infoHash: handle.infoHash,
    identifier: handle.identifier,
    name: handle.torrent.name,
    totalLength: handle.torrent.length,
    videoFiles: candidates,
    selected,
    streamUrl: streamUrlFor(handle.infoHash, selected.index),
  };
};

const openFresh = async (url: string, identifier: string): Promise<Handle> => {
  evictIfNeeded();
  // `path` e `destroyStoreOnDestroy` só são lidos das options do `add` (o client não as repassa
  // ao construir o Torrent — ver `new Torrent(torrentId, this, opts)` no webtorrent). Sem repetir
  // aqui, os pedaços vão para a pasta temporária do sistema e nunca são apagados.
  const torrent = getClient().add(url, {
    strategy: 'sequential',
    path: config.torrent.downloadPath,
    destroyStoreOnDestroy: true,
  });

  try {
    await waitForMetadata(torrent, identifier);
    assertArchiveOnlySources(torrent);
    if (rankVideoFiles(filesOf(torrent)).length === 0) throw new TorrentNoPlayableVideoError();
  } catch (err) {
    torrent.destroy();
    throw err;
  }

  const handle: Handle = {
    infoHash: torrent.infoHash,
    identifier,
    torrent,
    fileIndex: 0,
    lastAccess: Date.now(),
    activeStreams: 0,
  };
  handles.set(handle.infoHash, handle);
  return handle;
};

/** Abre (ou reaproveita) o torrent de um item da Archive e escolhe o vídeo tocável. */
export const openArchiveTorrent = async (identifier: string, fileIndex?: number): Promise<OpenTorrentResult> => {
  if (!torrentEnabled()) throw new TorrentDisabledError();
  const url = archiveTorrentUrl(identifier);
  if (!url) throw new TorrentInvalidIdentifierError(identifier);

  const reuse = [...handles.values()].find((h) => h.identifier === identifier && !h.torrent.destroyed);
  if (reuse) return applyFileIndex(reuse, fileIndex);

  // Duas chamadas simultâneas para o mesmo item não podem abrir dois torrents, e a abertura em
  // curso precisa contar no teto de LRU (senão N POSTs concorrentes furam o `maxActive`).
  const inflight = opening.get(identifier);
  if (inflight) return applyFileIndex(await inflight, fileIndex);

  const task = openFresh(url, identifier);
  opening.set(identifier, task);
  try {
    return applyFileIndex(await task, fileIndex);
  } finally {
    opening.delete(identifier);
  }
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

  // O cliente faz polling a cada 2s: isso também renova o "em uso" do handle, para um torrent que
  // está tocando não ser recolhido pelo sweeper entre uma leitura e outra.
  handle.lastAccess = Date.now();

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

export type TorrentStream = ReadableStream<Uint8Array>;

/**
 * Lê exatamente `[start, end]` (inclusivo) do arquivo.
 *
 * Não dá para delegar o recorte ao `createReadStream` do webtorrent por dois motivos: ele trata
 * `end` falsy como "até o fim do arquivo", então um range de 1 byte no offset 0 (`end === 0`)
 * baixaria o arquivo inteiro; e nada nele garante que o stream pare em `end`. Passamos um `end`
 * deliberadamente folgado (nunca menor que `start + 1`, para nunca cair no caso falsy) e cortamos
 * aqui — o corpo da resposta nunca excede o `Content-Length` declarado.
 */
export const openTorrentStream = (infoHash: string, fileIndex: number, start: number, end: number): TorrentStream | null => {
  const handle = handles.get(infoHash);
  if (!handle || handle.torrent.destroyed) return null;
  const file = handle.torrent.files[fileIndex] as TorrentFile | undefined;
  if (!file || file.length === 0) return null;

  handle.lastAccess = Date.now();
  handle.activeStreams++;

  const wanted = end - start + 1;
  const iterator = file[Symbol.asyncIterator]({ start, end: Math.max(end, start + 1) });
  let sent = 0;
  let released = false;
  const release = (): void => {
    if (released) return;
    released = true;
    handle.activeStreams = Math.max(0, handle.activeStreams - 1);
  };

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (sent >= wanted) {
        release();
        controller.close();
        return;
      }
      try {
        const { value, done } = await iterator.next();
        if (done) {
          release();
          controller.close();
          return;
        }
        const chunk = value;
        const remaining = wanted - sent;
        const out = chunk.length > remaining ? chunk.subarray(0, remaining) : chunk;
        sent += out.length;
        controller.enqueue(out);
      } catch (err) {
        release();
        controller.error(err);
      }
    },
    async cancel() {
      release();
      await iterator.return?.(undefined);
    },
  });
};

export const closeTorrent = (infoHash: string): boolean => {
  const handle = handles.get(infoHash);
  if (!handle) return false;
  destroyHandle(handle);
  return true;
};

/** Destrói torrents sem leitura há mais de `idleMs`, exceto os que estão servindo bytes agora. */
export const sweepIdleTorrents = (now = Date.now()): number => {
  let closed = 0;
  for (const handle of [...handles.values()]) {
    if (handle.activeStreams > 0) continue;
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
  opening.clear();
  client?.destroy();
  client = null;
};

export const activeTorrentCount = (): number => handles.size;
