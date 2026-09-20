import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { openDb, resetDbForTests } from '../src/server/db.ts';
import { archiveRoutes } from '../src/server/routes/archive.ts';

const originalFetch = globalThis.fetch;

beforeEach(() => {
  resetDbForTests(openDb(':memory:'));
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('GET /api/archive/search', () => {
  test('devolve os itens do Internet Archive mapeados', async () => {
    globalThis.fetch = (async () =>
      jsonResponse({
        response: { docs: [{ identifier: 'route-test-castelo', title: 'Castelo Rá-Tim-Bum', year: 1994 }] },
      })) as unknown as typeof fetch;

    const res = await archiveRoutes.request('/search?q=castelo-teste-rota');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.results).toHaveLength(1);
    expect(body.results[0].identifier).toBe('route-test-castelo');
    expect(body.results[0].year).toBe('1994');
  });

  test('502 quando o Internet Archive está fora do ar', async () => {
    globalThis.fetch = (async () => jsonResponse({}, 500)) as unknown as typeof fetch;
    const res = await archiveRoutes.request('/search?q=fora-do-ar-teste-rota');
    expect(res.status).toBe(502);
  });
});

describe('GET /api/archive/:identifier', () => {
  test('grava o título na biblioteca local e devolve a legenda hospedada', async () => {
    globalThis.fetch = (async () =>
      jsonResponse({
        metadata: { identifier: 'route-test-haunted', title: 'House on Haunted Hill', year: 1959 },
        files: [{ name: 'house.mp4', format: 'MPEG4' }, { name: 'house.asr.srt', format: 'SubRip' }],
      })) as unknown as typeof fetch;

    const res = await archiveRoutes.request('/route-test-haunted');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.identifier).toBe('route-test-haunted');
    expect(body.subtitleUrl).toBe('https://archive.org/download/route-test-haunted/house.asr.srt');
    expect(body.titleId).toBeTruthy();
  });

  test('404 quando o item não existe', async () => {
    globalThis.fetch = (async () => jsonResponse({})) as unknown as typeof fetch;
    const res = await archiveRoutes.request('/inexistente-teste-rota');
    expect(res.status).toBe(404);
  });
});
