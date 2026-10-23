import { describe, expect, test } from 'bun:test';
import { applyLibraryQuery, sortLibraryItems } from '../src/client/library-filter.ts';
import { DEFAULT_VIEW_QUERY } from '../src/server/saved-views/schema.ts';

type Row = { watchStatus: 'want' | 'watching' | 'watched' | 'dropped'; rating: number | null; title: { title: string; source: 'tmdb' | 'archive' | 'telegram' } };
const row = (title: string, rating: number | null, watchStatus: Row['watchStatus'] = 'want', source: Row['title']['source'] = 'tmdb'): Row => ({
  watchStatus,
  rating,
  title: { title, source },
});

describe('sortLibraryItems', () => {
  test('"recentes" mantém a ordem que veio do servidor (atividade mais recente primeiro)', () => {
    const rows = [row('Zebra', null), row('Abacaxi', 9)];
    expect(sortLibraryItems(rows, 'recent').map((r) => r.title.title)).toEqual(['Zebra', 'Abacaxi']);
  });

  test('"título" ordena A a Z ignorando caixa e acento', () => {
    const rows = [row('Zebra', null), row('Árvore', null), row('arco', null), row('Bola', null)];
    expect(sortLibraryItems(rows, 'title').map((r) => r.title.title)).toEqual(['arco', 'Árvore', 'Bola', 'Zebra']);
  });

  test('"nota" põe a maior primeiro e os sem nota por último, sem reordenar empates', () => {
    const rows = [row('sem nota', null), row('nota 6 a', 6), row('nota 9', 9), row('nota 6 b', 6)];
    expect(sortLibraryItems(rows, 'rating').map((r) => r.title.title)).toEqual(['nota 9', 'nota 6 a', 'nota 6 b', 'sem nota']);
  });

  test('nota zero é nota de verdade: fica antes de quem não tem nota', () => {
    const rows = [row('sem', null), row('zero', 0)];
    expect(sortLibraryItems(rows, 'rating').map((r) => r.title.title)).toEqual(['zero', 'sem']);
  });

  test('não altera o array recebido', () => {
    const rows = [row('b', 1), row('a', 2)];
    sortLibraryItems(rows, 'title');
    expect(rows.map((r) => r.title.title)).toEqual(['b', 'a']);
  });

  test('lista vazia não quebra', () => {
    expect(sortLibraryItems([], 'rating')).toEqual([]);
  });
});

describe('applyLibraryQuery (visão salva)', () => {
  test('a visão padrão deixa tudo como está', () => {
    const rows = [row('b', null), row('a', null, 'watched', 'telegram')];
    expect(applyLibraryQuery(rows, DEFAULT_VIEW_QUERY)).toEqual(rows);
  });

  test('filtra por status e origem e ordena, tudo de uma vez', () => {
    const rows = [
      row('Zeta', 7, 'want', 'tmdb'),
      row('Alfa', 9, 'want', 'tmdb'),
      row('Beta', 10, 'watched', 'tmdb'),
      row('Gama', 8, 'want', 'telegram'),
    ];
    const shown = applyLibraryQuery(rows, { status: 'want', source: 'tmdb', sort: 'rating' });
    expect(shown.map((r) => r.title.title)).toEqual(['Alfa', 'Zeta']);
  });

  test('combinação sem resultado devolve lista vazia (a tela mostra o estado vazio)', () => {
    expect(applyLibraryQuery([row('x', null)], { status: 'dropped', source: 'all', sort: 'recent' })).toEqual([]);
  });
});
