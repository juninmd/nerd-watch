import { describe, expect, test } from 'bun:test';
import { canReach, isRevisit } from '../src/client/scroll-memory.ts';

describe('isRevisit (volta/avanço restaura, link novo começa no topo)', () => {
  test('entrada marcada para a mesma rota é uma revisita', () => {
    expect(isRevisit({ nwKey: '/library?status=all' }, '/library?status=all')).toBe(true);
  });

  test('link novo (state nulo) ou de outra rota não restaura', () => {
    expect(isRevisit(null, '/library')).toBe(false);
    expect(isRevisit(undefined, '/library')).toBe(false);
    expect(isRevisit({ nwKey: '/agenda' }, '/library')).toBe(false);
  });

  test('state malformado não lança', () => {
    expect(isRevisit('texto', '/library')).toBe(false);
    expect(isRevisit({ nwKey: 42 }, '42')).toBe(false);
  });
});

describe('canReach (só rola quando o conteúdo já cobre a posição)', () => {
  test('conteúdo maior que a posição + viewport', () => {
    expect(canReach(800, 2000, 900)).toBe(true);
  });

  test('conteúdo ainda carregando não alcança a posição', () => {
    expect(canReach(800, 900, 900)).toBe(false);
  });

  test('posição zero sempre alcançável (página nova no topo)', () => {
    expect(canReach(0, 900, 900)).toBe(true);
  });
});
