/**
 * Declaração mínima do parse-torrent — só o que o nerd-watch usa.
 *
 * O pacote é ESM puro, sem tipos publicados, e o `parseTorrent` é **async** (retorna Promise), o
 * que é fácil de errar: `Object.keys(await …)` devolve as chaves, `Object.keys(…)` sem `await`
 * devolve lista vazia e passa desapercebido.
 */
declare module 'parse-torrent' {
  interface ParsedTorrent {
    infoHash: string;
    name: string;
    length: number;
    /** Trackers declarados pelo .torrent. Ausente quando o torrent não declara nenhum. */
    announce?: string[];
    /** Web seeds HTTP declarados pelo .torrent (`url-list`). */
    urlList?: string[];
    files: Array<{ name: string; length: number }>;
  }

  export default function parseTorrent(torrentId: Uint8Array | Buffer | string): Promise<ParsedTorrent>;
}
