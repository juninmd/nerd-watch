import { describe, expect, test } from 'bun:test';
import { createRefreshGate } from '../../src/client/app/refresh-gate.ts';

describe('createRefreshGate', () => {
  test('não deixa duas rodadas correrem juntas, nem no clique manual', () => {
    const gate = createRefreshGate(1000, () => 0);
    expect(gate.tryStart()).toBe(true);
    expect(gate.tryStart(true)).toBe(false);
    gate.finish();
    expect(gate.busy).toBe(false);
  });

  test('automático respeita o intervalo mínimo; manual o ignora', () => {
    let t = 0;
    const gate = createRefreshGate(1000, () => t);
    expect(gate.tryStart()).toBe(true);
    gate.finish();
    t = 999;
    expect(gate.tryStart()).toBe(false);
    expect(gate.tryStart(true)).toBe(true);
    gate.finish();
    t = 1998;
    expect(gate.tryStart()).toBe(false);
    t = 1999;
    expect(gate.tryStart()).toBe(true);
  });

  test('rodada que falha também libera o porteiro (finish em finally)', () => {
    const gate = createRefreshGate(0, () => 0);
    gate.tryStart();
    gate.finish();
    expect(gate.tryStart()).toBe(true);
  });
});
