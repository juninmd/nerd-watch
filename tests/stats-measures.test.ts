import { describe, expect, test } from 'bun:test';
import {
  busiestWeekday,
  longestStreak,
  ratingSummary,
  topGenres,
  weekdayCounts,
} from '../src/server/stats/measures.ts';

describe('longestStreak: dias civis com atividade, em sequência', () => {
  test('lista vazia não tem sequência', () => {
    expect(longestStreak([])).toBeNull();
  });

  test('um dia só é uma sequência de 1', () => {
    expect(longestStreak(['2026-05-10'])).toEqual({ days: 1, start: '2026-05-10', end: '2026-05-10' });
  });

  test('dias repetidos e fora de ordem não inflam a sequência', () => {
    expect(longestStreak(['2026-05-12', '2026-05-10', '2026-05-10', '2026-05-11', '2026-05-20'])).toEqual({
      days: 3,
      start: '2026-05-10',
      end: '2026-05-12',
    });
  });

  test('atravessa virada de mês, de ano e o 29 de fevereiro', () => {
    expect(longestStreak(['2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02'])?.days).toBe(4);
    expect(longestStreak(['2024-02-28', '2024-02-29', '2024-03-01'])?.days).toBe(3);
    expect(longestStreak(['2025-02-28', '2025-03-01'])?.days).toBe(2);
  });

  test('a maior sequência vence mesmo quando aparece depois', () => {
    const dates = ['2026-01-01', '2026-01-02', '2026-03-01', '2026-03-02', '2026-03-03', '2026-03-04'];
    expect(longestStreak(dates)).toEqual({ days: 4, start: '2026-03-01', end: '2026-03-04' });
  });
});

describe('weekdayCounts e busiestWeekday', () => {
  test('sem eventos: contagem zerada e nenhum dia mais movimentado', () => {
    expect(weekdayCounts([])).toEqual([0, 0, 0, 0, 0, 0, 0]);
    expect(busiestWeekday([0, 0, 0, 0, 0, 0, 0])).toBeNull();
  });

  test('conta por dia da semana (0 = domingo) e escolhe o maior', () => {
    // 2026-03-01 é domingo; 2026-03-08 também; 2026-03-03 é terça.
    const counts = weekdayCounts(['2026-03-01', '2026-03-08', '2026-03-03']);
    expect(counts[0]).toBe(2);
    expect(counts[2]).toBe(1);
    expect(busiestWeekday(counts)).toBe(0);
  });

  test('empate fica com o primeiro dia (domingo antes de segunda)', () => {
    expect(busiestWeekday([1, 0, 1, 0, 0, 0, 0])).toBe(0);
  });
});

describe('ratingSummary: distribuição 0-10 e média', () => {
  test('sem nenhuma nota: média nula e tudo sem nota', () => {
    expect(ratingSummary([])).toEqual({
      counts: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      average: null,
      rated: 0,
      unrated: 0,
    });
    expect(ratingSummary([null, null])).toMatchObject({ average: null, rated: 0, unrated: 2 });
  });

  test('conta cada nota inteira e separa as sem nota', () => {
    const s = ratingSummary([8, 8, 6, null]);
    expect(s.counts[8]).toBe(2);
    expect(s.counts[6]).toBe(1);
    expect(s.rated).toBe(3);
    expect(s.unrated).toBe(1);
    expect(s.average).toBe(7.3);
  });

  test('notas fora da faixa são limitadas a 0..10 e arredondadas', () => {
    const s = ratingSummary([10.6, -2, 7.4]);
    expect(s.counts[10]).toBe(1);
    expect(s.counts[0]).toBe(1);
    expect(s.counts[7]).toBe(1);
  });
});

describe('topGenres: gêneros por título, sem contar nada duas vezes', () => {
  test('um título com gênero repetido conta uma vez; nulo e lista vazia são "sem gênero"', () => {
    const r = topGenres([['Drama', 'Drama', 'Suspense'], null, [], ['Drama']]);
    expect(r.top).toEqual([
      { name: 'Drama', titles: 2 },
      { name: 'Suspense', titles: 1 },
    ]);
    expect(r.untagged).toBe(2);
  });

  test('empate de contagem ordena por nome; o limite corta o topo', () => {
    const genres = Array.from({ length: 12 }, (_, i) => [`G${String(i).padStart(2, '0')}`]);
    const r = topGenres(genres, 10);
    expect(r.top).toHaveLength(10);
    expect(r.top[0]?.name).toBe('G00');
    expect(r.untagged).toBe(0);
  });

  test('ordena nomes com acento pelo português, não pelo código Unicode', () => {
    const r = topGenres([['Terror'], ['Ação'], ['Ficção']]);
    expect(r.top.map((g) => g.name)).toEqual(['Ação', 'Ficção', 'Terror']);
  });
});
