import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { openDb, resetDbForTests } from '../../src/server/db/database.ts';
import { setAddonFetch } from '../../src/server/providers/stremio/client.ts';
import { stremioRoutes } from '../../src/server/routes/stremio.ts';
import { setHostResolver } from '../../src/server/subtitles/load.ts';

/**
 * Normalização de texto e de "stream de aviso" ponta a ponta na rota: o addon manda títulos com
 * entidades HTML e um stream que é só vídeo de erro. O cliente precisa receber texto legível e
 * nenhum botão de play para o aviso.
 */

const MANIFEST_URL = 'https://addon.example.com/manifest.json';
const BASE = 'https://addon.example.com';
const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const manifest = {
  id: 'org.example.text',
  name: 'Torrent &amp; Cia',
  version: '1.0.0',
  types: ['movie'],
  resources: ['catalog', 'meta', { name: 'stream', types: ['movie'] }],
  catalogs: [{ type: 'movie', id: 'top', name: 'Top &quot;10&quot;' }],
};

const install = async (): Promise<string> => {
  const res = await stremioRoutes.request('/addons', { method: 'POST', body: JSON.stringify({ url: MANIFEST_URL }), headers: { 'content-type': 'application/json' } });
  return (await res.json()).id as string;
};

beforeEach(() => {
  resetDbForTests(openDb(':memory:'));
  setHostResolver(async () => ['93.184.216.34']);
  setAddonFetch(async (url) => {
    if (url === MANIFEST_URL) return json(manifest);
    if (url.includes('/catalog/movie/top')) return json({ metas: [{ id: 'tt1', type: 'movie', name: 'Ocean&#039;s Eleven', poster: 'https://img.example.com/p.jpg' }] });
    if (url.includes('/meta/movie/tt1')) return json({ meta: { id: 'tt1', name: 'Ocean&#039;s Eleven', description: 'Danny &quot;Ocean&quot; &amp; equipe', videos: [] } });
    if (url.includes('/stream/movie/tt1'))
      return json({
        streams: [
          { name: 'Torrentio\nRD error', title: 'Token do RealDebrid inv&#225;lido', url: `${BASE}/videos/failed_access_v3.mp4` },
          { name: 'Torrentio\n1080p', title: 'Filme 1080p', url: 'https://cdn.example.com/filme.mp4' },
        ],
      });
    return json({}, 404);
  });
});

afterEach(() => {
  setAddonFetch();
  setHostResolver();
  resetDbForTests();
});

describe('texto do addon', () => {
  test('manifest, catálogo e meta chegam sem entidade HTML', async () => {
    const id = await install();
    const addons = await (await stremioRoutes.request('/addons')).json();
    expect(addons.addons[0].name).toBe('Torrent & Cia');
    expect(addons.addons[0].catalogs[0].name).toBe('Top "10"');

    const { items } = await (await stremioRoutes.request(`/addons/${id}/catalog/movie/top`)).json();
    expect(items[0].name).toBe("Ocean's Eleven");

    const meta = await (await stremioRoutes.request(`/addons/${id}/meta/movie/tt1`)).json();
    expect(meta.name).toBe("Ocean's Eleven");
    expect(meta.description).toBe('Danny "Ocean" & equipe');
  });

  test('stream com vídeo de aviso vira kind=error, sem URL, e o de verdade continua url', async () => {
    const id = await install();
    const { streams } = await (await stremioRoutes.request(`/addons/${id}/streams/movie/tt1`)).json();
    expect(streams.map((s: { kind: string }) => s.kind)).toEqual(['error', 'url']);
    expect(streams[0]).toMatchObject({ kind: 'error', url: null, description: 'Token do RealDebrid inválido' });
    expect(streams[1].url).toBe('https://cdn.example.com/filme.mp4');
    // O aviso não pode ser aberto pelo player: sem URL, o cliente não tem para onde ir.
    expect(streams[0].url).toBeNull();
  });
});
