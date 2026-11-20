import { describe, expect, test } from 'bun:test';
import { searchAddons } from '../../src/server/providers/stremio/search.ts';
import type { InstalledAddon } from '../../src/server/repo/stremio-addons.ts';

const addon = (id: string, catalogs: Array<{ type: string; id: string; searchable: boolean }>, resources = ['catalog']): InstalledAddon => ({
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
    background: null,
    types: ['movie'],
    resources,
    catalogs: catalogs.map((c) => ({ ...c, name: c.id, paged: false, genres: [], yearFilter: false })),
    idPrefixes: [],
    configurable: false,
    configurationRequired: false,
  },
});

const hit = (id: string) => ({ id, type: 'movie', name: `Filme ${id}`, poster: null, year: '2020' });
const named = (id: string, name: string) => ({ id, type: 'movie', name, poster: null, year: '2026' });

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

  test('addon sem busca no protocolo: filtra a primeira página sem caixa', async () => {
    const asked: string[] = [];
    const out = await searchAddons(
      [
        addon('f', [
          { type: 'movie', id: 'populares', searchable: false },
          { type: 'movie', id: 'recentes', searchable: false },
        ]),
      ],
      'ODISSEIA',
      async (_b, _t, catalogId, extra) => {
        asked.push(`${catalogId}:${extra.search ?? '-'}`);
        return catalogId === 'populares' ? [named('tt33764258', 'A Odisseia'), named('tt2', 'Outro filme')] : [named('tt33764258', 'A Odisseia')];
      },
    );
    // Casamento sem caixa, dedupe entre catálogos e nenhum `search` enviado ao addon.
    expect(out).toEqual([{ ...named('tt33764258', 'A Odisseia'), addonId: 'f', addonName: 'Addon f' }]);
    expect(asked).toEqual(['populares:-', 'recentes:-']);
  });

  test('filtro local ignora acento e isola falha de um catálogo', async () => {
    const out = await searchAddons(
      [
        addon('f', [
          { type: 'movie', id: 'ruim', searchable: false },
          { type: 'movie', id: 'bom', searchable: false },
        ]),
      ],
      'acao',
      async (_b, _t, catalogId) => {
        if (catalogId === 'ruim') throw new Error('boom');
        return [named('tt1', 'Ação Total'), named('tt2', 'Outro')];
      },
    );
    expect(out.map((h) => h.id)).toEqual(['tt1']);
  });

  test('filtro local respeita o teto por addon e o orçamento global por busca', async () => {
    const sixCatalogs = Array.from({ length: 6 }, (_, i) => ({ type: 'movie', id: `c${i}`, searchable: false }));
    let perAddonCalls = 0;
    const perAddon = await searchAddons([addon('f', sixCatalogs)], 'acao', async () => {
      perAddonCalls++;
      return [named('tt1', 'Ação')];
    });
    expect(perAddonCalls).toBe(4);
    expect(perAddon).toHaveLength(1);

    const fourCatalogs = Array.from({ length: 4 }, (_, i) => ({ type: 'movie', id: `c${i}`, searchable: false }));
    const calls: string[] = [];
    const out = await searchAddons(
      ['a', 'b', 'c'].map((id) => addon(id, fourCatalogs)),
      'acao',
      async (base) => {
        calls.push(base);
        return [named(`tt-${base}`, 'Ação')];
      },
    );
    expect(calls).toEqual([
      'https://a.example.com',
      'https://a.example.com',
      'https://a.example.com',
      'https://a.example.com',
      'https://b.example.com',
      'https://b.example.com',
      'https://b.example.com',
      'https://b.example.com',
    ]);
    expect(out.map((h) => h.addonId)).toEqual(['a', 'b']);
  });

  test('termo de 1 caractere não varre catálogo local', async () => {
    let calls = 0;
    const out = await searchAddons([addon('f', [{ type: 'movie', id: 'x', searchable: false }])], 'a', async () => {
      calls++;
      return [named('tt1', 'Ação')];
    });
    expect(calls).toBe(0);
    expect(out).toEqual([]);
  });
});
