import { describe, expect, test } from 'bun:test';
import type { AddonBoardDto, AddonItemDto } from '../../src/client/api/stremio.ts';
import { arrangeBoards, defaultPrefs, mergeFeed, moveBoard, toggleHidden, visibleBoards } from '../../src/client/addons/catalog-prefs.ts';

const board = (key: string): AddonBoardDto => ({ key, addonId: key, addonName: key, name: key, type: 'movie', catalogId: key }) as AddonBoardDto;
const item = (id: string): AddonItemDto => ({ id, type: 'movie', name: id, poster: null, year: null });
const boards = ['a', 'b', 'c'].map(board);
const keys = (l: AddonBoardDto[]) => l.map((b) => b.key);

describe('catálogos da tela Descobrir', () => {
  test('sem escolha, mantém a ordem padrão', () => {
    expect(keys(arrangeBoards(boards, defaultPrefs()))).toEqual(['a', 'b', 'c']);
  });

  test('mover troca vizinhos e não passa das pontas', () => {
    const p = moveBoard(boards, defaultPrefs(), 'c', -1);
    expect(keys(arrangeBoards(boards, p))).toEqual(['a', 'c', 'b']);
    expect(moveBoard(boards, p, 'a', -1)).toBe(p);
  });

  test('catálogo novo (addon instalado depois) entra no fim', () => {
    const p = { ...defaultPrefs(), order: ['b', 'a'] };
    expect(keys(arrangeBoards([...boards, board('d')], p))).toEqual(['b', 'a', 'c', 'd']);
  });

  test('oculto sai da tela e volta ao religar', () => {
    const hidden = toggleHidden(defaultPrefs(), 'b', true);
    expect(keys(visibleBoards(boards, hidden))).toEqual(['a', 'c']);
    expect(keys(visibleBoards(boards, toggleHidden(hidden, 'b', false)))).toEqual(['a', 'b', 'c']);
  });

  test('Meu feed intercala os catálogos sem repetir título', () => {
    const feed = mergeFeed([[item('1'), item('2')], [item('9'), item('1'), item('3')]], 4);
    expect(feed.map((x) => x.id)).toEqual(['1', '9', '2', '3']);
  });
});
