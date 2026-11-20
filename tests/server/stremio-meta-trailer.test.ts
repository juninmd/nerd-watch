import { afterEach, describe, expect, test } from 'bun:test';
import { fetchMeta } from '../../src/server/providers/stremio/protocol.ts';
import { setAddonFetch } from '../../src/server/providers/stremio/client.ts';
import { setHostResolver } from '../../src/server/subtitles/load.ts';

const json = (body: unknown): Response => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

afterEach(() => {
  setAddonFetch();
  setHostResolver();
});

const metaWith = (extra: Record<string, unknown>) => {
  setHostResolver(async () => ['93.184.216.34']);
  let asked = '';
  setAddonFetch(async (url) => {
    asked = String(url);
    return json({ meta: { id: 'tt0133093', type: 'movie', name: 'Matrix', ...extra } });
  });
  return () => asked;
};

describe('fetchMeta — trailer do addon', () => {
  test('usa trailerStreams (ytId) e cai em trailers (source)', async () => {
    const asked = metaWith({ trailerStreams: [{ title: 'Matrix', ytId: 'FVI84Dfx2-I' }] });
    expect((await fetchMeta('https://addon.example.com', 'movie', 'tt0133093'))?.trailerKey).toBe('FVI84Dfx2-I');
    expect(asked()).toContain('/meta/movie/tt0133093.json');

    metaWith({ trailers: [{ source: 'dQw4w9WgXcQ', type: 'Trailer' }] });
    expect((await fetchMeta('https://addon.example.com', 'movie', 'tt0133093'))?.trailerKey).toBe('dQw4w9WgXcQ');
  });

  test('prefere trailerStreams e descarta chave fora do formato do YouTube', async () => {
    metaWith({
      trailerStreams: [{ ytId: 'curto' }],
      trailers: [{ source: 'javascript:alert(1)' }, { source: 'dQw4w9WgXcQ' }],
    });
    expect((await fetchMeta('https://addon.example.com', 'movie', 'tt0133093'))?.trailerKey).toBe('dQw4w9WgXcQ');

    metaWith({ trailers: [{ source: 'https://youtube.com/watch?v=dQw4w9WgXcQ' }] });
    expect((await fetchMeta('https://addon.example.com', 'movie', 'tt0133093'))?.trailerKey).toBeNull();
  });

  test('sem trailer declarado devolve null', async () => {
    metaWith({});
    expect((await fetchMeta('https://addon.example.com', 'movie', 'tt0133093'))?.trailerKey).toBeNull();
  });
});
