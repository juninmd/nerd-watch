import { describe, expect, test } from 'bun:test';
import { goKeys, isNavActive, NAV_GROUPS, NAV_ITEMS } from '../../src/client/app/nav-model.ts';
import { resolveRoute } from '../../src/client/app/routes.ts';

const item = (path: string) => NAV_ITEMS.find((i) => i.path === path) as (typeof NAV_ITEMS)[number];

describe('menu lateral', () => {
  test('quatro grupos, e todo item aponta para uma rota que existe', () => {
    expect(NAV_GROUPS.map((g) => g.label)).toEqual(['Assistir', 'Descobrir', 'Fontes de vídeo', 'Conta e dados']);
    for (const i of NAV_ITEMS) expect(resolveRoute(i.path)).not.toBeNull();
  });

  test('não há dois itens com a mesma letra de atalho nem o mesmo caminho', () => {
    expect(new Set(NAV_ITEMS.map((i) => i.key)).size).toBe(NAV_ITEMS.length);
    expect(new Set(NAV_ITEMS.map((i) => i.path)).size).toBe(NAV_ITEMS.length);
  });

  test('detalhe do título fica na Biblioteca e o player nos Canais; só um item ativo por vez', () => {
    expect(isNavActive(item('/library'), '/title/tmdb/tv/1')).toBe(true);
    expect(isNavActive(item('/telegram'), '/watch/abc/1')).toBe(true);
    expect(isNavActive(item('/'), '/library')).toBe(false);
    for (const path of ['/', '/library', '/lists/abc', '/data', '/settings', '/telegram/x', '/public-domain']) {
      expect(NAV_ITEMS.filter((i) => isNavActive(i, path)).length).toBe(1);
    }
  });

  test('atalhos g + letra: os do menu e os apelidos antigos continuam valendo', () => {
    const keys = goKeys();
    expect(keys.h).toBe('/');
    expect(keys.i).toBe('/');
    expect(keys.b).toBe('/library');
    expect(keys.t).toBe('/telegram');
    expect(keys.c).toBe('/connections');
    expect(keys.x).toBe('/connections');
    expect(keys.d).toBe('/data');
    expect(keys.j).toBe('/settings');
    expect(keys.s).toBe('/search');
    expect(keys.p).toBe('/public-domain');
  });
});
