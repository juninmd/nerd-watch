import { describe, expect, test } from 'bun:test';
import { filterEntries, normalize, scoreText, type PaletteEntry, type PaletteGroup } from '../src/client/palette-search.ts';

const entry = (group: PaletteGroup, title: string, sub?: string): PaletteEntry => ({ id: `${group}:${title}`, group, title, sub, run: () => {} });

describe('normalize / scoreText', () => {
  test('ignora acento e caixa', () => {
    expect(normalize('São Paulo')).toBe('sao paulo');
    expect(scoreText('Viagem à Lua', 'a lua')).toBeGreaterThan(0);
  });

  test('prefixo vale mais que palavra, que vale mais que trecho', () => {
    expect(scoreText('Nosferatu', 'nos')).toBe(3);
    expect(scoreText('O Último Farol', 'far')).toBe(2);
    expect(scoreText('Metropolis', 'tropo')).toBe(1);
    expect(scoreText('Metropolis', 'xyz')).toBe(0);
  });

  test('@handle de canal casa pelo nome sem o @', () => {
    expect(scoreText('@series_em_foco', 'foco')).toBe(2);
  });
});

describe('filterEntries', () => {
  const all = [
    entry('Títulos', 'Cidade das Marés'),
    entry('Títulos', 'Nosferatu', 'filme · quero ver'),
    entry('Canais', '@cinema_classico'),
    entry('Ações', 'Ir para a Agenda'),
    entry('Ações', 'Exportar backup'),
    entry('Catálogo', 'Buscar “mar” no catálogo'),
  ];

  test('sem consulta mostra só as ações', () => {
    expect(filterEntries(all, '  ').map((e) => e.title)).toEqual(['Ir para a Agenda', 'Exportar backup']);
  });

  test('com consulta, agrupa na ordem fixa e mantém a busca no catálogo sempre', () => {
    const got = filterEntries(all, 'mar');
    expect(got.map((e) => e.group)).toEqual(['Títulos', 'Catálogo']);
    expect(got[0]?.title).toBe('Cidade das Marés');
  });

  test('melhor pontuação primeiro dentro do grupo', () => {
    const list = [entry('Títulos', 'A Noite dos Mortos'), entry('Títulos', 'Noite Vermelha'), entry('Títulos', 'Uma Noite Qualquer')];
    expect(filterEntries(list, 'noite').map((e) => e.title)).toEqual(['Noite Vermelha', 'A Noite dos Mortos', 'Uma Noite Qualquer']);
  });

  test('limita a 6 por grupo', () => {
    const many = Array.from({ length: 20 }, (_, i) => entry('Títulos', `Filme ${i}`));
    expect(filterEntries(many, 'filme')).toHaveLength(6);
  });

  test('o sub (ex.: status) também é pesquisável, com peso menor', () => {
    expect(filterEntries(all, 'quero').map((e) => e.title)).toContain('Nosferatu');
  });
});
