import { afterEach, describe, expect, test } from 'bun:test';
import { getTitleStreams } from '../../src/client/api/stremio.ts';

/**
 * A tela do título precisa mandar `title`/`year`: é assim que a API acha o item em addons que só
 * entendem id próprio (`afhd:…`). Sem esses campos o addon do AnimesFHD nunca apareceria em Bleach.
 */
const originalFetch = globalThis.fetch;
let captured = '';

afterEach(() => {
  globalThis.fetch = originalFetch;
  captured = '';
});

const stubFetch = (): void => {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    captured = String(input);
    return new Response(JSON.stringify({ imdbId: 'tt0434665', addons: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
};

describe('getTitleStreams', () => {
  test('envia título e ano junto do id', async () => {
    stubFetch();
    await getTitleStreams({ mediaType: 'tv', imdbId: 'tt0434665', season: 1, episode: 2, title: 'Bleach', year: '2004' });
    const query = new URL(captured, 'http://x').searchParams;
    expect(query.get('title')).toBe('Bleach');
    expect(query.get('year')).toBe('2004');
    expect(query.get('season')).toBe('1');
    expect(query.get('episode')).toBe('2');
  });

  test('sem título/ano a query não inventa os campos', async () => {
    stubFetch();
    await getTitleStreams({ mediaType: 'movie', tmdbId: 603 });
    const query = new URL(captured, 'http://x').searchParams;
    expect(query.get('title')).toBeNull();
    expect(query.get('year')).toBeNull();
    expect(query.get('mediaType')).toBe('movie');
  });

  test('item aberto no addon continua mandando addonId/type/itemId', async () => {
    stubFetch();
    await getTitleStreams({ mediaType: 'tv', addonId: 'a1', type: 'series', itemId: 'afhd:1:98', title: 'Bleach' });
    const query = new URL(captured, 'http://x').searchParams;
    expect(query.get('addonId')).toBe('a1');
    expect(query.get('type')).toBe('series');
    expect(query.get('itemId')).toBe('afhd:1:98');
  });
});
