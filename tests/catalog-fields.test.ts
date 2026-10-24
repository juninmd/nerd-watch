import { describe, expect, test } from 'bun:test';
import {
  decodeGenres,
  encodeGenres,
  GENRES_MAX,
  normalizeGenres,
  normalizeRuntimeMinutes,
  RUNTIME_MAX_MINUTES,
} from '../src/server/stats/catalog-fields.ts';

describe('normalizeGenres: o provider não é confiável, então a lista é limpa antes de gravar', () => {
  test('aceita lista normal e preserva a ordem do catálogo', () => {
    expect(normalizeGenres(['Drama', 'Ficção científica'])).toEqual(['Drama', 'Ficção científica']);
  });

  test('não-lista (ausente, objeto, string) vira null: "desconhecido", não lista vazia', () => {
    expect(normalizeGenres(undefined)).toBeNull();
    expect(normalizeGenres(null)).toBeNull();
    expect(normalizeGenres('Drama')).toBeNull();
    expect(normalizeGenres({ 0: 'Drama' })).toBeNull();
  });

  test('descarta itens que não são texto e nomes vazios; apara e colapsa espaços', () => {
    expect(normalizeGenres(['  Ação  ', 42, null, '', '   ', 'Terror  \t  noir', { name: 'X' }])).toEqual([
      'Ação',
      'Terror noir',
    ]);
  });

  test('remove repetidos e mantém a primeira ocorrência', () => {
    expect(normalizeGenres(['Drama', 'Comédia', 'Drama'])).toEqual(['Drama', 'Comédia']);
  });

  test('limita a GENRES_MAX itens e a 40 caracteres por nome', () => {
    const many = Array.from({ length: GENRES_MAX + 5 }, (_, i) => `G${i}`);
    expect(normalizeGenres(many)).toHaveLength(GENRES_MAX);
    expect(normalizeGenres(['x'.repeat(200)])?.[0]?.length).toBe(40);
  });

  test('lista vazia é um valor válido (o catálogo respondeu: não tem gênero)', () => {
    expect(normalizeGenres([])).toEqual([]);
  });
});

describe('encode/decode de titles.genres', () => {
  test('ida e volta preserva a lista, inclusive acentos', () => {
    expect(decodeGenres(encodeGenres(['Animação', 'Ação e aventura']))).toEqual(['Animação', 'Ação e aventura']);
  });

  test('null continua null nos dois sentidos (nunca buscado)', () => {
    expect(encodeGenres(null)).toBeNull();
    expect(decodeGenres(null)).toBeNull();
    expect(decodeGenres(undefined)).toBeNull();
  });

  test('texto corrompido ou que não é array não derruba a leitura', () => {
    expect(decodeGenres('{not json')).toBeNull();
    expect(decodeGenres('{"genre":"Drama"}')).toBeNull();
    expect(decodeGenres('"Drama"')).toBeNull();
    expect(decodeGenres('[1, 2]')).toEqual([]);
  });
});

describe('normalizeRuntimeMinutes', () => {
  test('minutos inteiros positivos passam; fração é arredondada', () => {
    expect(normalizeRuntimeMinutes(45)).toBe(45);
    expect(normalizeRuntimeMinutes(44.6)).toBe(45);
  });

  test('zero, negativo, NaN, infinito, texto e acima do teto viram null', () => {
    expect(normalizeRuntimeMinutes(0)).toBeNull();
    expect(normalizeRuntimeMinutes(-5)).toBeNull();
    expect(normalizeRuntimeMinutes(Number.NaN)).toBeNull();
    expect(normalizeRuntimeMinutes(Number.POSITIVE_INFINITY)).toBeNull();
    expect(normalizeRuntimeMinutes('90')).toBeNull();
    expect(normalizeRuntimeMinutes(undefined)).toBeNull();
    expect(normalizeRuntimeMinutes(RUNTIME_MAX_MINUTES + 1)).toBeNull();
    expect(normalizeRuntimeMinutes(RUNTIME_MAX_MINUTES)).toBe(RUNTIME_MAX_MINUTES);
  });
});
