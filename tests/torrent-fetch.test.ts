import { afterEach, describe, expect, test } from 'bun:test';
import parseTorrent from 'parse-torrent';
import { SourceError } from '../src/server/providers/sources/types.ts';
import {
  TORRENT_FILE_MAX_BYTES,
  fetchTorrentBytes,
  httpsTorrentUrl,
  normalizeTorrentBytes,
} from '../src/server/providers/torrent/fetch-torrent.ts';
import { bdict, bint, blist, bstr, makeTorrent } from './helpers/torrent-bytes.ts';

/**
 * Baixar um `.torrent` de URL colada pelo usuário é a parte mais exposta do provider. Estes testes
 * usam `fetch` falso: nenhum deles toca a rede. O que se prova: esquema, host, redirect, tamanho e
 * formato são checados antes de qualquer coisa chegar ao engine, e erros não vazam o corpo remoto.
 */

const encoder = new TextEncoder();
/** `Response` aceita Blob; o `Uint8Array` genérico do TS atual não passa no `BodyInit` (copiar resolve o tipo). */
const bodyOf = (bytes: Uint8Array): BodyInit => new Blob([new Uint8Array(bytes)]);

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

type Reply = Response | Error;
/** Fila de respostas; devolve também as URLs pedidas e o `redirect` usado em cada uma. */
const scriptFetch = (replies: Reply[]) => {
  const calls: Array<{ url: string; redirect: unknown }> = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), redirect: init?.redirect });
    const next = replies.shift();
    if (!next) throw new Error('fetch inesperado');
    if (next instanceof Error) throw next;
    return next;
  }) as unknown as typeof fetch;
  return calls;
};

const ORIGIN = 'https://archive.org/download/filme/filme_archive.torrent';

/** Erro de domínio esperado: confere a classe, o status e (opcional) um trecho da mensagem. */
const expectSourceError = async (promise: Promise<unknown>, status: SourceError['status'], message?: RegExp): Promise<void> => {
  const err = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(SourceError);
  expect((err as SourceError).status).toBe(status);
  if (message) expect((err as SourceError).message).toMatch(message);
};

describe('httpsTorrentUrl — só https, host público, sem credenciais', () => {
  test('aceita https com host público', () => {
    expect(httpsTorrentUrl(ORIGIN).hostname).toBe('archive.org');
  });

  test('recusa http: o .torrent é a âncora de confiança e por http pode ser trocado no caminho', () => {
    expect(() => httpsTorrentUrl('http://archive.org/x.torrent')).toThrow(/precisa vir por https/);
  });

  test('recusa outros esquemas e texto que não é URL', () => {
    expect(() => httpsTorrentUrl('ftp://archive.org/x.torrent')).toThrow(SourceError);
    expect(() => httpsTorrentUrl('file:///etc/passwd')).toThrow(SourceError);
    expect(() => httpsTorrentUrl('isto não é url')).toThrow(SourceError);
  });

  test('recusa usuário e senha embutidos', () => {
    expect(() => httpsTorrentUrl('https://user:senha@archive.org/x.torrent')).toThrow(/usuário e senha/);
  });

  test('recusa host local ou da LAN (o servidor não vira cliente da rede do usuário)', () => {
    expect(() => httpsTorrentUrl('https://localhost/x.torrent')).toThrow(/local ou privado/);
    expect(() => httpsTorrentUrl('https://127.0.0.1/x.torrent')).toThrow(/local ou privado/);
    expect(() => httpsTorrentUrl('https://192.168.0.10/x.torrent')).toThrow(/local ou privado/);
    expect(() => httpsTorrentUrl('https://[::1]/x.torrent')).toThrow(/local ou privado/);
  });
});

describe('fetchTorrentBytes — redirecionamento só para a mesma origem', () => {
  test('pede com redirect manual e devolve o corpo quando a resposta é direta', async () => {
    const torrent = makeTorrent({ files: ['a.mp4'] });
    const calls = scriptFetch([new Response(bodyOf(torrent), { status: 200 })]);
    const bytes = await fetchTorrentBytes(new URL(ORIGIN));
    expect(bytes.byteLength).toBe(torrent.byteLength);
    expect(calls[0]?.redirect).toBe('manual');
  });

  test('segue redirecionamento para a mesma origem (caminho relativo)', async () => {
    const torrent = makeTorrent({ files: ['a.mp4'] });
    const calls = scriptFetch([
      new Response(null, { status: 302, headers: { location: '/download/filme/filme_archive.torrent?final=1' } }),
      new Response(bodyOf(torrent), { status: 200 }),
    ]);
    await fetchTorrentBytes(new URL(ORIGIN));
    expect(calls).toHaveLength(2);
    expect(calls[1]?.url).toBe('https://archive.org/download/filme/filme_archive.torrent?final=1');
  });

  test('recusa redirect para outro host sem seguir: o destino não é escolhido pelo servidor de origem', async () => {
    const calls = scriptFetch([new Response(null, { status: 302, headers: { location: 'https://dn720802.ca.archive.org/x.torrent' } })]);
    await expectSourceError(fetchTorrentBytes(new URL(ORIGIN)), 400, /cole o link final/);
    expect(calls).toHaveLength(1);
  });

  test('recusa redirect que rebaixa para http no mesmo host (outra origem)', async () => {
    const calls = scriptFetch([new Response(null, { status: 301, headers: { location: 'http://archive.org/x.torrent' } })]);
    await expectSourceError(fetchTorrentBytes(new URL(ORIGIN)), 400, /cole o link final/);
    expect(calls).toHaveLength(1);
  });

  test('limita a cadeia de redirecionamentos', async () => {
    const hop = () => new Response(null, { status: 302, headers: { location: '/loop.torrent' } });
    scriptFetch([hop(), hop(), hop(), hop(), hop()]);
    await expectSourceError(fetchTorrentBytes(new URL(ORIGIN)), 502, /redirecionou demais/);
  });

  test('redirecionamento sem Location vira erro nosso', async () => {
    scriptFetch([new Response(null, { status: 302 })]);
    await expectSourceError(fetchTorrentBytes(new URL(ORIGIN)), 502, /sem dizer para onde/);
  });
});

describe('fetchTorrentBytes — erros do host nunca viram o corpo remoto', () => {
  test('HTTP de erro vira 502 com status, sem ecoar o corpo', async () => {
    scriptFetch([new Response('<html>SEGREDO-DO-HOST</html>', { status: 503 })]);
    const err = await fetchTorrentBytes(new URL(ORIGIN)).then(
      () => null,
      (e: unknown) => e as SourceError,
    );
    expect(err?.status).toBe(502);
    expect(err?.message).toContain('503');
    expect(err?.message).not.toContain('SEGREDO');
  });

  test('falha de rede vira 502 com mensagem nossa', async () => {
    scriptFetch([new TypeError('getaddrinfo ENOTFOUND interno.example.corp')]);
    await expectSourceError(fetchTorrentBytes(new URL(ORIGIN)), 502, /não consegui baixar/);
  });

  test('corpo vazio é recusado', async () => {
    scriptFetch([new Response(bodyOf(new Uint8Array(0)), { status: 200 })]);
    await expectSourceError(fetchTorrentBytes(new URL(ORIGIN)), 502, /veio vazio/);
  });

  test('Content-Length acima do teto é recusado antes de ler o corpo', async () => {
    scriptFetch([
      new Response(bodyOf(new Uint8Array(8)), {
        status: 200,
        headers: { 'content-length': String(TORRENT_FILE_MAX_BYTES + 1) },
      }),
    ]);
    await expectSourceError(fetchTorrentBytes(new URL(ORIGIN)), 502, /grande demais/);
  });

  test('corpo que passa do teto sem Content-Length é cortado durante a leitura', async () => {
    // Sem o teto na leitura, um host que omite o header entregaria quantos MB quisesse.
    const big = new Uint8Array(TORRENT_FILE_MAX_BYTES + 1024);
    scriptFetch([new Response(bodyOf(big), { status: 200 })]);
    await expectSourceError(fetchTorrentBytes(new URL(ORIGIN)), 502, /grande demais/);
  });
});

describe('normalizeTorrentBytes — o engine recebe só o que é seguro', () => {
  test('extrai infohash e nome, e o arquivo normalizado mantém o mesmo infohash', async () => {
    const original = makeTorrent({ name: 'colecao', files: ['a.mp4', 'b.mp4'], announce: ['udp://tracker.example.org:6969'] });
    const { ref, file } = await normalizeTorrentBytes(original);
    const originalHash = (await parseTorrent(original)).infoHash;

    expect(ref.infoHash).toBe(originalHash);
    expect(ref.name).toBe('colecao');
    expect((await parseTorrent(file)).infoHash).toBe(originalHash);
  });

  test('o arquivo normalizado não carrega tracker local/privado nem web seed', async () => {
    const original = makeTorrent({
      name: 'colecao',
      files: ['a.mp4'],
      announce: ['udp://tracker.example.org:6969', 'http://10.0.0.5/announce', 'http://127.0.0.1:9/announce'],
      urlList: ['https://archive.org/download/colecao/', 'http://192.168.1.1/x/'],
    });
    const { ref, file } = await normalizeTorrentBytes(original);
    const parsed = await parseTorrent(file);

    expect(ref.trackers).toEqual(['udp://tracker.example.org:6969']);
    expect(parsed.announce).toEqual(['udp://tracker.example.org:6969']);
    expect(parsed.urlList).toEqual([]);
  });

  test('bencode malformado vira 502 com mensagem nossa', async () => {
    await expectSourceError(normalizeTorrentBytes(encoder.encode('<html>não é torrent</html>')), 502, /não é um .torrent válido/);
  });

  test('20 bytes quaisquer não viram torrent (parse-torrent os aceita como infohash cru)', async () => {
    await expectSourceError(normalizeTorrentBytes(encoder.encode('isso não é bencode')), 502, /não é um .torrent válido/);
  });

  test('torrent sem nenhum arquivo é recusado', async () => {
    const empty = bdict([
      [
        'info',
        bdict([
          ['name', bstr('vazio')],
          ['piece length', bint(16384)],
          ['pieces', bstr('a'.repeat(20))],
          ['files', blist()],
        ]),
      ],
    ]);
    await expectSourceError(normalizeTorrentBytes(empty), 502, /não é um .torrent válido/);
  });
});
