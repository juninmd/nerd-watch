import { describe, expect, test } from 'bun:test';
import { pluralize } from '../src/client/pluralize.ts';

describe('pluralize (pt-BR)', () => {
  test('singular só quando a contagem é exatamente 1', () => {
    expect(pluralize(1, 'episódio', 'episódios')).toBe('1 episódio');
  });

  test('zero e demais usam o plural', () => {
    expect(pluralize(0, 'episódio', 'episódios')).toBe('0 episódios');
    expect(pluralize(12, 'episódio', 'episódios')).toBe('12 episódios');
  });
});
