import { afterEach, describe, expect, test } from 'bun:test';
import { searchRoutes } from '../src/server/routes/search.ts';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('GET /api/search', () => {
  test('exige o parâmetro "q"', async () => {
    const res = await searchRoutes.request('/');
    expect(res.status).toBe(400);
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
  });
});
