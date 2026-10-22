import { describe, expect, test } from 'bun:test';
import { filterItems, normalizeSearch } from '../src/client/telegram-items.ts';

const item = (messageId: string, caption: string | null) => ({ messageId, caption });

describe('normalizeSearch', () => {
  test('ignora maiúsculas, acentos e espaços repetidos', () => {
    expect(normalizeSearch('  PÂNICO   na  TV ')).toBe('panico na tv');
    expect(normalizeSearch('Ação & Coração')).toBe('acao & coracao');
  });

  test('texto vazio ou só espaços vira vazio', () => {
    expect(normalizeSearch('')).toBe('');
    expect(normalizeSearch('   ')).toBe('');
  });
});

describe('filterItems', () => {
  const items = [
    item('1', 'Enrolados - 2010\nDublado'),
    item('2', 'Pânico na TV: Episódio 12'),
    item('3', 'Rei Leão (1994)'),
    item('4', null),
  ];

  test('sem texto devolve a lista inteira, inclusive vídeos sem legenda', () => {
    expect(filterItems(items, '')).toBe(items);
    expect(filterItems(items, '   ')).toBe(items);
  });

  test('acha pela legenda sem se importar com caixa nem acento', () => {
    expect(filterItems(items, 'ENROLADOS').map((i) => i.messageId)).toEqual(['1']);
    expect(filterItems(items, 'panico').map((i) => i.messageId)).toEqual(['2']);
    expect(filterItems(items, 'leao').map((i) => i.messageId)).toEqual(['3']);
  });

  test('procura também na descrição (linhas depois da primeira)', () => {
    expect(filterItems(items, 'dublado').map((i) => i.messageId)).toEqual(['1']);
  });

  test('várias palavras: todas precisam aparecer, em qualquer ordem', () => {
    expect(filterItems(items, 'episodio panico').map((i) => i.messageId)).toEqual(['2']);
    expect(filterItems(items, 'enrolados leao')).toEqual([]);
  });

  test('vídeo sem legenda nunca casa com um texto, e nada casa devolve lista vazia', () => {
    expect(filterItems(items, 'video').map((i) => i.messageId)).toEqual([]);
    expect(filterItems([item('9', null)], 'x')).toEqual([]);
  });

  test('não altera a lista original e mantém a ordem', () => {
    const copy = [...items];
    filterItems(items, 'e');
    expect(items).toEqual(copy);
    expect(filterItems(items, '1').map((i) => i.messageId)).toEqual(['1', '2', '3']);
  });
});
