import { describe, expect, test } from 'bun:test';
import { icon, isIconName } from '../src/client/icons.ts';

describe('isIconName', () => {
  test('aceita só ícones que existem de verdade', () => {
    expect(isIconName('folder')).toBe(true);
    expect(isIconName('nao-existe')).toBe(false);
  });

  test('propriedades herdadas do objeto não são ícones (um descritor com icon "toString" não injeta código no SVG)', () => {
    for (const name of ['toString', 'constructor', 'hasOwnProperty', '__proto__']) expect(isIconName(name)).toBe(false);
    expect(icon('folder')).toContain('<svg');
  });
});
