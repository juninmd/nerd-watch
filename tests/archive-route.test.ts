import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { openDb, resetDbForTests } from '../src/server/db.ts';
import { archiveRoutes } from '../src/server/routes/archive.ts';
import { pickDirectVideoUrl } from '../src/server/providers/archive.ts';

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

  test('marca hasPlayableVideo quando há MP4 no item', async () => {
    globalThis.fetch = (async () =>
      jsonResponse({
        metadata: { identifier: 'route-test-mp4', title: 'Tem MP4', year: 1960 },
        files: [{ name: 'filme_512kb.mp4', format: '512Kb MPEG4' }],
      })) as unknown as typeof fetch;

    const body = await (await archiveRoutes.request('/route-test-mp4')).json();
    expect(body.hasPlayableVideo).toBe(true);
  });

  test('marca hasPlayableVideo:false quando só há OGV', async () => {
    globalThis.fetch = (async () =>
      jsonResponse({
        metadata: { identifier: 'route-test-ogv', title: 'Só OGV', year: 1961 },
        files: [{ name: 'filme.ogv', format: 'Ogg Video' }],
      })) as unknown as typeof fetch;

    const body = await (await archiveRoutes.request('/route-test-ogv')).json();
    expect(body.hasPlayableVideo).toBe(false);
    expect(body.directVideoUrl).toBeNull();
  });

  test('devolve o arquivo direto para o player do app (derivado H.264, mais leve)', async () => {
    globalThis.fetch = (async () =>
      jsonResponse({
        metadata: { identifier: 'route-test-direct', title: 'Direto', year: 1962 },
        files: [
          { name: 'filme.mp4', format: 'MPEG4', size: '900000000' },
          { name: 'filme_512kb.mp4', format: 'h.264', size: '90000000' },
        ],
      })) as unknown as typeof fetch;

    const body = await (await archiveRoutes.request('/route-test-direct')).json();
    expect(body.directVideoUrl).toBe('https://archive.org/download/route-test-direct/filme_512kb.mp4');
  });
});

describe('pickDirectVideoUrl', () => {
  test('prefere H.264, depois MP4, depois WebM', () => {
    const files = [
      { name: 'a.webm', format: 'WebM' },
      { name: 'b.mp4', format: 'MPEG4' },
      { name: 'c.mp4', format: 'h.264' },
    ];
    expect(pickDirectVideoUrl('x', files)).toBe('https://archive.org/download/x/c.mp4');
    expect(pickDirectVideoUrl('x', files.slice(0, 2))).toBe('https://archive.org/download/x/b.mp4');
    expect(pickDirectVideoUrl('x', [{ name: 'a.webm', format: 'WebM' }])).toBe('https://archive.org/download/x/a.webm');
  });

  test('item em partes começa pela parte 1, não pelo menor arquivo', () => {
    const parts = ['filme-2of10_512kb.mp4', 'filme-10of10_512kb.mp4', 'filme-1of10_512kb.mp4'].map((name, i) => ({ name, format: 'h.264', size: String(100 - i * 40) }));
    expect(pickDirectVideoUrl('x', parts)).toBe('https://archive.org/download/x/filme-1of10_512kb.mp4');
  });

  test('ignora o que o navegador não toca e escapa nomes com espaço e subpasta', () => {
    expect(pickDirectVideoUrl('x', [{ name: 'a.ogv' }, { name: 'b.avi' }, { name: 'c.mkv' }])).toBeNull();
    expect(pickDirectVideoUrl('x', undefined)).toBeNull();
    expect(pickDirectVideoUrl('x', [{ name: 'pasta/meu filme.mp4' }])).toBe('https://archive.org/download/x/pasta/meu%20filme.mp4');
  });
});
