import { describe, expect, test } from 'bun:test';
import { NAV_ITEMS } from '../../src/client/app/nav-model.ts';
import { paletteKeyLabel, resolveKey, shortcutHelpRows } from '../../src/client/app/shortcut-keys.ts';

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

  test('"v" alterna o tema, e só sem o prefixo pendente', () => {
    expect(resolveKey('v', false)).toEqual({ kind: 'theme' });
    expect(resolveKey('v', true)).toEqual({ kind: 'none' });
  });

  test('"?" abre a ajuda; "s" sozinho não faz nada (e depois do "g" vai à busca)', () => {
    expect(resolveKey('?', false)).toEqual({ kind: 'help' });
    expect(resolveKey('s', false)).toEqual({ kind: 'none' });
    expect(resolveKey('s', true)).toEqual({ kind: 'go', path: '/search' });
  });
});

describe('paletteKeyLabel', () => {
  test('mostra ⌘K em Mac e iPhone, Ctrl K no resto', () => {
    expect(paletteKeyLabel('MacIntel')).toBe('⌘K');
    expect(paletteKeyLabel('iPhone')).toBe('⌘K');
    expect(paletteKeyLabel('Win32')).toBe('Ctrl K');
    expect(paletteKeyLabel('Linux x86_64')).toBe('Ctrl K');
  });
});

describe('shortcutHelpRows', () => {
  test('lista todos os atalhos de navegação de NAV_ITEMS e adapta ⌘K no Mac', () => {
    const macRows = shortcutHelpRows('MacIntel');
    expect(macRows[0]?.[0]).toContain('⌘K');
    for (const item of NAV_ITEMS) {
      expect(macRows).toContainEqual([`g  ${item.key}`, item.label]);
    }
  });
});
