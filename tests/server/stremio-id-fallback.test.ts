import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { openDb, resetDbForTests } from '../../src/server/db/database.ts';
import { setAddonFetch } from '../../src/server/providers/stremio/client.ts';
import type { AddonStream } from '../../src/server/providers/stremio/protocol.ts';
import { streamsForTitle } from '../../src/server/providers/stremio/title-streams.ts';
import type { InstalledAddon } from '../../src/server/repo/stremio-addons.ts';
import { stremioRoutes } from '../../src/server/routes/stremio.ts';
import { setHostResolver as setResolver } from '../../src/server/subtitles/load.ts';

/**
 * Addon que usa id próprio (`afhd:…`) e não responde ao `tt…` do app. Se ele publica catálogo
 * pesquisável, o app pergunta pelo nome, acha o item, resolve o episódio pelo meta e só então pede os
 * streams. É o caso do AnimesFHD para Bleach.
 */

const addon = (over: Partial<InstalledAddon['manifest']> = {}, id = 'a1'): InstalledAddon => ({
  id,
  manifestUrl: `https://${id}.example.com/manifest.json`,
  baseUrl: `https://${id}.example.com`,
  addedAt: '2026-01-01',
  enabled: true,
  manifest: {
    id,
    name: `Addon ${id}`,
    version: '1',
    description: '',
    logo: null,
    background: null,
    types: ['series', 'movie'],
    resources: ['catalog', 'meta', 'stream'],
    catalogs: [{ type: 'series', id: 'populares', name: 'Populares', searchable: true, paged: true, genres: [], yearFilter: false }],
    idPrefixes: ['afhd:'],
    configurable: false,
    configurationRequired: false,
    ...over,
  },
});

/**
 * Manifest como o addon publica de verdade: `searchable` não existe no JSON — quem decide é o `extra`.
 * A instalação passa pelo `parseManifest`, então o teste de rota precisa do formato cru.
 */
const rawManifest = () => ({
  id: 'a1',
  name: 'Addon a1',
  version: '1',
  description: '',
  types: ['series', 'movie'],
  resources: ['catalog', 'meta', 'stream'],
  catalogs: [{ type: 'series', id: 'populares', name: 'Populares', extra: [{ name: 'search' }] }],
  idPrefixes: ['afhd:'],
});

const stream: AddonStream = {
  kind: 'url',
  title: 'AnimesFHD · Player 1',
  name: 'AnimesFHD',
  description: 'Player 1 • Legendado',
  url: 'https://cdn.example.com/ep1.mp4',
  infoHash: null,
  fileIdx: null,
  filename: null,
  videoSize: null,
  notWebReady: true,
  bingeGroup: null,
  countryWhitelist: [],
  subtitleLangs: [],
  subtitles: [],
  trackerCount: 0,
  trackers: [],
};

const deps = () => {
  const calls: string[] = [];
  return {
    calls,
    catalog: async (_base: string, type: string, catalogId: string, extra: { search?: string }) => {
      calls.push(`catalog:${type}:${catalogId}:${extra.search ?? ''}`);
      return [{ id: 'afhd:1', type: 'series', name: 'Bleach', poster: null, year: '2004' }];
    },
    meta: async (_base: string, _type: string, itemId: string) => {
      calls.push(`meta:${itemId}`);
      return {
        id: itemId,
        type: 'series',
        name: 'Bleach',
        poster: null,
        year: '2004',
        background: null,
        description: '',
        runtime: '',
        genres: [],
        trailerKey: null,
        videos: [{ id: 'afhd:1:98', title: 'Episódio 1', season: 1, episode: 1 }],
      };
    },
  };
};

describe('streamsForTitle com addon de id próprio', () => {
  test('resolve pelo catálogo e consulta os streams com o id do episódio do addon', async () => {
    const fake = deps();
    const seen: string[] = [];
    const fetchFn = async (_base: string, _type: string, contentId: string) => {
      seen.push(contentId);
      return [stream];
    };

    const result = await streamsForTitle([addon()], { mediaType: 'tv', imdbId: 'tt0434665', season: 1, episode: 1, title: 'Bleach', year: '2004' }, async () => null, fetchFn, fake);

    expect(fake.calls).toEqual(['catalog:series:populares:Bleach', 'meta:afhd:1']);
    expect(seen).toEqual(['afhd:1:98']);
    expect(result.addons).toHaveLength(1);
    expect(result.addons[0]).toMatchObject({ contentId: 'afhd:1:98', matchedTitle: 'Bleach', error: null });
    expect(result.addons[0]?.streams[0]).toMatchObject({ kind: 'url', url: 'https://cdn.example.com/ep1.mp4' });
  });

  test('sem nome do título (ou só espaços) não consulta catálogo nenhum', async () => {
    const fake = deps();
    const result = await streamsForTitle([addon()], { mediaType: 'tv', imdbId: 'tt0434665', season: 1, episode: 1 }, async () => null, async () => [stream], fake);
    expect(fake.calls).toEqual([]);
    expect(result.addons).toHaveLength(0);

    const blank = await streamsForTitle([addon()], { mediaType: 'tv', imdbId: 'tt0434665', season: 1, episode: 1, title: '   ' }, async () => null, async () => [stream], fake);
    expect(fake.calls).toEqual([]);
    expect(blank.addons).toHaveLength(0);
  });

  test('addon que aceita o id do app é consultado por id, não por busca', async () => {
    const fake = deps();
    const ttAddon = addon({ idPrefixes: ['tt'], id: 'tt-addon' });
    const result = await streamsForTitle([ttAddon], { mediaType: 'tv', imdbId: 'tt0434665', season: 1, episode: 1, title: 'Bleach' }, async () => null, async () => [stream], fake);
    expect(fake.calls).toEqual([]);
    expect(result.addons[0]?.contentId).toBe('tt0434665:1:1');
  });

  test('catálogo sem item correspondente não vira card', async () => {
    const fake = { ...deps(), catalog: async () => [{ id: 'afhd:2', type: 'series', name: 'Naruto', poster: null, year: '2002' }] };
    const result = await streamsForTitle([addon()], { mediaType: 'tv', imdbId: 'tt0434665', season: 1, episode: 1, title: 'Bleach', year: '2004' }, async () => null, async () => [stream], fake);
    expect(result.addons).toHaveLength(0);
  });

  test('falha ao buscar stream vira erro visível no grupo', async () => {
    const fake = deps();
    const result = await streamsForTitle([addon()], { mediaType: 'tv', imdbId: 'tt0434665', season: 1, episode: 1, title: 'Bleach' }, async () => null, async () => {
      throw new Error('boom');
    }, fake);
    expect(result.addons).toHaveLength(1);
    expect(result.addons[0]?.error).toBe('falha inesperada no addon');
  });
});

describe('rota /streams aceita título e ano', () => {
  const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

  beforeEach(() => {
    resetDbForTests(openDb(':memory:'));
    setResolver(async () => ['93.184.216.34']);
    setAddonFetch(async (url) => {
      if (url.endsWith('/manifest.json')) return json(rawManifest());
      if (url.includes('/catalog/series/populares')) return json({ metas: [{ id: 'afhd:1', type: 'series', name: 'Bleach', year: '2004' }] });
      if (url.includes('/meta/series/afhd%3A1')) return json({ meta: { id: 'afhd:1', name: 'Bleach', videos: [{ id: 'afhd:1:98', title: 'Ep', season: 1, episode: 1 }] } });
      if (url.includes('/stream/series/afhd%3A1%3A98')) return json({ streams: [{ name: 'AnimesFHD', title: 'Player 1', url: 'https://cdn.example.com/e.mp4' }] });
      return json({}, 404);
    });
  });

  afterEach(() => {
    setAddonFetch();
    setResolver();
    resetDbForTests();
  });

  test('com title/year acha o addon de id próprio; sem eles não acha', async () => {
    const installed = await stremioRoutes.request('/addons', {
      method: 'POST',
      body: JSON.stringify({ url: 'https://a1.example.com/manifest.json' }),
      headers: { 'content-type': 'application/json' },
    });
    expect(installed.status).toBe(201);

    const withTitle = await (await stremioRoutes.request('/streams?mediaType=tv&imdbId=tt0434665&season=1&episode=1&title=Bleach&year=2004')).json();
    expect(withTitle.addons[0]).toMatchObject({ contentId: 'afhd:1:98', matchedTitle: 'Bleach' });
    expect(withTitle.addons[0].streams[0].url).toBe('https://cdn.example.com/e.mp4');

    const withoutTitle = await (await stremioRoutes.request('/streams?mediaType=tv&imdbId=tt0434665&season=1&episode=1')).json();
    expect(withoutTitle.addons).toHaveLength(0);
  });

  test('title/year inválidos são 400', async () => {
    expect((await stremioRoutes.request('/streams?mediaType=tv&imdbId=tt0434665&year=24')).status).toBe(400);
    expect((await stremioRoutes.request(`/streams?mediaType=tv&imdbId=tt0434665&title=${'a'.repeat(201)}`)).status).toBe(400);
  });
});
