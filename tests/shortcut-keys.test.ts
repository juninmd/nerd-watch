import { describe, expect, test } from 'bun:test';
import { resolveKey } from '../src/client/shortcut-keys.ts';

describe('resolveKey', () => {
  test('Ctrl/Cmd+K e "/" abrem a paleta', () => {
    expect(resolveKey('k', false, true)).toEqual({ kind: 'palette' });
    expect(resolveKey('K', false, true)).toEqual({ kind: 'palette' });
    expect(resolveKey('/', false)).toEqual({ kind: 'palette' });
  });

  test('outras combinações com Ctrl não disparam nada (ex.: Ctrl+S do navegador)', () => {
    expect(resolveKey('s', false, true)).toEqual({ kind: 'none' });
  });

  test('"g" arma o prefixo e a letra seguinte navega', () => {
    expect(resolveKey('g', false)).toEqual({ kind: 'pending' });
    expect(resolveKey('t', true)).toEqual({ kind: 'go', path: '/telegram' });
    expect(resolveKey('c', true)).toEqual({ kind: 'go', path: '/connections' });
  });

  test('depois do "g", letra desconhecida cancela o prefixo sem navegar', () => {
    expect(resolveKey('z', true)).toEqual({ kind: 'none' });
  });

  test('"s" alterna spoilers e "?" abre a ajuda — só sem o prefixo pendente', () => {
    expect(resolveKey('s', false)).toEqual({ kind: 'spoilers' });
    expect(resolveKey('?', false)).toEqual({ kind: 'help' });
    expect(resolveKey('s', true)).toEqual({ kind: 'none' });
  });
});
