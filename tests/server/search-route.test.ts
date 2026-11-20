import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { openDb, resetDbForTests } from '../../src/server/db/database.ts';
import { searchRoutes } from '../../src/server/routes/search.ts';

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
