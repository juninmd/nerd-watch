import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { openDb, resetDbForTests } from '../../src/server/db/database.ts';
import { searchRoutes } from '../../src/server/routes/search.ts';
import { SUGGEST_MAX, uniqueSuggestions } from '../../src/server/routes/search-suggest.ts';

const originalFetch = globalThis.fetch;

beforeEach(() => resetDbForTests(openDb(':memory:')));
afterEach(() => {
  resetDbForTests();
  globalThis.fetch = originalFetch;
});

describe('GET /api/search', () => {
  test('exige o parâmetro "q"', async () => {
    const res = await searchRoutes.request('/');
    expect(res.status).toBe(400);
  });

  test('recusa consulta longa demais ou com controle sem tocar a rede', async () => {
    let called = 0;
    globalThis.fetch = (async () => {
      called++;
      return new Response('{}');
    }) as unknown as typeof fetch;

    expect((await searchRoutes.request(`/?q=${'a'.repeat(201)}`)).status).toBe(400);
    expect((await searchRoutes.request('/?q=filme%0Ateste')).status).toBe(400);
    expect(called).toBe(0);
  });

  test('sem TMDB_API_KEY no ambiente de teste, só traz resultados da Archive.org', async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({ response: { docs: [{ identifier: 'route-search-item', title: 'Busca Composta', year: 2001 }] } }),
        { status: 200 },
      )) as unknown as typeof fetch;

    const res = await searchRoutes.request('/?q=busca-composta-rota-search');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tmdbEnabled).toBe(false);
    expect(body.results).toHaveLength(1);
    expect(body.results[0].source).toBe('archive');
    expect(body.addonResults).toEqual([]);
  });
});

describe('busca por fonte e sugestões', () => {
  test('`source` pede uma fonte só; as outras nem são consultadas', async () => {
    const asked: string[] = [];
    globalThis.fetch = (async (url: string | URL) => {
      asked.push(String(url));
      return new Response(JSON.stringify({ response: { docs: [{ identifier: 'so-archive', title: 'Só Archive', year: 1950 }] } }), { status: 200 });
    }) as unknown as typeof fetch;
    const body = await (await searchRoutes.request('/?q=fonte-unica-teste&source=archive')).json();
    expect(body.results.map((r: { source: string }) => r.source)).toEqual(['archive']);
    expect(asked.every((u) => u.includes('archive.org'))).toBe(true);
  });

  test('`source` desconhecida é 400', async () => {
    expect((await searchRoutes.request('/?q=x&source=netflix')).status).toBe(400);
  });

  test('sugestões sem repetir nome+ano e no máximo SUGGEST_MAX', () => {
    const dup = [
      { title: 'Duna', year: '2021', mediaType: 'movie' as const },
      { title: 'duna', year: '2021', mediaType: 'movie' as const },
      { title: 'Duna', year: '1984', mediaType: 'movie' as const },
      { title: '', year: null, mediaType: 'tv' as const },
    ];
    expect(uniqueSuggestions(dup).map((s) => s.year)).toEqual(['2021', '1984']);
    const many = Array.from({ length: 20 }, (_, i) => ({ title: `T${i}`, year: null, mediaType: 'tv' as const }));
    expect(uniqueSuggestions(many)).toHaveLength(SUGGEST_MAX);
  });

  test('/suggest valida a consulta como a busca', async () => {
    expect((await searchRoutes.request('/suggest')).status).toBe(400);
  });
});
