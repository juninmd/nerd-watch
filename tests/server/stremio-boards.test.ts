import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { openDb, resetDbForTests } from '../../src/server/db/database.ts';
import { boardsOf, BOARDS_MAX } from '../../src/server/providers/stremio/boards.ts';
import { setAddonFetch } from '../../src/server/providers/stremio/client.ts';
import { parseManifest } from '../../src/server/providers/stremio/protocol.ts';
import { stremioRoutes } from '../../src/server/routes/stremio.ts';
import { setHostResolver } from '../../src/server/subtitles/load.ts';

/**
 * Catálogos dos addons: o que o manifest declara de filtro (gênero/ano) e a lista de quadros que a
 * tela Descobrir consome. Sem rede: o fetch do addon é falso e o manifest vem do banco.
 */

const MANIFEST_URL = 'https://addon.example.com/TOKEN/manifest.json';
const BASE = 'https://addon.example.com/TOKEN';

const manifest = {
  id: 'org.example.boards',
  name: 'Addon com catálogo',
  version: '2.0.0',
  types: ['movie', 'series'],
  resources: ['catalog', 'meta'],
  catalogs: [
    {
      type: 'movie',
      id: 'top',
      name: 'Mais vistos',
      extra: [
        { name: 'search', isRequired: false },
        { name: 'genre', isRequired: false, options: ['Ação', 'Comédia', 'Drama'] },
        { name: 'year', isRequired: false },
        { name: 'skip', isRequired: false },
      ],
    },
    { type: 'series', id: 'recent', name: 'Recentes', extraSupported: ['skip'] },
  ],
};

const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

let calls: string[] = [];

const serve = (responses: Record<string, () => Response> = {}) => {
  calls = [];
  setAddonFetch(async (url) => {
    calls.push(url);
    if (url === MANIFEST_URL) return json(manifest);
    const handler = responses[url];
    if (handler) return handler();
    return json({ metas: [] });
  });
};

const install = async (): Promise<string> => {
  const res = await stremioRoutes.request('/addons', { method: 'POST', body: JSON.stringify({ url: MANIFEST_URL }), headers: { 'content-type': 'application/json' } });
  return (await res.json()).id as string;
};

beforeEach(() => {
  resetDbForTests(openDb(':memory:'));
  setHostResolver(async () => ['93.184.216.34']);
  serve();
});

afterEach(() => {
  setAddonFetch();
  setHostResolver();
  resetDbForTests();
});

describe('manifest declara os filtros do catálogo', () => {
  test('gêneros saem de extra.options; extraSupported só informa os nomes', () => {
    const parsed = parseManifest(manifest);
    expect(parsed.catalogs[0]).toMatchObject({ id: 'top', searchable: true, paged: true, genres: ['Ação', 'Comédia', 'Drama'], yearFilter: true });
    expect(parsed.catalogs[1]).toMatchObject({ id: 'recent', searchable: false, paged: true, genres: [], yearFilter: false });
  });

  test('gênero fora da lista do manifest é recusado; a busca e o ano vão na URL do addon', async () => {
    const id = await install();
    const bad = await stremioRoutes.request(`/addons/${id}/catalog/movie/top?genre=Terror`);
    expect(bad.status).toBe(400);

    const ok = await stremioRoutes.request(`/addons/${id}/catalog/movie/top?genre=${encodeURIComponent('Ação')}&year=2024&skip=20`);
    expect(ok.status).toBe(200);
    expect(calls).toContain(`${BASE}/catalog/movie/top/genre=A%C3%A7%C3%A3o&year=2024&skip=20.json`);
  });

  test('ano em catálogo que não declara o filtro é 400 e nunca chega ao addon', async () => {
    const id = await install();
    const before = calls.length;
    const res = await stremioRoutes.request(`/addons/${id}/catalog/series/recent?year=2024`);
    expect(res.status).toBe(400);
    expect(calls).toHaveLength(before);
  });

  test('ano malformado e gênero com tamanho absurdo também são 400', async () => {
    const id = await install();
    expect((await stremioRoutes.request(`/addons/${id}/catalog/movie/top?year=24`)).status).toBe(400);
    expect((await stremioRoutes.request(`/addons/${id}/catalog/movie/top?genre=${'a'.repeat(200)}`)).status).toBe(400);
  });
});

describe('GET /boards', () => {
  test('lista um quadro por catálogo do addon, com o domínio e sem o caminho com token', async () => {
    await install();
    const res = await stremioRoutes.request('/boards');
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain('TOKEN');
    const { boards } = JSON.parse(text);
    expect(boards).toHaveLength(2);
    expect(boards[0]).toMatchObject({ addonName: 'Addon com catálogo', host: 'addon.example.com', type: 'movie', catalogId: 'top', name: 'Mais vistos' });
    expect(boards[0].genres).toEqual(['Ação', 'Comédia', 'Drama']);
    expect(boards[1]).toMatchObject({ type: 'series', catalogId: 'recent', genres: [] });
  });

  test('sem addon instalado a lista é vazia', async () => {
    expect((await (await stremioRoutes.request('/boards')).json()).boards).toEqual([]);
  });
});

describe('boardsOf', () => {
  const installed = (catalogs: unknown[], resources: string[]) => [
    {
      id: 'a1',
      manifestUrl: MANIFEST_URL,
      baseUrl: BASE,
      addedAt: '2026-01-01T00:00:00.000Z',
  enabled: true,
      manifest: { ...parseManifest({ ...manifest, catalogs, resources }), logo: null },
    },
  ];

  test('addon sem recurso catalog não gera quadro', () => {
    expect(boardsOf(installed([{ type: 'movie', id: 'x' }], ['stream']))).toEqual([]);
  });

  test('teto de quadros evita dezenas de trilhos na tela', () => {
    const many = Array.from({ length: BOARDS_MAX + 10 }, (_, i) => ({ type: 'movie', id: `c${i}` }));
    expect(boardsOf(installed(many, ['catalog'])).length).toBeLessThanOrEqual(BOARDS_MAX);
  });
});
