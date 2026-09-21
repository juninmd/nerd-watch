import { describe, expect, test } from 'bun:test';
import { isWithinWindow, todayIso } from '../src/server/date.ts';

describe('isWithinWindow', () => {
  test('data igual a "hoje" entra na janela', () => {
    expect(isWithinWindow('2026-09-20', '2026-09-20', 30)).toBe(true);
  });

  test('data no limite exato dos N dias entra', () => {
    expect(isWithinWindow('2026-10-20', '2026-09-20', 30)).toBe(true);
  });

  test('um dia além do limite não entra', () => {
    expect(isWithinWindow('2026-10-21', '2026-09-20', 30)).toBe(false);
  });

  test('data passada não entra', () => {
    expect(isWithinWindow('2026-09-19', '2026-09-20', 30)).toBe(false);
  });

  test('data nula não entra', () => {
    expect(isWithinWindow(null, '2026-09-20', 30)).toBe(false);
  });

  test('data inválida não entra e não lança', () => {
    expect(isWithinWindow('not-a-date', '2026-09-20', 30)).toBe(false);
  });

  test('atravessa virada de ano corretamente', () => {
    expect(isWithinWindow('2027-01-05', '2026-12-28', 14)).toBe(true);
    expect(isWithinWindow('2027-01-15', '2026-12-28', 14)).toBe(false);
  });
});

describe('todayIso', () => {
  test('usa a data local, não UTC (regressão: toISOString() já vira o dia seguinte à noite em fusos negativos)', () => {
    // 23:30 no horário local (qualquer fuso) — em UTC isso já seria o dia seguinte se usássemos toISOString().
    const localNight = new Date(2026, 8, 20, 23, 30, 0);
    expect(todayIso(localNight)).toBe('2026-09-20');
  });

  test('preenche mês e dia com zero à esquerda', () => {
    expect(todayIso(new Date(2026, 0, 5))).toBe('2026-01-05');
  });
});
