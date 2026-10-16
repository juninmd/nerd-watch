/**
 * Declaração mínima do webtorrent — só a superfície que o nerd-watch usa.
 *
 * O `@types/webtorrent` do DefinitelyTyped está desatualizado para a versão instalada
 * (não conhece `path`/`maxConns` nas options nem `torrent.destroyed`), e dependência de
 * tipos errada é pior que nenhuma. Mesma abordagem do `src/client/plyr.d.ts`.
 */
declare module 'webtorrent' {
  import type { Readable } from 'node:stream';

  interface Options {
    path?: string;
    maxConns?: number;
    downloadLimit?: number;
    uploadLimit?: number;
    dht?: boolean;
    tracker?: boolean;
    lsd?: boolean;
    utp?: boolean;
  }

  interface AddOptions {
    path?: string;
    /** `sequential` é o que permite tocar antes de baixar o arquivo inteiro. */
    strategy?: 'sequential' | 'rarest';
  }

  interface CreateReadStreamOptions {
    start?: number;
    end?: number;
  }

  interface TorrentFile {
    name: string;
    length: number;
    /** 0..1 do arquivo. */
    progress: number;
    createReadStream(opts?: CreateReadStreamOptions): Readable;
  }

  interface Torrent {
    infoHash: string;
    name: string;
    length: number;
    files: TorrentFile[];
    announce: string[];
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
    add(torrentId: string, opts?: AddOptions): Torrent;
    get(torrentId: string): Torrent | null;
    remove(torrentId: string, cb?: () => void): void;
    on(event: 'error', cb: (err: Error) => void): void;
    on(event: string, cb: (...args: never[]) => void): void;
    destroy(cb?: () => void): void;
  }
}
