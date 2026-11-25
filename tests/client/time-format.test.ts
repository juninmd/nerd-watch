import { describe, expect, test } from 'bun:test';
import { addDays, countByDay, datedFileName, formatDuration, localIsoDate } from '../../src/client/ui/time-format.ts';

describe('localIsoDate', () => {
  test('usa o dia local, não o UTC (23:30 local continua no mesmo dia)', () => {
    expect(localIsoDate(new Date(2026, 0, 5, 23, 30))).toBe('2026-01-05');
  });

  test('completa mês e dia com zero à esquerda', () => {
    expect(localIsoDate(new Date(2026, 2, 9))).toBe('2026-03-09');
  });
});

describe('datedFileName', () => {
  test('backup exportado às 23:30 leva a data local, não a de amanhã em UTC', () => {
    expect(datedFileName('nerd-watch-backup', 'json', new Date(2026, 10, 20, 23, 30))).toBe('nerd-watch-backup-2026-11-20.json');
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

describe('countByDay', () => {
  test('conta as entradas de cada dia, inclusive repetidas', () => {
    expect(countByDay([{ date: '2026-01-31' }, { date: '2026-01-31' }, { date: '2026-02-02' }])).toEqual({
      '2026-01-31': 2,
      '2026-02-02': 1,
    });
  });

  test('lista vazia não conta nada', () => {
    expect(countByDay([])).toEqual({});
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
