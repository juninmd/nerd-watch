import { describe, expect, test } from 'bun:test';
import { searchAddons } from '../../src/server/providers/stremio/search.ts';
import type { InstalledAddon } from '../../src/server/repo/stremio-addons.ts';

const addon = (id: string, catalogs: Array<{ type: string; id: string; searchable: boolean }>, resources = ['catalog']): InstalledAddon => ({
  id,
  manifestUrl: `https://${id}.example.com/manifest.json`,
  baseUrl: `https://${id}.example.com`,
  addedAt: '2026-01-01',
  manifest: { id, name: `Addon ${id}`, version: '1', description: '', logo: null, types: ['movie'], resources, catalogs: catalogs.map((c) => ({ ...c, name: c.id, paged: false, genres: [], yearFilter: false })) },
});

const hit = (id: string) => ({ id, type: 'movie', name: `Filme ${id}`, poster: null, year: '2020' });

describe('searchAddons', () => {
  test('consulta só catálogos pesquisáveis e marca o addon de origem', async () => {
    const asked: string[] = [];
    const out = await searchAddons(
      [addon('a', [{ type: 'movie', id: 'top', searchable: true }, { type: 'movie', id: 'novos', searchable: false }])],
      'matrix',
      async (_b, _t, catalogId, extra) => {
        asked.push(`${catalogId}:${extra.search}`);
        return [hit('tt1')];
      },
    );
    expect(asked).toEqual(['top:matrix']);
    expect(out).toEqual([{ ...hit('tt1'), addonId: 'a', addonName: 'Addon a' }]);
  });

  test('ignora addon sem recurso catalog e isola falha de um catálogo', async () => {
    const out = await searchAddons(
      [addon('streams', [{ type: 'movie', id: 'x', searchable: true }], ['stream']), addon('b', [{ type: 'movie', id: 'ruim', searchable: true }, { type: 'movie', id: 'bom', searchable: true }])],
      'q',
      async (_b, _t, catalogId) => {
        if (catalogId === 'ruim') throw new Error('boom');
        return [hit('tt2')];
      },
    );
    expect(out.map((h) => h.addonId)).toEqual(['b']);
  });

  test('dedupe do mesmo item entre catálogos do mesmo addon', async () => {
    const out = await searchAddons([addon('c', [{ type: 'movie', id: 'a', searchable: true }, { type: 'movie', id: 'b', searchable: true }])], 'q', async () => [hit('tt3')]);
    expect(out).toHaveLength(1);
  });
});
