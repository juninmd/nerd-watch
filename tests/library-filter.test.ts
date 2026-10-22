import { describe, expect, test } from 'bun:test';
import { countByStatus, filterBySource, filterByStatus } from '../src/client/library-filter.ts';

const item = (watchStatus: 'want' | 'watching' | 'watched' | 'dropped', source: 'tmdb' | 'archive' | 'telegram') => ({ watchStatus, title: { source } });

const items = [item('want', 'tmdb'), item('watching', 'tmdb'), item('watching', 'telegram'), item('watched', 'archive')];

describe('countByStatus', () => {
  test('conta cada status e o total', () => {
    expect(countByStatus(items)).toEqual({ all: 4, want: 1, watching: 2, watched: 1, dropped: 0 });
  });

  test('lista vazia zera tudo', () => {
    expect(countByStatus([])).toEqual({ all: 0, want: 0, watching: 0, watched: 0, dropped: 0 });
  });
});

describe('filtros', () => {
  test('"all" não filtra', () => {
    expect(filterBySource(items, 'all')).toHaveLength(4);
    expect(filterByStatus(items, 'all')).toHaveLength(4);
  });

  test('origem e status se combinam e as contagens seguem a origem', () => {
    const tmdb = filterBySource(items, 'tmdb');
    expect(countByStatus(tmdb).all).toBe(2);
    expect(filterByStatus(tmdb, 'watching')).toEqual([item('watching', 'tmdb')]);
  });
});
