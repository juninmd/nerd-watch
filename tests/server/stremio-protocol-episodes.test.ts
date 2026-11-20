import { afterEach, describe, expect, test } from 'bun:test';
import { setAddonFetch } from '../../src/server/providers/stremio/client.ts';
import { fetchMeta, fetchStreams, pathSegment } from '../../src/server/providers/stremio/protocol.ts';
import { setHostResolver } from '../../src/server/subtitles/load.ts';

afterEach(() => {
  setAddonFetch(undefined);
  setHostResolver(undefined);
});

describe('stremio protocol: episódios e segmentos', () => {
  test('pathSegment aceita : codificado e bloqueia barra, traversal, query, fragmento e controle', () => {
    expect(pathSegment('tt0903747:1:2')).toBe('tt0903747%3A1%3A2');
    expect(() => pathSegment('anime/ep-1')).toThrow('parâmetro inválido');
    expect(() => pathSegment('../secret')).toThrow('parâmetro inválido');
    expect(() => pathSegment('a?b=1')).toThrow('parâmetro inválido');
    expect(() => pathSegment('a#b')).toThrow('parâmetro inválido');
    expect(() => pathSegment('a\\b')).toThrow('parâmetro inválido');
    expect(() => pathSegment('a\nb')).toThrow('parâmetro inválido');
  });

  test('fetchMeta aceita season e episode como string numérica além de number', async () => {
    setHostResolver(async () => ['93.184.216.34']);
    setAddonFetch(async () =>
      new Response(
        JSON.stringify({
          meta: {
            id: 'tt0903747',
            type: 'series',
            name: 'Breaking Bad',
            videos: [
              { id: 'tt0903747:1:1', title: 'Pilot', season: '1', episode: '1' },
              { id: 'tt0903747:1:2', name: 'Cat in the Bag', season: 1, number: '2' },
            ],
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const meta = await fetchMeta('https://addon.example.com', 'series', 'tt0903747');
    expect(meta?.videos).toEqual([
      { id: 'tt0903747:1:1', title: 'Pilot', season: 1, episode: 1 },
      { id: 'tt0903747:1:2', title: 'Cat in the Bag', season: 1, episode: 2 },
    ]);
  });

  test('fetchStreams preserva name, description, behaviorHints, subtitleLangs e trackerCount', async () => {
    setHostResolver(async () => ['93.184.216.34']);
    setAddonFetch(async () =>
      new Response(
        JSON.stringify({
          streams: [
            {
              name: 'Torrentio\n1080p',
              description: 'Movie.1080p.WEB-DL\n👤 50 💾 2.1 GB',
              infoHash: '0123456789abcdef0123456789abcdef01234567',
              fileIdx: '3',
              sources: ['tracker:udp://tracker.example.com:80/announce'],
              subtitles: [{ id: '1', url: 'https://sub.example.com/pt.vtt', lang: 'por' }],
              behaviorHints: {
                filename: 'Movie.1080p.mkv',
                videoSize: 2254857830,
                notWebReady: true,
                bingeGroup: 'torrentio|1080p',
                countryWhitelist: ['br'],
              },
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const streams = await fetchStreams('https://addon.example.com', 'movie', 'tt0903747');
    expect(streams).toHaveLength(1);
    expect(streams[0]?.name).toBe('Torrentio\n1080p');
    expect(streams[0]?.description).toContain('👤 50');
    expect(streams[0]?.fileIdx).toBe(3);
    expect(streams[0]?.videoSize).toBe(2254857830);
    expect(streams[0]?.notWebReady).toBe(true);
    expect(streams[0]?.bingeGroup).toBe('torrentio|1080p');
    expect(streams[0]?.countryWhitelist).toEqual(['BR']);
    expect(streams[0]?.subtitleLangs).toEqual(['por']);
    expect(streams[0]?.trackerCount).toBe(1);
  });
});
