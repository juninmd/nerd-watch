import { afterEach, describe, expect, test } from 'bun:test';
import { subtitlesRoutes } from '../src/server/routes/subtitles.ts';
import { setHostResolver } from '../src/server/subtitles/load.ts';
// Nomes de teste resolvem para um IP público de documentação: nada sai para a rede.
setHostResolver(async () => ['203.0.113.10']);

/**
 * `POST /api/subtitles/vtt`: o servidor baixa a legenda escolhida e devolve WebVTT. O cliente nunca manda
 * a URL de destino, e a resposta de erro usa texto fixo (nada da fonte é repetido).
 */

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

/** Cada teste usa um id próprio: as buscas de addon e do Archive são cacheadas por módulo. */
let counter = 0;
const freshImdbId = (): string => `tt${String(2_000_000 + counter++).padStart(7, '0')}`;

const MANIFEST = {
  id: 'org.stremio.opensubtitlesv3',
  name: 'OpenSubtitles v3',
  resources: ['subtitles'],
  idPrefixes: ['tt'],
};
const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const SRT = '1\n00:00:01,000 --> 00:00:02,000\nOlá, mundo\n';

const post = (body: unknown) =>
  subtitlesRoutes.request('/vtt', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

/** Addon falso: manifest, lista de legendas com `subtitleUrl`, e o arquivo em `fileBody` quando pedido. */
const stubAddon = (subtitleUrl: string, extra: Record<string, () => Response> = {}, seen: string[] = []) => {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    seen.push(url);
    if (url.includes('/manifest.json')) return json(MANIFEST);
    if (url.includes('/subtitles/'))
      return json({ subtitles: [{ id: 'sub-1', url: subtitleUrl, lang: 'pob', subtitleFileName: 'a.srt' }] });
    if (extra[url]) return extra[url]();
    if (url === subtitleUrl) return new Response(SRT, { headers: { 'content-type': 'text/plain' } });
    return json({ error: 'inesperado' }, 404);
  }) as unknown as typeof fetch;
  return seen;
};

describe('POST /api/subtitles/vtt (addon)', () => {
  test('baixa a legenda escolhida e devolve WebVTT', async () => {
    stubAddon('https://subs5.strem.io/en/download/abc');
    const res = await post({ source: 'OpenSubtitles v3', id: 'sub-1', imdbId: freshImdbId(), mediaType: 'movie' });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/vtt');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    const body = await res.text();
    expect(body).toBe('WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nOlá, mundo\n');
  });

  test('a URL do arquivo vem do addon, nunca do corpo do pedido', async () => {
    const seen = stubAddon('https://subs5.strem.io/en/download/abc');
    await post({ source: 'OpenSubtitles v3', id: 'sub-1', imdbId: freshImdbId(), url: 'http://127.0.0.1:7877/secret' });
    expect(seen.some((u) => u.includes('127.0.0.1'))).toBe(false);
  });

  test('fonte que não está no addon configurado responde 404 sem baixar nada', async () => {
    const seen = stubAddon('https://subs5.strem.io/en/download/abc');
    const res = await post({ source: 'Qualquer Coisa', id: 'sub-1', imdbId: freshImdbId(), mediaType: 'movie' });
    expect(res.status).toBe(404);
    expect(seen.some((u) => u.includes('/download/'))).toBe(false);
  });

  test('addon que devolve file:// ou loopback é recusado com texto fixo', async () => {
    stubAddon('file:///etc/passwd');
    const res = await post({ source: 'OpenSubtitles v3', id: 'sub-1', imdbId: freshImdbId(), mediaType: 'movie' });
    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe('a fonte devolveu um endereço não permitido');
  });

  test('redirecionamento para a rede interna não é seguido', async () => {
    const seen = stubAddon('https://subs5.strem.io/en/download/abc', {
      'https://subs5.strem.io/en/download/abc': () =>
        new Response(null, { status: 302, headers: { location: 'http://127.0.0.1:7877/' } }),
    });
    const res = await post({ source: 'OpenSubtitles v3', id: 'sub-1', imdbId: freshImdbId(), mediaType: 'movie' });
    expect(res.status).toBe(502);
    expect(seen.some((u) => u.includes('127.0.0.1'))).toBe(false);
  });

  test('HTML de erro da fonte nunca é devolvido', async () => {
    stubAddon('https://subs5.strem.io/en/download/abc', {
      'https://subs5.strem.io/en/download/abc': () =>
        new Response('<h1>erro interno</h1>', { headers: { 'content-type': 'text/html' } }),
    });
    const res = await post({ source: 'OpenSubtitles v3', id: 'sub-1', imdbId: freshImdbId(), mediaType: 'movie' });
    expect(res.status).toBe(502);
    expect(await res.text()).not.toContain('erro interno');
  });

  test('corpo que não é JSON responde 400', async () => {
    const res = await subtitlesRoutes.request('/vtt', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{nao json',
    });
    expect(res.status).toBe(400);
  });

  test('fileId com OpenSubtitles desligado responde 400, sem chamada externa', async () => {
    const res = await post({ fileId: 42 });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/subtitles/vtt (Internet Archive)', () => {
  const metadata = (files: unknown[]) => json({ metadata: { title: 'Filme de teste', mediatype: 'movies' }, files });

  test('usa a legenda que o próprio item hospeda', async () => {
    const id = `item_${counter++}`;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === `https://archive.org/metadata/${id}`)
        return metadata([
          { name: 'filme.mp4', format: 'MPEG4' },
          { name: 'legenda.srt', format: 'SubRip' },
        ]);
      if (url === `https://archive.org/download/${id}/legenda.srt`)
        return new Response(SRT, { headers: { 'content-type': 'text/plain' } });
      return json({}, 404);
    }) as unknown as typeof fetch;

    const res = await post({ archiveId: id });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('00:00:01.000 --> 00:00:02.000');
  });

  test('item sem legenda responde 404', async () => {
    const id = `item_${counter++}`;
    globalThis.fetch = (async () => metadata([{ name: 'filme.mp4', format: 'MPEG4' }])) as unknown as typeof fetch;
    const res = await post({ archiveId: id });
    expect(res.status).toBe(404);
  });

  test('identificador com barra ou espaço é recusado antes de qualquer pedido', async () => {
    let called = false;
    globalThis.fetch = (async () => {
      called = true;
      return json({});
    }) as unknown as typeof fetch;
    for (const bad of ['../../etc', 'a b', '', '-x']) {
      const res = await post({ archiveId: bad });
      expect(res.status).toBe(400);
    }
    expect(called).toBe(false);
  });
});

describe('POST /api/subtitles/vtt (limite do corpo)', () => {
  test('corpo acima de 4 KB responde 413 sem ler o resto', async () => {
    const huge = JSON.stringify({ source: 'x', id: 'y', pad: 'a'.repeat(10_000) });
    const res = await subtitlesRoutes.request('/vtt', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: huge,
    });
    expect(res.status).toBe(413);
  });
});
