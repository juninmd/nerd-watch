import { mkdirSync } from 'node:fs';
import parseTorrent from 'parse-torrent';
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
 * 2. **O .torrent é validado ANTES de entrar no engine.** Ele é dado remoto e traz trackers e web
 *    seeds que o webtorrent contata sozinho, começando já na construção do Torrent. Por isso nós
 *    baixamos e parseamos o arquivo e conferimos os hosts antes de chamar `add()` — se só
 *    conferíssemos depois, a requisição para o host de terceiro já teria saído (ver
 *    `assertArchiveOnlySources`).
 * 3. **Sem semear após uso.** O torrent é destruído por ociosidade (ver `sweepIdleTorrents`) e o
 *    store é apagado junto, então nada continua em background nem acumula disco.
 */

const IDENTIFIER_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const ARCHIVE_HOST = 'https://archive.org';
const ARCHIVE_HOST_RE = /(^|\.)archive\.org$/i;
/** `.torrent` da Archive gira em torno de 1 MB; o teto evita baixar algo absurdo de um item estranho. */
const MAX_TORRENT_BYTES = 16 * 1024 * 1024;

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

const hostOf = (url: string): string | null => {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
};

/**
 * Confere trackers e web seeds declarados pelo próprio `.torrent` contra `*.archive.org`.
 *
 * É a parte que impede o servidor local de virar cliente de URLs escolhidas por quem publicou: o
 * acervo da Archive é aberto para upload, então um item de terceiro poderia declarar
 * `announce`/`url-list` apontando para qualquer host (inclusive loopback) e o webtorrent faria a
 * requisição. `new URL().hostname` resiste a userinfo (`archive.org@evil.com`), prefixo
 * (`notarchive.org`) e sufixo (`archive.org.evil.com`).
 *
 * Todos os itens de domínio público amostrados usam apenas `archive.org` e `bt1/bt2.archive.org`.
 */
export const assertArchiveOnlySources = (announce: readonly string[], urlList: readonly string[]): void => {
  const urls = [...announce, ...urlList];
  const foreign = [...new Set(urls.map(hostOf).filter((h): h is string => h !== null && !ARCHIVE_HOST_RE.test(h)))];
  if (foreign.length > 0) throw new TorrentUntrustedSourceError(foreign);
};

/** Baixa o `.torrent` com timeout e teto de tamanho — nosso fetch, antes de qualquer descoberta. */
const fetchTorrentBuffer = async (url: string): Promise<Buffer> => {
  const res = await fetch(url, { signal: AbortSignal.timeout(config.torrent.metadataTimeoutMs) });
  if (!res.ok) throw new TorrentUnavailableError(`a Archive respondeu ${res.status} para o .torrent deste item`);
  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.length === 0) throw new TorrentUnavailableError('o .torrent deste item veio vazio');
  if (buffer.length > MAX_TORRENT_BYTES) throw new TorrentUnavailableError('o .torrent deste item é grande demais');
  return buffer;
};

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
/** Aberturas em andamento por identifier: evita abrir o mesmo item duas vezes e conta no teto. */
const opening = new Map<string, Promise<Handle>>();
let client: InstanceType<typeof WebTorrent> | null = null;
let sweeper: ReturnType<typeof setInterval> | null = null;

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

/**
 * LRU: mantém no máximo `maxActive` torrents vivos, nunca derrubando um que esteja servindo bytes.
 *
 * Best-effort de propósito: se todos os handles estiverem com leitura ativa, um item novo ainda
 * abre (preferimos atender a quem clicou a estourar o teto). Como `opening` é contado, uma rajada
 * de aberturas simultâneas não fura o limite enquanto houver algo ocioso para recolher.
 */
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
  // Baixamos e validamos o .torrent antes de entregá-lo ao engine: assim nenhuma descoberta
  // (tracker/DHT/web seed) começa antes de sabermos para onde o torrent aponta.
  const buffer = await fetchTorrentBuffer(url);
  const parsed = (await parseTorrent(buffer)) as { announce?: string[]; urlList?: string[] };
  assertArchiveOnlySources(parsed.announce ?? [], parsed.urlList ?? []);

  evictIfNeeded();
  // `path` e `destroyStoreOnDestroy` só são lidos das options do `add` (o client não as repassa ao
  // construir o Torrent — ver `new Torrent(torrentId, this, opts)` no webtorrent). Sem repetir
  // aqui, os pedaços vão para a pasta temporária do sistema e nunca são apagados.
  const torrent = getClient().add(buffer, {
    strategy: 'sequential',
    path: config.torrent.downloadPath,
    destroyStoreOnDestroy: true,
  });

  try {
    await waitForMetadata(torrent, identifier);
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

  // Duas chamadas simultâneas para o mesmo item não abrem dois torrents: a segunda espera a
  // primeira e só escolhe o arquivo. O `finally` limpa mesmo se a abertura falhar, então uma
  // tentativa fracassada não deixa estado preso aqui.
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

  // De propósito NÃO renovamos `lastAccess` aqui. O cliente faz polling a cada 2s enquanto o painel
  // está montado, então renovar transformaria o poll em "atividade" e o sweeper nunca dispararia:
  // uma aba esquecida baixaria o arquivo inteiro, porque o webtorrent fica pedindo pedaços sozinho
  // (medido: ~50 MB em 20s sem nenhuma leitura). Quem segura o handle é a leitura de verdade —
  // `activeStreams` — e quem encerra é o fechamento explícito ou o sweeper.

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

/**
 * Quantos bytes pedir ao iterador do webtorrent para servir exatamente `[start, end]`.
 *
 * O iterador trata `end` falsy como "até o fim do arquivo", e `0` é falsy: um range de um byte no
 * offset 0 viraria o arquivo inteiro. Pedimos sempre pelo menos `start + 1` e cortamos o excedente
 * na saída, então este valor é deliberadamente folgado — quem garante o tamanho é o corte.
 */
export const paddedIterEnd = (start: number, end: number): number => Math.max(end, start + 1);

/**
 * Consome `wanted` bytes do iterador e encerra. Extraído de `openTorrentStream` para ser testável
 * com um iterador falso — é onde mora a garantia de que o corpo não excede o `Content-Length`.
 * `onDone` roda uma única vez, em qualquer desfecho, e sempre antes de o stream terminar.
 */
export const streamExactBytes = (
  iterator: AsyncIterator<Uint8Array>,
  wanted: number,
  onDone: () => void,
): ReadableStream<Uint8Array> => {
  let sent = 0;
  let finalized = false;
  let cancelled = false;

  /** Roda uma única vez, em qualquer desfecho. Devolver o iterador é o que libera os pedaços. */
  const finalize = async (): Promise<void> => {
    if (finalized) return;
    finalized = true;
    onDone();
    // Sem o `return()` o webtorrent mantém os pedaços selecionados em prioridade alta até o
    // torrent morrer: o `_deselect` dele só acontece no `return()` ou no fim natural da iteração.
    try {
      await iterator.return?.(undefined);
    } catch {
      /* o iterador já pode ter morrido junto com o torrent */
    }
  };

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (cancelled) return;
      if (sent >= wanted) {
        await finalize();
        controller.close();
        return;
      }
      try {
        const { value, done } = await iterator.next();
        // Um `cancel()` pode ter acontecido enquanto o `next()` estava em voo: mexer no controller
        // aqui seria operação sobre um stream já fechado.
        if (cancelled) return;
        if (done) {
          await finalize();
          controller.close();
          return;
        }
        const remaining = wanted - sent;
        const out = value.length > remaining ? value.subarray(0, remaining) : value;
        sent += out.length;
        controller.enqueue(out);
      } catch (err) {
        await finalize();
        if (!cancelled) controller.error(err);
      }
    },
    async cancel() {
      cancelled = true;
      await finalize();
    },
  });
};

/**
 * Abre o stream do trecho `[start, end]` (inclusivo) do arquivo escolhido, contando como leitura
 * ativa do handle para o sweeper e o LRU não derrubarem o torrent no meio da reprodução.
 */
export const openTorrentStream = (infoHash: string, fileIndex: number, start: number, end: number): ReadableStream<Uint8Array> | null => {
  const handle = handles.get(infoHash);
  if (!handle || handle.torrent.destroyed) return null;
  const file = handle.torrent.files[fileIndex] as TorrentFile | undefined;
  if (!file || file.length === 0) return null;

  handle.lastAccess = Date.now();
  handle.activeStreams++;

  const iterator = file[Symbol.asyncIterator]({ start, end: paddedIterEnd(start, end) });
  return streamExactBytes(iterator, end - start + 1, () => {
    handle.activeStreams = Math.max(0, handle.activeStreams - 1);
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
