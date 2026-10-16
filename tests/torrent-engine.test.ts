import { afterEach, describe, expect, test } from 'bun:test';
import {
  TorrentUnavailableError,
  TorrentUntrustedSourceError,
  assertArchiveOnlySources,
  loadTrustedTorrentBuffer,
} from '../src/server/torrent/engine.ts';

/**
 * Os testes do commit anterior cobriam só funções puras: dava para reverter a ordem
 * `validar → add` (o bug que motivou aquela rodada) e a suíte continuava verde. Estes exercitam
 * a fronteira de verdade, com um `.torrent` sintético e o `fetch` trocado.
 */

const encoder = new TextEncoder();

const cat = (...parts: Uint8Array[]): Uint8Array => {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
};

const bstr = (value: string): Uint8Array => {
  const bytes = encoder.encode(value);
  return cat(encoder.encode(`${bytes.length}:`), bytes);
};
const bint = (value: number): Uint8Array => encoder.encode(`i${value}e`);
const blist = (...items: Uint8Array[]): Uint8Array => cat(encoder.encode('l'), ...items, encoder.encode('e'));
const bdict = (pairs: Array<[string, Uint8Array]>): Uint8Array =>
  cat(encoder.encode('d'), ...pairs.flatMap(([key, value]) => [bstr(key), value]), encoder.encode('e'));

/** Menor torrent que o parse-torrent aceita, com `announce` e `url-list` escolhidos pelo teste. */
const makeTorrent = (announce: string[], urlList: string[] = []): Uint8Array => {
  const info = bdict([
    ['name', bstr('item-de-teste')],
    ['piece length', bint(16384)],
    ['pieces', bstr('a'.repeat(20))],
    ['length', bint(100)],
  ]);
  const pairs: Array<[string, Uint8Array]> = [['announce', bstr(announce[0] ?? '')]];
  if (announce.length > 0) pairs.push(['announce-list', blist(...announce.map((a) => blist(bstr(a))))]);
  if (urlList.length > 0) pairs.push(['url-list', urlList.length === 1 ? bstr(urlList[0] ?? '') : blist(...urlList.map(bstr))]);
  pairs.push(['info', info]);
  return cat(bdict(pairs));
};

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

const stubFetch = (body: Uint8Array | Error, init: { status?: number; headers?: Record<string, string> } = {}): void => {
  globalThis.fetch = (async () => {
    if (body instanceof Error) throw body;
    return new Response(body as unknown as BodyInit, {
      status: init.status ?? 200,
      headers: init.headers ?? { 'content-type': 'application/x-bittorrent' },
    });
  }) as unknown as typeof fetch;
};

const TORRENT_URL = 'https://archive.org/download/item-de-teste/item-de-teste_archive.torrent';

describe('loadTrustedTorrentBuffer', () => {
  test('devolve o buffer quando as fontes são do archive.org', async () => {
    const torrent = makeTorrent(['http://bt1.archive.org:6969/announce'], ['https://archive.org/download/']);
    stubFetch(torrent);
    const buffer = await loadTrustedTorrentBuffer(TORRENT_URL);
    expect(buffer.length).toBe(torrent.length);
  });

  test('recusa o item quando o announce aponta para fora — a validação é do conteúdo, não da URL', async () => {
    // A URL pedida é a do archive.org; quem aponta para fora é o CONTEÚDO do .torrent.
    stubFetch(makeTorrent(['http://127.0.0.1:9/announce']));
    await expect(loadTrustedTorrentBuffer(TORRENT_URL)).rejects.toBeInstanceOf(TorrentUntrustedSourceError);
  });

  test('recusa o item quando um web seed aponta para fora', async () => {
    stubFetch(makeTorrent(['http://bt1.archive.org:6969/announce'], ['http://evil.com/items/']));
    await expect(loadTrustedTorrentBuffer(TORRENT_URL)).rejects.toBeInstanceOf(TorrentUntrustedSourceError);
  });

  test('erro de rede vira TorrentUnavailableError (502), não 500', async () => {
    stubFetch(new TypeError('fetch failed'));
    await expect(loadTrustedTorrentBuffer(TORRENT_URL)).rejects.toBeInstanceOf(TorrentUnavailableError);
  });

  test('resposta HTTP ruim vira TorrentUnavailableError', async () => {
    stubFetch(new Uint8Array(0), { status: 503 });
    await expect(loadTrustedTorrentBuffer(TORRENT_URL)).rejects.toBeInstanceOf(TorrentUnavailableError);
  });

  test('corpo que não é torrent vira TorrentUnavailableError, não erro cru de parse', async () => {
    stubFetch(encoder.encode('<html>não é um torrent</html>'));
    await expect(loadTrustedTorrentBuffer(TORRENT_URL)).rejects.toBeInstanceOf(TorrentUnavailableError);
  });

  test('corpo vazio vira TorrentUnavailableError', async () => {
    stubFetch(new Uint8Array(0));
    await expect(loadTrustedTorrentBuffer(TORRENT_URL)).rejects.toBeInstanceOf(TorrentUnavailableError);
  });

  test('recusa pelo Content-Length antes de ler o corpo (mensagem identifica a checagem de header)', async () => {
    // `pull` de um ReadableStream roda de forma eager logo na construção, então não dá para provar
    // "não leu o corpo" por contagem de pull — a mensagem prova qual checagem disparou.
    globalThis.fetch = (async () =>
      new Response(new Uint8Array(8), {
        status: 200,
        headers: { 'content-length': String(64 * 1024 * 1024) },
      })) as unknown as typeof fetch;

    await expect(loadTrustedTorrentBuffer(TORRENT_URL)).rejects.toThrow(/Content-Length/);
  });

  test('recusa pelo tamanho do corpo quando não há Content-Length confiável', async () => {
    // Precisa ser maior que o teto de 16 MB para exercitar a checagem pós-leitura.
    stubFetch(new Uint8Array(17 * 1024 * 1024));
    await expect(loadTrustedTorrentBuffer(TORRENT_URL)).rejects.toThrow(/grande demais$/);
  });
});

describe('assertArchiveOnlySources — falha fechada', () => {
  test('aceita o FQDN raiz com ponto final', () => {
    expect(() => assertArchiveOnlySources(['http://archive.org./announce'], [])).not.toThrow();
  });

  test('recusa URL que não parseia, em vez de pular', () => {
    expect(() => assertArchiveOnlySources(['http://'], [])).toThrow(TorrentUntrustedSourceError);
    expect(() => assertArchiveOnlySources(['//evil.com/announce'], [])).toThrow(TorrentUntrustedSourceError);
    expect(() => assertArchiveOnlySources(['não é url'], [])).toThrow(TorrentUntrustedSourceError);
  });

  test('recusa IPv6 literal', () => {
    expect(() => assertArchiveOnlySources(['http://[::1]/announce'], [])).toThrow(TorrentUntrustedSourceError);
  });

  test('aceita tracker por UDP no domínio da Archive', () => {
    expect(() => assertArchiveOnlySources(['udp://bt1.archive.org:6969/announce'], [])).not.toThrow();
  });
});
