import { describe, expect, test } from 'bun:test';
import { addonItemPath, addonPath, canBrowse, capabilitySummary, resourceLabel } from '../../src/client/addons/addon-links.ts';
import { resolveRoute } from '../../src/client/app/routes.ts';
import type { AddonDto } from '../../src/client/api/stremio.ts';

const addon = (over: Partial<AddonDto>): AddonDto => ({ id: 'a1', host: 'h', name: 'n', version: '', description: '', logo: null, types: [], resources: [], catalogs: [], addedAt: '', ...over });

describe('addon-links', () => {
  test('id de episódio com ":" e "/" faz a viagem de ida e volta pela rota', () => {
    const path = addonItemPath('a1', 'series', 'tt1:1:2/x');
    expect(resolveRoute(path)?.params.map(decodeURIComponent)).toEqual(['a1', 'series', 'tt1:1:2/x']);
    expect(resolveRoute(addonPath('a1'))?.def.id).toBe('addonBrowse');
  });

  test('só navega quando declara catalog e tem catálogo listado', () => {
    expect(canBrowse(addon({ resources: ['catalog'], catalogs: [{ type: 'movie', id: 't', name: 'T', searchable: false, paged: false }] }))).toBe(true);
    expect(canBrowse(addon({ resources: ['catalog'] }))).toBe(false);
    expect(canBrowse(addon({ resources: ['stream'], catalogs: [{ type: 'movie', id: 't', name: 'T', searchable: false, paged: false }] }))).toBe(false);
  });

  test('rótulos de recurso conhecidos e desconhecidos', () => {
    expect(resourceLabel('subtitles')).toBe('legendas');
    expect(resourceLabel('addon_catalog')).toBe('addon_catalog');
  });
});

describe('capabilitySummary', () => {
  test('addon só de stream explica que não lista títulos', () => {
    expect(capabilitySummary(addon({ resources: ['stream'] }))).toContain('não lista títulos');
  });
  test('addon com catálogo conta quantos', () => {
    expect(capabilitySummary(addon({ resources: ['catalog'], catalogs: [{ type: 'movie', id: 't', name: 'T', searchable: false, paged: false }] }))).toContain('1 catálogo');
  });
  test('declara catalog sem catálogo listado', () => {
    expect(capabilitySummary(addon({ resources: ['catalog'] }))).toContain('não listou nenhum');
  });
});
