import { describe, expect, test } from 'bun:test';
import type { AddonStream } from '../../src/server/providers/stremio/protocol.ts';
import { ADDON_CONCURRENCY, streamsForTitle } from '../../src/server/providers/stremio/title-streams.ts';
import type { InstalledAddon } from '../../src/server/repo/stremio-addons.ts';

/**
 * Fan-out da página do título: com vários addons, as requisições não podem sair todas de uma vez
 * (rajada vira 429 no addon e segura sockets do app local). O teto é `ADDON_CONCURRENCY`.
 */
const addon = (id: string): InstalledAddon => ({
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
    types: ['movie'],
    resources: ['stream'],
    catalogs: [],
    idPrefixes: ['tt'],
    configurable: false,
    configurationRequired: false,
  },
});

describe('concorrência do fan-out de streams', () => {
  test('nunca passa do teto e devolve um grupo por addon', async () => {
    let inFlight = 0;
    let peak = 0;
    const fetchFn = async (): Promise<AddonStream[]> => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight--;
      return [];
    };

    const addons = Array.from({ length: 10 }, (_, i) => addon(`a${i}`));
    const result = await streamsForTitle(addons, { mediaType: 'movie', imdbId: 'tt0111161', season: null, episode: null }, async () => null, fetchFn);

    expect(result.addons).toHaveLength(10);
    expect(peak).toBeLessThanOrEqual(ADDON_CONCURRENCY);
    // Se fosse um por vez, o pico seria 1; o teto tem que ser aproveitado.
    expect(peak).toBeGreaterThan(1);
  });

  test('ordem dos grupos segue a ordem dos addons, mesmo terminando fora de ordem', async () => {
    const fetchFn = async (baseUrl: string) => {
      const id = Number(baseUrl.match(/a(\d+)\./)?.[1] ?? '0');
      await new Promise((resolve) => setTimeout(resolve, (10 - id) * 3));
      return [];
    };
    const addons = Array.from({ length: 4 }, (_, i) => addon(`a${i}`));
    const result = await streamsForTitle(addons, { mediaType: 'movie', imdbId: 'tt0111161', season: null, episode: null }, async () => null, fetchFn);
    expect(result.addons.map((g) => g.addonId)).toEqual(['a0', 'a1', 'a2', 'a3']);
  });
});
