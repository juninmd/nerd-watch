import { describe, expect, test } from 'bun:test';
import { clockLabel } from '../../src/client/player/player-clock.ts';

describe('relógio do player', () => {
  const now = new Date(2026, 10, 27, 21, 34, 0);

  test('soma o que falta à hora atual', () => {
    expect(clockLabel(now, 600, 600 + 77 * 60, 1)).toBe('21:34 · termina 22:51');
  });

  test('a velocidade encurta o fim (2x = metade do tempo)', () => {
    expect(clockLabel(now, 0, 60 * 60, 2)).toBe('21:34 · termina 22:04');
  });

  test('sem duração (ao vivo, carregando) ou no fim mostra só a hora', () => {
    expect(clockLabel(now, 0, Number.NaN, 1)).toBe('21:34');
    expect(clockLabel(now, 100, 100, 1)).toBe('21:34');
  });
});
