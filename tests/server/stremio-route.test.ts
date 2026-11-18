import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { getDb, openDb, resetDbForTests } from '../../src/server/db/database.ts';
import { streamsForTitle } from '../../src/server/providers/stremio/title-streams.ts';
import { listAddons } from '../../src/server/repo/stremio-addons.ts';
import { setAddonFetch } from '../../src/server/providers/stremio/client.ts';
import { stremioRoutes } from '../../src/server/routes/stremio.ts';
import { setHostResolver } from '../../src/server/subtitles/load.ts';

const MANIFEST_URL = 'https://addon.example.com/TOKEN-SECRETO/manifest.json';
const manifest = {
  id: 'org.example.addon',
  name: 'Addon de teste',
  version: '1.0.0',
  resources: ['catalog', 'meta', { name: 'stream', types: ['movie'] }, 'subtitles'],
  types: ['movie'],
  catalogs: [{ type: 'movie', id: 'top', name: 'Top', extra: [{ name: 'search' }, { name: 'skip' }] }],
  logo: 'javascript:alert(1)',
};

const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
let calls: string[] = [];

const serve = (routes: Record<string, () => Response>) => {
  calls = [];
  setAddonFetch(async (url) => {
    calls.push(url);
    const handler = routes[url];
    if (!handler) return json({}, 404);
    return handler();
  });
};

const install = (url: string = MANIFEST_URL) =>
  stremioRoutes.request('/addons', { method: 'POST', body: JSON.stringify({ url }), headers: { 'content-type': 'application/json' } });

beforeEach(() => {
  resetDbForTests(openDb(':memory:'));
  setHostResolver(async () => ['93.184.216.34']);
});
afterEach(() => {
  setAddonFetch();
  setHostResolver();
  resetDbForTests();
});

describe('instalação manual de addon', () => {
  test('instala, não devolve o caminho com token e descarta logo não-http', async () => {
    serve({ [MANIFEST_URL]: () => json(manifest) });
    const res = await install();
    expect(res.status).toBe(201);
    const text = await res.text();
    expect(text).not.toContain('TOKEN-SECRETO');
    const dto = JSON.parse(text);
    expect(dto).toMatchObject({ name: 'Addon de teste', host: 'addon.example.com', resources: ['catalog', 'meta', 'stream', 'subtitles'], logo: null });
    expect(dto.catalogs[0]).toMatchObject({ id: 'top', searchable: true, paged: true });

    const list = await (await stremioRoutes.request('/addons')).text();
    expect(list).not.toContain('TOKEN-SECRETO');
    expect(JSON.parse(list).addons).toHaveLength(1);
  });

  test('instalar o mesmo link duas vezes não duplica', async () => {
    serve({ [MANIFEST_URL]: () => json(manifest) });
    await install();
    await install();
    expect((await (await stremioRoutes.request('/addons')).json()).addons).toHaveLength(1);
  });

  test('link inválido é 400 e nunca chega à rede', async () => {
    serve({});
    for (const url of ['http://localhost:7000/manifest.json', 'https://addon.example.com/x.json', '']) expect((await install(url)).status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  test('host que resolve para rede privada é recusado', async () => {
    setHostResolver(async () => ['10.0.0.5']);
    serve({ [MANIFEST_URL]: () => json(manifest) });
    expect((await install()).status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  test('JSON que não é manifest é 400; addon fora do ar é 502; lento é 504', async () => {
    serve({ [MANIFEST_URL]: () => json({ qualquer: 'coisa' }) });
    expect((await install()).status).toBe(400);
    serve({ [MANIFEST_URL]: () => json({}, 500) });
    expect((await install()).status).toBe(502);
    setAddonFetch(async () => {
      const err = new Error('abort');
      err.name = 'AbortError';
      throw err;
    });
    expect((await install()).status).toBe(504);
  });

  test('campo desconhecido no corpo é 400', async () => {
    const res = await stremioRoutes.request('/addons', { method: 'POST', body: JSON.stringify({ url: MANIFEST_URL, x: 1 }), headers: { 'content-type': 'application/json' } });
    expect(res.status).toBe(400);
  });

  test('remove addon e 404 para o inexistente', async () => {
    serve({ [MANIFEST_URL]: () => json(manifest) });
    const { id } = await (await install()).json();
    expect((await stremioRoutes.request(`/addons/${id}`, { method: 'DELETE' })).status).toBe(200);
    expect((await stremioRoutes.request(`/addons/${id}`, { method: 'DELETE' })).status).toBe(404);
  });
});

describe('catálogo, meta e streams', () => {
  const base = 'https://addon.example.com/TOKEN-SECRETO';
  const setup = async () => {
    serve({
      [MANIFEST_URL]: () => json(manifest),
      [`${base}/catalog/movie/top/search=a%20b&skip=20.json`]: () =>
        json({ metas: [{ id: 'tt1', type: 'movie', name: 'Filme', poster: 'https://img.example.com/p.jpg', releaseInfo: '1999' }, { id: 'x' }, { id: 'tt2', name: 'Mau', poster: 'data:text/html,x' }] }),
      [`${base}/meta/movie/tt1.json`]: () => json({ meta: { id: 'tt1', name: 'Filme', description: 'sinopse', genres: ['Drama'], videos: [{ id: 'tt1:1:2', title: 'Ep', season: 1, episode: 2 }] } }),
      [`${base}/stream/movie/tt1.json`]: () =>
        json({
          streams: [
            { url: 'https://cdn.example.com/v.mp4', name: 'HD', title: 'Arquivo' },
            { url: 'file:///etc/passwd', title: 'ruim' },
            { ytId: 'dQw4w9WgXcQ', title: 'yt' },
            { infoHash: 'abc', title: 'torrent' },
            { externalUrl: 'https://example.com/ver', title: 'externo' },
          ],
        }),
    });
    return (await (await install()).json()).id as string;
  };

  test('catálogo normaliza itens e descarta o que não é seguro', async () => {
    const id = await setup();
    const res = await stremioRoutes.request(`/addons/${id}/catalog/movie/top?search=a%20b&skip=20`);
    expect(res.status).toBe(200);
    const { items } = await res.json();
    expect(items).toEqual([
      { id: 'tt1', type: 'movie', name: 'Filme', poster: 'https://img.example.com/p.jpg', year: '1999' },
      { id: 'tt2', type: 'movie', name: 'Mau', poster: null, year: null },
    ]);
  });

  test('catálogo não declarado no manifest é 400', async () => {
    const id = await setup();
    expect((await stremioRoutes.request(`/addons/${id}/catalog/movie/inexistente`)).status).toBe(400);
    expect((await stremioRoutes.request(`/addons/${id}/catalog/movie/top?skip=abc`)).status).toBe(400);
  });

  test('meta traz sinopse e episódios', async () => {
    const id = await setup();
    const meta = await (await stremioRoutes.request(`/addons/${id}/meta/movie/tt1`)).json();
    expect(meta).toMatchObject({ name: 'Filme', description: 'sinopse', genres: ['Drama'], videos: [{ id: 'tt1:1:2', season: 1, episode: 2 }] });
  });

  test('streams: só http(s) toca; torrent fica listado sem URL', async () => {
    const id = await setup();
    const { streams } = await (await stremioRoutes.request(`/addons/${id}/streams/movie/tt1`)).json();
    expect(streams.map((s: { kind: string }) => s.kind)).toEqual(['url', 'youtube', 'torrent', 'external']);
    expect(streams[0]).toEqual({ kind: 'url', title: 'HD · Arquivo', url: 'https://cdn.example.com/v.mp4' });
    expect(streams[2].url).toBeNull();
  });

  test('addon inexistente é 404; id com barra é recusado', async () => {
    await setup();
    expect((await stremioRoutes.request('/addons/nao-existe/streams/movie/tt1')).status).toBe(404);
    const id = await setup();
    expect((await stremioRoutes.request(`/addons/${id}/meta/movie/a%2Fb`)).status).toBe(400);
  });

  test('redirect para endereço privado é recusado', async () => {
    const id = await setup();
    setAddonFetch(async () => new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/latest' } }));
    const res = await stremioRoutes.request(`/addons/${id}/streams/movie/tt1`);
    expect(res.status).toBe(400);
  });
});

describe('addon só de streams (sem catálogo, como o Brazuca)', () => {
  const base = 'https://addon.example.com/TOKEN-SECRETO';
  const streamOnly = { id: 'org.stream', name: 'Só stream', resources: [{ name: 'stream', types: ['movie', 'series'], idPrefixes: ['tt'] }], types: ['movie', 'series'], catalogs: [] };
  const setup = async () => {
    serve({
      [MANIFEST_URL]: () => json(streamOnly),
      [`${base}/stream/movie/tt0133093.json`]: () => json({ streams: [{ infoHash: 'abc', title: 'torrent' }] }),
      [`${base}/stream/series/tt0944947%3A1%3A1.json`]: () => json({ streams: [{ url: 'https://cdn.example.com/e.mp4', title: 'ep' }] }),
    });
    await install();
    return listAddons(await getDb());
  };

  test('busca streams pelo IMDb do TMDB, filme e série (sem progresso = 1x1)', async () => {
    const addons = await setup();
    const movie = await streamsForTitle(addons, { mediaType: 'movie', tmdbId: 603, season: null, episode: null }, async () => 'tt0133093');
    expect(movie.addons[0]).toMatchObject({ name: 'Só stream', error: null, streams: [{ kind: 'torrent', url: null }] });
    const tv = await streamsForTitle(addons, { mediaType: 'tv', tmdbId: 1399, season: null, episode: null }, async () => 'tt0944947');
    expect(tv.addons[0]?.streams[0]?.kind).toBe('url');
  });

  test('sem IMDb não consulta addon; falha de um addon vira erro com mensagem fixa', async () => {
    const addons = await setup();
    calls = [];
    expect(await streamsForTitle(addons, { mediaType: 'movie', tmdbId: 1, season: null, episode: null }, async () => null)).toEqual({ imdbId: null, addons: [] });
    expect(calls).toHaveLength(0);
    const out = await streamsForTitle(addons, { mediaType: 'movie', tmdbId: 1, season: null, episode: null }, async () => 'tt9999999');
    expect(out.addons[0]?.error).toBe('o addon respondeu 404');
  });

  test('addon sem recurso stream não entra', async () => {
    serve({ [MANIFEST_URL]: () => json({ ...streamOnly, resources: ['subtitles'] }) });
    await install();
    const out = await streamsForTitle(listAddons(await getDb()), { mediaType: 'movie', tmdbId: 1, season: null, episode: null }, async () => 'tt1234567');
    expect(out.addons).toEqual([]);
  });

  test('status: ok quando o manifest responde, erro com mensagem fixa quando não', async () => {
    await setup();
    const { id } = (await (await stremioRoutes.request('/addons')).json()).addons[0];
    expect(await (await stremioRoutes.request(`/addons/${id}/status`)).json()).toEqual({ ok: true, error: null });
    serve({ [MANIFEST_URL]: () => json({}, 500) });
    expect(await (await stremioRoutes.request(`/addons/${id}/status`)).json()).toEqual({ ok: false, error: 'o addon respondeu 500' });
  });

  test('/streams valida parâmetros', async () => {
    expect((await stremioRoutes.request('/streams?tmdbId=x&mediaType=movie')).status).toBe(400);
    expect((await stremioRoutes.request('/streams?tmdbId=1&mediaType=anime')).status).toBe(400);
  });
});
