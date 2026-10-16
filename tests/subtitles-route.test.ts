import { afterEach, describe, expect, test } from 'bun:test';
import { subtitlesRoutes } from '../src/server/routes/subtitles.ts';
import { isFetchableSubtitleUrl, searchAllSubtitles } from '../src/server/providers/subtitles/index.ts';
import { languageRank } from '../src/server/providers/subtitles/languages.ts';

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
  test('baixa com o payload EXATO que o painel envia', async () => {
    // Regressão do defeito que passou por toda a suíte: o painel não mandava `imdbId`, e o servidor
    // não resolvia por tmdbId — então todo download de addon pela interface dava 404. Os testes
    // antigos passavam porque montavam o payload à mão, com imdbId.
    const imdbId = freshImdbId();
    stubAddon([raw({ id: '777' })]);

    const search = await (await subtitlesRoutes.request(`/?imdbId=${imdbId}&mediaType=movie`)).json();
    expect(search.imdbId).toBe(imdbId);

    const result = search.results[0];
    const payload = {
      source: result.source,
      id: result.id,
      imdbId: search.imdbId,
      mediaType: 'movie',
      season: null,
      episode: null,
    };
    const res = await subtitlesRoutes.request('/download', { method: 'POST', body: JSON.stringify(payload) });
    expect(res.status).toBe(200);
    expect((await res.json()).url).toStartWith('/api/subtitles/file?');
  });

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

  test('400 quando o imdbId não tem formato de IMDb (nome de arquivo não recebe texto livre)', async () => {
    for (const bad of ['../../etc/passwd', 'tt1"; filename*=UTF-8\'\'pwned', 'nao-e-imdb', 'tt123']) {
      const res = await subtitlesRoutes.request(
        `/file?source=https%3A%2F%2Fopensubtitles-v3.strem.io&id=1&imdbId=${encodeURIComponent(bad)}`,
      );
      expect(res.status).toBe(400);
    }
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

  test('502 quando o addon devolve um endereço que não podemos buscar', async () => {
    // O addon é código de terceiro: sem esta guarda, ele poderia apontar para file:// ou loopback
    // e transformar o proxy numa leitura de arquivo local.
    stubAddon([raw({ url: 'file:///etc/passwd' })]);
    const res = await subtitlesRoutes.request(
      `/file?source=https%3A%2F%2Fopensubtitles-v3.strem.io&id=1&imdbId=${freshImdbId()}&type=movie`,
    );
    expect(res.status).toBe(502);
  });

  test('502 quando o addon está fora do ar (não confundir com "legenda não existe")', async () => {
    globalThis.fetch = (async () => json({}, 500)) as unknown as typeof fetch;
    const res = await subtitlesRoutes.request(
      `/file?source=https%3A%2F%2Fopensubtitles-v3.strem.io&id=1&imdbId=${freshImdbId()}&type=movie`,
    );
    expect(res.status).toBe(502);
  });
});

describe('isFetchableSubtitleUrl', () => {
  test('aceita http(s) público', () => {
    expect(isFetchableSubtitleUrl('https://subs5.strem.io/en/download/abc')).toBe(true);
    expect(isFetchableSubtitleUrl('http://exemplo.com/a.srt')).toBe(true);
  });

  test('recusa esquema que não é http(s)', () => {
    for (const url of ['file:///etc/passwd', 'ftp://x/a.srt', 'data:text/plain,oi', 'javascript:alert(1)']) {
      expect(isFetchableSubtitleUrl(url)).toBe(false);
    }
  });

  test('recusa loopback, rede privada e link-local', () => {
    for (const url of [
      'http://localhost/a.srt',
      'http://127.0.0.1:8080/a.srt',
      'http://10.0.0.5/a.srt',
      'http://192.168.1.1/a.srt',
      'http://172.16.0.1/a.srt',
      'http://169.254.169.254/latest/meta-data',
      'http://0.0.0.0/a.srt',
      'http://[::1]/a.srt',
    ]) {
      expect(isFetchableSubtitleUrl(url)).toBe(false);
    }
  });

  test('não cai em falso positivo com 172.32 (fora da faixa privada)', () => {
    expect(isFetchableSubtitleUrl('http://172.32.0.1/a.srt')).toBe(true);
  });

  test('recusa URL inválida', () => {
    expect(isFetchableSubtitleUrl('não é url')).toBe(false);
    expect(isFetchableSubtitleUrl('')).toBe(false);
  });
});

describe('languageRank', () => {
  test('ordena pt-BR antes de pt quando a configuração é pt-BR,pt,en', () => {
    // Com semântica de grupo os dois empatariam e a ordem configurada seria ignorada.
    const order = ['pt-BR', 'pt', 'en'];
    expect(languageRank('pob', order)).toBeLessThan(languageRank('por', order));
    expect(languageRank('pt-BR', order)).toBe(0);
    expect(languageRank('pt', order)).toBe(1);
    expect(languageRank('en', order)).toBe(2);
  });

  test('idioma fora da lista vai para o fim', () => {
    const order = ['pt-BR', 'pt', 'en'];
    expect(languageRank('hun', order)).toBeGreaterThan(languageRank('en', order));
  });
});

describe('searchAllSubtitles — diagnóstico', () => {
  test('sem id do IMDb diz o motivo certo, em vez de "desligado"', async () => {
    // Título da TMDB sem vínculo com o IMDb não é "feature desligada": é outra causa, e a interface
    // precisa dizer isso para não mandar o usuário configurar o que já está configurado.
    const outcome = await searchAllSubtitles({ tmdbId: 999999999, mediaType: 'movie' });
    expect(outcome.enabled).toBe(false);
    expect(outcome.reason).toBe('no_imdb_id');
  });

  test('sources lista quem respondeu, mesmo sem resultado', async () => {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/manifest.json')) return json(MANIFEST);
      return json({ subtitles: [] });
    }) as unknown as typeof fetch;

    const outcome = await searchAllSubtitles({ imdbId: freshImdbId(), mediaType: 'movie' });
    expect(outcome.enabled).toBe(true);
    expect(outcome.sources).toEqual(['OpenSubtitles v3']);
  });

  test('não repete a mesma legenda quando a fonte aparece duas vezes', async () => {
    stubAddon([raw({ id: 'a' }), raw({ id: 'a' })]);
    const outcome = await searchAllSubtitles({ imdbId: freshImdbId(), mediaType: 'movie' });
    expect(outcome.results.filter((r) => r.id === 'a')).toHaveLength(1);
  });
});
