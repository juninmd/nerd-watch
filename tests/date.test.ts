import { describe, expect, test } from 'bun:test';
import { isWithinWindow } from '../src/server/date.ts';

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
