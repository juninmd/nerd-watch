import { describe, expect, test } from 'bun:test';
import { SAVED_VIEW_QUERY_MAX_CHARS, SAVED_VIEW_NAME_MAX, parseStoredViewQuery, parseViewName, parseViewQuery, serializeViewQuery } from '../src/server/saved-views/schema.ts';
import { ValidationError } from '../src/server/validation-error.ts';

describe('parseViewQuery: lista de chaves e valores permitidos', () => {
  test('aceita uma combinação válida e completa', () => {
    expect(parseViewQuery({ status: 'watched', source: 'tmdb', layout: 'list', sort: 'title' })).toEqual({
      status: 'watched',
      source: 'tmdb',
      layout: 'list',
      sort: 'title',
    });
  });

  test('chaves ausentes assumem o padrão (visão "tudo, grade, recentes")', () => {
    expect(parseViewQuery({})).toEqual({ status: 'all', source: 'all', layout: 'grid', sort: 'recent' });
  });

  test('chave desconhecida é recusada, inclusive __proto__ e chaves parecidas com SQL', () => {
    expect(() => parseViewQuery({ status: 'all', foo: 'bar' })).toThrow(ValidationError);
    expect(() => parseViewQuery(JSON.parse('{"__proto__":{"status":"watched"}}'))).toThrow(ValidationError);
    expect(() => parseViewQuery({ 'status; DROP TABLE library_entries': 'all' })).toThrow(ValidationError);
  });

  test('valor fora da lista branca é recusado, mesmo parecendo SQL ou HTML', () => {
    for (const bad of [
      { status: "watched' OR '1'='1" },
      { source: 'tmdb; DROP TABLE titles' },
      { sort: '(SELECT 1)' },
      { layout: '<img src=x onerror=alert(1)>' },
      { status: 'WATCHED' },
    ]) {
      expect(() => parseViewQuery(bad)).toThrow(ValidationError);
    }
  });

  test('tipo errado é recusado (número, null, lista, objeto aninhado)', () => {
    for (const bad of [{ status: 1 }, { status: null }, { status: ['watched'] }, { status: { value: 'watched' } }, { sort: true }]) {
      expect(() => parseViewQuery(bad)).toThrow(ValidationError);
    }
  });

  test('o corpo precisa ser um objeto simples', () => {
    for (const bad of [null, 'watched', ['watched'], 42, undefined]) {
      expect(() => parseViewQuery(bad)).toThrow(ValidationError);
    }
  });

  test('payload acima do teto é recusado antes de qualquer validação de valor', () => {
    const huge = { status: 'all', notes: 'x'.repeat(SAVED_VIEW_QUERY_MAX_CHARS) };
    expect(() => parseViewQuery(huge)).toThrow(ValidationError);
  });
});

describe('serializeViewQuery / parseStoredViewQuery', () => {
  test('serialização é determinística (mesma combinação, mesmo texto) e volta igual', () => {
    const a = serializeViewQuery({ sort: 'rating', layout: 'list', source: 'all', status: 'want' });
    const b = serializeViewQuery({ status: 'want', source: 'all', layout: 'list', sort: 'rating' });
    expect(a).toBe(b);
    expect(parseStoredViewQuery(a)).toEqual({ status: 'want', source: 'all', layout: 'list', sort: 'rating' });
  });

  test('texto guardado que não é JSON ou não passa na validação é recusado (backup adulterado)', () => {
    expect(() => parseStoredViewQuery('{não é json')).toThrow(ValidationError);
    expect(() => parseStoredViewQuery('{"status":"apagar"}')).toThrow(ValidationError);
  });
});

describe('parseViewName', () => {
  test('aparado, 1 a 40 caracteres, sem controle', () => {
    expect(parseViewName('  Terror e suspense  ')).toBe('Terror e suspense');
    expect(() => parseViewName('   ')).toThrow(ValidationError);
    expect(() => parseViewName('a'.repeat(SAVED_VIEW_NAME_MAX + 1))).toThrow(ValidationError);
    expect(() => parseViewName('linha\nquebrada')).toThrow(ValidationError);
    expect(() => parseViewName(12)).toThrow(ValidationError);
  });

  test('texto com cara de injeção vira só texto', () => {
    expect(parseViewName(`x' OR 1=1 --`)).toBe(`x' OR 1=1 --`);
  });
});
