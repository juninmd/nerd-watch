import { describe, expect, test } from 'bun:test';
import { addDays, formatDuration, localIsoDate, weekCells } from '../src/client/time-format.ts';

describe('localIsoDate', () => {
  test('usa o dia local, não o UTC (23:30 local continua no mesmo dia)', () => {
    expect(localIsoDate(new Date(2026, 0, 5, 23, 30))).toBe('2026-01-05');
  });

  test('completa mês e dia com zero à esquerda', () => {
    expect(localIsoDate(new Date(2026, 2, 9))).toBe('2026-03-09');
  });
});

describe('addDays', () => {
  test('atravessa o fim do mês e do ano', () => {
    expect(localIsoDate(addDays(new Date(2026, 11, 30), 3))).toBe('2027-01-02');
  });

  test('não altera a data original', () => {
    const base = new Date(2026, 5, 1);
    addDays(base, 10);
    expect(localIsoDate(base)).toBe('2026-06-01');
  });
});

describe('weekCells', () => {
  test('gera n dias seguidos e conta as entradas de cada um', () => {
    const cells = weekCells(new Date(2026, 0, 30), 4, [{ date: '2026-01-31' }, { date: '2026-01-31' }, { date: '2026-02-02' }, { date: '2026-03-01' }]);
    expect(cells.map((c) => [c.iso, c.count])).toEqual([
      ['2026-01-30', 0],
      ['2026-01-31', 2],
      ['2026-02-01', 0],
      ['2026-02-02', 1],
    ]);
  });
});

describe('formatDuration', () => {
  test.each([
    [65, '1:05'],
    [3600, '1h00'],
    [5400, '1h30'],
    [9, '0:09'],
  ])('%p s → %p', (seconds, expected) => {
    expect(formatDuration(seconds)).toBe(expected);
  });

  test('ausente, zero ou negativo vira null', () => {
    expect(formatDuration(null)).toBeNull();
    expect(formatDuration(0)).toBeNull();
    expect(formatDuration(-5)).toBeNull();
  });
});
