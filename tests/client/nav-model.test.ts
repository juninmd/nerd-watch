import { describe, expect, test } from 'bun:test';
import {
  goKeys,
  isNavActive,
  NAV_GROUPS,
  NAV_ITEMS,
  readNavCompact,
  writeNavCompact,
} from '../../src/client/app/nav-model.ts';
import { resolveRoute } from '../../src/client/app/routes.tsx';

const item = (path: string) => NAV_ITEMS.find((i) => i.path === path) as (typeof NAV_ITEMS)[number];

describe('menu lateral', () => {
  test('quatro grupos, e todo item aponta para uma rota que existe', () => {
    expect(NAV_GROUPS.map((g) => g.label)).toEqual(['Assistir', 'Descobrir', 'Fontes de vídeo', 'Conta e dados']);
    for (const i of NAV_ITEMS) expect(resolveRoute(i.path)).not.toBeNull();
  });

  test('todo caminho do menu é único e todo grupo tem itens', () => {
    const paths = NAV_ITEMS.map((i) => i.path);
    expect(new Set(paths).size).toBe(paths.length);
    for (const g of NAV_GROUPS) expect(g.items.length).toBeGreaterThan(0);
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

  test('o início só vale na raiz', () => {
    expect(isNavActive(item('/'), '/')).toBe(true);
    expect(isNavActive(item('/'), '/library')).toBe(false);
  });

  test('telas filhas ativam o item da família', () => {
    expect(isNavActive(item('/library'), '/title/tmdb/tv/123')).toBe(true);
    expect(isNavActive(item('/telegram'), '/watch/abc')).toBe(true);
    expect(isNavActive(item('/lists'), '/lists/minha-lista')).toBe(true);
  });

  test('listas e biblioteca não se confundem', () => {
    expect(isNavActive(item('/library'), '/lists')).toBe(false);
    expect(isNavActive(item('/lists'), '/library')).toBe(false);
  });

  test('a barra do celular tem 4 ou 5 atalhos', () => {
    const n = NAV_ITEMS.filter((i) => i.primary).length;
    expect(n).toBeGreaterThanOrEqual(4);
    expect(n).toBeLessThanOrEqual(5);
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

  test('preferência de menu compacto sobrevive e tolera storage quebrado', () => {
    const mem: Record<string, string> = {};
    const storage = {
      getItem: (k: string) => mem[k] ?? null,
      setItem: (k: string, v: string) => {
        mem[k] = v;
      },
    };
    expect(readNavCompact(storage)).toBe(false);
    writeNavCompact(true, storage);
    expect(readNavCompact(storage)).toBe(true);
    const broken = {
      getItem: () => {
        throw new Error('bloqueado');
      },
      setItem: () => {
        throw new Error('bloqueado');
      },
    };
    expect(readNavCompact(broken)).toBe(false);
    expect(() => writeNavCompact(true, broken)).not.toThrow();
  });
});
