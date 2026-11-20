import { describe, expect, test } from 'bun:test';
import type { AddonBoardDto } from '../../src/client/api/stremio.ts';
import { groupBoards, MAX_RAILS, railsOf, RAIL_ITEMS } from '../../src/client/addons/discover-model.ts';

const board = (addonId: string, type: string, id: string): AddonBoardDto => ({
  key: `${addonId}:${type}:${id}`,
  addonId,
  addonName: `Addon ${addonId}`,
  logo: null,
  host: `${addonId}.example.com`,
  type,
  catalogId: id,
  name: id,
  searchable: false,
  paged: true,
  genres: [],
  yearFilter: false,
});

describe('modelo da tela Descobrir', () => {
  test('agrupa por addon preservando a ordem de instalação', () => {
    const groups = groupBoards([board('a', 'movie', 'top'), board('b', 'series', 'recent'), board('a', 'series', 'novidades')]);
    expect(groups.map((g) => g.addonId)).toEqual(['a', 'b']);
    expect(groups[0]?.boards.map((b) => b.catalogId)).toEqual(['top', 'novidades']);
    expect(groups[0]?.addonName).toBe('Addon a');
  });

  test('filmes e séries primeiro; o resto vai para o fim', () => {
    const rails = railsOf(
      groupBoards([board('a', 'channel', 'canais'), board('b', 'movie', 'filmes'), board('c', 'podcast', 'pods'), board('d', 'series', 'series')]),
      10,
    );
    expect(rails.map((r) => r.type)).toEqual(['movie', 'series', 'channel', 'podcast']);
  });

  test('respeita o teto de trilhos e de itens por trilho', () => {
    const many = Array.from({ length: MAX_RAILS + 5 }, (_, i) => board(`a${i}`, 'movie', `c${i}`));
    expect(railsOf(groupBoards(many))).toHaveLength(MAX_RAILS);
    expect(RAIL_ITEMS).toBeGreaterThan(0);
    expect(railsOf([])).toEqual([]);
  });
});
