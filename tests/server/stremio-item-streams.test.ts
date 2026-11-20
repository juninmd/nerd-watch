import { describe, expect, test } from 'bun:test';
import type { AddonStream } from '../../src/server/providers/stremio/protocol.ts';
import { streamsForTitle } from '../../src/server/providers/stremio/title-streams.ts';
import type { InstalledAddon } from '../../src/server/repo/stremio-addons.ts';

const addon = (id: string, resources: string[], types: string[]): InstalledAddon => ({
  id,
  manifestUrl: `https://${id}.example.com/manifest.json`,
  baseUrl: `https://${id}.example.com`,
  addedAt: '2026-01-01',
  manifest: {
    id,
    name: `Addon ${id}`,
    version: '1',
    description: '',
    logo: null,
    types,
    resources,
    catalogs: [],
  },
});

const urlStream = (url: string): AddonStream => ({
  kind: 'url',
  title: url,
  name: 'Fonte',
  description: url,
  url,
  infoHash: null,
  fileIdx: null,
  filename: null,
  videoSize: null,
  notWebReady: false,
  bingeGroup: null,
  countryWhitelist: [],
  subtitleLangs: [],
  subtitles: [],
  trackerCount: 0,
  trackers: [],
});

const torrentStream = (hash: string): AddonStream => ({
  ...urlStream(''),
  kind: 'torrent',
  url: null,
  infoHash: hash,
  trackers: [],
});

const own = addon('fenix', ['stream'], ['movie', 'series', 'anime']);
const torrentio = addon('torrentio', ['stream'], ['movie', 'series']);
const metaOnly = addon('cinemeta', ['catalog', 'meta'], ['movie', 'series']);

const resolver = async () => 'tt0816692';

describe('streamsForTitle — item aberto em um addon', () => {
  test('junta os streams do próprio addon com os torrents dos outros addons pelo IMDb', async () => {
    const calls: string[] = [];
    const fetchFn = async (base: string, type: string, id: string): Promise<AddonStream[]> => {
      calls.push(`${base}|${type}|${id}`);
      if (base === own.baseUrl) return [urlStream('https://fenix.example.com/v/1')];
      return [torrentStream('c9e15763f722f23e98a29decdfae341b98d53056')];
    };
    const out = await streamsForTitle(
      [own, torrentio],
      { mediaType: 'movie', imdbId: 'tt0816692', season: null, episode: null, own: { addonId: 'fenix', type: 'movie', itemId: 'tt0816692' } },
      resolver,
      fetchFn,
    );
    expect(out.addons.map((a) => `${a.addonId}:${a.type}:${a.contentId}`)).toEqual(['fenix:movie:tt0816692', 'torrentio:movie:tt0816692']);
    expect(out.addons[0]?.streams[0]).toMatchObject({ index: 0, kind: 'url', url: 'https://fenix.example.com/v/1' });
    expect(out.addons[1]?.streams[0]).toMatchObject({ index: 0, kind: 'torrent' });
    expect(calls).toContain('https://fenix.example.com|movie|tt0816692');
  });

  test('item sem IMDb (id próprio do addon) devolve só os streams do próprio addon e não consulta outros', async () => {
    const calls: string[] = [];
    const out = await streamsForTitle(
      [own, torrentio],
      { mediaType: 'tv', season: null, episode: null, own: { addonId: 'fenix', type: 'anime', itemId: 'afhd:123' } },
      resolver,
      async (base, type, id) => {
        calls.push(`${base}|${type}|${id}`);
        return [urlStream('https://afhd.example.com/v/1')];
      },
    );
    expect(out).toMatchObject({ imdbId: null, addons: [{ addonId: 'fenix', type: 'anime', contentId: 'afhd:123' }] });
    expect(calls).toEqual(['https://fenix.example.com|anime|afhd:123']);
  });

  test('esconde o “nada encontrado” do addon do item quando outro addon trouxe streams', async () => {
    const out = await streamsForTitle(
      [own, torrentio],
      { mediaType: 'movie', imdbId: 'tt0816692', season: null, episode: null, own: { addonId: 'fenix', type: 'movie', itemId: 'tt0816692' } },
      resolver,
      async (base) => (base === own.baseUrl ? [] : [torrentStream('c9e15763f722f23e98a29decdfae341b98d53056')]),
    );
    expect(out.addons.map((a) => a.addonId)).toEqual(['torrentio']);
  });

  test('addon só de catálogo/meta não é consultado como stream; os outros entram pelo IMDb', async () => {
    const calls: string[] = [];
    const out = await streamsForTitle(
      [metaOnly, torrentio],
      { mediaType: 'movie', imdbId: 'tt0816692', season: null, episode: null, own: { addonId: 'cinemeta', type: 'movie', itemId: 'tt0816692' } },
      resolver,
      async (base, type, id) => {
        calls.push(`${base}|${type}|${id}`);
        return [torrentStream('c9e15763f722f23e98a29decdfae341b98d53056')];
      },
    );
    expect(out.addons.map((a) => a.addonId)).toEqual(['torrentio']);
    expect(calls).toEqual(['https://torrentio.example.com|movie|tt0816692']);
  });

  test('episódio: addon do item pelo id original e os outros pelo tt:T:E', async () => {
    const out = await streamsForTitle(
      [own, torrentio],
      {
        mediaType: 'tv',
        imdbId: 'tt1234567',
        season: 1,
        episode: 2,
        own: { addonId: 'fenix', type: 'series', itemId: 'afhd:7:1:2' },
      },
      resolver,
      async (base) => (base === own.baseUrl ? [urlStream('https://fenix.example.com/e2')] : [torrentStream('c9e15763f722f23e98a29decdfae341b98d53056')]),
    );
    expect(out.addons.map((a) => `${a.addonId}:${a.type}:${a.contentId}`)).toEqual(['fenix:series:afhd:7:1:2', 'torrentio:series:tt1234567:1:2']);
  });

  test('tipo do item que o addon não declara não impede consultá-lo pelo IMDb', async () => {
    const odd = addon('odd', ['stream'], ['movie', 'series']);
    const calls: string[] = [];
    const out = await streamsForTitle(
      [odd, torrentio],
      { mediaType: 'tv', imdbId: 'tt1234567', season: 1, episode: 2, own: { addonId: 'odd', type: 'anime', itemId: 'tt1234567:1:2' } },
      resolver,
      async (base, type, id) => {
        calls.push(`${base}|${type}|${id}`);
        return [torrentStream('c9e15763f722f23e98a29decdfae341b98d53056')];
      },
    );
    expect(calls).toEqual(['https://odd.example.com|series|tt1234567:1:2', 'https://torrentio.example.com|series|tt1234567:1:2']);
    expect(out.addons.map((a) => a.addonId)).toEqual(['odd', 'torrentio']);
  });

  test('erro do addon do item continua visível quando outro addon trouxe streams', async () => {
    const out = await streamsForTitle(
      [own, torrentio],
      { mediaType: 'movie', imdbId: 'tt0816692', season: null, episode: null, own: { addonId: 'fenix', type: 'movie', itemId: 'tt0816692' } },
      resolver,
      async (base) => {
        if (base === own.baseUrl) throw new Error('boom');
        return [torrentStream('c9e15763f722f23e98a29decdfae341b98d53056')];
      },
    );
    expect(out.addons.map((a) => a.addonId)).toEqual(['fenix', 'torrentio']);
    expect(out.addons[0]?.error).toBe('falha inesperada no addon');
  });
});
