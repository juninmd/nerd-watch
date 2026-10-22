/**
 * Monta `.torrent` sintéticos em bencode, à mão, para os testes do provider. Nada disto vem da rede:
 * os valores são fixtures óbvias e o infohash sai do próprio conteúdo do `info`.
 */

const encoder = new TextEncoder();

export const cat = (...parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
};

export const bstr = (value: string): Uint8Array => {
  const bytes = encoder.encode(value);
  return cat(encoder.encode(`${bytes.length}:`), bytes);
};
export const bint = (value: number): Uint8Array => encoder.encode(`i${value}e`);
export const blist = (...items: Uint8Array[]): Uint8Array => cat(encoder.encode('l'), ...items, encoder.encode('e'));
export const bdict = (pairs: Array<[string, Uint8Array]>): Uint8Array =>
  cat(encoder.encode('d'), ...pairs.flatMap(([k, v]) => [bstr(k), v]), encoder.encode('e'));

export interface TorrentOpts {
  name?: string;
  /** Trackers do `announce`/`announce-list`. O primeiro vira `announce`. */
  announce?: string[];
  /** Web seeds (`url-list`). */
  urlList?: string[];
  /** Vários arquivos (forma `files`); sem isso o torrent tem um único arquivo. */
  files?: string[];
}

/** `.torrent` de teste. O `info` é fixo, então o infohash depende só de `name` e `files`. */
export const makeTorrent = (opts: TorrentOpts = {}): Uint8Array => {
  const files = opts.files ?? [];
  const name = bstr(opts.name ?? 'item-de-teste');
  const info =
    files.length > 0
      ? bdict([
          ['name', name],
          ['piece length', bint(16384)],
          ['pieces', bstr('a'.repeat(20))],
          ['files', blist(...files.map((path) => bdict([['length', bint(100)], ['path', blist(bstr(path))]])))],
        ])
      : bdict([
          ['name', name],
          ['piece length', bint(16384)],
          ['pieces', bstr('a'.repeat(20))],
          ['length', bint(100)],
        ]);

  const pairs: Array<[string, Uint8Array]> = [];
  const announce = opts.announce ?? [];
  if (announce.length > 0) {
    pairs.push(['announce', bstr(announce[0] as string)]);
    pairs.push(['announce-list', blist(...announce.map((a) => blist(bstr(a))))]);
  }
  const urlList = opts.urlList ?? [];
  if (urlList.length > 0) pairs.push(['url-list', urlList.length === 1 ? bstr(urlList[0] as string) : blist(...urlList.map(bstr))]);
  pairs.push(['info', info]);
  return bdict(pairs);
};
