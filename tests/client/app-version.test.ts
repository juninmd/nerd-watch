import { describe, expect, test } from 'bun:test';
import { versionLabel } from '../../src/client/platform/version.ts';

describe('versão instalada na UI', () => {
  test('mostra a versão do app com o prefixo "v"', () => {
    expect(versionLabel('0.3.1')).toBe('versão instalada: v0.3.1');
  });

  test('no navegador (sem app instalado) não mostra linha nenhuma', () => {
    expect(versionLabel(null)).toBeNull();
    expect(versionLabel('')).toBeNull();
  });
});
