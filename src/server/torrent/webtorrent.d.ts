/**
 * Declaração mínima do webtorrent — só a superfície que o nerd-watch usa.
 *
 * O `@types/webtorrent` do DefinitelyTyped está desatualizado para a versão instalada, e um tipo
 * errado é pior que nenhum: ele compila um erro de runtime sem reclamar. Duas armadilhas concretas
 * que esta declaração existe para não repetir (mesma abordagem de declarar o módulo à mão):
 *
 * - `path` NÃO é lido das options do construtor do client, só das options do `add` (por torrent).
 *   Declarar em `Options` deixava o `tsc` abençoar o engano de configurar o diretório no client.
 * - `createReadStream`/o iterador assíncrono tratam `end` falsy como "até o fim do arquivo".
 */
declare module 'webtorrent' {
  import type { Readable } from 'node:stream';

  interface Options {
    maxConns?: number;
    downloadLimit?: number;
    uploadLimit?: number;
    dht?: boolean;
    tracker?: boolean;
    lsd?: boolean;
    utp?: boolean;
  }

  /**
   * Options do `add`. `path` e `destroyStoreOnDestroy` moram AQUI, não nas do client: o client não
   * as repassa ao construir o Torrent (`new Torrent(torrentId, this, opts)`), então declará-las em
   * `Options` deixaria o `tsc` aprovar uma configuração que não tem efeito nenhum.
   */
  interface AddOptions {
    /** Diretório de download deste torrent. */
    path?: string;
    /** Apaga os pedaços baixados quando o torrent é destruído. */
    destroyStoreOnDestroy?: boolean;
    /** `sequential` é o que permite tocar antes de baixar o arquivo inteiro. */
    strategy?: 'sequential' | 'rarest';
  }

  /** `start`/`end` são inclusivos, em bytes. */
  interface RangeOptions {
    start?: number;
    end?: number;
  }

  interface TorrentFile {
    /** Último segmento do caminho. Não normalizado: para o disco use `path`. */
    name: string;
    /** Caminho dentro do torrent, normalizado pelo parse-torrent (`..` acima da raiz já colapsado). */
    path: string;
    length: number;
    /** 0..1 do arquivo. */
    progress: number;
    createReadStream(opts?: RangeOptions): Readable;
    [Symbol.asyncIterator](opts?: RangeOptions): AsyncIterator<Uint8Array>;
  }

  interface Torrent {
    infoHash: string;
    name: string;
    length: number;
    files: TorrentFile[];
    /** Trackers (http/udp/wss). */
    announce: string[];
    /** Web seeds HTTP declarados pelo próprio .torrent. */
    urlList: string[];
    numPeers: number;
    downloaded: number;
    uploaded: number;
    downloadSpeed: number;
    uploadSpeed: number;
    destroyed: boolean;
    once(event: 'ready', cb: () => void): void;
    once(event: 'error', cb: (err: Error) => void): void;
    on(event: string, cb: (...args: never[]) => void): void;
    destroy(cb?: () => void): void;
  }

  export default class WebTorrent {
    constructor(opts?: Options);
    /** `torrentId` pode ser URL/magnet ou o próprio `.torrent` já lido (aí nada é baixado). */
    add(torrentId: string | Uint8Array, opts?: AddOptions): Torrent;
    /** Assíncrono no runtime (3.0.21) — consumido com `await`. */
    get(torrentId: string): Promise<Torrent | null>;
    remove(torrentId: string, opts?: { destroyStore?: boolean }, cb?: () => void): void;
    on(event: 'error', cb: (err: Error) => void): void;
    on(event: string, cb: (...args: never[]) => void): void;
    destroy(cb?: () => void): void;
  }
}
