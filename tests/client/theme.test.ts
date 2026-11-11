import { describe, expect, test } from 'bun:test';
import { nextThemePref, parseThemePref, resolveTheme, THEME_COLOR } from '../../src/client/app/theme.ts';

describe('tema', () => {
  test('preferência inválida ou ausente cai no escuro (padrão do app)', () => {
    expect(parseThemePref(null)).toBe('dark');
    expect(parseThemePref('roxo')).toBe('dark');
    expect(parseThemePref('light')).toBe('light');
    expect(parseThemePref('system')).toBe('system');
  });

  test('"sistema" acompanha o aparelho; as outras ignoram', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
    expect(resolveTheme('light', true)).toBe('light');
  });

  test('o botão cicla escuro → claro → sistema → escuro', () => {
    expect(nextThemePref('dark')).toBe('light');
    expect(nextThemePref('light')).toBe('system');
    expect(nextThemePref('system')).toBe('dark');
  });

  test('theme-color de cada tema é o fundo do tokens.css', () => {
    expect(THEME_COLOR.dark).toBe('#0a0b12');
    expect(THEME_COLOR.light).toBe('#eeedf6');
  });
});
