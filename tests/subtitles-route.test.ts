import { afterEach, describe, expect, test } from 'bun:test';
import { subtitlesRoutes } from '../src/server/routes/subtitles.ts';

/**
 * O addon padrão (`https://opensubtitles-v3.strem.io`) está configurado por padrão, então estes
 * testes trocam o `fetch` global: sem isso eles sairiam para a rede de verdade.
 *
 * `imdbId` é passado direto porque `tmdbExternalIds` exige chave da TMDB, que não existe aqui.
 */

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

/**
 * `fetchAddonSubtitles` é cacheada por 30 min com chave nos argumentos — e o cache é de módulo.
 * Dois testes com o mesmo `imdbId` compartilhariam resultado, então cada caso usa um id próprio.
 */
let idCounter = 0;
const freshImdbId = (): string => `tt${String(1_000_000 + idCounter++).padStart(7, '0')}`;

const MANIFEST = { id: 'org.stremio.opensubtitlesv3', name: 'OpenSubtitles v3', resources: ['subtitles'], idPrefixes: ['tt'] };

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** Responde manifest e a lista de legendas, diferenciando as duas URLs. */
const stubAddon = (subtitles: unknown[], onSubtitlesUrl?: (url: string) => void): void => {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/manifest.json')) return json(MANIFEST);
    if (url.includes('/subtitles/')) {
      onSubtitlesUrl?.(url);
      return json({ subtitles });
    }
    return json({ error: 'inesperado' }, 404);
  }) as unknown as typeof fetch;
};

const raw = (over: Record<string, unknown> = {}) => ({
  id: '1',
  url: 'https://subs5.strem.io/en/download/x',
  lang: 'pob',
  subtitleFileName: 'filme.srt',
  movieReleaseName: 'Filme (1994)',
  ...over,
});

describe('GET /api/subtitles com addon (sem chave nenhuma)', () => {
  test('devolve resultados e o nome da fonte', async () => {
    stubAddon([raw()]);
    const res = await subtitlesRoutes.request(`/?imdbId=${freshImdbId()}&mediaType=movie`);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.enabled).toBe(true);
    expect(body.sources).toEqual(['OpenSubtitles v3']);
    expect(body.results).toHaveLength(1);
    expect(body.results[0]).toMatchObject({
      source: 'OpenSubtitles v3',
      id: '1',
      languageCode: 'pt-BR',
      language: 'Português (BR)',
      release: 'Filme (1994)',
      downloads: null,
    });
  });

  test('filtra pelos idiomas configurados (padrão pt-BR, pt, en)', async () => {
    stubAddon([raw(), raw({ id: '2', lang: 'hun' }), raw({ id: '3', lang: 'eng' })]);
    const body = await (await subtitlesRoutes.request(`/?imdbId=${freshImdbId()}&mediaType=movie`)).json();
    expect(body.results.map((r: { id: string }) => r.id).sort()).toEqual(['1', '3']);
  });

  test('ordena pelo idioma preferido, na ordem configurada', async () => {
    stubAddon([raw({ id: 'en', lang: 'eng' }), raw({ id: 'ptbr', lang: 'pob' }), raw({ id: 'pt', lang: 'por' })]);
    const body = await (await subtitlesRoutes.request(`/?imdbId=${freshImdbId()}&mediaType=movie`)).json();
    expect(body.results.map((r: { id: string }) => r.id)).toEqual(['ptbr', 'pt', 'en']);
  });

  test('série monta tt:temporada:episódio na URL do addon', async () => {
    let seen = '';
    stubAddon([raw()], (url) => {
      seen = url;
    });
    await subtitlesRoutes.request(`/?imdbId=${freshImdbId()}&mediaType=tv&season=1&episode=2`);
    expect(seen).toContain('/subtitles/series/');
    expect(seen).toContain('%3A1%3A2.json');
  });

  test('filme não leva temporada/episódio', async () => {
    let seen = '';
    const imdbId = freshImdbId();
    stubAddon([raw()], (url) => {
      seen = url;
    });
    await subtitlesRoutes.request(`/?imdbId=${imdbId}&mediaType=movie`);
    expect(seen).toContain(`/subtitles/movie/${imdbId}.json`);
  });

  test('addon fora do ar não derruba a busca', async () => {
    globalThis.fetch = (async () => json({}, 500)) as unknown as typeof fetch;
    const res = await subtitlesRoutes.request(`/?imdbId=${freshImdbId()}&mediaType=movie`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.results).toEqual([]);
    expect(body.unavailable.length).toBeGreaterThan(0);
  });

  test('400 quando não vem tmdbId, imdbId nem query', async () => {
    const res = await subtitlesRoutes.request('/');
    expect(res.status).toBe(400);
  });
});

describe('POST /api/subtitles/download', () => {
  test('devolve uma URL do próprio app, não do addon', async () => {
    const imdbId = freshImdbId();
    stubAddon([raw()]);
    const res = await subtitlesRoutes.request('/download', {
      method: 'POST',
      body: JSON.stringify({ source: 'OpenSubtitles v3', id: '1', imdbId, mediaType: 'movie' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.url).toStartWith('/api/subtitles/file?');
    expect(body.url).toContain(`imdbId=${imdbId}`);
  });

  test('404 quando a legenda sumiu da fonte', async () => {
    stubAddon([]);
    const res = await subtitlesRoutes.request('/download', {
      method: 'POST',
      body: JSON.stringify({ source: 'OpenSubtitles v3', id: '1', imdbId: freshImdbId(), mediaType: 'movie' }),
    });
    expect(res.status).toBe(404);
  });

  test('400 sem fileId nem source+id', async () => {
    const res = await subtitlesRoutes.request('/download', { method: 'POST', body: JSON.stringify({}) });
    expect(res.status).toBe(400);
  });

  test('501 no caminho da OpenSubtitles quando não há chave', async () => {
    const res = await subtitlesRoutes.request('/download', { method: 'POST', body: JSON.stringify({ fileId: 42 }) });
    expect(res.status).toBe(501);
  });
});

describe('GET /api/subtitles/file (proxy)', () => {
  test('403 quando a fonte não está na lista configurada', async () => {
    const res = await subtitlesRoutes.request(`/file?source=https://evil.com&id=1&imdbId=${freshImdbId()}`);
    expect(res.status).toBe(403);
  });

  test('400 sem id ou imdbId', async () => {
    const res = await subtitlesRoutes.request('/file?source=https%3A%2F%2Fopensubtitles-v3.strem.io');
    expect(res.status).toBe(400);
  });

  test('serve o arquivo com nome de arquivo, sem repassar URL do cliente', async () => {
    const imdbId = freshImdbId();
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/subtitles/')) return json({ subtitles: [raw({ url: 'https://subs5.strem.io/en/download/abc' })] });
      if (url.includes('subs5.strem.io')) return new Response('1\n00:00:01,000 --> 00:00:02,000\nOlá\n', { status: 200 });
      return json({}, 404);
    }) as unknown as typeof fetch;

    const res = await subtitlesRoutes.request(
      `/file?source=https%3A%2F%2Fopensubtitles-v3.strem.io&id=1&imdbId=${imdbId}&type=movie`,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('content-disposition')).toContain(`${imdbId}.srt`);
    expect(await res.text()).toContain('Olá');
  });

  test('404 quando a legenda não está mais no addon', async () => {
    stubAddon([]);
    const res = await subtitlesRoutes.request(
      `/file?source=https%3A%2F%2Fopensubtitles-v3.strem.io&id=1&imdbId=${freshImdbId()}&type=movie`,
    );
    expect(res.status).toBe(404);
  });
});
